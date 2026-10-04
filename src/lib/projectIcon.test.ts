import { describe, expect, it } from "vitest";
import { PROJECT_GLYPHS, projectGlyphIndex } from "../components/ProjectIcon";

describe("project glyphs", () => {
  it("are all named and distinct", () => {
    expect(new Set(PROJECT_GLYPHS.map((g) => g.name)).size).toBe(PROJECT_GLYPHS.length);
  });
  it("pick a stable glyph per project id, spread across the set", () => {
    expect(projectGlyphIndex("rouge")).toBe(projectGlyphIndex("rouge"));
    const idx = new Set(["a", "b", "rouge", "grill-me", "blindspot", "x1", "x2", "x3"].map(projectGlyphIndex));
    expect(idx.size).toBeGreaterThan(2);
  });
});
