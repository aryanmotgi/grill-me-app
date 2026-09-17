import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import {
  blockerChain,
  blockerOf,
  DROP_STATUSES,
  isBlocked,
  kanbanColumns,
} from "./kanban";

const task = (over: Partial<Task> & Pick<Task, "id">): Task => ({
  title: over.id,
  desc: "",
  owner: "me",
  status: "not-started",
  files: [],
  ...over,
});

describe("kanbanColumns", () => {
  it("routes each status to its column", () => {
    const cols = kanbanColumns([
      task({ id: "a", status: "not-started" }),
      task({ id: "b", status: "in-progress" }),
      task({ id: "c", status: "done" }),
    ]);
    expect(cols["not-started"].map((t) => t.id)).toEqual(["a"]);
    expect(cols["in-progress"].map((t) => t.id)).toEqual(["b"]);
    expect(cols.done.map((t) => t.id)).toEqual(["c"]);
    expect(cols.blocked).toEqual([]);
  });

  it("blocked outranks the underlying status for a not-done task", () => {
    // in-progress but waiting on an unfinished blocker → shows in blocked, not in-progress
    const cols = kanbanColumns([
      task({ id: "blocker", status: "not-started" }),
      task({ id: "child", status: "in-progress", blockedBy: "blocker" }),
    ]);
    expect(cols.blocked.map((t) => t.id)).toEqual(["child"]);
    expect(cols["in-progress"]).toEqual([]);
  });

  it("a task whose blocker is done is not blocked", () => {
    const cols = kanbanColumns([
      task({ id: "blocker", status: "done" }),
      task({ id: "child", status: "in-progress", blockedBy: "blocker" }),
    ]);
    expect(cols.blocked).toEqual([]);
    expect(cols["in-progress"].map((t) => t.id)).toEqual(["child"]);
  });

  it("done always wins, even with an unfinished blocker", () => {
    const cols = kanbanColumns([
      task({ id: "blocker", status: "not-started" }),
      task({ id: "child", status: "done", blockedBy: "blocker" }),
    ]);
    expect(cols.done.map((t) => t.id)).toEqual(["child"]);
    expect(cols.blocked).toEqual([]);
  });

  it("preserves input order within a column", () => {
    const cols = kanbanColumns([
      task({ id: "a", status: "not-started" }),
      task({ id: "b", status: "not-started" }),
    ]);
    expect(cols["not-started"].map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("blockerOf / isBlocked", () => {
  it("returns the unfinished blocker", () => {
    const tasks = [
      task({ id: "blocker", status: "in-progress" }),
      task({ id: "child", blockedBy: "blocker" }),
    ];
    expect(blockerOf(tasks[1], tasks)?.id).toBe("blocker");
    expect(isBlocked(tasks[1], tasks)).toBe(true);
  });

  it("is not blocked with no blockedBy, a done blocker, or a dangling id", () => {
    expect(isBlocked(task({ id: "x" }), [])).toBe(false);
    const doneBlocker = [task({ id: "b", status: "done" }), task({ id: "c", blockedBy: "b" })];
    expect(isBlocked(doneBlocker[1], doneBlocker)).toBe(false);
    expect(isBlocked(task({ id: "c", blockedBy: "missing" }), [])).toBe(false);
  });
});

describe("blockerChain", () => {
  it("collects the unfinished chain root→nearest", () => {
    const tasks = [
      task({ id: "root", title: "Root", status: "in-progress" }),
      task({ id: "mid", title: "Mid", status: "not-started", blockedBy: "root" }),
      task({ id: "leaf", title: "Leaf", status: "not-started", blockedBy: "mid" }),
    ];
    expect(blockerChain(tasks[2], tasks)).toEqual(["Root", "Mid"]);
  });

  it("stops at a done ancestor and is cycle-safe", () => {
    const done = [
      task({ id: "root", title: "Root", status: "done" }),
      task({ id: "leaf", title: "Leaf", blockedBy: "root" }),
    ];
    expect(blockerChain(done[1], done)).toEqual([]);
    const cyclic = [
      task({ id: "a", title: "A", blockedBy: "b" }),
      task({ id: "b", title: "B", blockedBy: "a" }),
    ];
    expect(() => blockerChain(cyclic[0], cyclic)).not.toThrow();
  });
});

describe("DROP_STATUSES", () => {
  it("excludes the derived blocked column", () => {
    expect(DROP_STATUSES).toEqual(["not-started", "in-progress", "done"]);
    expect(DROP_STATUSES).not.toContain("blocked");
  });
});
