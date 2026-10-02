import { describe, expect, it } from "vitest";
import { isRelayAddr, savedRoomOf } from "./teamRoom";

const good = { role: "guest", memberId: "m2", hostAddr: "relay:abc123def456:s3cret", code: "ABCDE", invite: "https://r/join/abc123def456#s3cret" };

describe("savedRoomOf", () => {
  it("accepts a saved relay room", () => {
    expect(savedRoomOf(good)).toEqual(good);
  });
  it("never restores a same-Wi-Fi room (its host app is gone)", () => {
    expect(savedRoomOf({ ...good, hostAddr: "192.168.1.4:4518" })).toBeNull();
  });
  it("rejects junk", () => {
    expect(savedRoomOf(null)).toBeNull();
    expect(savedRoomOf({ ...good, role: "admin" })).toBeNull();
    expect(savedRoomOf({ ...good, memberId: "" })).toBeNull();
  });
  it("spots relay addresses", () => {
    expect(isRelayAddr("relay:x:y")).toBe(true);
    expect(isRelayAddr("127.0.0.1:4518")).toBe(false);
    expect(isRelayAddr(null)).toBe(false);
  });
});
