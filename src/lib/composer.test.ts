import { describe, expect, it } from "vitest";
import { activeToken } from "./composer";

describe("activeToken", () => {
  it("detects a slash command at the start of the input", () => {
    expect(activeToken("/shi", 4)).toEqual({ kind: "/", query: "shi", start: 0 });
  });
  it("detects a slash command after whitespace", () => {
    expect(activeToken("fix this /re", 12)).toEqual({ kind: "/", query: "re", start: 9 });
  });
  it("does NOT treat a path like a/b as a command", () => {
    expect(activeToken("open src/App", 12)).toBeNull();
  });
  it("detects an @ file reference anywhere in a word", () => {
    expect(activeToken("look at @App", 12)).toEqual({ kind: "@", query: "App", start: 8 });
  });
  it("returns null with no active trigger", () => {
    expect(activeToken("just some text", 14)).toBeNull();
  });
  it("uses the caret, not the end of text", () => {
    // caret sits right after "/sh"; the trailing "ip more" is ignored
    expect(activeToken("/ship more", 3)).toEqual({ kind: "/", query: "sh", start: 0 });
  });
  it("guards out-of-range carets", () => {
    expect(activeToken("/x", -1)).toBeNull();
    expect(activeToken("/x", 99)).toBeNull();
  });
});
