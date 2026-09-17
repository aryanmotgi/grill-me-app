import { describe, expect, it } from "vitest";
import type { Teammate } from "../types";
import { isOverCap, sessionTokens, shouldCapPause, type CapCandidate } from "./cap";

describe("isOverCap", () => {
  it("is over when tokens exceed a positive cap", () => {
    expect(isOverCap(200_001, 200_000)).toBe(true);
  });

  it("is NOT over when exactly at the cap (hitting it is still in budget)", () => {
    expect(isOverCap(200_000, 200_000)).toBe(false);
  });

  it("is not over below the cap", () => {
    expect(isOverCap(150_000, 200_000)).toBe(false);
  });

  it("treats cap 0 (or negative) as OFF — nothing is ever over", () => {
    expect(isOverCap(999_999_999, 0)).toBe(false);
    expect(isOverCap(999_999_999, -1)).toBe(false);
    expect(isOverCap(0, 0)).toBe(false);
  });
});

describe("sessionTokens", () => {
  const mate = (tokens?: Teammate["usage"]["tokens"]): Teammate =>
    ({ usage: { model: "x", sessionPct: 0, weeklyPct: 0, sessionResetsIn: "—", weeklyResetsAt: "—", permissionMode: "—", tokens } } as Teammate);

  it("sums input + output only (cache reads are near-free, excluded)", () => {
    expect(sessionTokens(mate({ input: 120_000, output: 80_000, cacheRead: 5_000_000, turns: 12 }))).toBe(200_000);
  });

  it("is 0 for a session with no transcript tally yet", () => {
    expect(sessionTokens(mate(undefined))).toBe(0);
  });
});

describe("shouldCapPause", () => {
  const c = (over: Partial<CapCandidate> = {}): CapCandidate => ({
    status: "working",
    alive: true,
    paused: false,
    rateLimited: false,
    tokens: 250_000,
    cap: 200_000,
    ...over,
  });

  it("pauses a working session over its cap (money stop fires mid-work)", () => {
    expect(shouldCapPause(c())).toBe(true);
  });

  it("pauses an idle session over its cap too", () => {
    expect(shouldCapPause(c({ status: "idle" }))).toBe(true);
  });

  it("NEVER pauses a needs-input session even far over cap (human is deciding)", () => {
    expect(shouldCapPause(c({ status: "needs-input", tokens: 10_000_000 }))).toBe(false);
  });

  it("never pauses a rate-limited session (it resumes on its own)", () => {
    expect(shouldCapPause(c({ rateLimited: true }))).toBe(false);
  });

  it("never pauses a dead or already-paused session", () => {
    expect(shouldCapPause(c({ alive: false }))).toBe(false);
    expect(shouldCapPause(c({ paused: true }))).toBe(false);
  });

  it("does not fire under the cap or when the cap is off", () => {
    expect(shouldCapPause(c({ tokens: 150_000 }))).toBe(false);
    expect(shouldCapPause(c({ cap: 0 }))).toBe(false);
  });
});
