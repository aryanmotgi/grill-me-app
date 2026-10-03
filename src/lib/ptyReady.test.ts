import { describe, expect, it } from "vitest";
import { TRUST_ACCEPT_KEYS, isReady, isTrustPrompt } from "./ptyReady";

describe("Claude's trust-this-folder screen", () => {
  // what a brand-new worktree shows first (captured from Claude Code 2.1)
  const screen = [
    "Accessing workspace:",
    "/Users/x/worktrees/worktrees-add-a-comment",
    "Quick safety check: Is this a project you created or one you trust? (Like your",
    "own code, a well-known open source project, or work from your team).",
    "❯ No, exit",
    "Yes, I trust this folder",
    "Enter to confirm · Esc to cancel",
  ];

  it("is recognized", () => {
    expect(isTrustPrompt(screen.join("\n"))).toBe(true);
    expect(isTrustPrompt("❯ \n? for shortcuts")).toBe(false);
  });

  it("is never mistaken for an idle prompt (its menu has a ❯ too)", () => {
    expect(isReady({ id: "p", alive: true, quietMs: 10_000, tail: screen })).toBe(false);
    expect(isReady({ id: "p", alive: true, quietMs: 10_000, tail: ["❯ ", "? for shortcuts"] })).toBe(true);
  });

  it("answers Yes: move off the default “No, exit”, then confirm", () => {
    expect(TRUST_ACCEPT_KEYS).toEqual(["\x1b[B", "\r"]);
  });
});

import { submitParts } from "./ptyReady";
describe("submitting to an agent", () => {
  it("presses a real Enter, not a newline", () => {
    expect(submitParts("hi")).toEqual(["hi", "\r"]);
    expect(submitParts("/ship\n")).toEqual(["/ship", "\r"]);
  });
  it("types line breaks inside one message, never as a paste", () => {
    // a bracketed paste reads to Claude as material you shared, not an instruction
    expect(submitParts("line one\r\nline two\n")).toEqual(["line one\nline two", "\r"]);
  });
});
