// ---------------------------------------------------------------------------
// The Brain's plan view, worked out from the shared tasks: the MVP (tasks
// marked must-have), the plan by stage (to do, doing, done), and who's on
// what. Pure.
// ---------------------------------------------------------------------------

import type { Task } from "../types";

export interface Mvp { items: Task[]; done: number; total: number }
export interface PlanColumns { todo: Task[]; doing: Task[]; done: Task[] }
export interface Person { id: string; name: string; doing: Task[] }

export function mvpOf(tasks: Task[]): Mvp {
  const items = tasks.filter((t) => t.mvp);
  return { items, done: items.filter((t) => t.status === "done").length, total: items.length };
}

/** Each stage, must-haves first, then by when work started. */
export function columns(tasks: Task[]): PlanColumns {
  const order = (a: Task, b: Task) => Number(!!b.mvp) - Number(!!a.mvp) || (a.startedAt ?? 0) - (b.startedAt ?? 0);
  return {
    todo: tasks.filter((t) => t.status === "not-started").sort(order),
    doing: tasks.filter((t) => t.status === "in-progress").sort(order),
    done: tasks.filter((t) => t.status === "done").sort(order),
  };
}

/** Who's working on what: everyone with a task in progress, busiest first,
 *  then everyone else known (so nobody silently has nothing). */
export function whoIsOnWhat(tasks: Task[], people: { id: string; name: string }[]): Person[] {
  const list = people.map((p) => ({ id: p.id, name: p.name, doing: tasks.filter((t) => t.owner === p.id && t.status === "in-progress") }));
  // owners that aren't in the list (a teammate who left, an old id)
  for (const t of tasks) {
    if (t.status === "in-progress" && t.owner && !list.some((p) => p.id === t.owner)) {
      list.push({ id: t.owner, name: t.owner, doing: tasks.filter((x) => x.owner === t.owner && x.status === "in-progress") });
    }
  }
  return list.sort((a, b) => b.doing.length - a.doing.length);
}

/** The task this one waits on, if it isn't done yet. */
export function blockedBy(t: Task, tasks: Task[]): Task | undefined {
  const b = t.blockedBy ? tasks.find((x) => x.id === t.blockedBy) : undefined;
  return b && b.status !== "done" ? b : undefined;
}
