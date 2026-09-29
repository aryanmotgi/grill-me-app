import { describe, expect, it } from "vitest";
import { promptSlug } from "../components/NewSession";

describe("promptSlug", () => {
  it("kebabs the first four words", () => {
    expect(promptSlug("Fix the Login bug on mobile please", [])).toBe("fix-the-login-bug");
  });
  it("falls back when nothing usable", () => {
    expect(promptSlug("!!!", [])).toBe("session");
  });
  it("dedupes against taken ids", () => {
    expect(promptSlug("add auth", ["add-auth", "add-auth-2"])).toBe("add-auth-3");
  });
});
