import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank, fuzzySegments } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("returns an empty match for a blank query", () => {
    expect(fuzzyMatch("anything", "")).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch("anything", "   ")).toEqual({ score: 0, positions: [] });
  });

  it("matches an in-order subsequence case-insensitively", () => {
    const r = fuzzyMatch("Toggle Theme", "tgt");
    expect(r).not.toBeNull();
    // t(0) g(2, first g) t(7, second word start) — greedy leftmost
    expect(r!.positions).toEqual([0, 2, 7]);
  });

  it("returns null when characters are out of order or missing", () => {
    expect(fuzzyMatch("open settings", "zzz")).toBeNull();
    expect(fuzzyMatch("abc", "cab")).toBeNull();
  });

  it("finds a subsequence whenever one exists (greedy is complete)", () => {
    expect(fuzzyMatch("ababab", "aaa")).not.toBeNull();
    expect(fuzzyMatch("abab", "aaa")).toBeNull();
  });

  it("scores a contiguous prefix above a scattered match", () => {
    const tight = fuzzyMatch("ship active session", "ship")!;
    const loose = fuzzyMatch("sxhxixp", "ship")!; // scattered subsequence
    expect(tight.score).toBeGreaterThan(loose.score);
  });

  it("rewards word-boundary matches over mid-word ones", () => {
    const boundary = fuzzyMatch("merge pilot", "mp")!; // m(0) p(6, after space)
    const midword = fuzzyMatch("mxxxp", "mp")!; // m(0) p(4, mid-word, non-adjacent)
    expect(boundary.score).toBeGreaterThan(midword.score);
  });
});

describe("fuzzySegments", () => {
  it("returns the whole string as one non-match run when nothing matched", () => {
    expect(fuzzySegments("hello", [])).toEqual([{ text: "hello", hit: false }]);
  });

  it("marks matched positions and merges consecutive hits", () => {
    // positions 0,1 then 4
    expect(fuzzySegments("abcde", [0, 1, 4])).toEqual([
      { text: "ab", hit: true },
      { text: "cd", hit: false },
      { text: "e", hit: true },
    ]);
  });

  it("reconstructs the original text exactly", () => {
    const segs = fuzzySegments("Toggle Theme", [0, 3, 7]);
    expect(segs.map((s) => s.text).join("")).toBe("Toggle Theme");
  });
});

describe("fuzzyRank", () => {
  const items = [
    { label: "ship active session", hint: "runs /ship" },
    { label: "switch project", hint: "open the project picker" },
    { label: "open settings", hint: "team, terminal, safety" },
  ];
  const fields = (i: (typeof items)[number]) => [i.label, i.hint];

  it("keeps only matches, best score first (scores non-increasing)", () => {
    const ranked = fuzzyRank(items, "se", fields); // matches all three
    expect(ranked).toHaveLength(3);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it("reports which field won so the caller highlights the right text", () => {
    const ranked = fuzzyRank(items, "picker", fields);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].item.label).toBe("switch project");
    expect(ranked[0].fieldIndex).toBe(1); // matched the hint, not the label
  });

  it("returns nothing when no field matches", () => {
    expect(fuzzyRank(items, "zzzz", fields)).toEqual([]);
  });

  it("is stable for equal scores (input order preserved)", () => {
    const tie = [{ label: "aa" }, { label: "ab" }, { label: "ac" }];
    const ranked = fuzzyRank(tie, "a", (i) => [i.label]);
    expect(ranked.map((r) => r.item.label)).toEqual(["aa", "ab", "ac"]);
  });
});
