import { describe, expect, it } from "vitest";
import { inQuietHours, notificationsSilenced, parseHhMm } from "./quietHours";

// Fix a date and vary only the clock time so the wall-clock math is exercised
// without depending on the machine's timezone offset (getHours is local).
const at = (h: number, m = 0) => new Date(2026, 8, 15, h, m, 0);

describe("parseHhMm", () => {
  it("parses valid 24h times to minutes since midnight", () => {
    expect(parseHhMm("00:00")).toBe(0);
    expect(parseHhMm("07:30")).toBe(450);
    expect(parseHhMm("23:59")).toBe(1439);
    expect(parseHhMm(" 9:05 ")).toBe(545);
  });
  it("rejects malformed or out-of-range input", () => {
    for (const bad of ["", "9", "24:00", "12:60", "aa:bb", "12:5", "-1:00"]) {
      expect(parseHhMm(bad), bad).toBeNull();
    }
  });
});

describe("inQuietHours", () => {
  it("handles a same-day window [09:00, 17:00)", () => {
    expect(inQuietHours(at(8, 59), "09:00", "17:00")).toBe(false);
    expect(inQuietHours(at(9, 0), "09:00", "17:00")).toBe(true); // start is quiet
    expect(inQuietHours(at(12, 0), "09:00", "17:00")).toBe(true);
    expect(inQuietHours(at(16, 59), "09:00", "17:00")).toBe(true);
    expect(inQuietHours(at(17, 0), "09:00", "17:00")).toBe(false); // end rings
  });

  it("handles a window that wraps midnight [22:00, 07:00)", () => {
    expect(inQuietHours(at(21, 59), "22:00", "07:00")).toBe(false);
    expect(inQuietHours(at(22, 0), "22:00", "07:00")).toBe(true);
    expect(inQuietHours(at(2, 0), "22:00", "07:00")).toBe(true);
    expect(inQuietHours(at(6, 59), "22:00", "07:00")).toBe(true);
    expect(inQuietHours(at(7, 0), "22:00", "07:00")).toBe(false);
  });

  it("treats an empty window (start === end) as never quiet", () => {
    expect(inQuietHours(at(3, 0), "08:00", "08:00")).toBe(false);
  });

  it("fails open (not quiet) on malformed times", () => {
    expect(inQuietHours(at(3, 0), "nonsense", "07:00")).toBe(false);
    expect(inQuietHours(at(3, 0), "22:00", "")).toBe(false);
  });
});

describe("notificationsSilenced", () => {
  const qh = (extra: Record<string, unknown>) => ({ quietHours: extra });

  it("silences (sound AND OS banner) inside an enabled window", () => {
    const s = qh({ enabled: true, start: "22:00", end: "07:00" });
    expect(notificationsSilenced(s, at(2, 0))).toBe(true);
    expect(notificationsSilenced(s, at(12, 0))).toBe(false);
  });

  it("never silences when quiet hours are disabled or absent", () => {
    expect(notificationsSilenced(qh({ enabled: false, start: "22:00", end: "07:00" }), at(2, 0))).toBe(false);
    expect(notificationsSilenced({}, at(2, 0))).toBe(false); // Settings test button
  });

  it("fails open on a malformed or partial quietHours block", () => {
    expect(notificationsSilenced(qh({ enabled: true, start: "22:00" }), at(2, 0))).toBe(false);
    expect(notificationsSilenced(qh({ enabled: true, start: 22, end: 7 }), at(2, 0))).toBe(false);
  });
});
