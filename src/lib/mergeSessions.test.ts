import { describe, expect, it } from "vitest";
import { candidates, hasConflicts, lines, mergePrompt, withWork, type BranchPreview } from "./mergeSessions";

const p = (branch: string, commits: string[], conflicts: string[] = []): BranchPreview => ({
  branch, commits, conflicts, files: [{ file: "game.js", adds: 3, dels: 1 }],
});

describe("merge my sessions", () => {
  it("offers sessions on their own branch", () => {
    const s = [{ id: "me", branch: "main" }, { id: "a", branch: "feat/a" }, { id: "b", branch: "—" }, { id: "c", branch: "main" }];
    expect(candidates(s, "main").map((x) => x.id)).toEqual(["a"]);
  });
  it("keeps only branches with work, and spots conflicts", () => {
    const ps = [p("feat/a", ["x"]), p("feat/b", []), p("feat/c", ["y"], ["index.html"])];
    expect(withWork(ps).map((x) => x.branch)).toEqual(["feat/a", "feat/c"]);
    expect(hasConflicts(ps)).toBe(true);
    expect(hasConflicts([p("feat/a", ["x"])])).toBe(false);
    expect(lines(ps[0].files)).toEqual({ adds: 3, dels: 1 });
  });
  it("tells the agent the order, the expected conflicts, and to keep both sides", () => {
    const text = mergePrompt("main", [p("feat/seasons", ["s"]), p("feat/sound", ["t"], ["index.html", "style.css"])]);
    expect(text).toContain("in this order: feat/seasons, feat/sound");
    expect(text).toContain("- feat/sound: index.html, style.css");
    expect(text).toContain("keep both sides' features");
    expect(text).not.toContain("expected to conflict:\n\n");
  });
});
