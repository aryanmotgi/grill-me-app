import { describe, expect, it } from "vitest";
import { clampPlayhead, scrubWindow } from "./scrubback";

const LINES = ["a", "b", "c", "d", "e"];

describe("clampPlayhead", () => {
  it("returns 0 for an empty buffer", () => {
    expect(clampPlayhead([], 3)).toBe(0);
    expect(clampPlayhead([], 0)).toBe(0);
  });

  it("clamps into [0, len-1]", () => {
    expect(clampPlayhead(LINES, -4)).toBe(0);
    expect(clampPlayhead(LINES, 99)).toBe(4);
    expect(clampPlayhead(LINES, 2)).toBe(2);
  });

  it("floors fractional values and falls back to the last line for NaN", () => {
    expect(clampPlayhead(LINES, 2.9)).toBe(2);
    expect(clampPlayhead(LINES, Number.NaN)).toBe(4);
  });
});

describe("scrubWindow", () => {
  it("returns an empty window for no lines", () => {
    expect(scrubWindow([], 0, 10)).toEqual({ top: 0, bottom: 0, window: [] });
  });

  it("shows the run of lines ending at the playhead", () => {
    expect(scrubWindow(LINES, 3, 2)).toEqual({ top: 2, bottom: 3, window: ["c", "d"] });
  });

  it("does not underflow past the first line", () => {
    expect(scrubWindow(LINES, 1, 5)).toEqual({ top: 0, bottom: 1, window: ["a", "b"] });
  });

  it("lands the newest line at the bottom when scrubbed fully right", () => {
    const w = scrubWindow(LINES, 99, 3);
    expect(w.bottom).toBe(4);
    expect(w.window).toEqual(["c", "d", "e"]);
  });

  it("treats a zero/negative viewport as at least one row", () => {
    expect(scrubWindow(LINES, 2, 0)).toEqual({ top: 2, bottom: 2, window: ["c"] });
  });
});
