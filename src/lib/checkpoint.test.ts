import { describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_DEFAULT_MINUTES,
  CHECKPOINT_MIN_MINUTES,
  checkpointEnabled,
  checkpointIntervalMinutes,
  clampCheckpointInterval,
  classifyCheckpoint,
  runCheckpoints,
  summarizeCheckpoints,
  type CheckpointOutcome,
} from "./checkpoint";

describe("clampCheckpointInterval", () => {
  it("floors below the minimum", () => {
    expect(clampCheckpointInterval(1)).toBe(CHECKPOINT_MIN_MINUTES);
    expect(clampCheckpointInterval(4)).toBe(CHECKPOINT_MIN_MINUTES);
    expect(clampCheckpointInterval(0)).toBe(CHECKPOINT_MIN_MINUTES);
    expect(clampCheckpointInterval(-99)).toBe(CHECKPOINT_MIN_MINUTES);
  });
  it("passes valid values through, flooring fractionals", () => {
    expect(clampCheckpointInterval(5)).toBe(5);
    expect(clampCheckpointInterval(10)).toBe(10);
    expect(clampCheckpointInterval(12.9)).toBe(12);
  });
  it("falls back to the default for non-numeric input", () => {
    expect(clampCheckpointInterval(undefined)).toBe(CHECKPOINT_DEFAULT_MINUTES);
    expect(clampCheckpointInterval("nope")).toBe(CHECKPOINT_DEFAULT_MINUTES);
    expect(clampCheckpointInterval(NaN)).toBe(CHECKPOINT_DEFAULT_MINUTES);
    expect(clampCheckpointInterval(Infinity)).toBe(CHECKPOINT_DEFAULT_MINUTES);
  });
  it("accepts numeric strings (from an <input>)", () => {
    expect(clampCheckpointInterval("15")).toBe(15);
    expect(clampCheckpointInterval("3")).toBe(CHECKPOINT_MIN_MINUTES);
  });
});

describe("checkpointEnabled / checkpointIntervalMinutes", () => {
  it("defaults off", () => {
    expect(checkpointEnabled({})).toBe(false);
    expect(checkpointEnabled({ autoCheckpoint: false })).toBe(false);
    // only the literal boolean true counts as on
    expect(checkpointEnabled({ autoCheckpoint: "true" })).toBe(false);
    expect(checkpointEnabled({ autoCheckpoint: true })).toBe(true);
  });
  it("derives a clamped interval from settings", () => {
    expect(checkpointIntervalMinutes({})).toBe(CHECKPOINT_DEFAULT_MINUTES);
    expect(checkpointIntervalMinutes({ autoCheckpointMinutes: 2 })).toBe(CHECKPOINT_MIN_MINUTES);
    expect(checkpointIntervalMinutes({ autoCheckpointMinutes: 30 })).toBe(30);
  });
});

describe("classifyCheckpoint", () => {
  it("treats an error as error", () => {
    expect(classifyCheckpoint(false, "refusing to checkpoint on protected branch 'main'")).toBe("error");
  });
  it("treats a clean-tree message as clean", () => {
    expect(classifyCheckpoint(true, "clean — nothing to checkpoint")).toBe("clean");
  });
  it("treats a commit message as committed", () => {
    expect(classifyCheckpoint(true, "checkpoint · 3 files")).toBe("committed");
  });
});

describe("summarizeCheckpoints", () => {
  const o = (name: string, status: CheckpointOutcome["status"], detail = ""): CheckpointOutcome => ({ name, status, detail });

  it("reports all-clean as a quiet info line", () => {
    const r = summarizeCheckpoints([o("me", "clean"), o("bob", "clean")]);
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/nothing to checkpoint/i);
  });
  it("names a single committed session", () => {
    const r = summarizeCheckpoints([o("me", "committed", "checkpoint · 2 files"), o("bob", "clean")]);
    expect(r.kind).toBe("info");
    expect(r.text).toContain("me");
    expect(r.text).toContain("2 files");
  });
  it("counts multiple committed sessions", () => {
    const r = summarizeCheckpoints([o("me", "committed"), o("bob", "committed")]);
    expect(r.text).toMatch(/Checkpointed 2 sessions/);
  });
  it("surfaces errors as warn, keeping the committed count", () => {
    const r = summarizeCheckpoints([o("me", "committed"), o("bob", "error", "boom")]);
    expect(r.kind).toBe("warn");
    expect(r.text).toContain("Checkpointed 1");
    expect(r.text).toContain("bob");
    expect(r.text).toContain("boom");
  });
});

describe("runCheckpoints", () => {
  it("invokes checkpoint_commit per unique repo and classifies results", async () => {
    const invoke = vi.fn(async (_cmd: string, args?: Record<string, unknown>) => {
      const p = args?.repoPath as string;
      if (p === "/a") return "checkpoint · 1 files";
      if (p === "/b") return "clean — nothing to checkpoint";
      throw "refusing to checkpoint on protected branch 'main'";
    }) as unknown as <T>(c: string, a?: Record<string, unknown>) => Promise<T>;

    const out = await runCheckpoints(
      [
        { name: "a", repoPath: "/a" },
        { name: "b", repoPath: "/b" },
        { name: "c", repoPath: "/c" },
        { name: "dup", repoPath: "/a" }, // same repo — must be skipped
        { name: "empty", repoPath: "" }, // no path — must be skipped
      ],
      invoke,
    );

    expect(out).toHaveLength(3);
    expect(out.find((x) => x.name === "a")?.status).toBe("committed");
    expect(out.find((x) => x.name === "b")?.status).toBe("clean");
    expect(out.find((x) => x.name === "c")?.status).toBe("error");
    // /a invoked once (dedup), /b, /c → 3 calls total, never /empty
    expect((invoke as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });
});
