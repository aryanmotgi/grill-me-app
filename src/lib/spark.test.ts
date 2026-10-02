import { describe, expect, it } from "vitest";
import { addItem, emptyDNA, fromSessions, setHelped, type Batch, type CodingDNA } from "./dna";
import { SPARK_SCHEMA, notices, parseSpark, quietNotice, sparkPrompt } from "./spark";

const NOW = 1_790_000_000_000;
const DAY = 86400_000;
const batch = (over: Partial<Batch> = {}): Batch => ({
  sessions: 1, prompts: 0, promptWords: 0, shortPrompts: 0, planPrompts: 0, questionPrompts: 0, fileRefPrompts: 0, frustratedPrompts: 0,
  testRuns: 0, testFails: 0, retries: 0, undos: 0, models: {}, skills: {}, mcp: {}, slash: {}, subagents: {}, tools: {}, moments: [], from: 0, to: 0, ...over,
});

describe("the Spark", () => {
  it("checks in two weeks after you add an Evolution, until you answer", () => {
    let d: CodingDNA = { ...emptyDNA(NOW), evolutions: [{ id: "context7", name: "Context7", why: "", at: NOW - 30 * DAY, installedAt: NOW - 15 * DAY, uses: 6 }] };
    const n = notices(d, NOW);
    expect(n[0]).toMatchObject({ kind: "checkin", ref: "context7", text: "You added Context7 2 weeks ago and used it 6 times. Did it help?" });
    expect(notices({ ...d, evolutions: [{ ...d.evolutions[0], installedAt: NOW - 3 * DAY }] }, NOW).some((x) => x.kind === "checkin")).toBe(false);
    d = setHelped(d, "context7", "yes", NOW);
    expect(notices(d, NOW).some((x) => x.kind === "checkin")).toBe(false);
    expect(notices(d, NOW).some((x) => x.kind === "win" && x.text === "Nice: Context7 helped.")).toBe(true);
  });

  it("flags rules waiting for your OK, and struggles with an Evolution for them", () => {
    const d = fromSessions(emptyDNA(NOW), batch({ prompts: 40, promptWords: 300, testRuns: 20, testFails: 9 }), NOW);
    const n = notices(d, NOW);
    expect(n.find((x) => x.kind === "rules")?.text).toContain("waiting for your OK");
    expect(n.find((x) => x.kind === "struggle")?.actions).toContain("open-evolutions");
  });

  it("stays quiet about what you dismissed", () => {
    const d = fromSessions(emptyDNA(NOW), batch({ prompts: 40, promptWords: 300, testRuns: 20, testFails: 9 }), NOW);
    const first = notices(d, NOW)[0];
    expect(notices(quietNotice(d, first.id), NOW).some((x) => x.id === first.id)).toBe(false);
  });

  it("asks grounded in your DNA, and keeps only sane answers", () => {
    const d = addItem(emptyDNA(NOW), "rules", "Never push directly to main.");
    expect(sparkPrompt(d, "How should I review faster?")).toContain("Never push directly to main.");
    expect([...SPARK_SCHEMA.required]).toEqual(["answer", "remember"]);
    expect(parseSpark({ answer: "Try smaller diffs.", remember: [{ strand: "habits", text: "You review every diff yourself" }, { strand: "toolkit", text: "nope nope" }, { strand: "pains", text: "x" }] }))
      .toEqual({ answer: "Try smaller diffs.", remember: [{ strand: "habits", text: "You review every diff yourself" }] });
    expect(parseSpark({ answer: "" })).toBeNull();
    expect(parseSpark("junk")).toBeNull();
  });
});
