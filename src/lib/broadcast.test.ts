import { describe, expect, it } from "vitest";
import {
  classifyBroadcastTargets,
  writableSelectedTargets,
  type BroadcastMember,
} from "./broadcast";

const m = (id: string, permission?: string): BroadcastMember => ({ id, name: id, permission });

describe("classifyBroadcastTargets", () => {
  it("treats the first member (local operator) as writable regardless of permission", () => {
    const out = classifyBroadcastTargets([m("me", "view")]);
    expect(out).toEqual([{ id: "me", name: "me", writable: true }]);
  });

  it("requires permission === edit for non-operator members", () => {
    const out = classifyBroadcastTargets([m("me"), m("ann", "edit"), m("bob", "view")]);
    expect(out.map((t) => t.writable)).toEqual([true, true, false]);
    expect(out[2].reason).toBe("view-only");
  });

  it("treats unset or unrecognized permission on non-operators as view-only", () => {
    const out = classifyBroadcastTargets([m("me"), m("ann"), m("bob", "readonly")]);
    expect(out[1]).toEqual({ id: "ann", name: "ann", writable: false, reason: "view-only" });
    expect(out[2].writable).toBe(false);
  });

  it("returns an empty list for no members", () => {
    expect(classifyBroadcastTargets([])).toEqual([]);
  });
});

describe("writableSelectedTargets", () => {
  const members = [m("me", "view"), m("ann", "edit"), m("bob", "view")];

  it("keeps only selected members that are writable, in config order", () => {
    const out = writableSelectedTargets(members, ["bob", "ann", "me"]);
    expect(out.map((t) => t.id)).toEqual(["me", "ann"]);
  });

  it("ignores selected ids that are not real members", () => {
    const out = writableSelectedTargets(members, ["ann", "ghost"]);
    expect(out.map((t) => t.id)).toEqual(["ann"]);
  });

  it("returns nothing when only view-only members are selected", () => {
    expect(writableSelectedTargets(members, ["bob"])).toEqual([]);
  });
});
