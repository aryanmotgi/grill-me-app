import { describe, expect, it } from "vitest";
import { projectIdFor } from "./addProject";

describe("projectIdFor", () => {
  it("kebabs the folder name", () => {
    expect(projectIdFor("My Cool App", [])).toBe("my-cool-app");
  });
  it("suffixes collisions and never returns the reserved default id", () => {
    expect(projectIdFor("blindspot", ["blindspot"])).toBe("blindspot-2");
    expect(projectIdFor("default", [])).toBe("default-2");
  });
  it("falls back for unusable names", () => {
    expect(projectIdFor("!!!", [])).toBe("project");
  });
});
