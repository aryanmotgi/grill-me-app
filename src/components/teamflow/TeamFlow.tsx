import { useApp } from "../../store";
import { TeamStart } from "./TeamStart";
import { Lobby } from "./Lobby";

/**
 * Phase router for team mode. Minimal stub — the setup-flow PR extends this
 * with the brainstorm/plan/tasks/assign screens; keep wiring-only changes.
 */
export function TeamFlow() {
  const room = useApp((s) => s.room);
  const roomSelf = useApp((s) => s.roomSelf);

  if (!roomSelf) return <TeamStart />;
  const phase = room?.phase ?? "lobby";
  if (phase === "lobby") return <Lobby />;
  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="text-[12px] text-dim">{phase} — setup flow coming up</div>
    </div>
  );
}
