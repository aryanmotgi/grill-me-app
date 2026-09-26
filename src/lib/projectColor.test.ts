import { describe, expect, it } from "vitest";
import { projectColor } from "./projectColor";

describe("projectColor", () => {
  it("is deterministic for the same id", () => {
    expect(projectColor("grill-me")).toBe(projectColor("grill-me"));
  });
  it("gives different ids different hues (usually)", () => {
    expect(projectColor("alpha")).not.toBe(projectColor("beta"));
  });
  it("returns a valid hsl string", () => {
    expect(projectColor("x")).toMatch(/^hsl\(\d+ 34% 62%\)$/);
  });
});
