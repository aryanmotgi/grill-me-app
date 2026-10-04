import { describe, expect, it } from "vitest";
import { focusLeft, glowOf, initialsOf, questionOf, nextSteps, peekLine, recapLine, spendOf, spokenDone, type PillSession } from "./pill";

const s = (over: Partial<PillSession>): PillSession => ({ id: "a", title: "A", status: "idle", peek: "", stuck: false, pinned: false, context: null, trust: false, initials: "A", ...over });

describe("pill glow", () => {
  it("picks the most urgent state", () => {
    const base = { outside: [], justDone: false, focus: false };
    expect(glowOf({ ...base, sessions: [s({ status: "working" }), s({ status: "needs-input" })] })).toBe("needs");
    expect(glowOf({ ...base, sessions: [s({ status: "working", stuck: true })] })).toBe("stuck");
    expect(glowOf({ ...base, sessions: [s({ status: "working" })] })).toBe("working");
    expect(glowOf({ ...base, sessions: [s({})], justDone: true })).toBe("done");
    expect(glowOf({ ...base, sessions: [] })).toBe("idle");
    // an outside session waiting on a permission counts
    expect(glowOf({ ...base, sessions: [], outside: [{ id: "x", folder: "/a", ask: "", status: "needs" }] })).toBe("needs");
  });
  it("goes quiet in focus mode, except for what needs you", () => {
    expect(glowOf({ sessions: [s({ status: "working" })], outside: [], justDone: true, focus: true })).toBe("idle");
    expect(glowOf({ sessions: [s({ status: "needs-input" })], outside: [], justDone: false, focus: true })).toBe("needs");
  });
});

describe("pill words", () => {
  it("peeks", () => {
    expect(peekLine({ sentence: "Working", file: "src/login.tsx", working: true, tests: true })).toBe("Editing login.tsx · tests pass");
    expect(peekLine({ sentence: "Ready for your next message", file: "—", working: false, tests: null })).toBe("Ready for your next message");
  });
  it("offers next steps that fit", () => {
    expect(nextSteps({ tests: null, changed: 3, app: true, onBranch: true }).map((o) => o.id)).toEqual(["tests", "commit", "open-app"]);
    expect(nextSteps({ tests: false, changed: 2, app: false, onBranch: false }).map((o) => o.id)).toEqual(["tests"]);
    expect(nextSteps({ tests: true, changed: 0, app: false, onBranch: true }).map((o) => o.id)).toEqual(["merge"]);
    expect(nextSteps({ tests: null, changed: 0, app: false, onBranch: false })).toEqual([]);
  });
  it("sums up time away", () => {
    expect(recapLine(1500, [{ kind: "done", title: "a" }, { kind: "done", title: "b" }, { kind: "needs", title: "c" }])).toBe("While you were away (25 min): 2 done, 1 needs you.");
    expect(recapLine(7200, [{ kind: "stuck", title: "a" }])).toBe("While you were away (2 h): 1 stuck.");
    expect(recapLine(900, [])).toBeNull();
  });
  it("speaks plainly", () => {
    expect(spokenDone("Market", 3, true)).toBe("Market is done. 3 files changed, tests pass.");
    expect(spokenDone("Market", 1, null)).toBe("Market is done. 1 file changed.");
  });
  it("prices spend and counts focus minutes", () => {
    expect(spendOf({ a: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, b: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 } }, (t) => t.input * 0.5)).toBe(1.5);
    expect(focusLeft(10 * 60_000 + 1, 0)).toBe(11);
    expect(focusLeft(null)).toBe(0);
  });
});

describe("chip letters", () => {
  it("takes the first letters of the first two words", () => {
    expect(initialsOf("Market prices")).toBe("MP");
    expect(initialsOf("barn")).toBe("B");
    expect(initialsOf("add-a-tooltip")).toBe("AA");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("what a waiting agent asks", () => {
  it("finds the last question on its screen", () => {
    expect(questionOf([
      "╭──────────────────────────────╮",
      "│ Should I store saves in localStorage or a file?  │",
      "│ ❯ 1. localStorage                │",
      "│   2. A JSON file                 │",
      "╰──────────────────────────────╯",
      "Enter to confirm · Esc to cancel",
    ])).toBe("Should I store saves in localStorage or a file?");
    expect(questionOf(["Done. 3 files changed.", ""])).toBeUndefined();
  });
});
