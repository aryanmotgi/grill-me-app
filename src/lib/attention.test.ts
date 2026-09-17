import { describe, expect, it } from "vitest";
import {
  autoPauseEligible,
  needsAttention,
  resolveDisplayStatus,
  type AutoPauseCandidate,
} from "./attention";

const idleCandidate = (over: Partial<AutoPauseCandidate> = {}): AutoPauseCandidate => ({
  status: "idle",
  alive: true,
  paused: false,
  rateLimited: false,
  isViewed: false,
  quietMs: 10 * 60_000, // 10 min quiet, well past the 5 min threshold
  idleThresholdMs: 5 * 60_000,
  ...over,
});

describe("autoPauseEligible", () => {
  it("pauses a genuinely idle unwatched session past the threshold", () => {
    expect(autoPauseEligible(idleCandidate())).toBe(true);
  });

  it("NEVER pauses a needs-input session, no matter how long it has been quiet", () => {
    // quiet BECAUSE it is waiting on a human — the old code paused this
    expect(autoPauseEligible(idleCandidate({ status: "needs-input" }))).toBe(false);
    expect(
      autoPauseEligible(idleCandidate({ status: "needs-input", quietMs: 24 * 60 * 60_000 })),
    ).toBe(false);
  });

  it("never pauses a rate-limited session (it resumes on its own)", () => {
    expect(autoPauseEligible(idleCandidate({ rateLimited: true }))).toBe(false);
  });

  it("never pauses the session currently on screen", () => {
    expect(autoPauseEligible(idleCandidate({ isViewed: true }))).toBe(false);
  });

  it("never pauses dead or already-paused sessions", () => {
    expect(autoPauseEligible(idleCandidate({ alive: false }))).toBe(false);
    expect(autoPauseEligible(idleCandidate({ paused: true }))).toBe(false);
  });

  it("waits out the quiet threshold", () => {
    expect(autoPauseEligible(idleCandidate({ quietMs: 4 * 60_000 }))).toBe(false);
  });
});

describe("resolveDisplayStatus", () => {
  it("keeps needs-input visible while paused (pause must not mask a human request)", () => {
    // old code: paused -> "idle" unconditionally, hiding the request
    expect(resolveDisplayStatus("needs-input", true, false)).toBe("needs-input");
  });

  it("keeps a rate-limit needs-input visible while paused", () => {
    expect(resolveDisplayStatus("idle", true, true)).toBe("needs-input");
  });

  it("shows paused working/idle sessions as idle", () => {
    expect(resolveDisplayStatus("working", true, false)).toBe("idle");
    expect(resolveDisplayStatus("idle", true, false)).toBe("idle");
  });

  it("passes status through unchanged when not paused", () => {
    expect(resolveDisplayStatus("working", false, false)).toBe("working");
    expect(resolveDisplayStatus("idle", false, false)).toBe("idle");
    expect(resolveDisplayStatus("needs-input", false, false)).toBe("needs-input");
  });
});

describe("needsAttention", () => {
  it("includes a paused session that needs input", () => {
    expect(needsAttention({ status: "needs-input", health: "ok", paused: true })).toBe(true);
  });

  it("includes a non-paused needs-input session", () => {
    expect(needsAttention({ status: "needs-input", health: "ok" })).toBe(true);
  });

  it("does NOT include a working session just because it is paused", () => {
    expect(needsAttention({ status: "working", health: "ok", paused: true })).toBe(false);
  });

  it("does not include healthy idle/working sessions", () => {
    expect(needsAttention({ status: "idle", health: "ok" })).toBe(false);
    expect(needsAttention({ status: "working", health: "ok" })).toBe(false);
  });

  it("includes unhealthy sessions regardless of status", () => {
    expect(needsAttention({ status: "idle", health: "stale" })).toBe(true);
    expect(needsAttention({ status: "working", health: "disconnected" })).toBe(true);
  });

  it("includes a stalled or looping session even when otherwise healthy", () => {
    expect(needsAttention({ status: "idle", health: "ok", flag: "stalled" })).toBe(true);
    expect(needsAttention({ status: "working", health: "ok", flag: "looping" })).toBe(true);
  });

  it("does not include a healthy, unflagged session", () => {
    expect(needsAttention({ status: "idle", health: "ok" })).toBe(false);
  });
});

describe("end-to-end invariant: auto-pause can never hide a session from attention", () => {
  it("any session eligible for auto-pause is, after pausing, still not attention-worthy — and any attention-worthy session is never eligible", () => {
    const statuses = ["idle", "working", "needs-input"] as const;
    for (const status of statuses) {
      for (const rateLimited of [false, true]) {
        const eligible = autoPauseEligible(idleCandidate({ status, rateLimited }));
        const shownAfterPause = resolveDisplayStatus(status, true, rateLimited);
        const needed = needsAttention({ status: shownAfterPause, health: "ok", paused: true });
        if (eligible) expect(needed).toBe(false);
        // conversely: anything a human must answer is never auto-pause eligible
        if (status === "needs-input" || rateLimited) expect(eligible).toBe(false);
      }
    }
  });
});
