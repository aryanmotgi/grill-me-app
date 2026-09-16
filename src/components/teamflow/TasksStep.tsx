import { useState } from "react";
import { useApp } from "../../store";
import type { RoomTask } from "../../types";
import { newTaskId } from "./logic";
import { advancePhase, roomPost } from "./roomApi";
import { StepShell } from "./TeamFlow";

/** One editable row. Local drafts overlay live values only while editing. */
function TaskRow({ task }: { task: RoomTask }) {
  const [title, setTitle] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const commit = () => {
    const next = { ...task, title: (title ?? task.title).trim(), detail: (detail ?? task.detail).trim() };
    if (next.title !== task.title || next.detail !== task.detail) {
      void roomPost("/room/task", { op: "edit", task: next });
    }
    setTitle(null);
    setDetail(null);
  };

  return (
    <div className="flex items-start gap-2 border-b border-line py-2 last:border-b-0">
      <div className="flex-1 min-w-0">
        <input
          className="w-full bg-transparent text-[12px] font-semibold outline-none focus:text-accent"
          value={title ?? task.title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <input
          className="w-full bg-transparent text-[10px] text-dim outline-none"
          placeholder="detail…"
          value={detail ?? task.detail}
          onChange={(e) => setDetail(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <button
        className="btn"
        title="Remove task"
        onClick={() => void roomPost("/room/task", { op: "remove", task })}
      >
        remove
      </button>
    </div>
  );
}

export function TasksStep() {
  const room = useApp((s) => s.room);
  const roomRole = useApp((s) => s.roomRole);
  const [newTitle, setNewTitle] = useState("");
  const isHost = roomRole === "host";
  const tasks = room?.tasks ?? [];

  const add = () => {
    const t = newTitle.trim();
    if (!t) return;
    setNewTitle("");
    void roomPost("/room/task", {
      op: "add",
      task: { id: newTaskId(), title: t, detail: "", assignee: null },
    });
  };

  return (
    <StepShell
      title="tasks"
      hint="anyone can add, edit, or remove"
      actions={
        isHost ? (
          <button
            className="btn primary"
            onClick={() => void advancePhase("assign")}
            disabled={tasks.length === 0}
          >
            assign
          </button>
        ) : (
          <span className="text-[10px] text-faint">the host moves everyone to assignment</span>
        )
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-line bg-panel px-3 py-1">
        {tasks.length === 0 ? (
          <div className="text-[11px] text-faint py-2">
            No tasks yet — add the first one below.
          </div>
        ) : (
          tasks.map((t) => <TaskRow key={t.id} task={t} />)
        )}
      </div>
      <div className="flex gap-2 pt-2 flex-none">
        <input
          className="flex-1 bg-raised border border-line rounded-[5px] px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          placeholder="add a task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn" onClick={add} disabled={!newTitle.trim()}>
          add
        </button>
      </div>
    </StepShell>
  );
}
