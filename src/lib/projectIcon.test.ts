import { describe, expect, it } from "vitest";
import { PROJECT_SPRITES, projectSpriteIndex } from "../components/ProjectIcon";

describe("project sprites", () => {
  it("are all 8x8", () => {
    for (const s of PROJECT_SPRITES) {
      expect(s).toHaveLength(8);
      for (const row of s) expect(row).toHaveLength(8);
    }
  });
  it("pick a stable sprite per project id", () => {
    expect(projectSpriteIndex("rouge")).toBe(projectSpriteIndex("rouge"));
    const idx = new Set(["a", "b", "rouge", "grill-me", "blindspot", "x1", "x2", "x3"].map(projectSpriteIndex));
    expect(idx.size).toBeGreaterThan(2);
  });
});
