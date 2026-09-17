import { describe, expect, it } from "vitest";
import { padBox, placeCoachmark } from "./spotlight";

const VP = { width: 1200, height: 800 };
const TIP = { width: 340, height: 150 };

describe("padBox", () => {
  it("grows the box on every side", () => {
    expect(padBox({ left: 100, top: 50, width: 200, height: 40 }, 6)).toEqual({
      left: 94,
      top: 44,
      width: 212,
      height: 52,
    });
  });
});

describe("placeCoachmark", () => {
  it("places below when there is vertical room (e.g. top-bar pill)", () => {
    const p = placeCoachmark({ left: 400, top: 10, width: 256, height: 30 }, TIP, VP);
    expect(p.placement).toBe("below");
    // sits under the padded spot, left-aligned to it
    expect(p.tip.top).toBeGreaterThan(40);
    expect(p.tip.left).toBe(p.spot.left);
  });

  it("places to the right of a tall left rail with no room below", () => {
    // full-height left panel: no vertical room, wide room to the right
    const p = placeCoachmark({ left: 0, top: 0, width: 260, height: 800 }, TIP, VP);
    expect(p.placement).toBe("right");
    expect(p.tip.left).toBeGreaterThan(260);
  });

  it("places above when the target hugs the bottom edge", () => {
    // short target near the bottom, spanning full width so no side room
    const p = placeCoachmark({ left: 0, top: 760, width: 1200, height: 30 }, TIP, VP);
    expect(p.placement).toBe("above");
    expect(p.tip.top).toBeLessThan(760);
  });

  it("clamps the coachmark inside the viewport horizontally", () => {
    // target pinned to the right edge — below placement would overflow right
    const p = placeCoachmark({ left: 1180, top: 10, width: 16, height: 16 }, TIP, VP);
    expect(p.tip.left).toBeGreaterThanOrEqual(12);
    expect(p.tip.left + TIP.width).toBeLessThanOrEqual(VP.width - 12 + 0.001);
  });

  it("never lets the coachmark run off the bottom", () => {
    const p = placeCoachmark({ left: 400, top: 10, width: 256, height: 30 }, TIP, VP);
    expect(p.tip.top + TIP.height).toBeLessThanOrEqual(VP.height - 12 + 0.001);
  });

  it("respects custom pad so the highlight ring clears the target", () => {
    const p = placeCoachmark({ left: 100, top: 100, width: 200, height: 40 }, TIP, VP, { pad: 10 });
    expect(p.spot).toEqual({ left: 90, top: 90, width: 220, height: 60 });
  });
});
