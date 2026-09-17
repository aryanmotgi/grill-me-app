import { describe, expect, it } from "vitest";
import {
  nextPresence,
  normalizePresence,
  PRESENCE_LABEL,
  PRESENCE_ORDER,
  PRESENCE_TONE,
  type Presence,
} from "./selfPresence";

describe("normalizePresence", () => {
  it("passes through valid values", () => {
    for (const p of PRESENCE_ORDER) expect(normalizePresence(p)).toBe(p);
  });
  it("defaults anything else to available", () => {
    for (const bad of [undefined, null, "", "busy", 3, {}]) {
      expect(normalizePresence(bad)).toBe("available");
    }
  });
});

describe("nextPresence", () => {
  it("cycles available → heads-down → away → available", () => {
    expect(nextPresence("available")).toBe("heads-down");
    expect(nextPresence("heads-down")).toBe("away");
    expect(nextPresence("away")).toBe("available");
  });
  it("visits every state exactly once per full loop", () => {
    const seen = new Set<Presence>();
    let p: Presence = "available";
    for (let i = 0; i < PRESENCE_ORDER.length; i++) {
      seen.add(p);
      p = nextPresence(p);
    }
    expect(seen.size).toBe(PRESENCE_ORDER.length);
    expect(p).toBe("available"); // back to start
  });
});

describe("presence maps", () => {
  it("has a label and a non-accent tone for every state", () => {
    for (const p of PRESENCE_ORDER) {
      expect(PRESENCE_LABEL[p]).toBeTruthy();
      expect(PRESENCE_TONE[p]).toMatch(/^text-/);
      expect(PRESENCE_TONE[p]).not.toContain("accent"); // amber = actions only
    }
  });
});
