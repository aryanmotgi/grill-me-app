import { useApp } from "../store";
import { Icon } from "./Icon";
import type { Teammate } from "../types";

const SETUP_LABEL: Record<Teammate["setup"], string> = {
  worktree: "worktree ok",
  env: "env linked",
  ready: "ready",
};

function SessionRow({ mate }: { mate: Teammate }) {
  const { activeId, setActive, splitId, setSplit, toggleDnd } = useApp();
  const isActive = activeId === mate.id;
  const inSplit = splitId === mate.id;
  const offline = mate.health !== "ok";

  return (
    <div
      className={`group px-3 py-3 cursor-pointer transition-colors ${
        isActive
          ? "bg-raised border-l-2 border-l-accent"
          : "hover:bg-raised/60 border-l-2 border-l-transparent"
      }`}
      onClick={() => setActive(mate.id)}
    >
      {/* primary line: dot (the one status signal) + name + branch */}
      <div className="flex items-center gap-2">
        <span className={`status-dot ${mate.status}`} title={`${mate.status}${offline ? ` · no activity ${mate.lastActiveMin}m` : ""}`} />
        <span className="font-display font-semibold text-[13px]">{mate.name}</span>
        <span className="font-mono text-faint text-[10px] truncate" title={mate.branch}>
          <Icon name="branch" size={11} /> {mate.branch}
        </span>
        <span className="flex-1" />
        {mate.dnd ? <span title="Do not disturb" className="text-faint"><Icon name="bellOff" size={11} /></span> : null}
      </div>

      {/* secondary line: task label + quiet metadata */}
      <div className="mt-1 flex items-center gap-2 pl-4">
        <span className="text-dim text-[11px] truncate" title={mate.taskLabel}>
          {mate.taskLabel}
        </span>
        <span className="flex-1" />
        <span className="tag">{SETUP_LABEL[mate.setup]}</span>
        {offline ? (
          <span
            className={`text-[10px] ${mate.health === "disconnected" ? "text-danger" : "text-warn"}`}
            title={`No activity for ${mate.lastActiveMin}m`}
          >
            {mate.health === "disconnected" ? "offline" : `quiet ${mate.lastActiveMin}m`}
          </span>
        ) : null}
      </div>

      {/* live presence */}
      <div className="mt-0.5 pl-4 font-mono text-[10px] text-faint truncate" title={mate.currentFile}>
        <Icon name="file" size={10} /> {mate.currentFile}
      </div>

      {/* row actions — hover only, keeps rows quiet */}
      <div className="mt-1.5 pl-4 gap-1.5 items-center hidden group-hover:flex demo-hide">
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
        <span className="text-faint text-[10px]" title={mate.permission === "edit" ? "You can jump into this session" : "View-only for you"}>
          {mate.permission === "edit" ? <><Icon name="swap" size={10} /> can jump in</> : <><Icon name="eye" size={10} /> view-only</>}
        </span>
      </div>
    </div>
  );
}

export function SessionList() {
  const teammates = useApp((s) => s.teammates);
  return (
    <aside className="w-[276px] flex-none border-r border-line bg-panel flex flex-col overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between">
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
