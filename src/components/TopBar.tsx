import { attentionCount, useApp } from "../store";
import { Icon } from "./Icon";
import { themes } from "../theme/themes";

export function TopBar() {
  const {
    teammates, mergeQueue, advanceMergeQueue, themeName, setTheme,
    demoMode, toggleDemo, focusMode, toggleFocus,
    toast, quickCommit, activeId, setSwitcherOpen, setSettingsOpen,
  } = useApp();

  const attention = attentionCount(teammates);
  const working = teammates.filter((t) => t.status === "working").length;
  const mergerName = teammates.find((t) => t.id === mergeQueue[0])?.name;

  return (
    <header className="flex items-center gap-4 px-4 h-11 border-b border-line bg-panel flex-none">
      <div className="flex items-baseline gap-2">
        <span className="font-display font-bold text-[15px] tracking-[0.08em] text-accent">
          GRILL&nbsp;ME
        </span>
        <span className="panel-label hidden sm:inline">team terminal</span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-dim">
        <span className="status-dot working" />
        {working}/{teammates.length} working
      </div>

      {/* merge/integrator indicator — click passes the turn */}
      <button
        className="tag ok demo-hide cursor-pointer hover:text-ok"
        title="Whose turn to merge — click when done to pass the turn"
        onClick={advanceMergeQueue}
      >
        <Icon name="merge" size={11} /> merge turn: {mergerName}
      </button>

      <div className="flex-1" />

      {/* notification badge */}
      <button
        className="relative btn demo-hide"
        title="Sessions needing attention"
        onClick={() => toast(attention ? `${attention} session(s) need attention — OS notification pinged (stubbed)` : "All quiet")}
      >
        <Icon name="bell" size={11} /> alerts
        {attention > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-warn text-accent-ink text-[9px] font-bold flex items-center justify-center">
            {attention}
          </span>
        )}
      </button>

      <button className="btn demo-hide" title="One-click commit + push (⌘S)" onClick={() => quickCommit(activeId)}>
        <Icon name="push" size={11} /> commit
      </button>
      <button className="btn demo-hide" title="Quick switcher (⌘K)" onClick={() => setSwitcherOpen(true)}>
        ⌘K
      </button>
      <button className={`btn ${focusMode ? "active" : ""} demo-hide`} onClick={toggleFocus} title="Collapse to just your pane">
        focus
      </button>
      <button className={`btn ${demoMode ? "primary" : ""}`} onClick={toggleDemo} title="Clean view for demoing">
        demo
      </button>
      <button className="btn demo-hide" title="Settings" onClick={() => setSettingsOpen(true)}>
        <Icon name="gear" size={11} />
      </button>
      <select
        className="btn demo-hide"
        value={themeName}
        onChange={(e) => setTheme(e.target.value)}
        title="Theme"
      >
        {Object.keys(themes).map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </header>
  );
}
