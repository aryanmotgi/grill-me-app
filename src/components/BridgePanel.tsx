import { useEffect, useRef, useState } from "react";
import { note } from "../lib/activity";
import { create } from "zustand";
import { useApp, ptyIdFor, upsertShared } from "../store";
import { deliverBriefWhenReady } from "../lib/ptyReady";
import { sessionTitle } from "../lib/sessionTitle";
import {
  EMPTY_BRIDGE, newlyPending, parseBridge, pending, pendingCount, planToTasks,
  describeAction, type BridgeAction, type BridgeHandoff, type BridgePlan, type BridgeState,
} from "../lib/bridge";
import { inboundFor, questionMirrorsToPush, toTeamHandoff } from "../lib/teamBridge";
import { automationOn } from "../lib/automations";
import { Icon } from "./Icon";
import type { Task } from "../types";

// ---------------------------------------------------------------------------
// Claude bridge UI. The grill-me MCP server lets the Claude app (brainstorm)
// and Claude Code sessions (coders) share context through Grill Me; every
// write it makes lands here as a pending request you approve:
//   handoffs  — a task (or an answer) to type into a session
//   plans     — tasks for the board + the decision behind them
//   questions — a coder asking the brainstorm side something
// ---------------------------------------------------------------------------

interface BridgeConn { desktop: boolean; code: boolean; desktopInstalled: boolean }

export const useBridge = create<{
  state: BridgeState;
  conn: BridgeConn | null;
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({
  state: EMPTY_BRIDGE,
  conn: null,
  open: false,
  setOpen: (open) => set({ open }),
}));

const native = () => "__TAURI_INTERNALS__" in window;

async function refresh(announce: boolean) {
  const { invoke } = await import("@tauri-apps/api/core");
  const next = parseBridge(await invoke<string>("bridge_read").catch(() => ""));
  const prev = useBridge.getState().state;
  useBridge.setState({ state: next });
  if (announce) for (const msg of newlyPending(prev, next)) note(`${msg}. Open Bridge to answer it.`);
  // drafted answers + approve-from-phone pings (BridgeLoop)
  void import("./BridgeLoop").then((l) => l.onBridgeState(prev, next, announce));
  void mirrorToTeam(next);
  void syncTeamBridge(next);
}

/** Who am I in the room, and is the room live (past onboarding)? */
function roomMe(st = useApp.getState()) {
  const me = st.roomSelf?.memberId ?? "";
  const meName = st.room?.members.find((m) => m.id === me)?.name ?? me;
  return { me, meName, live: !!(me && st.room && st.room.phase === "done") };
}

/** Team bridge (team-bridge.json over the room):
 *  - items teammates routed to my sessions → pending local hand-offs (Rust
 *    dedupes by id), then the usual approve-to-type flow;
 *  - my coders' open questions → mirrored so teammates' Claudes can answer;
 *    mirrors close when the local question does. */
const importedIds = new Set<string>();
async function syncTeamBridge(b: BridgeState) {
  const st = useApp.getState();
  const { me, meName, live } = roomMe(st);
  if (!live) return;
  const { invoke } = await import("@tauri-apps/api/core");
  let added = false;
  for (const e of inboundFor(st.teamBridge, me)) {
    if (importedIds.has(e.id)) continue;
    importedIds.add(e.id);
    added = (await invoke<boolean>("bridge_import", { item: e }).catch(() => false)) || added;
  }
  const titleOf = (id: string) => {
    const t = st.teammates.find((x) => x.id === id);
    return t ? sessionTitle(t, st.appSettings.sessionTitles) : id;
  };
  const push = questionMirrorsToPush(b.questions, st.teamBridge, me, meName, titleOf);
  if (push.length) await upsertShared("team-bridge.json", push);
  if (added) await refresh(true); // show (and announce) what just arrived
}

