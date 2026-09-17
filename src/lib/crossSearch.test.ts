import { describe, expect, it } from "vitest";
import { searchSessions, splitMatch, totalMatches } from "./crossSearch";
import type { Teammate, TerminalLine } from "../types";

const mate = (id: string, lines: string[]): Teammate =>
  ({
    id,
    name: id,
    terminal: lines.map((text): TerminalLine => ({ kind: "out", text })),
  }) as Teammate;

describe("searchSessions", () => {
  it("returns nothing for an empty or whitespace query", () => {
    const mates = [mate("a", ["error here"])];
    expect(searchSessions(mates, "")).toEqual([]);
    expect(searchSessions(mates, "   ")).toEqual([]);
  });

  it("matches case-insensitively across every session", () => {
    const mates = [
      mate("a", ["Build FAILED", "ok"]),
      mate("b", ["all good"]),
      mate("c", ["another failed run"]),
    ];
    const groups = searchSessions(mates, "failed");
    expect(groups.map((g) => g.mate.id)).toEqual(["a", "c"]);
    expect(totalMatches(groups)).toBe(2);
  });

  it("omits sessions with no matches", () => {
    const groups = searchSessions([mate("a", ["nothing"]), mate("b", ["hit"])], "hit");
    expect(groups).toHaveLength(1);
    expect(groups[0].mate.id).toBe("b");
  });

  it("attaches one line of context on each side, undefined at buffer edges", () => {
    const groups = searchSessions([mate("a", ["first", "target", "last"])], "target");
    const [hit] = groups[0].hits;
    expect(hit.index).toBe(1);
    expect(hit.before).toBe("first");
    expect(hit.after).toBe("last");

    const edge = searchSessions([mate("b", ["target", "after"])], "target");
    expect(edge[0].hits[0].before).toBeUndefined();
    expect(edge[0].hits[0].after).toBe("after");
  });

  it("records every matching line in a session, in order", () => {
    const groups = searchSessions([mate("a", ["err 1", "ok", "err 2"])], "err");
    expect(groups[0].hits.map((h) => h.index)).toEqual([0, 2]);
  });
});

describe("splitMatch", () => {
  it("returns the whole line as one non-match segment for an empty query", () => {
    expect(splitMatch("hello world", "")).toEqual([{ text: "hello world", hit: false }]);
  });

  it("splits around a match preserving original casing", () => {
    expect(splitMatch("Build FAILED now", "failed")).toEqual([
      { text: "Build ", hit: false },
      { text: "FAILED", hit: true },
      { text: " now", hit: false },
    ]);
  });

  it("handles multiple and adjacent matches", () => {
    expect(splitMatch("aXaXa", "x")).toEqual([
      { text: "a", hit: false },
      { text: "X", hit: true },
      { text: "a", hit: false },
      { text: "X", hit: true },
      { text: "a", hit: false },
    ]);
  });

  it("flags a match at the very start and end", () => {
    expect(splitMatch("abc", "abc")).toEqual([{ text: "abc", hit: true }]);
  });
});
