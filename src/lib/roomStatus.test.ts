import { describe, expect, it } from "vitest";
import {
  CONNECTING_MAX_MS,
  JOINED_MAX_MS,
  memberStatus,
  statusDotClass,
  statusLabel,
} from "./roomStatus";

const NOW = 1_758_040_000_000;

describe("memberStatus", () => {
  it("is joined for a fresh heartbeat", () => {
    expect(memberStatus(NOW, NOW)).toBe("joined");
    expect(memberStatus(NOW - 1_000, NOW)).toBe("joined");
    expect(memberStatus(NOW - 5_999, NOW)).toBe("joined");
  });

  it("flips to connecting at exactly 6s", () => {
    expect(memberStatus(NOW - JOINED_MAX_MS, NOW)).toBe("connecting");
    expect(memberStatus(NOW - 10_000, NOW)).toBe("connecting");
  });

  it("is still connecting at exactly 15s (contract: 6-15s inclusive)", () => {
    expect(memberStatus(NOW - CONNECTING_MAX_MS, NOW)).toBe("connecting");
  });

  it("is disconnected past 15s", () => {
    expect(memberStatus(NOW - (CONNECTING_MAX_MS + 1), NOW)).toBe("disconnected");
    expect(memberStatus(NOW - 60_000, NOW)).toBe("disconnected");
  });

  it("treats minor clock skew (lastSeen in the future) as joined, never disconnected", () => {
    // host clock a few seconds ahead of a guest must not render everyone offline
    expect(memberStatus(NOW + 3_000, NOW)).toBe("joined");
  });

  it("handles a lastSeen of 0 (never heartbeated) as disconnected", () => {
    expect(memberStatus(0, NOW)).toBe("disconnected");
  });
});

describe("statusDotClass", () => {
  it("maps onto the app's status-dot classes", () => {
    expect(statusDotClass("joined")).toBe("working");
    expect(statusDotClass("connecting")).toBe("needs-input");
    expect(statusDotClass("disconnected")).toBe("idle");
  });
});

describe("statusLabel", () => {
  it("labels every status", () => {
    expect(statusLabel("joined")).toBe("joined");
    expect(statusLabel("connecting")).toBe("connecting…");
    expect(statusLabel("disconnected")).toBe("disconnected");
  });
});
