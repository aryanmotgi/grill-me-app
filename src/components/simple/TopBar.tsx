import { useEffect, useState } from "react";
import { ptyIdFor, useApp } from "../../store";
import { useBridge } from "../BridgePanel";
import { pendingCount } from "../../lib/bridge";
import { Icon } from "../Icon";
import { sessionTitle } from "../../lib/sessionTitle";
import { sessionSentence } from "../../lib/sessionSentence";
import { kTokens, money, sessionStats } from "../../lib/coach";
import { submitToAgent } from "../../lib/ptyReady";
import { useTests } from "../../lib/testsStore";
import { automationOn, withAutomation } from "../../lib/automations";
import { ago, goBack, lastTurn, listSavePoints, savePoint, useSavePoints, type SavePoint } from "../../lib/savepoints";
import type { Teammate } from "../../types";
import { useActivity } from "../../lib/activity";
import { span } from "../../lib/limits";

// ---------------------------------------------------------------------------
// Simple layout, top of the middle column. The left half is the session's
// name and one plain sentence of where it is, and it's all window-drag
// space (data-drag-zone; see hooks/useWindowDrag). The right holds the few
// things worth one click: what it cost, whether the tests pass, undo, the
// Peek panel, and Review & ship. The team goal shows only when there is one
// or you're in a team.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

function Chip({ children, title, onClick, tone, on }: {
  children: React.ReactNode; title: string; onClick?: () => void; tone?: "ok" | "warn" | "danger"; on?: boolean;
}) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : on ? "text-ink" : "text-dim";
  const cls = `topbar-chip ${color} ${on ? "on" : ""}`;
  return onClick
    ? <button className={cls} title={title} onClick={onClick}>{children}</button>
    : <span className={cls} title={title}>{children}</span>;
}

function Goal() {
  const goal = useBridge((b) => b.state.goal ?? "");
  const team = useApp((s) => s.appMode === "team");
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<string | null>(null);
  if (!goal && !team && draft === null) return null;
  const save = async () => {
    const g = (draft ?? "").trim();
    setDraft(null);
    if (g === goal) return;
    if (native()) {
      const { invoke } = await import("@tauri-apps/api/core");
      try { await invoke("bridge_set_goal", { goal: g }); } catch (e) { toast(`Couldn't save the goal: ${e}`, "warn"); return; }
    }
    useBridge.setState((b) => ({ state: { ...b.state, goal: g } }));
  };
  return draft !== null ? (
    <input autoFocus aria-label="Team goal" placeholder="e.g. Ship login + feed by 6pm"
      className="w-[260px] bg-raised hairline rounded-md px-2 h-7 text-[12.5px] outline-none focus:border-accent"
      value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void save()}
      onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setDraft(null); }} />
  ) : (
    <button className="topbar-chip text-dim max-w-[260px]" onClick={() => setDraft(goal)}
      title={goal ? `Team goal: every agent is told to stay on this. Click to edit.` : "Set a goal so every agent stays on the same track"}>
      <Icon name="spark" size={11} /> <span className="truncate">{goal || "Set a team goal"}</span>
    </button>
  );
}

function CostChip({ mate }: { mate: Teammate }) {
  const st = sessionStats(mate);
  const toast = useApp((s) => s.toast);
  if (!st) return null;
  if (st.heavy) {
    return (
      <Chip tone="warn" title={`Spent about ${money(st.cost)}. Each message now re-reads ~${kTokens(st.perTurn)} tokens (${money(st.nextMsg)}). Click to compact: it keeps the gist and every message gets cheaper.`}
        onClick={() => void submitToAgent(ptyIdFor(mate.id), "/compact").then(() => toast("Compacting this session"), (e) => toast(`Couldn't compact: ${e}`, "warn"))}>
        {money(st.cost)} · compact
      </Chip>
    );
  }
  return <Chip title={`Spent about ${money(st.cost)} over ${st.turns} messages (estimate at list prices). Each message re-reads ~${kTokens(st.perTurn)} tokens.`}>{money(st.cost)}</Chip>;
}

