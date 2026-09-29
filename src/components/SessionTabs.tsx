import { useApp } from "../store";
import { visibleSessions } from "../lib/sessionNav";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Monocode-style top tab strip: every open session is a two-line tab
// (name + agent, then task/branch subtitle). Clicking a tab activates that
// session in the center pane; "+" starts a new session. The right edge holds
// review & ship for the active session (the old TopBar's primary action).
// The strip doubles as window-drag chrome under the overlay titlebar.
// ---------------------------------------------------------------------------

export function SessionTabs() {
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const activeId = useApp((s) => s.activeId);
  const setActive = useApp((s) => s.setActive);
  const appMode = useApp((s) => s.appMode);
  const ownId = useApp((s) => s.members[0]?.id);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const shipSession = useApp((s) => s.shipSession);

  const shown = visibleSessions(teammates, appMode, ownId);
  const active = teammates.find((t) => t.id === activeId);

  return (
    <div data-tauri-drag-region className="flex items-stretch h-10 flex-none bg-panel border-b border-line demo-hide">
      <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
        {shown.map((t) => {
          const on = view === "session" && t.id === activeId;
          const agent = members.find((m) => m.id === t.id)?.agent ?? "claude";
          return (
            <button
              key={t.id}
              className={`group/tab flex items-center gap-2 px-3 min-w-0 max-w-[220px] border-r border-line cursor-pointer transition-colors ${
                on ? "bg-bg text-ink" : "text-dim hover:text-ink hover:bg-raised"
              }`}
              title={`${t.name} · ${t.branch}${t.taskLabel ? ` · ${t.taskLabel}` : ""}`}
              onClick={() => { if (view !== "session") setView("session"); setActive(t.id); }}
            >
              <AgentLogo agent={agent} size={15} />
              <span className="flex flex-col justify-center min-w-0 text-left">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`status-dot ${t.status} flex-none`} aria-hidden />
                  <span className="text-[11.5px] font-semibold truncate">{t.name}</span>
                </span>
                <span className="font-mono text-[9px] text-faint truncate">
                  {t.taskLabel || t.branch}
                </span>
              </span>
            </button>
          );
        })}
        {view === "new" || shown.length === 0 ? (
          <div className="flex items-center gap-2 px-3 my-1 ml-1 rounded-lg bg-raised text-ink text-[13px] flex-none">
            <Icon name="spark" size={13} /> New session
          </div>
        ) : null}
        <button
          className="px-3 text-dim hover:text-ink cursor-pointer flex-none"
          title="New session"
          onClick={() => setView("new")}
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
      {active && view === "session" ? (
        <button
          className="flex items-center gap-1.5 px-3 my-1.5 mr-2 rounded-md bg-accent text-accent-ink text-[11px] font-semibold cursor-pointer hover:brightness-110 flex-none"
          title={`Review & ship ${active.name}'s branch (⌘S)`}
          onClick={() => shipSession(active.id)}
        >
          <Icon name="push" size={11} /> review & ship
        </button>
      ) : null}
    </div>
  );
}