/** Tell the sender what happened to something they routed to me. */
async function reflectToTeam(id: string, status: "sent" | "dismissed") {
  const st = useApp.getState();
  const { me, live } = roomMe(st);
  const e = st.teamBridge.find((x) => x.id === id && x.to === me);
  if (live && e && e.status !== status) {
    await upsertShared("team-bridge.json", [{ ...e, status }]);
    // the approver's machine says so in team chat (only this side posts it)
    if (status === "sent" && e.kind === "handoff") {
      const { meName } = roomMe(st);
      void import("./teamChatActions").then(({ postSystemLine }) =>
        postSystemLine(`${meName} approved ${e.fromName}'s hand-off to “${e.sessionTitle || e.session || "a session"}”`));
    }
  }
}

/** Team brain: in a live room, brain notes + goal ride the room's shared
 *  decisions log (tagged "brain"), so teammates' sessions see them too. */
async function mirrorToTeam(b: BridgeState) {
  const st = useApp.getState();
  if (!st.room || !st.roomSelf || st.room.phase !== "done") return;
  const have = new Set(st.decisions.map((d) => `${d.id}|${d.text}`));
  const author = st.members[0]?.id ?? "me";
  const entries = [
    ...b.notes.map((n) => ({ id: `brain-${n.id}`, text: n.text, epochMs: n.ts })),
    ...(b.goal ? [{ id: "brain-goal", text: `🎯 Goal: ${b.goal}`, epochMs: Date.now() }] : []),
  ]
    .filter((e) => !have.has(`${e.id}|${e.text}`))
    .map((e) => ({ ...e, author, ts: new Date(e.epochMs).toTimeString().slice(0, 5), tag: "brain" }));
  if (!entries.length) return;
  useApp.setState((s) => ({ decisions: [...entries, ...s.decisions.filter((d) => !entries.some((e) => e.id === d.id))] }));
  await upsertShared("decisions.json", entries);
}

/** Re-read bridge.json now (BridgeLoop, after it changed something). */
export const refreshBridge = (announce = false) => (native() ? refresh(announce) : Promise.resolve());

async function refreshConn() {
  const { invoke } = await import("@tauri-apps/api/core");
  const conn = await invoke<BridgeConn>("bridge_status").catch(() => null);
  useBridge.setState({ conn });
}

/** After a session's turn: mismatch check + board update (Claude, fast model).
 *  Throttled per session; off via Brain → Smart checks. */
const lastCheck: Record<string, number> = {};
const CHECK_EVERY_MS = 3 * 60_000;

async function runBrainCheck(memberId: string) {
  const st = useApp.getState();
  // one model call serves both: the plan check and spotting agreed decisions
  const checks = st.appSettings.brainChecks !== false;
  const spot = automationOn(st.appSettings, "spot-decisions");
  if (!checks && !spot) return;
  const now = Date.now();
  if (now - (lastCheck[memberId] ?? 0) < CHECK_EVERY_MS) return;
  lastCheck[memberId] = now;
  const { invoke } = await import("@tauri-apps/api/core");
  const r = await invoke<{ session: string; mismatch: boolean; reason: string; doneTaskIds: string[]; startedTaskIds: string[]; proposed?: number } | null>(
    "brain_check", { memberId, checks, spot },
  ).catch(() => null);
  if (!r) return;
  if (r.proposed) void import("./BrainWatch").then((w) => w.announceProposed(r.session, r.proposed ?? 0));
  if (r.mismatch) {
    note(`${r.session} may be off-plan: ${r.reason}`, "warn");
  }
  const done = new Set(r.doneTaskIds);
  const started = new Set(r.startedTaskIds);
  const changed: Task[] = useApp.getState().tasks.flatMap((t): Task[] => {
    if (done.has(t.id) && t.status !== "done") return [{ ...t, status: "done" }];
    if (started.has(t.id) && t.status === "not-started") return [{ ...t, status: "in-progress", startedAt: Date.now() }];
    return [];
  });
  if (!changed.length) return;
  useApp.setState((s) => ({ tasks: s.tasks.map((t) => changed.find((c) => c.id === t.id) ?? t) }));
  await upsertShared("tasks.json", changed);
  note(`Board: ${changed.map((t) => `“${t.title}” → ${t.status === "done" ? "done" : "in progress"}`).join(", ")}`);
}

