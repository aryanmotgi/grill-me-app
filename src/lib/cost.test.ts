import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKEN_RATES,
  estimateCost,
  resolveRates,
  sessionSpends,
  totalCost,
} from "./cost";
import type { Teammate } from "../types";

const mate = (
  id: string,
  tokens?: { input: number; output: number; cacheRead: number; turns: number },
  model = "claude-sonnet",
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
      model,
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

describe("estimateCost", () => {
  it("multiplies each token class by its per-million rate", () => {
    // 1M in ($3) + 2M out ($30) + 10M cache ($3) = $36
    const cost = estimateCost({ input: 1_000_000, output: 2_000_000, cacheRead: 10_000_000 });
    expect(cost).toBeCloseTo(36, 6);
  });

  it("is zero for an empty tally", () => {
    expect(estimateCost({ input: 0, output: 0, cacheRead: 0 })).toBe(0);
  });

  it("honors custom rates", () => {
    const cost = estimateCost(
      { input: 1_000_000, output: 0, cacheRead: 0 },
      { input: 10, output: 99, cacheRead: 99 },
    );
    expect(cost).toBeCloseTo(10, 6);
  });
});

describe("resolveRates", () => {
  it("falls back to defaults for non-objects", () => {
    expect(resolveRates(undefined)).toEqual(DEFAULT_TOKEN_RATES);
    expect(resolveRates(null)).toEqual(DEFAULT_TOKEN_RATES);
    expect(resolveRates(42)).toEqual(DEFAULT_TOKEN_RATES);
  });

  it("overrides only valid numeric fields, keeping defaults otherwise", () => {
    const r = resolveRates({ input: 5, output: "nope", cacheRead: -1 });
    expect(r.input).toBe(5);
    expect(r.output).toBe(DEFAULT_TOKEN_RATES.output);
    expect(r.cacheRead).toBe(DEFAULT_TOKEN_RATES.cacheRead); // negative rejected
  });
});

describe("sessionSpends", () => {
  it("omits sessions with no tokens or all-zero tallies", () => {
    const rows = sessionSpends([
      mate("aryan"),
      mate("mei", { input: 0, output: 0, cacheRead: 5, turns: 0 }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("rolls up and sorts biggest-spender first", () => {
    const rows = sessionSpends([
      mate("aryan", { input: 100, output: 100, cacheRead: 0, turns: 2 }),
      mate("mei", { input: 900, output: 900, cacheRead: 10, turns: 8 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["mei", "aryan"]);
    expect(rows[0].total).toBe(1800);
    expect(rows[0].turns).toBe(8);
    expect(rows[0].model).toBe("claude-sonnet");
  });

  it("computes each row's estimated cost", () => {
    const [row] = sessionSpends([
      mate("aryan", { input: 1_000_000, output: 1_000_000, cacheRead: 0, turns: 1 }),
    ]);
    // 1M in ($3) + 1M out ($15) = $18
    expect(row.cost).toBeCloseTo(18, 6);
  });
});

describe("totalCost", () => {
  it("sums estimated cost across sessions with real tallies", () => {
    const total = totalCost([
      mate("aryan", { input: 1_000_000, output: 0, cacheRead: 0, turns: 1 }),
      mate("mei", { input: 0, output: 1_000_000, cacheRead: 0, turns: 1 }),
    ]);
    // $3 + $15
    expect(total).toBeCloseTo(18, 6);
  });
});
