import { describe, expect, it } from "vitest";
import { projectMonogram } from "../components/ProjectIcon";

describe("project monogram", () => {
  it("uses the first letter, or two for two-word names when asked", () => {
    expect(projectMonogram("farm-sim")).toBe("F");
    expect(projectMonogram("farm-sim", true)).toBe("FS");
    expect(projectMonogram("demo", true)).toBe("D");
    expect(projectMonogram("  ")).toBe("?");
    expect(projectMonogram("éclair app")).toBe("É");
  });
});
