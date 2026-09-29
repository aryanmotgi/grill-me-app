import { describe, expect, it } from "vitest";
import { DEFAULT_STALL_MIN, isStalled, looksLooping } from "./stall";

describe("isStalled", () => {
  const min = DEFAULT_STALL_MIN; // 5

  it("flags a session that went silent past the threshold", () => {
    expect(isStalled(6 * 60_000, "idle", false, min)).toBe(true);
    // a working-status session that just crossed the line (quiet long enough)
    expect(isStalled(6 * 60_000, "working", false, min)).toBe(true);
  });

  it("does NOT flag a session quiet for less than the threshold", () => {
    expect(isStalled(4 * 60_000, "idle", false, min)).toBe(false);
    expect(isStalled(0, "working", false, min)).toBe(false);
  });

  it("NEVER flags a needs-input session — it is quiet because it waits on a human", () => {
    expect(isStalled(60 * 60_000, "needs-input", false, min)).toBe(false);
  });

  it("does not flag a paused session — pausing is deliberate quiet", () => {
    expect(isStalled(60 * 60_000, "idle", true, min)).toBe(false);
  });

  it("honors a configurable threshold", () => {
    expect(isStalled(4 * 60_000, "idle", false, 3)).toBe(true); // 4m > 3m
    expect(isStalled(4 * 60_000, "idle", false, 10)).toBe(false); // 4m < 10m
  });

  it("clamps a nonsensical zero/negative threshold to at least 1 minute", () => {
    expect(isStalled(90_000, "idle", false, 0)).toBe(true); // 1.5m > 1m
    expect(isStalled(30_000, "idle", false, 0)).toBe(false); // 0.5m < 1m
  });
});

describe("looksLooping", () => {
  const block = "running tests\nFAIL src/foo.test.ts\nretrying command\nsame error as before";
  const other = "installing dependencies\nresolving packages\nfetching metadata\nlinking binaries";

  it("returns false with too few samples", () => {
    expect(looksLooping([])).toBe(false);
    expect(looksLooping([block, block])).toBe(false);
  });

  it("detects output that changes and keeps coming back (A → B → A → B)", () => {
    expect(looksLooping([block, other, block, block])).toBe(true);
    expect(looksLooping([other, block, other, block, block])).toBe(true);
  });

  it("does NOT flag a screen that just sits still (long command, thinking)", () => {
    expect(looksLooping([block, block, block, block])).toBe(false);
    const a = `${block}\n⠋ esc to interrupt`;
    const b = `${block}\n⠙ esc to interrupt`;
    const c = `${block}\n⠹ esc to interrupt`;
    expect(looksLooping([a, b, c])).toBe(false);
  });

  it("tolerates spinner churn inside a real loop", () => {
    const a = `${block}\n⠋ esc to interrupt`;
    const c = `${block}\n⠹ esc to interrupt`;
    expect(looksLooping([a, other, c, a])).toBe(true);
  });

  it("does NOT flag steadily-advancing output as a loop", () => {
    expect(
      looksLooping([
        "step 1 of 4 building module a",
        "step 2 of 4 building module b",
        "step 3 of 4 building module c",
        "step 4 of 4 linking output",
      ]),
    ).toBe(false);
  });

  it("ignores tails that are too short to judge", () => {
    expect(looksLooping(["ok", "ok", "ok", "ok"])).toBe(false);
  });

  it("ignores blank/whitespace tails between real output", () => {
    expect(looksLooping(["", "   ", block, other, block, block])).toBe(true);
    expect(looksLooping(["", "   ", block, block, block])).toBe(false);
  });
});
