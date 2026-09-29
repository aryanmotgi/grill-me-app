import { useApp } from "../store";
import { visibleSessions } from "../lib/sessionNav";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";
import { GrillFlame } from "./GrillMark";
import { EditableTitle } from "./EditableTitle";
import { TestBadge } from "./Automations";
import { DockToggles } from "./Dock";

// ---------------------------------------------------------------------------
// Monocode-style top tab strip: every open session is a two-line tab
// (name + agent, then task/branch subtitle). Clicking a tab activates that
// session in the center pane; "+" starts a new session. The right edge holds
// review & ship for the active session (the old TopBar's primary action).
// The strip doubles as window-drag chrome under the overlay titlebar.
// ---------------------------------------------------------------------------

export function SessionTabs({ padLeft = false }: { padLeft?: boolean }) {
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const activeId = useApp((s) => s.activeId);
  const setActive = useApp((s) => s.setActive);
  const appMode = useApp((s) => s.appMode);
  const ownId = useApp((s) => s.members[0]?.id);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const shipSession = useApp((s) => s.shipSession);

  const insertSnippet = useApp((s) => s.insertSnippet);
  const shown = visibleSessions(teammates, appMode, ownId);
  const active = teammates.find((t) => t.id === activeId);

  return (
    <div data-tauri-drag-region className={`flex items-center gap-1 h-12 pr-2 flex-none border-b border-line demo-hide ${padLeft ? "pl-[84px]" : "pl-2"}`}>
      <DockToggles side="left" />
      <div data-tauri-drag-region className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 min-w-0 h-full">
        {shown.map((t) => {
          const on = view === "session" && t.id === activeId;
          const agent = members.find((m) => m.id === t.id)?.agent ?? "claude";
          return (
            <button
              key={t.id}
              className={`group/tab flex items-center gap-2.5 h-9 px-3.5 min-w-[200px] max-w-[360px] rounded-lg cursor-pointer transition-colors ${
                on ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/50"
              }`}
              title={`${t.name} · ${t.branch}${t.taskLabel ? ` · ${t.taskLabel}` : ""}`}
              onClick={() => { if (view !== "session") setView("session"); setActive(t.id); }}
            >
              <AgentLogo agent={agent} size={15} />
              <EditableTitle mate={t} className="text-[13.5px] min-w-0 flex-1 text-left" />
              <TestBadge id={t.id} />
              {t.status !== "idle" ? <span className={`status-dot ${t.status} flex-none`} style={{ width: 6, height: 6 }} aria-hidden /> : null}
            </button>
          );
        })}
        {view === "new" || shown.length === 0 ? (
          <div className="flex items-center gap-2.5 h-9 px-3.5 min-w-[180px] rounded-lg bg-raised text-ink text-[13.5px] flex-none">
            <Icon name="spark" size={13} /> New session
          </div>
        ) : null}
        <button
          className="w-8 h-8 rounded-lg flex items-center justify-center text-dim hover:text-ink hover:bg-raised/50 cursor-pointer flex-none"
          title="New session"
          onClick={() => setView("new")}
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
      {active && view === "session" && (members.find((m) => m.id === active.id)?.agent ?? "claude") === "claude" ? (
        <button
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-dim hover:text-ink hover:bg-raised text-[12.5px] cursor-pointer flex-none"
          title="Type /grillme --orient into this session: where am I, what's next, grill my understanding (press Enter to send)"
          onClick={() => void insertSnippet("/grillme --orient")}
        >
          <GrillFlame px={1.5} /> Grill me
        </button>
      ) : null}
      {active && view === "session" ? (
        <button
          className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-accent text-accent-ink text-[12.5px] font-medium cursor-pointer hover:brightness-110 flex-none"
          title={`Review & ship ${active.name}'s branch (⌘S)`}
          onClick={() => shipSession(active.id)}
        >
          <Icon name="push" size={12} /> Review & ship
        </button>
      ) : null}
      <DockToggles side="right" />
    </div>
  );
}
