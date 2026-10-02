import { describe, expect, it } from "vitest";
import { ago, beforeLabel, lastTurn } from "./savepoints";

describe("save points", () => {
  it("labels a save point with the message it came before", () => {
    expect(beforeLabel("add  a\nlogin page")).toBe("Before: “add a login page”");
    expect(beforeLabel("x".repeat(100)).length).toBeLessThan(80);
  });
  it("undo last turn picks the newest pre-message save point", () => {
    const pts = [
      { id: "c", label: "Before going back", at: 3 },
      { id: "b", label: "Before: “second”", at: 2 },
      { id: "a", label: "Before: “first”", at: 1 },
    ];
    expect(lastTurn(pts)?.id).toBe("b");
    expect(lastTurn([{ id: "x", label: "Saved by you", at: 1 }])).toBeUndefined();
  });
  it("says when, plainly", () => {
    const now = 1_000_000_000_000;
    expect(ago(now / 1000 - 5, now)).toBe("just now");
    expect(ago(now / 1000 - 240, now)).toBe("4 min ago");
    expect(ago(now / 1000 - 7200, now)).toBe("2 h ago");
  });
});
