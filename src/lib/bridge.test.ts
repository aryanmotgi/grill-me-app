import { describe, expect, it } from "vitest";
import { EMPTY_BRIDGE, newlyPending, parseBridge, pendingCount, planToTasks, type BridgeState } from "./bridge";

const state: BridgeState = {
  handoffs: [
    { id: "h1", ts: 1, status: "pending", kind: "handoff", session: "a", sessionTitle: "Landing", message: "m", userExplanation: "e" },
    { id: "h2", ts: 2, status: "sent", kind: "handoff", session: "a", message: "m", userExplanation: "e" },
  ],
  plans: [{ id: "p1", ts: 1, status: "pending", title: "Auth", decision: "d", tasks: [{ title: "Login" }, { title: "Logout", files: ["a.ts"] }] }],
  questions: [{ id: "q1", ts: 1, answered: false, from: "a", question: "?" }, { id: "q2", ts: 1, answered: true, from: "a", question: "?" }],
  notes: [],
};

describe("bridge helpers", () => {
  it("parses defensively", () => {
    expect(parseBridge("nope")).toEqual(EMPTY_BRIDGE);
    expect(parseBridge('{"handoffs":5}').handoffs).toEqual([]);
  });
  it("counts only pending work", () => {
    expect(pendingCount(state)).toBe(3);
  });
  it("reports only newly pending items", () => {
    expect(newlyPending(EMPTY_BRIDGE, state)).toHaveLength(3);
    expect(newlyPending(state, state)).toEqual([]);
    expect(newlyPending(EMPTY_BRIDGE, state)[0]).toContain("Landing");
  });
  it("turns a plan into not-started tasks with stable ids", () => {
    const tasks = planToTasks(state.plans[0], "me");
    expect(tasks.map((t) => t.id)).toEqual(["p1-t0", "p1-t1"]);
    expect(tasks[1]).toMatchObject({ owner: "me", status: "not-started", files: ["a.ts"] });
  });
});
