import { describe, expect, it } from "vitest";
import {
  activityLine,
  BUDGET_WARN_AT,
  DEFAULT_TOKEN_BUDGET,
  tokenBudget,
  tokenBurn,
  totalTokens,
} from "./dashboard";
import type { ActivityEvent, Teammate } from "../types";

const mate = (
  id: string,
  tokens?: { input: number; output: number; cacheRead: number; turns: number },
): Teammate =>
  ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    initials: id.slice(0, 2).toUpperCase(),
    branch: "—",
    taskLabel: "—",
    status: "idle",
    setup: "ready",
    currentFile: "—",
    lastActiveMin: 0,
    health: "ok",
    permission: "edit",
    dnd: false,
    recording: false,
    usage: {
      model: "—",
      sessionPct: 0,
      weeklyPct: 0,
      sessionResetsIn: "—",
      weeklyResetsAt: "—",
      permissionMode: "—",
      tokens,
    },
    terminal: [],
    changes: [],
    standupNote: "—",
  }) as Teammate;

describe("tokenBudget", () => {
  it("returns an empty budget when no session has tokens yet", () => {
    const b = tokenBudget([mate("aryan"), mate("mei")]);
    expect(b.spent).toBe(0);
    expect(b.top).toBeNull();
    expect(b.near).toBe(false);
    expect(b.over).toBe(false);
    expect(b.cap).toBe(DEFAULT_TOKEN_BUDGET);
  });

  it("sums input+output only (cache reads excluded) across sessions", () => {
    const b = tokenBudget([
      mate("aryan", { input: 100, output: 200, cacheRead: 9_000_000, turns: 3 }),
      mate("mei", { input: 50, output: 50, cacheRead: 0, turns: 1 }),
    ]);
    expect(b.spent).toBe(400); // 300 + 100, cacheRead ignored
  });

  it("names the biggest spender", () => {
    const b = tokenBudget([
      mate("aryan", { input: 100, output: 100, cacheRead: 0, turns: 1 }),
      mate("mei", { input: 900, output: 900, cacheRead: 0, turns: 5 }),
      mate("dev", { input: 10, output: 10, cacheRead: 0, turns: 1 }),
    ]);
    expect(b.top?.id).toBe("mei");
    expect(b.top?.tokens).toBe(1800);
  });

  it("ignores sessions whose tallies are zero", () => {
    const b = tokenBudget([mate("aryan", { input: 0, output: 0, cacheRead: 5, turns: 0 })]);
    expect(b.spent).toBe(0);
    expect(b.top).toBeNull();
  });

  it("flags near at the warn threshold and over past the cap", () => {
    const cap = 1000;
    const nearAmt = Math.ceil(cap * BUDGET_WARN_AT);
    const near = tokenBudget([mate("a", { input: nearAmt, output: 0, cacheRead: 0, turns: 1 })], cap);
    expect(near.near).toBe(true);
    expect(near.over).toBe(false);
    const over = tokenBudget([mate("a", { input: cap + 1, output: 0, cacheRead: 0, turns: 1 })], cap);
    expect(over.over).toBe(true);
    expect(over.ratio).toBeGreaterThan(1);
  });

  it("stays safe when the cap is zero", () => {
    const b = tokenBudget([mate("a", { input: 10, output: 10, cacheRead: 0, turns: 1 })], 0);
    expect(b.ratio).toBe(0);
    expect(b.near).toBe(false);
  });
});

describe("totalTokens", () => {
  it("matches the budget spend", () => {
    const team = [
      mate("aryan", { input: 100, output: 200, cacheRead: 0, turns: 1 }),
      mate("mei", { input: 5, output: 5, cacheRead: 0, turns: 1 }),
    ];
    expect(totalTokens(team)).toBe(310);
  });
});

describe("tokenBurn", () => {
  it("is empty (and total 0) when no session has tokens yet", () => {
    const burn = tokenBurn([mate("aryan"), mate("mei")]);
    expect(burn.total).toBe(0);
    expect(burn.bars).toEqual([]);
    expect(burn.max).toBe(0);
  });

  it("sums input+output (cache reads excluded) and matches the budget total", () => {
    const team = [
      mate("aryan", { input: 100, output: 200, cacheRead: 9_000_000, turns: 3 }),
      mate("mei", { input: 50, output: 50, cacheRead: 0, turns: 1 }),
    ];
    const burn = tokenBurn(team);
    expect(burn.total).toBe(400);
    expect(burn.total).toBe(tokenBudget(team).spent);
  });

  it("returns one bar per real session, biggest first, with the max spend", () => {
    const burn = tokenBurn([
      mate("aryan", { input: 100, output: 100, cacheRead: 0, turns: 1 }),
      mate("mei", { input: 900, output: 900, cacheRead: 0, turns: 5 }),
      mate("dev", { input: 10, output: 10, cacheRead: 0, turns: 1 }),
    ]);
    expect(burn.bars.map((b) => b.id)).toEqual(["mei", "aryan", "dev"]);
    expect(burn.bars[0].tokens).toBe(1800);
    expect(burn.max).toBe(1800);
  });

  it("drops sessions with a zero (or missing) tally rather than charting a fake bar", () => {
    const burn = tokenBurn([
      mate("aryan", { input: 0, output: 0, cacheRead: 5, turns: 0 }),
      mate("mei"),
      mate("dev", { input: 5, output: 5, cacheRead: 0, turns: 1 }),
    ]);
    expect(burn.bars.map((b) => b.id)).toEqual(["dev"]);
    expect(burn.total).toBe(10);
  });
});

describe("activityLine", () => {
  const nameOf = (id: string) => (id === "aryan" ? "Aryan" : id);
  const ev = (kind: ActivityEvent["kind"], actor: string, text: string): ActivityEvent => ({
    id: `${kind}-${actor}`,
    kind,
    actor,
    text,
    ts: "20:00",
  });

  it("reads a commit line", () => {
    expect(activityLine(ev("commit", "aryan", "feat: home"), nameOf)).toBe("Aryan committed feat: home");
  });

  it("passes merge text through (already phrased)", () => {
    expect(activityLine(ev("merge", "aryan", "merged x → main"), nameOf)).toBe("Aryan merged x → main");
  });

  it("falls back to the actor id when no name is known", () => {
    expect(activityLine(ev("status", "ghost", "went idle"), nameOf)).toBe("ghost went idle");
  });
});