/** Mount once (App): live bridge state + the "coder finished" ping. */
export function useBridgeFeed() {
  const lastPing = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!native()) {
      // browser dev: sample items so the Flow view / panel are browsable
      void import("../data/fakeBridge").then(({ FAKE_BRIDGE, FAKE_DRIFT }) => {
        useBridge.setState({ state: FAKE_BRIDGE });
        void import("./BrainWatch").then((w) => w.useDrift.setState({ conflicts: FAKE_DRIFT }));
      });
      return;
    }
    let alive = true;
    const unlisten: (() => void)[] = [];
    void refresh(false);
    void refreshConn();
    import("@tauri-apps/api/event").then(async ({ listen }) => {
      const subs = await Promise.all([
        listen("bridge-changed", () => void refresh(true)),
        // a Grill Me Chat reply landed (any chat, panel open or not): spot decisions in it
        listen<{ chatId: string; isError: boolean }>("brainstorm-done", (e) =>
          void import("./BrainWatch").then((w) => w.onChatDone(e.payload.chatId, e.payload.isError))),
      ]);
      if (alive) unlisten.push(...subs); else subs.forEach((u) => u());
    });
    const poll = setInterval(() => void refresh(true), 5000);
    // reviews on disk, then the phone's approve buttons (no-op unless phone pings are on)
    void import("./BridgeLoop").then((l) => l.loadReviews());
    const phone = setInterval(() => void import("./BridgeLoop").then((l) => l.pollPhone()), 10_000);

    // ping: a session that was working goes idle → nudge a review in the Claude app
    let prev = new Map(useApp.getState().teammates.map((t) => [t.id, t.status]));
    const unsub = useApp.subscribe((s) => {
      const conn = useBridge.getState().conn;
      for (const t of s.teammates) {
        const was = prev.get(t.id);
        if (was === "working" && t.status === "idle") {
          void runBrainCheck(t.id);
          // auto review + hand-off replies
          void import("./BridgeLoop").then((l) => l.onSessionIdle(t.id));
          // drift alarm: compare sessions once several have finished recently
          void import("./BrainWatch").then((w) => w.onSessionFinished(t.id));
        }
        if (was === "working" && t.status === "idle" && (conn?.desktop || conn?.code)) {
          const now = Date.now();
          if (now - (lastPing.current[t.id] ?? 0) > 120_000) {
            lastPing.current[t.id] = now;
            const title = sessionTitle(t, s.appSettings.sessionTitles);
            note(`${title} finished its turn`);
          }
        }
      }
      prev = new Map(s.teammates.map((t) => [t.id, t.status]));
    });
    return () => { alive = false; unlisten.forEach((u) => u()); clearInterval(poll); clearInterval(phone); unsub(); };
  }, []);
}

// ---- actions (shared with the Flow view) -----------------------------------

export async function bridgeResolve(list: string, id: string, status: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("bridge_resolve", { list, id, status }).catch((e) => useApp.getState().toast(`Bridge: ${e}`, "warn"));
  if (list === "handoffs" && (status === "sent" || status === "dismissed")) await reflectToTeam(id, status);
  await refresh(false);
}

/** Approve a handoff: make sure the session is up, then type the message in.
 *  Addressed to a teammate's session? It goes over the room instead, and
 *  they approve it on their side. */
