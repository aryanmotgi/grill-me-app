import { useApp } from "../store";
import { visibleSessions } from "../lib/sessionNav";
import { AgentBadge } from "./SessionList";

// ---------------------------------------------------------------------------
// Monocode-style top tab strip: every open session is a tab. Clicking a tab
// activates that session in the center pane; "+" starts a new session (the
// templates overlay, which owns branch + brief). The strip mirrors the same
// visibleSessions ordering the sidebar and keyboard nav use, so tab N here is
// always the same session as "N" on the keyboard.
// ---------------------------------------------------------------------------

export function SessionTabs() {
  const teammates = useApp((s) => s.teammates);
  const activeId = useApp((s) => s.activeId);
  const setActive = useApp((s) => s.setActive);
  const appMode = useApp((s) => s.appMode);
  const ownId = useApp((s) => s.members[0]?.id);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);

  const shown = visibleSessions(teammates, appMode, ownId);
  if (shown.length === 0) return null;

  return (
    <div className="flex items-stretch h-8 flex-none bg-panel border-b border-line overflow-x-auto demo-hide">
      {shown.map((t) => {
        const active = view === "session" && t.id === activeId;
        return (
          <button
            key={t.id}
            className={`flex items-center gap-1.5 px-3 min-w-0 max-w-[220px] border-r border-line cursor-pointer transition-colors ${
              active ? "bg-bg text-ink border-b-2 border-b-accent -mb-px" : "text-dim hover:text-ink hover:bg-raised"
            }`}
            title={`${t.name} · ${t.branch}${t.taskLabel ? ` · ${t.taskLabel}` : ""}`}
            onClick={() => { if (view !== "session") setView("session"); setActive(t.id); }}
          >
            <span className={`status-dot ${t.status} flex-none`} aria-hidden />
            <span className="font-display text-[11px] font-semibold truncate">{t.name}</span>
            <AgentBadge memberId={t.id} />
            <span className="font-mono text-[9px] text-faint truncate hidden xl:inline">{t.branch}</span>
          </button>
        );
      })}
      <button
        className="px-3 text-dim hover:text-accent cursor-pointer text-[13px] flex-none"
        title="New session (from a template: branch + starting brief)"
        onClick={() => useApp.setState({ sessionTemplatesOpen: true })}
      >
        +
      </button>
    </div>
  );
}
