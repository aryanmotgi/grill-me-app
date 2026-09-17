import { describe, it, expect } from "vitest";
import { buildPresenceMap, type LiveLock } from "./presence";

describe("buildPresenceMap", () => {
  it("returns empty views for no locks", () => {
    const m = buildPresenceMap([]);
    expect(m.byFile).toEqual([]);
    expect(m.byMember).toEqual([]);
    expect(m.fileCount).toBe(0);
    expect(m.memberCount).toBe(0);
    expect(m.conflictCount).toBe(0);
  });

  it("groups a single file with one owner (no conflict)", () => {
    const m = buildPresenceMap([{ owner: "ana", file: "src/a.ts", ts: 10 }]);
    expect(m.byFile).toEqual([
      { file: "src/a.ts", owners: ["ana"], latestTs: 10, conflict: false },
    ]);
    expect(m.byMember).toEqual([{ owner: "ana", file: "src/a.ts", ts: 10 }]);
    expect(m.conflictCount).toBe(0);
  });

  it("flags a file held by two owners as a conflict and sorts owners", () => {
    const locks: LiveLock[] = [
      { owner: "zed", file: "src/x.ts", ts: 5 },
      { owner: "ana", file: "src/x.ts", ts: 7 },
    ];
    const m = buildPresenceMap(locks);
    expect(m.byFile[0].conflict).toBe(true);
    expect(m.byFile[0].owners).toEqual(["ana", "zed"]);
    expect(m.byFile[0].latestTs).toBe(7);
    expect(m.conflictCount).toBe(1);
  });

  it("floats conflicts above single-owner files, then orders by recency", () => {
    const locks: LiveLock[] = [
      { owner: "ana", file: "solo-new.ts", ts: 100 },
      { owner: "ana", file: "conflict.ts", ts: 50 },
      { owner: "bob", file: "conflict.ts", ts: 51 },
      { owner: "bob", file: "solo-old.ts", ts: 10 },
    ];
    const m = buildPresenceMap(locks);
    expect(m.byFile.map((f) => f.file)).toEqual([
      "conflict.ts", // conflict first despite older than solo-new
      "solo-new.ts", // then most-recent solo
      "solo-old.ts",
    ]);
  });

  it("a member's current file is their most recent lock only", () => {
    const locks: LiveLock[] = [
      { owner: "ana", file: "old.ts", ts: 1 },
      { owner: "ana", file: "now.ts", ts: 9 },
    ];
    const m = buildPresenceMap(locks);
    expect(m.byMember).toEqual([{ owner: "ana", file: "now.ts", ts: 9 }]);
    // both files still appear in the file view
    expect(m.fileCount).toBe(2);
  });

  it("dedupes repeat touches of the same file by the same owner", () => {
    const locks: LiveLock[] = [
      { owner: "ana", file: "a.ts", ts: 1 },
      { owner: "ana", file: "a.ts", ts: 4 },
    ];
    const m = buildPresenceMap(locks);
    expect(m.byFile).toHaveLength(1);
    expect(m.byFile[0].owners).toEqual(["ana"]);
    expect(m.byFile[0].latestTs).toBe(4);
    expect(m.byFile[0].conflict).toBe(false);
  });

  it("orders byMember most-recently-active first", () => {
    const locks: LiveLock[] = [
      { owner: "slow", file: "a.ts", ts: 2 },
      { owner: "fast", file: "b.ts", ts: 8 },
    ];
    const m = buildPresenceMap(locks);
    expect(m.byMember.map((x) => x.owner)).toEqual(["fast", "slow"]);
    expect(m.memberCount).toBe(2);
  });
});
