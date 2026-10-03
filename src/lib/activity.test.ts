import { describe, expect, it } from "vitest";
import { addItem } from "./activity";

describe("activity", () => {
  it("adds newest first", () => {
    const a = addItem(addItem([], "one", "info", 1000), "two", "warn", 2000);
    expect(a.map((x) => x.text)).toEqual(["two", "one"]);
    expect(a[0]).toMatchObject({ tone: "warn", count: 1, read: false });
  });
  it("merges a repeat within half an hour instead of piling up", () => {
    let a = addItem([], "X may be off-plan", "warn", 0);
    a = addItem(a, "other", "info", 1000);
    a = addItem(a, "X may be off-plan", "warn", 60_000);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ text: "X may be off-plan", count: 2 });
    expect(addItem(a, "X may be off-plan", "warn", 60_000 + 31 * 60_000)).toHaveLength(3);
  });
  it("keeps the log short", () => {
    let a: ReturnType<typeof addItem> = [];
    for (let i = 0; i < 80; i++) a = addItem(a, `n${i}`, "info", i);
    expect(a).toHaveLength(60);
  });
});