export async function bridgeSend(h: BridgeHandoff): Promise<boolean> {
  const { members, toast } = useApp.getState();
  if (h.to) {
    const st = useApp.getState();
    const { me, meName, live } = roomMe(st);
    if (!live) { toast(`Not in a live team room — can't reach ${h.toName || "that teammate"}`, "warn"); return false; }
    const items = [toTeamHandoff(h, me, meName, Date.now())];
    const q = h.questionId ? st.teamBridge.find((e) => e.id === h.questionId) : undefined;
    if (q) items.push({ ...q, status: "answered" });
    await upsertShared("team-bridge.json", items);
    await bridgeResolve("handoffs", h.id, "sent");
    if (h.kind === "handoff") {
      void import("./teamChatActions").then(({ postSystemLine }) =>
        postSystemLine(`${meName} handed a task to ${h.toName || h.to}'s “${h.sessionTitle || h.session}”`));
    }
    toast(`Sent to ${h.toName || h.to} — they approve it in their Grill Me before it's typed in`);
    return true;
  }
  const m = members.find((x) => x.id === h.session);
  if (!m) { toast(`No session "${h.sessionTitle || h.session}" in this project`, "warn"); return false; }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("pty_ensure", {
    id: ptyIdFor(m.id), cwd: m.repoPath, shell: false,
    remote: m.remote ?? null, tmux: m.tmuxSession ?? null, agent: m.agent ?? null,
  }).catch(() => {});
  await bridgeResolve("handoffs", h.id, "sent");
  toast(`Sending to ${h.sessionTitle || m.name} once it's ready…`);
  const ok = await deliverBriefWhenReady(ptyIdFor(m.id), h.message.endsWith("\n") ? h.message : `${h.message}\n`);
  // the session's next idle after this produces its reply to the hand-off
  if (ok) await invoke("bridge_flag", { id: h.id, flag: "delivered" }).catch(() => {});
  toast(ok ? `Delivered to ${h.sessionTitle || m.name}` : `Couldn't deliver to ${h.sessionTitle || m.name} — it never reached a prompt`, ok ? "info" : "warn");
  return ok;
}

/** Approve a plan: its tasks go on the board, its decision into the log. */
export async function bridgeApply(plan: BridgePlan): Promise<number> {
  const st = useApp.getState();
  const tasks = planToTasks(plan, st.members[0]?.id ?? "me");
  useApp.setState((s) => {
    const byId = new Map(s.tasks.map((t) => [t.id, t]));
    for (const t of tasks) byId.set(t.id, t);
    return { tasks: [...byId.values()] };
  });
  await upsertShared("tasks.json", tasks);
  if (plan.decision) useApp.getState().addDecision(`${plan.title} — ${plan.decision}`, "plan");
  await bridgeResolve("plans", plan.id, "applied");
  st.toast(`${tasks.length} tasks added to the board`);
  return tasks.length;
}

interface RunResult {
  action?: BridgeAction;
  test?: { ok: boolean; ms: number; tail: string; cmd: string; sig: string };
  /** open_preview: the running server (null = started, not listening yet) */
  previewUrl?: string | null;
  /** create_session: the webview spawns it, then reports back */
  spawn?: { id: string; branch: string; task: string };
}

/** Run an action Claude requested (the click IS the approval). Rust
 *  re-validates it and runs it; a new session is spawned here through the
 *  usual template path, then reported back. */
export async function bridgeRunAction(a: BridgeAction): Promise<void> {
  const st = useApp.getState();
  if (!native()) { st.toast("Running actions needs the native app", "warn"); return; }
  const { invoke } = await import("@tauri-apps/api/core");
  let r: RunResult | null = null;
  try {
    r = await invoke<RunResult>("bridge_run_action", { id: a.id });
  } catch (e) {
    st.toast(`Couldn't run it: ${e}`, "warn");
  }
  if (r?.spawn) {
    const { id, branch, task } = r.spawn;
    await st.spawnFromTemplate(id, id, branch, task);
    const ok = useApp.getState().members.some((m) => m.id === id);
    r.action = await invoke<BridgeAction>("bridge_action_finish", {
      id: a.id, ok,
      summary: ok ? `Started session “${id}” on ${branch}; the task goes in once it's ready.` : `Couldn't start a session on ${branch} — see the toast for why.`,
    }).catch(() => r?.action);
  }
  if (r?.test && a.session) {
    const t = r.test;
    const sid = a.session;
    void import("../lib/testsStore").then(({ useTests }) =>
      useTests.setState((s) => ({ results: { ...s.results, [sid]: { ok: t.ok, ms: t.ms, tail: t.tail, cmd: t.cmd, sig: t.sig, at: Date.now() } } })));
  }
  if (a.kind === "open_preview" && r?.action?.outcome?.ok) {
    if (r.previewUrl) st.setAppSetting("previewUrl", r.previewUrl);
    st.setView("preview");
  }
  const o = r?.action?.outcome;
  if (o) st.toast(o.summary, o.ok ? "info" : "warn");
  await refresh(false);
}

