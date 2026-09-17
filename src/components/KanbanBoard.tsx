import { useState } from "react";
import { Icon } from "./Icon";
import { FileBadge } from "./TaskBoard";
import { TickNumber } from "./TickNumber";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import {
  blockerChain,
  blockerOf,
  COLUMNS,
  DROP_STATUSES,
  kanbanColumns,
  type ColumnKey,
} from "../lib/kanban";
import type { Task, TaskStatus } from "../types";

const STATUS_LABEL: Record<TaskStatus, string> = {
  "not-started": "not started",
  "in-progress": "in progress",
  done: "done",
};

/** Blocked is derived (no such TaskStatus), so it never accepts a drop. */
function isDroppable(key: ColumnKey): key is TaskStatus {
  return key !== "blocked";
}

// ---------------------------------------------------------------------------
// Keyboard-accessible move control — the drag-and-drop fallback. A button that
// reveals one <button role="menuitem"> per settable status (blocked excluded).
// setTaskStatus persists through shared_upsert, exactly like a drop.
// ---------------------------------------------------------------------------
function MoveControl({ task, move }: { task: Task; move: (status: TaskStatus) => void }) {
  const [open, setOpen] = useState(false);
  const targets = DROP_STATUSES.filter((s) => s !== task.status);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        className="btn text-[10px]"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Move to another column"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      >
        move →
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-10 mt-1 glass rounded-md shadow-2xl p-1 flex flex-col min-w-[116px]">
          {targets.map((s) => (
            <button
              key={s}
              role="menuitem"
              className="btn text-left text-[11px]"
              onClick={() => { move(s); setOpen(false); }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KanbanCard({
  task,
  tasks,
  ownerName,
  dragging,
  move,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  tasks: Task[];
  ownerName: string;
  dragging: boolean;
  move: (status: TaskStatus) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const blocker = blockerOf(task, tasks);
  const chain = blocker ? blockerChain(task, tasks) : [];
  const files = task.status === "done" ? [] : task.files;
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", task.id); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`hairline rounded-md bg-panel/60 p-2.5 cursor-grab active:cursor-grabbing transition-opacity ${dragging ? "opacity-40" : ""}`}
    >
      <div className={`text-[12px] font-medium leading-snug ${task.status === "done" ? "line-through text-dim" : ""}`}>
        {task.title}
      </div>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-dim text-[10px]">{ownerName}</span>
        <span className="flex-1" />
        <MoveControl task={task} move={move} />
      </div>
      {blocker ? (
        <div className="mt-1.5">
          <span className="tag warn">
            <Icon name="block" size={10} />{" "}
            {chain.length > 1 ? `chain: ${chain.join(" → ")} → this` : `waiting on ${blocker.title}`}
          </span>
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="mt-1.5 font-mono text-[10px] text-faint leading-relaxed">
          {files.map((f) => (
            <span key={f}><FileBadge file={f} />{f}{"  "}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Column({
  col,
  tasks,
  allTasks,
  ownerName,
  dragId,
  isOver,
  onCardDragStart,
  onCardDragEnd,
  onEnter,
  onLeave,
  onDrop,
  move,
}: {
  col: { key: ColumnKey; label: string };
  tasks: Task[];
  allTasks: Task[];
  ownerName: (id: string) => string;
  dragId: string | null;
  isOver: boolean;
  onCardDragStart: (id: string) => void;
  onCardDragEnd: () => void;
  onEnter: () => void;
  onLeave: () => void;
  onDrop: (status: TaskStatus) => void;
  move: (id: string, status: TaskStatus) => void;
}) {
  const droppable = isDroppable(col.key);
  const dragActive = dragId !== null;
  return (
    <section
      className={`flex-1 min-w-[210px] flex flex-col rounded-md p-2 transition-colors ${
        isOver ? "bg-accent/10 border border-accent" : "border border-line/50"
      }`}
      onDragOver={droppable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onEnter(); } : undefined}
      onDragLeave={droppable ? onLeave : undefined}
      onDrop={droppable ? (e) => { e.preventDefault(); onDrop(col.key as TaskStatus); } : undefined}
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        {col.key === "blocked" ? <Icon name="block" size={11} className="text-warn" /> : null}
        <span className="panel-label">{col.label}</span>
        <TickNumber value={tasks.length} className="text-data text-[11px]" />
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto min-h-[64px] pr-0.5">
        {tasks.length === 0 ? (
          <div className="text-faint text-[10px] leading-relaxed px-1 py-3 text-center">
            {col.key === "blocked"
              ? "Nothing blocked."
              : droppable && dragActive
                ? "drop here"
                : "—"}
          </div>
        ) : (
          tasks.map((t) => (
            <KanbanCard
              key={t.id}
              task={t}
              tasks={allTasks}
              ownerName={ownerName(t.owner)}
              dragging={dragId === t.id}
              move={(status) => move(t.id, status)}
              onDragStart={() => onCardDragStart(t.id)}
              onDragEnd={onCardDragEnd}
            />
          ))
        )}
      </div>
      {col.key === "blocked" ? (
        <div className="text-faint text-[9px] leading-snug px-1 pt-2">
          derived — resolve the blocker to unblock
        </div>
      ) : null}
    </section>
  );
}

/** Kanban task board overlay: the shared tasks as draggable cards across
 *  blocked / not-started / in-progress / done. Drops and the keyboard "move →"
 *  fallback both call store.setTaskStatus, which persists via shared_upsert —
 *  no separate task state, no refetch. */
export function KanbanBoard() {
  const open = useApp((s) => s.kanbanOpen);
  const tasks = useApp((s) => s.tasks);
  const teammates = useApp((s) => s.teammates);
  const setTaskStatus = useApp((s) => s.setTaskStatus);
  const modalA11y = useModalA11y("Kanban task board", open);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ColumnKey | null>(null);

  if (!open) return null;
  const close = () => useApp.setState({ kanbanOpen: false });
  const cols = kanbanColumns(tasks);
  const ownerName = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
  const move = (id: string, status: TaskStatus) => setTaskStatus(id, status);

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[5vh]" onClick={close}>
      <div
        {...modalA11y}
        className="w-[min(1180px,95vw)] max-h-[88vh] flex flex-col glass rounded-md shadow-2xl rise p-5 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">TASK BOARD — KANBAN</span>
          <span className="text-faint text-[10px]">drag a card between columns, or use “move →”</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>
        {tasks.length === 0 ? (
          <div className="text-faint text-[11px] leading-relaxed py-10 text-center">
            No tasks yet. Add tasks from the right rail → tasks, or fan out a checklist.
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto pb-1">
            {COLUMNS.map((col) => (
              <Column
                key={col.key}
                col={col}
                tasks={cols[col.key]}
                allTasks={tasks}
                ownerName={ownerName}
                dragId={dragId}
                isOver={overCol === col.key}
                onCardDragStart={setDragId}
                onCardDragEnd={() => { setDragId(null); setOverCol(null); }}
                onEnter={() => setOverCol(col.key)}
                onLeave={() => setOverCol((c) => (c === col.key ? null : c))}
                onDrop={(status) => {
                  if (dragId) move(dragId, status);
                  setDragId(null);
                  setOverCol(null);
                }}
                move={move}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
