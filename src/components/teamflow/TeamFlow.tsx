import type { ReactNode } from "react";
import { useApp } from "../../store";
import { TeamStart } from "./TeamStart";
import { Lobby } from "./Lobby";
import { Brainstorm } from "./Brainstorm";
import { PlanStep } from "./PlanStep";
import { TasksStep } from "./TasksStep";
import { AssignStep } from "./AssignStep";

const STEPS = ["brainstorm", "plan", "tasks", "assign"] as const;

/** Shared shell for every setup step: code, phase stepper, one action slot. */
export function StepShell({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const room = useApp((s) => s.room);
  const phase = room?.phase;
  return (
    <div className="h-full flex flex-col bg-bg">
      <div className="flex items-center gap-3 px-4 h-10 border-b border-line flex-none">
        <span className="font-display text-[15px] font-semibold">team setup</span>
        <span className="font-mono text-[11px] text-faint">room {room?.code}</span>
        <span className="flex-1" />
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`text-[10px] ${s === phase ? "text-accent font-semibold" : "text-faint"}`}
          >
            {i + 1} {s}
          </span>
        ))}
      </div>
      <div className="flex-1 min-h-0 flex flex-col items-center overflow-y-auto">
        <div className="w-full max-w-[640px] flex-1 min-h-0 flex flex-col px-4 py-4">
          <div className="flex items-baseline gap-2 mb-1 flex-none">
            <span className="text-[12px] font-semibold">{title}</span>
            {hint ? <span className="text-[10px] text-faint">{hint}</span> : null}
          </div>
          {children}
          {actions ? <div className="flex justify-end gap-2 pt-3 flex-none">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Phase-driven router over store.room.phase. */
export function TeamFlow() {
  const room = useApp((s) => s.room);
  const roomSelf = useApp((s) => s.roomSelf);

  // no room joined/hosted yet → create-or-join screen
  if (!roomSelf) return <TeamStart />;
  switch (room?.phase ?? "lobby") {
    case "lobby":
      return <Lobby />;
    case "brainstorm":
      return <Brainstorm />;
    case "plan":
      return <PlanStep />;
    case "tasks":
      return <TasksStep />;
    case "assign":
      return <AssignStep />;
    default:
      // "done" (and anything unknown) — App routes back to the workspace;
      // finishTeamSetup clears the room via the store subscription.
      return null;
  }
}
