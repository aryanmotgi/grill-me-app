import { describe, expect, it } from "vitest";
import { isNeutral, parseWatch, record, settle, summarize, wordMatch, type WatchEntry } from "./goalWatch";

const GOAL = "Ship login and signup with Supabase";
const MIN = 60_000;

describe("goal watch", () => {
  it("records and settles prompts", () => {
    let log: WatchEntry[] = [];
    log = record(log, { at: 1, text: "add the  login\nform", session: "s" });
    expect(log[0]).toMatchObject({ text: "add the login form", verdict: "pending" });
    log = settle(log, 1, "on", "login form");
    expect(log[0].verdict).toBe("on");
    expect(record(Array.from({ length: 80 }, (_, i) => ({ at: i, text: "x", session: "s", verdict: "on" as const })), { at: 99, text: "y", session: "s" })).toHaveLength(60);
  });
  it("ignores prompts that say nothing about direction", () => {
    for (const t of ["/compact", "yes", "continue", "do it", "ok!"]) expect(isNeutral(t)).toBe(true);
    expect(isNeutral("add password reset")).toBe(false);
  });
  it("guesses with words when no AI is connected", () => {
    expect(wordMatch(GOAL, "the signup button doesn't submit")).toBe("on");
    expect(wordMatch(GOAL, "make the navbar purple with a gradient")).toBe("side");
  });
  it("parses the AI's answer", () => {
    expect(parseWatch({ on_goal: false, why: "navbar styling, not auth" })).toEqual({ verdict: "side", why: "navbar styling, not auth" });
    expect(parseWatch({ why: "x" })).toBeNull();
  });
  it("nudges after a run of side quests, and stays quiet on track", () => {
    const now = 100 * MIN;
    const e = (minsAgo: number, verdict: "on" | "side"): WatchEntry => ({ at: now - minsAgo * MIN, text: "", session: "s", verdict });
    const onTrack = summarize([e(30, "side"), e(20, "on"), e(10, "on")], GOAL, now);
    expect(onTrack).toMatchObject({ total: 3, on: 2, sideStreak: 0, nudge: null });
    const drifting = summarize([e(50, "on"), e(35, "side"), e(20, "side"), e(5, "side")], GOAL, now);
    expect(drifting.sideStreak).toBe(3);
    expect(drifting.nudge).toBe("35 min on side quests. Your goal: Ship login and signup with Supabase");
    const quick = summarize([e(6, "side"), e(4, "side"), e(1, "side")], GOAL, now);
    expect(quick.nudge).toBe("Your last 3 prompts were side quests. Your goal: Ship login and signup with Supabase");
  });
});
