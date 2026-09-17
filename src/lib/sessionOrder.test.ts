import { describe, expect, it } from "vitest";
import { applySessionOrder, moveId, reorderByDrop } from "./sessionOrder";

const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("applySessionOrder", () => {
  it("returns items unchanged with no/empty order", () => {
    expect(applySessionOrder(rows, undefined)).toBe(rows);
    expect(ids(applySessionOrder(rows, []))).toEqual(["a", "b", "c", "d"]);
  });

  it("reorders to match a full order array", () => {
    expect(ids(applySessionOrder(rows, ["c", "a", "d", "b"]))).toEqual(["c", "a", "d", "b"]);
  });

  it("appends items missing from the order after the ranked ones, in natural order", () => {
    // only c and a are ranked; b and d were never dragged
    expect(ids(applySessionOrder(rows, ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores stale ids in the order that no longer exist", () => {
    expect(ids(applySessionOrder(rows, ["gone", "b", "a"]))).toEqual(["b", "a", "c", "d"]);
  });

  it("never drops or duplicates an item", () => {
    const out = applySessionOrder(rows, ["d", "d", "x"]);
    expect(ids(out).slice().sort()).toEqual(["a", "b", "c", "d"]);
    expect(out).toHaveLength(4);
  });
});

describe("moveId", () => {
  it("moves an id up", () => {
    expect(moveId(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("moves an id down", () => {
    expect(moveId(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("clamps at the top and bottom", () => {
    expect(moveId(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("no-ops for an unknown id", () => {
    const arr = ["a", "b"];
    expect(moveId(arr, "z", 1)).toBe(arr);
  });
});

describe("reorderByDrop", () => {
  it("drags a lower row up onto a higher target — lands before it", () => {
    expect(reorderByDrop(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("drags a higher row down onto a lower target — lands after it", () => {
    expect(reorderByDrop(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("no-ops when dropping onto itself", () => {
    const arr = ["a", "b", "c"];
    expect(reorderByDrop(arr, "b", "b")).toBe(arr);
  });

  it("no-ops for unknown ids", () => {
    const arr = ["a", "b", "c"];
    expect(reorderByDrop(arr, "z", "b")).toBe(arr);
    expect(reorderByDrop(arr, "a", "z")).toBe(arr);
  });
});
