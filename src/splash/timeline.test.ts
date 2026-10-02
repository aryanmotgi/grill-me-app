import { describe, expect, it } from "vitest";
import { TIMELINE, modeOf, nextFill, shouldExpand, skipOffset, stalled, welcomeLine } from "./timeline";

describe("launch timeline", () => {
  it("first launch runs about 4–5 s, later launches under 2 s", () => {
    expect(TIMELINE.first.minReady + TIMELINE.first.expand).toBeGreaterThan(4);
    expect(TIMELINE.first.minReady + TIMELINE.first.expand).toBeLessThan(5.5);
    expect(TIMELINE.back.minReady + TIMELINE.back.expand).toBeLessThan(2);
    expect(modeOf("back")).toBe("back");
    expect(modeOf(null)).toBe("first");
  });
  it("the box only fills after it exists, and only opens when loading is done", () => {
    const tl = TIMELINE.first, boxed = tl.fold[1] + 0.1, ready = tl.minReady + 0.05;
    expect(nextFill(0, 1, tl.fold[0], 0.016, tl)).toBe(0);
    let f = 0;
    for (let i = 0; i < 60; i++) f = nextFill(f, 1, boxed, 0.05, tl);
    expect(f).toBe(1);
    expect(shouldExpand(ready, 0.9, tl)).toBe(false);
    expect(shouldExpand(tl.fold[0], 1, tl)).toBe(false);
    expect(shouldExpand(ready, 1, tl)).toBe(true);
  });
  it("click skips to the box, never backwards", () => {
    const tl = TIMELINE.first;
    expect(0.5 + skipOffset(0.5, 0, tl)).toBeCloseTo(tl.fold[1]);
    expect(skipOffset(tl.fold[1] + 1, 0.2, tl)).toBe(0.2);
  });
  it("welcome line uses the first name and teammate count", () => {
    expect(welcomeLine("Aryan Motgi", 2)).toEqual({ hello: "Welcome back, Aryan", online: "2 teammates online" });
    expect(welcomeLine("", 1)).toEqual({ hello: "Welcome back", online: "1 teammate online" });
    expect(welcomeLine("Sam", 0).online).toBe("No teammates online yet");
    expect(welcomeLine("Sam", null).online).toBeNull();
  });
  it("notices when macOS stops drawing the splash", () => {
    expect(stalled(1000, 1200, false)).toBe(false);
    expect(stalled(1000, 2500, false)).toBe(false); // a hitch isn't a stall
    expect(stalled(1000, 4500, false)).toBe(true);
    expect(stalled(1000, 1001, true)).toBe(true);
  });
});
