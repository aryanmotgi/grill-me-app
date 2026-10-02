import { useState } from "react";
import { useApp } from "../../store";
import { useBridge } from "../BridgePanel";
import { pendingCount } from "../../lib/bridge";
import { useChatUnread } from "../teamChatActions";
import { ChangesTab } from "../WorkspacePanel";
import { DirNode } from "../FilesPanel";
import { EditorPane } from "../EditorPane";
import { TaskBoard } from "../TaskBoard";
import { TeamChat } from "../TeamChat";
import { Icon } from "../Icon";
import { PreviewPage } from "../PreviewPage";
import { kTokens, money, sessionStats } from "../../lib/coach";
import { submitToAgent } from "../../lib/ptyReady";
import { ptyIdFor } from "../../store";
import { useTests } from "../../lib/testsStore";
import { automationOn, withAutomation } from "../../lib/automations";
import { rightTabOf, type RightTab } from "../../lib/uiLayout";
import type { Teammate } from "../../types";

// ---------------------------------------------------------------------------
// Simple layout, right column. On top, "This session": what it cost, how
// heavy it's getting, a save point, and what Grill Me is guarding. Below,
// four tabs that replace ~a dozen classic surfaces. Changes = the code
// (diffs + every file). Preview = the app it's building. Plan = what the
// team agreed (tasks, decisions). Team = people (approvals, chat).
// ---------------------------------------------------------------------------

function Stat({ label, value, tone, title }: { label: string; value: string; tone?: "warn"; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className={`num text-[15px] leading-tight ${tone === "warn" ? "text-warn" : "text-ink"}`}>{value}</div>
      <div className="text-[10.5px] text-faint truncate">{label}</div>
    </div>
  );
}

/** Did its last change pass the tests? Off by default; one click turns it on. */
function TestsLine({ id }: { id: string }) {
  const settings = useApp((s) => s.appSettings);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const toast = useApp((s) => s.toast);
  const r = useTests((t) => t.results[id]);
  if (!automationOn(settings, "auto-test")) {
    return (
      <button className="flex items-center gap-1.5 text-[11.5px] text-dim hover:text-ink cursor-pointer text-left"
        title="Runs the project's tests after each reply that changed something, and shows the result here"
        onClick={() => { const [k, v] = withAutomation(settings, "auto-test", true); setAppSetting(k, v); }}>
        <Icon name="check" size={11} /> Check tests after every reply
      </button>
    );
  }
  if (!r) return <span className="flex items-center gap-1.5 text-[11.5px] text-faint"><Icon name="check" size={11} /> Tests run after its next change</span>;
  if (r.running) return <span className="flex items-center gap-1.5 text-[11.5px] text-dim"><span className="spinner" /> Running tests…</span>;
  if (r.ok) return <span className="flex items-center gap-1.5 text-[11.5px] text-ok" title={r.cmd}><Icon name="check" size={11} /> Tests pass</span>;
  const send = () => void submitToAgent(ptyIdFor(id), `The tests fail after your last change (${r.cmd}). Find the cause, tell me in one line, then fix it:\n\n${r.tail.slice(-1500)}`)
    .catch((e) => toast(`Couldn't send: ${e}`, "warn"));
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-danger" title={r.tail.slice(-600)}>
      <Icon name="cross" size={11} /> Tests fail
      <span className="flex-1" />
      <button className="btn" onClick={send}>Ask it to fix</button>
    </span>
  );
}

