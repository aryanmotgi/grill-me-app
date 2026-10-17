import { describe, it, expect } from "vitest";
import { deliverable, dueNow, humanLine, NUDGE_TEXT, planVersion, verdict, waiting } from "./planNudge";

const T = (id: string, status: "idle" | "working" | "needs-input", seen: number) => ({ id, status, seen });
const PLAN = 1000;

describe("queued, not interrupting — the decision this was built on", () => {
  it("never pushes into a session that is mid-turn", () => {
    // text arriving during a tool call can land inside it; one more turn
    // against a stale plan is the cheaper mistake
    expect(verdict(T("a", "working", 0), PLAN)).toEqual({ send: false, why: "mid-turn" });
    expect(deliverable("working")).toBe(false);
  });

  it("delivers when idle and when waiting on a human", () => {
    // needs-input especially: someone is about to type there anyway
    for (const s of ["idle", "needs-input"] as const) {
      expect(verdict(T("a", s, 0), PLAN)).toEqual({ send: true });
      expect(deliverable(s)).toBe(true);
    }
  });

  it("holds a working session rather than dropping it", () => {
    const ts = [T("a", "working", 0), T("b", "idle", 0)];
    expect(dueNow(ts, PLAN).map((t) => t.id)).toEqual(["b"]);
    expect(waiting(ts, PLAN).map((t) => t.id)).toEqual(["a"]);
    // the held one is still due on a later pass, once it stops working
    expect(dueNow([T("a", "idle", 0)], PLAN).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("not telling a session what it already knows", () => {
  it("skips a session that has seen this version", () => {
    expect(verdict(T("a", "idle", PLAN), PLAN)).toEqual({ send: false, why: "up-to-date" });
    expect(verdict(T("a", "idle", PLAN + 1), PLAN)).toEqual({ send: false, why: "up-to-date" });
  });

  it("sends when the plan is newer than what it saw", () => {
    expect(verdict(T("a", "idle", PLAN - 1), PLAN)).toEqual({ send: true });
  });

  it("does nothing when nothing changed", () => {
    expect(verdict(T("a", "idle", 0), 0)).toEqual({ send: false, why: "no-change" });
    expect(dueNow([T("a", "idle", 0)], 0)).toEqual([]);
  });
});

describe("the plan version", () => {
  it("takes the newest, because decisions arrive from several machines unordered", () => {
    expect(planVersion([{ at: 5, what: "a" }, { at: 99, what: "b" }, { at: 7, what: "c" }])).toBe(99);
  });

  it("survives junk rather than poisoning every comparison with NaN", () => {
    expect(planVersion([{ at: NaN, what: "x" }, { at: 42, what: "y" }])).toBe(42);
    expect(planVersion([])).toBe(0);
  });
});

describe("what each side is told", () => {
  it("sends the agent to catch_up instead of restating the plan", () => {
    // catch_up knows what this agent has already seen; this does not
    expect(NUDGE_TEXT).toMatch(/catch_up/);
    expect(NUDGE_TEXT.length).toBeLessThan(220);
  });

  it("tells the human what moved and who is still on the old plan", () => {
    const c = [{ at: PLAN, what: "auth uses magic links" }];
    expect(humanLine(c, 2, 1)).toBe(
      "Plan changed: auth uses magic links. Told 2 sessions. 1 still working — it finds out at the next turn.",
    );
    expect(humanLine(c, 1, 0)).toBe("Plan changed: auth uses magic links. Told 1 session.");
    expect(humanLine(c, 0, 0)).toMatch(/already up to date/);
  });

  it("does not quote one change when several landed at once", () => {
    const c = [{ at: 1, what: "a" }, { at: 2, what: "b" }];
    expect(humanLine(c, 1, 0)).toMatch(/2 changes/);
  });
});
