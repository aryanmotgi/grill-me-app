import { describe, expect, it } from "vitest";
import { interviewBrainOf, pickBrain, readyAis, statusLabel, type AiStatus } from "./aiConnect";

const row = (id: AiStatus["id"], installed: boolean, signedIn: boolean | null): AiStatus => ({ id, name: id, installed, signedIn, detail: "" });

describe("connect your AI", () => {
  it("only signed-in, installed AIs are ready, in preferred order", () => {
    const rows = [row("codex", true, true), row("claude", true, true), row("gemini", true, null), row("cursor", false, false)];
    expect(readyAis(rows).map((r) => r.id)).toEqual(["claude", "codex"]);
  });
  it("keeps the user's pick while it's ready, otherwise falls back", () => {
    const rows = [row("claude", true, true), row("codex", true, true)];
    expect(pickBrain(rows, "codex")).toBe("codex");
    expect(pickBrain(rows, "gemini")).toBe("claude");
    expect(pickBrain([row("claude", true, false)])).toBe("form");
    expect(pickBrain([])).toBe("form");
  });
  it("reads the saved brain defensively", () => {
    expect(interviewBrainOf("codex")).toBe("codex");
    expect(interviewBrainOf("rm")).toBe("form");
    expect(interviewBrainOf(undefined)).toBe("form");
  });
  it("labels each status in plain words", () => {
    expect(statusLabel(row("claude", false, false))).toBe("Not installed");
    expect(statusLabel(row("claude", true, true))).toBe("Signed in");
    expect(statusLabel(row("claude", true, false))).toBe("Not signed in");
    expect(statusLabel(row("gemini", true, null))).toBe("Can't tell if you're signed in");
  });
});
