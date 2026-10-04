import { describe, expect, it } from "vitest";
import { blockedBy, columns, mvpOf, whoIsOnWhat } from "./brainPlan";
import type { Task } from "../types";

const t = (id: string, status: Task["status"], over: Partial<Task> = {}): Task => ({ id, title: id, desc: "", owner: "me", status, files: [], ...over });

describe("brain plan", () => {
  const tasks = [
    t("login", "done", { mvp: true }),
    t("signup", "in-progress", { mvp: true, owner: "mei", startedAt: 2 }),
    t("dark-mode", "not-started"),
    t("reset", "not-started", { mvp: true, blockedBy: "signup" }),
    t("polish", "in-progress", { owner: "me", startedAt: 1 }),
  ];
  it("counts the MVP", () => {
    expect(mvpOf(tasks)).toMatchObject({ done: 1, total: 3 });
  });
  it("splits the plan into stages, must-haves first", () => {
    const c = columns(tasks);
    expect(c.todo.map((x) => x.id)).toEqual(["reset", "dark-mode"]);
    expect(c.doing.map((x) => x.id)).toEqual(["signup", "polish"]);
    expect(c.done.map((x) => x.id)).toEqual(["login"]);
  });
  it("says who's on what, including owners it doesn't know", () => {
    const w = whoIsOnWhat(tasks, [{ id: "me", name: "You" }, { id: "sam", name: "Sam" }]);
    expect(w.map((p) => `${p.name}:${p.doing.length}`)).toEqual(["You:1", "mei:1", "Sam:0"]);
  });
  it("knows what a task waits on", () => {
    expect(blockedBy(tasks[3], tasks)?.id).toBe("signup");
    expect(blockedBy(t("x", "not-started", { blockedBy: "login" }), tasks)).toBeUndefined();
  });
});
