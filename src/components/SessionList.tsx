import { useApp } from "../store";
import type { Teammate } from "../types";

const SETUP_LABEL: Record<Teammate["setup"], string> = {
  worktree: "worktree ✓",
  env: "env linked",
  ready: "ready",
};

const HEALTH_LABEL: Record<Teammate["health"], string | null> = {
  ok: null,
  stale: "stale",
  disconnected: "offline",
};

function SessionRow({ mate }: { mate: Teammate }) {
  const { activeId, setActive, splitId, setSplit, toggleDnd } = useApp();
  const isActive = activeId === mate.id;
  const inSplit = splitId === mate.id;

  return (
    <div
      className={`group px-3 py-2.5 border-b border-line cursor-pointer transition-colors ${
        isActive ? "bg-raised border-l-2 border-l-accent" : "hover:bg-raised/60 border-l-2 border-l-transparent"
      }`}
      onClick={() => setActive(mate.id)}
    >
      <div className="flex items-center gap-2">
        <span className={`status-dot ${mate.status}`} title={mate.status} />
        <span className="font-display font-semibold text-[13px]">{mate.name}</span>
        <span className="text-faint text-[11px] truncate">⎇ {mate.branch}</span>
        <span className="flex-1" />
        {mate.dnd ? <span title="Do not disturb" className="text-faint">◌</span> : null}
        {mate.permission === "view" ? (
          <span title="View-only for you" className="text-faint text-[10px]">🔒</span>
        ) : (
          <span title="You can jump in" className="text-faint text-[10px]">⇄</span>
        )}
      </div>

      <div className="mt-1 flex items-center gap-1.5 pl-4">
        <span className="text-dim text-[11px] truncate">{mate.taskLabel}</span>
        <span className="flex-1" />
        <span className={`tag ${mate.setup === "ready" ? "ok" : ""}`}>{SETUP_LABEL[mate.setup]}</span>
        {HEALTH_LABEL[mate.health] ? (
          <span className="tag danger" title={`No output for ${mate.lastActiveMin}m`}>
            {HEALTH_LABEL[mate.health]} {mate.lastActiveMin}m
          </span>
        ) : null}
      </div>

      {/* live presence: currently open file */}
      <div className="mt-1 pl-4 text-[10px] text-faint truncate">
        ▸ {mate.currentFile}
      </div>

      {/* row actions on hover */}
      <div className="mt-1.5 pl-4 gap-1.5 hidden group-hover:flex demo-hide">
        <button
          className={`btn ${inSplit ? "active" : ""}`}
          onClick={(e) => { e.stopPropagation(); setSplit(inSplit ? null : mate.id); }}
          title="View side-by-side with active pane"
        >
          split
        </button>
        <button
          className={`btn ${mate.dnd ? "active" : ""}`}
          onClick={(e) => { e.stopPropagation(); toggleDnd(mate.id); }}
          title="Silence notifications from this session"
        >
          dnd
        </button>
      </div>
    </div>
  );
}

export function SessionList() {
  const teammates = useApp((s) => s.teammates);
  return (
    <aside className="w-[248px] flex-none border-r border-line bg-panel flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-line flex items-center justify-between">
        <span className="panel-label">sessions</span>
        <span className="text-faint text-[10px]">{teammates.length} on vm</span>
      </div>
      <div className="overflow-y-auto">
        {teammates.map((mate) => (
          <SessionRow key={mate.id} mate={mate} />
        ))}
      </div>
    </aside>
  );
}