function TestsChip({ id }: { id: string }) {
  const settings = useApp((s) => s.appSettings);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const toast = useApp((s) => s.toast);
  const r = useTests((t) => t.results[id]);
  if (!automationOn(settings, "auto-test")) {
    return (
      <Chip title="Run the project's tests after each reply that changes something, and show the result here"
        onClick={() => { const [k, v] = withAutomation(settings, "auto-test", true); setAppSetting(k, v); toast("Tests will run after each change"); }}>
        <Icon name="check" size={11} /> Tests
      </Chip>
    );
  }
  if (!r) return <Chip title="Tests run after its next change"><Icon name="check" size={11} /> Tests</Chip>;
  if (r.running) return <Chip title={r.cmd}><span className="spinner" style={{ width: 10, height: 10 }} /> Testing</Chip>;
  if (r.ok) return <Chip tone="ok" title={`${r.cmd} passed`}><Icon name="check" size={11} /> Tests pass</Chip>;
  return (
    <Chip tone="danger" title={`${r.cmd} failed. Click to send the failure to the agent.\n\n${r.tail.slice(-500)}`}
      onClick={() => void submitToAgent(ptyIdFor(id), `The tests fail after your last change (${r.cmd}). Tell me the cause in one line, then fix it:\n\n${r.tail.slice(-1500)}`).catch((e) => toast(`Couldn't send: ${e}`, "warn"))}>
      <Icon name="cross" size={11} /> Tests fail · fix
    </Chip>
  );
}

function UndoChips({ repo }: { repo: string }) {
  const rev = useSavePoints((s) => s.rev);
  const toast = useApp((s) => s.toast);
  const [points, setPoints] = useState<SavePoint[]>([]);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => { void listSavePoints(repo).then(setPoints); }, [repo, rev]);
  const last = lastTurn(points);
  const go = (p: SavePoint) => void goBack(repo, p.id).then((m) => { toast(m); setOpen(false); }, (e) => toast(`Couldn't go back: ${e}`, "warn"));
  return (
    <span className="relative flex items-center" data-no-drag>
      <button className="topbar-chip text-dim rounded-r-none" disabled={!last}
        title={last ? `Undo the last turn: files go back to ${last.label.toLowerCase()}. Where you are now is saved first.` : "Nothing to undo yet. A save point is made before every message you send."}
        onClick={() => last && go(last)}>
        <Icon name="up" size={11} className="-rotate-90" /> Undo
      </button>
      <button className={`topbar-chip text-dim rounded-l-none border-l border-line px-1.5 ${open ? "on" : ""}`} title="All save points" aria-label="All save points" onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={9} className="rotate-90" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="composer-menu absolute right-0 top-full mt-1.5 z-40 w-[300px] max-h-[380px] overflow-y-auto rounded-xl p-1.5 rise">
            <div className="flex items-center px-2.5 pt-1.5 pb-1">
              <span className="text-[10.5px] tracking-[0.12em] text-faint uppercase flex-1">Save points</span>
              <button className="text-[11.5px] text-dim hover:text-ink cursor-pointer"
                onClick={() => void savePoint(repo, "Saved by you").then(() => toast("Saved"), (e) => toast(`Couldn't save: ${e}`, "warn"))}>
                Save now
              </button>
            </div>
            {points.length === 0 ? <div className="px-2.5 py-2 text-[12px] text-faint">None yet. One is saved before every message you send.</div> : null}
            {points.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-raised">
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] text-ink truncate" title={p.label}>{p.label}</span>
                  <span className="block text-[10.5px] text-faint">{ago(p.at)}</span>
                </span>
                {confirm === p.id
                  ? <button className="btn text-warn flex-none" title="Where you are now is saved first, so this can be undone too" onClick={() => go(p)}>Sure?</button>
                  : <button className="btn flex-none" onClick={() => setConfirm(p.id)}>Go back</button>}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </span>
  );
}