/** What a bare terminal never shows you: spend, weight, a save point, and the guard rails. */
function SessionCard({ active }: { active: Teammate | undefined }) {
  const checkpointNow = useApp((s) => s.checkpointNow);
  const toast = useApp((s) => s.toast);
  const [saving, setSaving] = useState(false);
  if (!active) return null;
  const st = sessionStats(active);
  const changed = active.changes.length;
  const save = async () => {
    setSaving(true);
    try { await checkpointNow(); } finally { setSaving(false); }
  };
  const compact = () => void submitToAgent(ptyIdFor(active.id), "/compact")
    .then(() => toast("Compacting: the session keeps the gist and each message gets cheaper"))
    .catch((e) => toast(`Couldn't compact: ${e}`, "warn"));
  return (
    <div className="flex-none border-b border-line px-3 py-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] tracking-[0.12em] uppercase text-faint font-semibold flex-1 truncate">This session</span>
        {st ? <span className="text-[10.5px] text-faint capitalize" title={active.usage.model}>{st.family === "other" ? active.usage.model : st.family}</span> : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="spent (est.)" value={st ? money(st.cost) : "—"} title="Estimated from this session's real token counts at list prices" />
        <Stat label={st?.heavy ? "per message · heavy" : "per message"} value={st ? kTokens(st.perTurn) : "—"} tone={st?.heavy ? "warn" : undefined}
          title={st ? `Each message re-reads about ${kTokens(st.perTurn)} tokens (${money(st.nextMsg)}).` : "Shows after the first reply"} />
        <Stat label={changed === 1 ? "file changed" : "files changed"} value={String(changed)} />
      </div>
      <div className="flex gap-1.5">
        <button className="btn flex-1 justify-center" disabled={saving} onClick={() => void save()}
          title="Commit everything now on this branch (never main, never pushed), so you can always get back here">
          <Icon name="commit" size={11} /> {saving ? "Saving…" : "Save point"}
        </button>
        {st?.heavy ? (
          <button className="btn flex-1 justify-center text-warn" onClick={compact} title="Summarize the conversation so each message costs less">
            Compact
          </button>
        ) : null}
      </div>
      <TestsLine id={active.id} />
      <div className="flex items-center gap-1.5 text-[10.5px] text-faint"
        title="Risky commands (force-push to main, rm -rf, DROP TABLE…) are blocked even with permissions skipped. You get a ping when the agent needs you.">
        <Icon name="lock" size={10} /> Risky commands blocked · pinged when it needs you
      </div>
    </div>
  );
}

function ChangesPane({ active }: { active: Teammate | undefined }) {
  const members = useApp((s) => s.members);
  const openFile = useApp((s) => s.openFile);
  const activeFile = useApp((s) => s.activeFile);
  const openFiles = useApp((s) => s.openFiles);
  const closeFile = useApp((s) => s.closeFile);
  const closeAll = () => { for (const f of openFiles) closeFile(f); };
  const [mode, setMode] = useState<"changed" | "all">("changed");
  const member = members.find((m) => m.id === active?.id) ?? members[0];
  const root = member?.repoPath ?? null;
  const changes = active?.changes ?? [];

  if (openFiles.length > 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <button className="flex-none flex items-center gap-1.5 h-8 px-3 text-[12px] text-dim hover:text-ink border-b border-line cursor-pointer"
          onClick={closeAll}>
          <Icon name="chevron" size={9} className="rotate-180" /> Back to the file list
        </button>
        <EditorPane embedded />
      </div>
    );
  }
  if (!root) return <p className="p-4 text-[12px] text-faint">Start a session to see its code here.</p>;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-none flex gap-1 px-2 py-2 border-b border-line">
        {(["changed", "all"] as const).map((m) => (
          <button key={m} className={`btn flex-1 ${mode === m ? "active" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {m === "changed" ? `Changed${changes.length ? ` · ${changes.length}` : ""}` : "All files"}
          </button>
        ))}
      </div>
      {mode === "changed" ? (
        <ChangesTab root={root} changes={changes} activeFile={activeFile} openFile={openFile} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          <DirNode root={root} rel="" name="" depth={0} onOpenFile={(rel) => openFile(rel)} openRel={activeFile} />
        </div>
      )}
    </div>
  );
}

function PlanPane() {
  const decisions = useApp((s) => s.decisions);
  const recent = [...decisions].sort((a, b) => b.epochMs - a.epochMs).slice(0, 5);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-4 pt-3 text-[11px] tracking-[0.12em] uppercase text-faint font-semibold">Tasks</div>
      <TaskBoard />
      <div className="px-4 pt-2 pb-1 text-[11px] tracking-[0.12em] uppercase text-faint font-semibold">Recent decisions</div>
      {recent.length === 0 ? (
        <p className="px-4 pb-4 text-[12px] text-faint">Nothing decided yet. Decisions you or your agents log show up here, and every agent reads them.</p>
      ) : (
        <ul className="px-4 pb-4 flex flex-col gap-2">
          {recent.map((d) => (
            <li key={d.id} className="text-[12.5px] text-ink leading-snug select-text">{d.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamPane() {
  const appMode = useApp((s) => s.appMode);
  const setAppMode = useApp((s) => s.setAppMode);
  const live = useApp((s) => !!(s.room && s.roomSelf && s.room.phase === "done"));
  const waiting = useBridge((b) => pendingCount(b.state));
  const openApprovals = useBridge((b) => b.setOpen);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-none px-3 py-2.5 border-b border-line flex items-center gap-2">
        <span className="flex-1 text-[12.5px]">
          {waiting ? <span className="text-warn">{waiting} waiting for your OK</span> : <span className="text-faint">Nothing waiting for your OK</span>}
        </span>
        <button className="btn" onClick={() => openApprovals(true)} title="Hand-offs, plans and questions from Claude and teammates">
          Approvals
        </button>
      </div>
      {live ? (
        <TeamChat variant="page" />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Icon name="team" size={22} className="text-faint" />
          <p className="text-[12.5px] text-dim leading-relaxed">
            {appMode === "team"
              ? "Your team room isn't connected yet."
              : "You're working solo. Invite teammates and everyone's agents share one goal, one plan and one chat."}
          </p>
          {appMode !== "team" ? <button className="btn active" onClick={() => setAppMode("team")}>Invite team</button> : null}
        </div>
      )}
    </div>
  );
}

export function RightPanel({ active, width }: { active: Teammate | undefined; width: number }) {
  const stored = useApp((s) => s.appSettings.rightTab);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const tab = rightTabOf(stored);
  const view = useApp((s) => s.view);
  const changed = active?.changes?.length ?? 0;
  const waiting = useBridge((b) => pendingCount(b.state));
  const unread = useChatUnread();
  const TABS: { id: RightTab; label: string; badge: number }[] = [
    { id: "changes", label: "Changes", badge: changed },
    { id: "preview", label: "Preview", badge: 0 },
    { id: "plan", label: "Plan", badge: 0 },
    { id: "team", label: "Team", badge: waiting + unread },
  ];
  return (
    <aside style={{ width }} className="flex-none border-l border-line bg-panel flex flex-col overflow-hidden" aria-label="Changes, plan and team">
      <div data-tauri-drag-region className="h-12 flex-none border-b border-line flex items-center gap-1 px-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={`flex-1 h-8 rounded-lg text-[12.5px] cursor-pointer transition-colors ${tab === t.id ? "bg-raised text-ink" : "text-dim hover:text-ink"}`}
            onClick={() => setAppSetting("rightTab", t.id)}>
            {t.label}
            {t.badge ? <span className={`ml-1.5 num ${t.id === "team" ? "text-warn" : "text-faint"}`}>{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {view === "session" ? <SessionCard active={active} /> : null}
      <div key={tab} className="tab-fade flex-1 min-h-0 flex flex-col">
        {tab === "changes" ? <ChangesPane active={active} /> : null}
        {tab === "preview" ? <PreviewPage /> : null}
        {tab === "plan" ? <PlanPane /> : null}
        {tab === "team" ? <TeamPane /> : null}
      </div>
    </aside>
  );
}
