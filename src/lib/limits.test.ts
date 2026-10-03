import { describe, expect, it } from "vitest";
import { forecast, paceFrac, span, type LimitWindow } from "./limits";

const NOW = Date.parse("2026-10-03T12:00:00Z");
// a 5-hour window that resets in `left` minutes, with `pct` used
const w = (pct: number, left: number, windowMins = 300): LimitWindow => ({ label: "5-hour", pct, windowMins, resetsAt: new Date(NOW + left * 60_000).toISOString() });

describe("limits", () => {
  it("formats spans", () => {
    expect(span(45)).toBe("45m");
    expect(span(80)).toBe("1h 20m");
    expect(span(120)).toBe("2h");
    expect(span(60 * 50)).toBe("2d 2h");
    expect(span(60 * 96)).toBe("4d");
  });
  it("knows how far through the window we are", () => {
    expect(paceFrac(w(10, 150), NOW)).toBeCloseTo(0.5);
    expect(paceFrac({ label: "x", pct: 1, windowMins: 300, resetsAt: null }, NOW)).toBeNull();
  });
  it("warns when the pace runs out before the reset", () => {
    // 60% used in 1h of a 5h window: 1%/min, 40 more minutes to full, 4h to reset
    const f = forecast(w(60, 240), NOW);
    expect(f.text).toBe("At this pace you hit the limit in 40m, 3h 20m before it resets.");
    expect(f.tone).toBe("hot");
  });
  it("says on pace when it lasts", () => {
    expect(forecast(w(30, 120), NOW)).toEqual({ tone: "ok", text: "On pace. Resets in 2h." });
  });
  it("doesn't guess too early, and says when it's full", () => {
    expect(forecast(w(2, 295), NOW).text).toBe("Plenty left. Resets in 4h 55m.");
    expect(forecast(w(100, 30), NOW)).toEqual({ tone: "hot", text: "Limit reached. Resets in 30m." });
  });
});
