import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useApp, ptyIdFor, upsertShared } from "../store";
import { deliverBriefWhenReady } from "../lib/ptyReady";
import { sessionTitle } from "../lib/sessionTitle";
import {
  EMPTY_BRIDGE, newlyPending, parseBridge, pending, pendingCount, planToTasks,
  type BridgeHandoff, type BridgePlan, type BridgeState,
} from "../lib/bridge";
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

interface BridgeConn { desktop: boolean; code: boolean; desktopInstalled: boolean; node: string | null }

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
  if (announce) for (const msg of newlyPending(prev, next)) useApp.getState().toast(`${msg} — open Claude bridge`);
  void mirrorToTeam(next);
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
  if (st.appSettings.brainChecks === false) return;
  const now = Date.now();
  if (now - (lastCheck[memberId] ?? 0) < CHECK_EVERY_MS) return;
  lastCheck[memberId] = now;
  const { invoke } = await import("@tauri-apps/api/core");
  const r = await invoke<{ session: string; mismatch: boolean; reason: string; doneTaskIds: string[]; startedTaskIds: string[] } | null>(
    "brain_check", { memberId },
  ).catch(() => null);
  if (!r) return;
  if (r.mismatch) {
    st.toast(`⚠ ${r.session} may be off-plan: ${r.reason}`, "warn");
    void import("./Automations").then(({ alertEverywhere }) => alertEverywhere("Off-plan work", `${r.session}: ${r.reason}`));
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
  st.toast(`Board: ${changed.map((t) => `“${t.title}” → ${t.status === "done" ? "done" : "in progress"}`).join(", ")}`);
}

/** Mount once (App): live bridge state + the "coder finished" ping. */
export function useBridgeFeed() {
  const lastPing = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!native()) {
      // browser dev: sample items so the Flow view / panel are browsable
      void import("../data/fakeBridge").then(({ FAKE_BRIDGE }) => useBridge.setState({ state: FAKE_BRIDGE }));
      return;
    }
    let alive = true;
    let unlisten: (() => void) | undefined;
    void refresh(false);
    void refreshConn();
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen("bridge-changed", () => void refresh(true)).then((u) => { if (alive) unlisten = u; else u(); }),
    );
    const poll = setInterval(() => void refresh(true), 5000);

    // ping: a session that was working goes idle → nudge a review in the Claude app
    let prev = new Map(useApp.getState().teammates.map((t) => [t.id, t.status]));
    const unsub = useApp.subscribe((s) => {
      const conn = useBridge.getState().conn;
      for (const t of s.teammates) {
        const was = prev.get(t.id);
        if (was === "working" && t.status === "idle") void runBrainCheck(t.id);
        if (was === "working" && t.status === "idle" && (conn?.desktop || conn?.code)) {
          const now = Date.now();
          if (now - (lastPing.current[t.id] ?? 0) > 120_000) {
            lastPing.current[t.id] = now;
            const title = sessionTitle(t, s.appSettings.sessionTitles);
            s.toast(`${title} finished — ask the Claude app: "what did ${title} just do?"`);
          }
        }
      }
      prev = new Map(s.teammates.map((t) => [t.id, t.status]));
    });
    return () => { alive = false; unlisten?.(); clearInterval(poll); unsub(); };
  }, []);
}

// ---- actions (shared with the Flow view) -----------------------------------

export async function bridgeResolve(list: string, id: string, status: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("bridge_resolve", { list, id, status }).catch((e) => useApp.getState().toast(`Bridge: ${e}`, "warn"));
  await refresh(false);
}

/** Approve a handoff: make sure the session is up, then type the message in. */
export async function bridgeSend(h: BridgeHandoff): Promise<boolean> {
  const { members, toast } = useApp.getState();
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

          {p.handoffs.length === 0 && p.plans.length === 0 && p.questions.length === 0 ? (
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
                {h.kind === "answer" ? "Answer" : "Task"} → {h.sessionTitle || h.session}
              </div>
              <div className="text-[12.5px] text-ink whitespace-pre-wrap max-h-48 overflow-y-auto">{h.message}</div>
              {h.userExplanation ? (
                <div className="text-[12px] text-dim border-l-2 border-line pl-2.5">
                  <span className="text-faint">You explained: </span>{h.userExplanation}
                </div>
              ) : null}
              <div className="flex gap-2 pt-1">
                <button className="composer-btn on" disabled={busy === h.id} onClick={() => void send(h)}>
                  <Icon name="push" size={12} /> Send to session
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
