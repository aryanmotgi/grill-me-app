import type { Task, TaskStatus } from "../types";

// ---------------------------------------------------------------------------
// Kanban column model — pure functions over the SAME task shape the board and
// store already use. "blocked" is a DERIVED column, not a TaskStatus: a task is
// blocked when its blockedBy points at a task that isn't done. Only the three
// real statuses can be set (via store.setTaskStatus), so those are the only
// drop targets. Kept pure + framework-free so the partitioning is unit-testable
// without a Tauri backend or a rendered board.
// ---------------------------------------------------------------------------

export type ColumnKey = "blocked" | TaskStatus;

/** Column order left→right. Labels match the existing task-board wording. */
export const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "blocked", label: "blocked" },
  { key: "not-started", label: "not started" },
  { key: "in-progress", label: "in progress" },
  { key: "done", label: "done" },
];

/** Statuses a card can be dragged/moved INTO. "blocked" is derived from a
 *  blockedBy link, never set directly, so it is deliberately excluded. */
export const DROP_STATUSES: TaskStatus[] = ["not-started", "in-progress", "done"];

/** The unfinished blocker of a task, or undefined if it isn't blocked. */
export function blockerOf(task: Task, tasks: Task[]): Task | undefined {
  if (!task.blockedBy) return undefined;
  const b = tasks.find((t) => t.id === task.blockedBy);
  return b && b.status !== "done" ? b : undefined;
}

/** A not-done task waiting on an unfinished blocker. */
export function isBlocked(task: Task, tasks: Task[]): boolean {
  return task.status !== "done" && blockerOf(task, tasks) !== undefined;
}

/** Walk blockedBy links upward, collecting the titles of the unfinished chain
 *  (root → nearest). Mirrors the task-board chain, cycle-safe via `seen`. */
export function blockerChain(task: Task, tasks: Task[]): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: Task | undefined = task;
  while (cur?.blockedBy && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = tasks.find((t) => t.id === cur!.blockedBy);
    if (!parent || parent.status === "done") break;
    chain.unshift(parent.title);
    cur = parent;
  }
  return chain;
}

/**
 * Partition tasks into kanban columns. Precedence mirrors the task board:
 * done always lands in done; a not-done blocked task lands in blocked
 * regardless of its underlying status; everything else falls to its status.
 * Order within a column preserves input order.
 */
export function kanbanColumns(tasks: Task[]): Record<ColumnKey, Task[]> {
  const cols: Record<ColumnKey, Task[]> = {
    blocked: [],
    "not-started": [],
    "in-progress": [],
    done: [],
  };
  for (const t of tasks) {
    if (t.status === "done") cols.done.push(t);
    else if (isBlocked(t, tasks)) cols.blocked.push(t);
    else cols[t.status].push(t);
  }
  return cols;
}
