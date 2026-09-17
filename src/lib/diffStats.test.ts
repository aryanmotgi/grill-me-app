import { describe, expect, it } from "vitest";
import { diffLineStats } from "./diffStats";

describe("diffLineStats", () => {
  it("counts body +/- lines and ignores file headers", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "index 111..222 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,3 +1,4 @@",
      " unchanged",
      "-old line",
      "+new line",
      "+another added",
    ].join("\n");
    expect(diffLineStats(diff)).toEqual({ added: 2, removed: 1 });
  });

  it("returns zeroes for an empty diff", () => {
    expect(diffLineStats("")).toEqual({ added: 0, removed: 0 });
    expect(diffLineStats("(no diff)")).toEqual({ added: 0, removed: 0 });
  });

  it("does not count the truncation footer as a change line", () => {
    const diff = "+real add\n… diff truncated at 120KB …";
    expect(diffLineStats(diff)).toEqual({ added: 1, removed: 0 });
  });

  it("counts multiple files' hunks together", () => {
    const diff = [
      "--- a/a.ts",
      "+++ b/a.ts",
      "+a1",
      "--- a/b.ts",
      "+++ b/b.ts",
      "+b1",
      "-b0",
    ].join("\n");
    expect(diffLineStats(diff)).toEqual({ added: 2, removed: 1 });
  });
});
