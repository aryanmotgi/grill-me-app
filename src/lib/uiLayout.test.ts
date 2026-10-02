import { describe, expect, it } from "vitest";
import { rightTabOf, uiLayoutOf } from "./uiLayout";

describe("uiLayoutOf", () => {
  it("brand-new users get the simple layout", () => {
    expect(uiLayoutOf({})).toBe("simple");
  });
  it("existing users keep classic until they switch", () => {
    expect(uiLayoutOf({ appMode: "solo" })).toBe("classic");
    expect(uiLayoutOf({ activeProject: "p1" })).toBe("classic");
    expect(uiLayoutOf({ onboarded: true })).toBe("classic");
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
    expect(rightTabOf(undefined)).toBe("changes");
  });
});
