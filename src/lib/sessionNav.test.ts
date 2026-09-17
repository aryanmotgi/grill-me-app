import { describe, expect, it } from "vitest";
import { stepSelection, visibleSessions } from "./sessionNav";

const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("visibleSessions", () => {
  it("shows every row in team mode", () => {
    expect(visibleSessions(rows, "team", "b").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("shows every row before a mode is chosen (null)", () => {
    expect(visibleSessions(rows, null, "b")).toHaveLength(3);
  });

  it("shows only the own row in solo mode", () => {
    expect(visibleSessions(rows, "solo", "b").map((r) => r.id)).toEqual(["b"]);
  });

  it("falls back to the first row in solo mode when ownId is unknown", () => {
    expect(visibleSessions(rows, "solo", undefined).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("stepSelection", () => {
  const ids = ["a", "b", "c"];

  it("moves down and up between neighbours", () => {
    expect(stepSelection(ids, "a", 1)).toBe("b");
    expect(stepSelection(ids, "b", -1)).toBe("a");
  });

  it("clamps at both ends — no wrap", () => {
    expect(stepSelection(ids, "c", 1)).toBe("c");
    expect(stepSelection(ids, "a", -1)).toBe("a");
  });

  it("seeds from the first row going down when current is null/unknown", () => {
    expect(stepSelection(ids, null, 1)).toBe("a");
    expect(stepSelection(ids, "zzz", 1)).toBe("a");
  });

  it("seeds from the last row going up when current is null/unknown", () => {
    expect(stepSelection(ids, null, -1)).toBe("c");
  });

  it("returns null for an empty list", () => {
    expect(stepSelection([], "a", 1)).toBeNull();
  });
});
