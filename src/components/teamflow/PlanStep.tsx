import { useState } from "react";
import { useApp } from "../../store";
import { parseTasksJson } from "./logic";
import { advancePhase } from "./roomApi";
import { StepShell } from "./TeamFlow";

export function PlanStep() {
  const room = useApp((s) => s.room);
  const roomRole = useApp((s) => s.roomRole);
  const toast = useApp((s) => s.toast);
  const isHost = roomRole === "host";
  // host edits locally; the edited text ships with the advance payload.
  // (v1: there is no plan-patch endpoint, so guest view tracks room.plan.)
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = edited ?? room?.plan ?? "";

  const breakIntoTasks = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string>("room_make_tasks", { plan });
      const tasks = parseTasksJson(raw);
      if (tasks.length === 0) {
        toast("Couldn't get tasks out of the plan — tweak it and try again", "warn");
        return;
      }
      await advancePhase("tasks", tasks);
    } catch (e) {
      toast(`Task breakdown failed: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell
      title="plan"
      hint={isHost ? "edit until it reads right" : "the host is polishing the draft"}
      actions={
        isHost ? (
          <button className="btn primary" onClick={breakIntoTasks} disabled={busy || !plan.trim()}>
            {busy ? "breaking into tasks…" : "looks right → break into tasks"}
          </button>
        ) : null
      }
    >
      {isHost ? (
        <textarea
          className="flex-1 min-h-0 bg-panel border border-line rounded-md p-3 font-mono text-[11px] leading-relaxed outline-none focus:border-accent resize-none select-text"
          value={plan}
          onChange={(e) => setEdited(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto bg-panel border border-line rounded-md p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
          {plan || <span className="text-faint">plan is on its way…</span>}
        </div>
      )}
    </StepShell>
  );
}
