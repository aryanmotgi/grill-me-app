import { describe, expect, it } from "vitest";
import type { Decision } from "../types";
import { dedupeDecisions, makeDecision } from "./decisions";

describe("makeDecision", () => {
  it("shapes a trimmed entry with a stable, author+time-keyed id", () => {
    const d = makeDecision("  use zustand for state  ", "aryan", undefined, 1000);
    expect(d).toEqual({
      id: "d-aryan-1000",
      text: "use zustand for state",
      author: "aryan",
      epochMs: 1000,
      ts: expect.any(String),
    });
  });

  it("returns null for empty or whitespace-only text", () => {
    expect(makeDecision("", "aryan")).toBeNull();
    expect(makeDecision("   \n\t ", "aryan")).toBeNull();
  });

  it("normalizes a tag (trim + lowercase) and omits it when blank", () => {
    expect(makeDecision("x", "a", "  Architecture ", 1)?.tag).toBe("architecture");
    expect("tag" in (makeDecision("x", "a", "   ", 1) as object)).toBe(false);
  });
});

describe("dedupeDecisions", () => {
  const at = (id: string, epochMs: number, text = id): Decision => ({
    id,
    text,
    author: "a",
    epochMs,
    ts: "00:00",
  });

  it("sorts newest-first by epochMs", () => {
    const out = dedupeDecisions([at("a", 100), at("b", 300), at("c", 200)]);
    expect(out.map((d) => d.id)).toEqual(["b", "c", "a"]);
  });

  it("dedupes by id with the later occurrence winning (mirrors the Rust merge)", () => {
    const out = dedupeDecisions([at("a", 100, "old"), at("a", 100, "new")]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("new");
  });

  it("breaks epochMs ties deterministically by id", () => {
    const out = dedupeDecisions([at("z", 50), at("a", 50)]);
    expect(out.map((d) => d.id)).toEqual(["a", "z"]);
  });
});
