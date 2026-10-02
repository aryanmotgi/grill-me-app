import { describe, expect, it } from "vitest";
import { rightTabOf, uiLayoutOf } from "./uiLayout";

describe("uiLayoutOf", () => {
  it("everyone starts on the simple layout", () => {
    expect(uiLayoutOf({})).toBe("simple");
    expect(uiLayoutOf({ appMode: "solo" })).toBe("simple");
    expect(uiLayoutOf({ activeProject: "p1" })).toBe("simple");
  });
  it("an explicit choice always wins", () => {
    expect(uiLayoutOf({ appMode: "team", uiLayout: "simple" })).toBe("simple");
    expect(uiLayoutOf({ uiLayout: "classic" })).toBe("classic");
    expect(uiLayoutOf({ uiLayout: "weird" })).toBe("simple");
  });
});

describe("rightTabOf", () => {
  it("falls back to changes", () => {
    expect(rightTabOf("plan")).toBe("plan");
    expect(rightTabOf("team")).toBe("team");
    expect(rightTabOf("preview")).toBe("preview");
    expect(rightTabOf(undefined)).toBe("changes");
  });
});