/** The quiet list: what Grill Me noticed on its own, with a count. Never pops up. */
function ActivityBell() {
  const items = useActivity((a) => a.items);
  const readAll = useActivity((a) => a.readAll);
  const clear = useActivity((a) => a.clear);
  const [open, setOpen] = useState(false);
  const unread = items.filter((x) => !x.read).length;
  const toggle = () => { if (!open) readAll(); setOpen(!open); };
  return (
    <span className="relative" data-no-drag>
      <button className={`topbar-chip ${unread ? "text-ink" : "text-dim"} ${open ? "on" : ""}`} onClick={toggle}
        title="Activity: what Grill Me noticed in the background" aria-label={`Activity${unread ? `, ${unread} new` : ""}`}>
        <Icon name="bell" size={12} />{unread ? <span className="num text-accent">{unread}</span> : null}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="composer-menu absolute right-0 top-full mt-1.5 z-40 w-[360px] max-h-[420px] overflow-y-auto rounded-xl p-1.5 rise">
            <div className="flex items-center px-2.5 pt-1.5 pb-1">
              <span className="text-[10.5px] tracking-[0.12em] text-faint uppercase flex-1">Activity</span>
              {items.length ? <button className="text-[11.5px] text-dim hover:text-ink cursor-pointer" onClick={clear}>Clear</button> : null}
            </div>
            {items.length === 0 ? <div className="px-2.5 py-3 text-[12px] text-faint">Nothing yet. Things Grill Me notices in the background show up here instead of popping up.</div> : null}
            {items.map((x) => (
              <div key={x.id} className="flex items-start gap-2 px-2.5 py-2 rounded-lg hover:bg-raised">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-none ${x.tone === "warn" ? "bg-warn" : "bg-line"}`} aria-hidden />
                <span className="flex-1 min-w-0 text-[12px] text-dim leading-snug select-text">
                  {x.text}{x.count > 1 ? <span className="text-faint"> ×{x.count}</span> : null}
                </span>
                <span className="text-[10.5px] text-faint flex-none num">{span((Date.now() - x.at) / 60_000)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </span>
  );
}

export function TopBar({ active, peekOpen, onTogglePeek }: { active: Teammate | undefined; peekOpen: boolean; onTogglePeek: () => void }) {
  const view = useApp((s) => s.view);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const repo = useApp((s) => s.members.find((m) => m.id === active?.id)?.repoPath ?? "");
  const testsOk = useTests((t) => (active && t.results[active.id] && !t.results[active.id].running ? t.results[active.id].ok : null));
  const shipSession = useApp((s) => s.shipSession);
  const waiting = useBridge((b) => pendingCount(b.state));
  const bridgeOpen = useBridge((b) => b.open);
  const setBridgeOpen = useBridge((b) => b.setOpen);
  const onSession = view === "session" && !!active;
  const sentence = active ? sessionSentence(active, testsOk) : null;
  const PAGE: Record<string, string> = { home: "Overview", brain: "Brain", flow: "Flow", dna: "Coding DNA", automations: "Automations", new: "New session", preview: "Preview", tasks: "Tasks", inbox: "Inbox", feed: "Activity", team: "Team" };

  return (
    <div data-drag-zone data-tauri-drag-region className="h-12 flex-none border-b border-line flex items-center gap-2 pl-4 pr-2 select-none">
      <div className="flex-1 min-w-0 flex items-baseline gap-2.5">
        <span className="text-[13.5px] font-semibold text-ink truncate max-w-[45%]">
          {onSession ? sessionTitle(active!, titles) : PAGE[view] ?? "Grill Me"}
        </span>
        {onSession && sentence ? (
          <span className={`text-[12px] truncate ${sentence.tone === "needs" ? "text-warn" : sentence.tone === "working" ? "text-dim" : sentence.tone === "done" ? "text-ok" : "text-faint"}`}>
            {sentence.text}
          </span>
        ) : null}
      </div>
      <Goal />
      {onSession ? (
        <>
          <CostChip mate={active!} />
          <TestsChip id={active!.id} />
          {repo ? <UndoChips repo={repo} /> : null}
        </>
      ) : null}
      {waiting ? (
        <Chip tone="warn" on={bridgeOpen} title="The Bridge: plans, hand-offs and questions waiting for your OK" onClick={() => setBridgeOpen(!bridgeOpen)}>
          <Icon name="swap" size={11} /> {waiting} waiting
        </Chip>
      ) : null}
      <ActivityBell />
      <Chip on={peekOpen} title={peekOpen ? "Hide the Peek panel" : "Peek: changed files, the app preview, the plan, the team"} onClick={onTogglePeek}>
        <Icon name="layout" size={12} /> Peek
      </Chip>
      {onSession ? (
        <button className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-accent text-accent-ink text-[12.5px] font-medium cursor-pointer hover:brightness-110 flex-none whitespace-nowrap"
          title="Review this session's changes, then ship them (⌘S)" onClick={() => shipSession(active!.id)}>
          <Icon name="push" size={11} /> Ship
        </button>
      ) : null}
    </div>
  );
}
