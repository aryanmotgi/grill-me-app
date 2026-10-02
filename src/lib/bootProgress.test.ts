import { describe, expect, it } from "vitest";
import { matesOnline, progressOf } from "./bootProgress";

describe("boot progress", () => {
  it("reports Ready once settings and the restore are both done", () => {
    expect(progressOf(new Set(["start"])).value).toBe(0.15);
    expect(progressOf(new Set(["start", "settings"])).value).toBe(0.5);
    expect(progressOf(new Set(["start", "restore"])).value).toBe(0.15);
    expect(progressOf(new Set(["start", "settings", "restore"]))).toEqual({ value: 1, label: "Ready" });
  });
  it("counts teammates online, not me and not stale ones", () => {
    const now = 100_000;
    const members = [{ id: "me", lastSeen: now }, { id: "a", lastSeen: now - 1000 }, { id: "b", lastSeen: now - 60_000 }];
    expect(matesOnline(members, "me", now)).toBe(1);
    expect(matesOnline([], "me", now)).toBe(0);
  });
});