/** "Got it" on a finished action's outcome. */
export async function ackAction(id: string): Promise<void> {
  if (!native()) {
    useBridge.setState((b) => ({ state: { ...b.state, actions: (b.state.actions ?? []).map((a) => (a.id === id ? { ...a, outcomeAck: true } : a)) } }));
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("bridge_flag", { id, flag: "actionAck" }).catch(() => {});
  await refresh(false);
}

export function BridgeButton() {
  const count = useBridge((b) => pendingCount(b.state));
  const conn = useBridge((b) => b.conn);
  const setOpen = useBridge((b) => b.setOpen);
  const open = useBridge((b) => b.open);
  const connected = !!(conn?.desktop || conn?.code);
  return (
    <button
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md cursor-pointer transition-colors hover:bg-raised ${
        count ? "text-warn" : open ? "text-ink" : connected ? "text-dim hover:text-ink" : "text-faint hover:text-dim"
      }`}
      title={connected ? "Claude bridge — Claude app ⇄ Claude Code" : "Claude bridge — not connected yet"}
      onClick={() => setOpen(!open)}
    >
      <Icon name="swap" size={12} /> <span className="sb-wide">Bridge</span>
      {count ? <span className="num">{count}</span> : null}
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-line bg-raised/40 p-3.5 flex flex-col gap-2">{children}</div>;
}

export function BridgePanel() {
  const open = useBridge((b) => b.open);
  const setOpen = useBridge((b) => b.setOpen);
  const state = useBridge((b) => b.state);
  const conn = useBridge((b) => b.conn);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState("");

  if (!open) return null;
  const p = pending(state);
  const connected = !!(conn?.desktop || conn?.code);

  const resolve = bridgeResolve;

  const connect = async () => {
    setBusy("connect");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      toast(await invoke<string>("bridge_connect"));
      await refreshConn();
    } catch (e) {
      toast(`Connect failed: ${e}`, "warn");
    } finally {
      setBusy("");
    }
  };

  const send = async (h: BridgeHandoff) => {
    setBusy(h.id);
    try { await bridgeSend(h); } finally { setBusy(""); }
  };

  const apply = async (plan: BridgePlan) => {
    setBusy(plan.id);
    try { await bridgeApply(plan); } finally { setBusy(""); }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <aside className="composer-menu fixed right-3 top-14 bottom-10 z-50 w-[420px] rounded-2xl flex flex-col overflow-hidden rise"
        role="dialog" aria-label="Claude bridge">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-line flex-none">
          <Icon name="swap" size={14} />
          <span className="text-[14px] font-semibold text-ink flex-1">Claude bridge</span>
          <button className="w-7 h-7 rounded-md flex items-center justify-center text-faint hover:text-ink hover:bg-raised cursor-pointer"
            onClick={() => setOpen(false)} aria-label="Close"><Icon name="cross" size={12} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4 select-text">
          {/* connection */}
          <div className="flex items-center gap-3 text-[12px]">
            <span className="flex flex-col gap-0.5 flex-1">
              <span className={conn?.desktop ? "text-ok" : "text-faint"}>● Claude app {conn?.desktop ? "connected" : conn?.desktopInstalled === false ? "not installed" : "not connected"}</span>
              <span className={conn?.code ? "text-ok" : "text-faint"}>● Claude Code {conn?.code ? "connected" : "not connected"}</span>
            </span>
            <button className="composer-btn" disabled={busy === "connect"} onClick={connect}>
              {busy === "connect" ? "Connecting…" : connected ? "Reconnect" : "Connect"}
            </button>
          </div>
          {connected ? null : (
            <p className="text-[11.5px] text-faint leading-relaxed">
              Connect plugs the grill-me MCP server into both. Then restart the Claude app, and new Claude Code sessions pick it up automatically.
            </p>
          )}

          {p.handoffs.length === 0 && p.plans.length === 0 && p.questions.length === 0 && p.actions.length === 0 ? (
            <div className="text-[12px] text-faint leading-relaxed border-t border-line pt-4">
              Nothing waiting. In the Claude app, try:
              <div className="mt-2 flex flex-col gap-1 text-dim">
                <span>“What are my Grill Me sessions doing?”</span>
                <span>“Explain what my Rouge session changed.”</span>
                <span>“Let's plan the next feature, then send it to the coder.”</span>
              </div>
            </div>
          ) : null}

          {p.handoffs.map((h) => (
            <Card key={h.id}>
              <div className="text-[11px] tracking-[0.1em] uppercase text-faint">
                {h.from ? `From ${h.from} · ` : ""}{h.kind === "answer" ? "Answer" : "Task"} → {h.to ? `${h.toName || h.to} · ` : ""}{h.sessionTitle || h.session}
              </div>
              <div className="text-[12.5px] text-ink whitespace-pre-wrap max-h-48 overflow-y-auto">{h.message}</div>
              {h.userExplanation ? (
                <div className="text-[12px] text-dim border-l-2 border-line pl-2.5">
                  <span className="text-faint">You explained: </span>{h.userExplanation}
                </div>
              ) : null}
              <div className="flex gap-2 pt-1">
                <button className="composer-btn on" disabled={busy === h.id} onClick={() => void send(h)}>
                  <Icon name="push" size={12} /> {h.to ? `Send to ${h.toName || "teammate"}` : "Send to session"}
                </button>
                <button className="composer-btn" onClick={() => void resolve("handoffs", h.id, "dismissed")}>Dismiss</button>
              </div>
            </Card>
          ))}

          {p.plans.map((plan) => (
            <Card key={plan.id}>
              <div className="text-[11px] tracking-[0.1em] uppercase text-faint">Plan</div>
              <div className="text-[13.5px] font-semibold text-ink">{plan.title}</div>
              {plan.decision ? <div className="text-[12px] text-dim">{plan.decision}</div> : null}
              <ul className="list-disc pl-5 text-[12.5px] text-dim flex flex-col gap-0.5">
                {plan.tasks.map((t, i) => <li key={i}>{t.title}</li>)}
              </ul>
              <div className="flex gap-2 pt-1">
                <button className="composer-btn on" disabled={busy === plan.id} onClick={() => void apply(plan)}>
                  <Icon name="check" size={12} /> Add {plan.tasks.length} tasks to board
                </button>
                <button className="composer-btn" onClick={() => void resolve("plans", plan.id, "dismissed")}>Dismiss</button>
              </div>
            </Card>
          ))}

          {p.questions.map((q) => (
            <Card key={q.id}>
              <div className="text-[11px] tracking-[0.1em] uppercase text-faint">Question from {q.fromTitle || q.from}</div>
              <div className="text-[12.5px] text-ink whitespace-pre-wrap">{q.question}</div>
              {q.context ? <div className="text-[11.5px] text-faint whitespace-pre-wrap">{q.context}</div> : null}
              <div className="text-[11.5px] text-dim">Answer it in the Claude app — say “answer the open question”.</div>
              <div><button className="composer-btn" onClick={() => void resolve("questions", q.id, "dismissed")}>Dismiss</button></div>
            </Card>
          ))}

          {p.actions.map((a) => (
            <Card key={a.id}>
              <div className="text-[11px] tracking-[0.1em] uppercase text-faint">Action</div>
              <div className="text-[12.5px] text-ink">Claude asks to {describeAction(a)}</div>
              {a.reason ? <div className="text-[12px] text-dim border-l-2 border-line pl-2.5"><span className="text-faint">Why: </span>{a.reason}</div> : null}
              <div className="flex gap-2 pt-1">
                <button className="composer-btn on" onClick={() => { setOpen(false); useApp.getState().setView("flow"); }}>
                  <Icon name="chevron" size={11} /> Review in Flow
                </button>
                <button className="composer-btn" onClick={() => void resolve("actions", a.id, "dismissed")}>Dismiss</button>
              </div>
            </Card>
          ))}

          {state.notes.length ? (
            <div className="border-t border-line pt-3">
              <div className="text-[11px] tracking-[0.1em] uppercase text-faint mb-1.5">Shared notes</div>
              <ul className="flex flex-col gap-1 text-[12px] text-dim">
                {state.notes.slice(-6).reverse().map((n) => <li key={n.id}>• {n.text}{n.by ? <span className="text-faint"> — {n.by}</span> : null}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
