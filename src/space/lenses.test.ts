import { describe, expect, it } from "vitest";
import { live, meter, meterLine, readState } from "./lenses";

describe("live lens", () => {
  const l = live([
    { id: "me", title: "Market", status: "working", folder: "/code/farm", current: "src/logic.js", changed: ["src/logic.js", "./src/ui.js"] },
    { id: "barn", title: "Barn", status: "idle", folder: "/wt/barn", current: "/wt/barn/src/ui.js", changed: ["src/ui.js", "barn.js"] },
    { id: "x", title: "X", status: "idle", folder: "/wt/x", current: "—", changed: [] },
  ]);
  it("maps each session's files onto the project, by relative path", () => {
    expect(l.touched.get("src/ui.js")).toEqual(["me", "barn"]);
    expect(l.touched.get("barn.js")).toEqual(["barn"]);
    expect(l.on.get("me")).toBe("src/logic.js");
    expect(l.on.get("barn")).toBe("src/ui.js");
    expect(l.on.has("x")).toBe(false);
  });
  it("finds where two sessions' work could collide", () => {
    expect(l.overlaps).toEqual(["src/ui.js"]);
    expect(new Set(l.colors.values()).size).toBe(3);
  });
});

describe("understanding lens", () => {
  it("knows read, changed-since and unread", () => {
    expect(readState(undefined, 5)).toBe("unread");
    expect(readState(10_000, 5_000)).toBe("read");
    expect(readState(10_000, 50_000)).toBe("stale");
  });
  it("counts what you've read and lists the rest, newest first", () => {
    const m = meter([{ rel: "a", mtime: 1 }, { rel: "b", mtime: 9_000 }, { rel: "c", mtime: 50_000 }, { rel: "d", mtime: 3 }], { a: 5_000, c: 10_000 });
    expect(m).toEqual({ total: 4, read: 1, stale: 1, unread: ["c", "b", "d"] });
    expect(meterLine(m)).toBe("You've read 1 of 4 files your agents changed this week · 1 changed since");
    expect(meterLine({ total: 2, read: 2, stale: 0, unread: [] })).toBe("You've read all 2 files your agents changed this week");
    expect(meterLine({ total: 0, read: 0, stale: 0, unread: [] })).toBe("Nothing changed this week");
  });
});
