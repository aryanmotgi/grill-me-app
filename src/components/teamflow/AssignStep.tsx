import { useState } from "react";
import { useApp } from "../../store";
import { advancePhase, roomPost } from "./roomApi";
import { StepShell } from "./TeamFlow";

export function AssignStep() {
  const room = useApp((s) => s.room);
  const roomRole = useApp((s) => s.roomRole);
  const finishTeamSetup = useApp((s) => s.finishTeamSetup);
  const [finishing, setFinishing] = useState(false);
  const isHost = roomRole === "host";
  const tasks = room?.tasks ?? [];
  const members = room?.members ?? [];

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    const ok = await advancePhase("done");
    // host completes locally right away — guests follow via the room feed's
    // phase:"done" transition (store subscription calls finishTeamSetup).
    if (ok) await finishTeamSetup();
    setFinishing(false);
  };

  return (
    <StepShell
      title="assign"
      hint="who takes what — everyone sees this live"
      actions={
        isHost ? (
          <button className="btn primary" onClick={() => void finish()} disabled={finishing || tasks.length === 0}>
            {finishing ? "finishing…" : "finish setup"}
          </button>
        ) : (
          <span className="text-[10px] text-faint">the host finishes setup when assignments look right</span>
        )
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-line bg-panel px-3 py-1">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold truncate">{t.title}</div>
              {t.detail ? <div className="text-[10px] text-dim truncate">{t.detail}</div> : null}
            </div>
            <select
              className="btn"
              value={t.assignee ?? ""}
              onChange={(e) =>
                void roomPost("/room/task", {
                  op: "assign",
                  task: { ...t, assignee: e.target.value || null },
                })
              }
            >
              <option value="">unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.isHost ? " (host)" : ""}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </StepShell>
  );
}
