import { useApp } from "../../store";

/**
 * Placeholder — the real TeamStart/Lobby/Brainstorm/Plan/Tasks/Assign
 * screens land in the team-flow PR, which owns this directory.
 */
export function TeamFlow() {
  const setAppMode = useApp((s) => s.setAppMode);
  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="max-w-sm flex flex-col gap-3 p-5 bg-panel hairline rounded-md rise">
        <span className="panel-label">team mode</span>
        <p className="text-[12px] text-dim leading-relaxed">
          Team setup coming from the flow PR — create/join a room, lobby, and
          shared planning land there.
        </p>
        <button className="btn self-start" onClick={() => setAppMode(null)}>
          back to mode select
        </button>
      </div>
    </div>
  );
}
