import { describe, expect, it } from "vitest";
import builtinDoc from "../data/catalog.json";
import { parseCatalog } from "./catalog";
import {
  addItem, editItem, emptyMemory, fromProfile, fromScan, fromSessions, logSuggestions, memoryBrief, memoryOf, needWeights,
  patterns, recent, removeItem, setPainStatus, toMarkdown, type Batch,
} from "./memory";
import { toolsYouHave, type WorkflowProfile } from "./profile";

const catalog = parseCatalog(builtinDoc)!;
const NOW = 1_790_000_000_000;
const DAY = 86400_000;
const profile = (over: Partial<WorkflowProfile> = {}): WorkflowProfile => ({ pains: [], agents: ["claude"], source: "interview", updated: 1, ...over });
const batch = (over: Partial<Batch> = {}): Batch => ({
  sessions: 1, prompts: 0, promptWords: 0, shortPrompts: 0, planPrompts: 0, questionPrompts: 0, fileRefPrompts: 0, frustratedPrompts: 0,
  testRuns: 0, testFails: 0, retries: 0, undos: 0, models: {}, skills: {}, mcp: {}, slash: {}, subagents: {}, tools: {}, moments: [], from: 0, to: 0, ...over,
});

describe("workflow memory", () => {
  it("fills from the interview: habits, pains in their words, notes under the right stage", () => {
    const m = fromProfile(emptyMemory(NOW), profile({
      team: "solo", level: "senior", style: "plan-first", pains: ["testing", "review"],
      notes: [{ text: "Testcontainers flake 1 in 10", about: "testing" }, { text: "Big diffs hide bugs", about: "review" }],
      summary: "You plan first and lose time on flaky tests.",
    }), NOW);
    expect(m.habits.map((h) => h.text)).toEqual(expect.arrayContaining(["Works solo", "Experienced developer", "You plan first and lose time on flaky tests."]));
    expect(m.pains.find((p) => p.about === "testing")?.text).toBe("Testcontainers flake 1 in 10");
    expect(m.pains.find((p) => p.about === "review")?.status).toBe("open");
    expect(m.flow.test.map((x) => x.text)).toContain("Testcontainers flake 1 in 10");
    expect(m.flow.plan.map((x) => x.text)).toContain("Writes a plan first, then lets the AI code");
  });

  it("keeps your edits when the same fact comes in again", () => {
    let m = fromProfile(emptyMemory(NOW), profile({ team: "solo" }), NOW);
    m = editItem(m, "habits", "habit:team", "Solo, with a designer friend sometimes");
    m = fromProfile(m, profile({ team: "solo" }), NOW + 1);
    expect(m.habits.find((h) => h.id === "habit:team")?.text).toBe("Solo, with a designer friend sometimes");
  });

  it("tracks the toolkit from the scan and notices installed suggestions", () => {
    const scan = { ts: 1, sources: [], checked: [], agents: { bins: ["claude"], apps: [] }, extensions: { mcp: [{ name: "my-private-mcp", agent: "claude", scope: "user" }], plugins: [], skills: [] }, stack: { dependencies: ["vitest"] } } as never;
    let m = logSuggestions(emptyMemory(NOW), [{ id: "vitest", name: "Vitest", stage: "test", kind: "cli", why: "w", what: "x" }], NOW);
    m = fromScan(m, scan, toolsYouHave(catalog, scan), NOW + DAY);
    expect(m.toolkit.map((t) => t.id)).toEqual(expect.arrayContaining(["claude-code", "vitest", "mcp:my-private-mcp"]));
    expect(m.suggestions[0].installedAt).toBe(NOW + DAY);
  });

  it("learns patterns from session counts, and only counts", () => {
    let m = emptyMemory(NOW);
    m = fromSessions(m, batch({ prompts: 50, promptWords: 400, planPrompts: 1, frustratedPrompts: 6, testRuns: 20, testFails: 9, undos: 6, models: { "claude-opus-4-8": 300, "claude-haiku": 20 }, skills: { "superpowers:brainstorming": 7 },
      moments: [{ kind: "test-loop", detail: "`vitest` failed 4 times in one session", at: NOW / 1000, project: "app" }] }), NOW);
    const ids = m.learned.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["pat:short-prompts", "pat:rarely-plans", "pat:frustrated", "pat:tests-fail", "pat:undos", "pat:opus-heavy", "pat:leans-on"]));
    expect(m.learned.find((l) => l.id === "pat:tests-fail")?.text).toBe("9 of 20 test runs failed (45%) in the last 4 weeks.");
    expect(m.moments[0].detail).toContain("vitest");
    expect(recent(m).prompts).toBe(50);
  });

  it("adds up a week and rolls over to the next", () => {
    let m = fromSessions(emptyMemory(NOW), batch({ prompts: 10 }), NOW);
    m = fromSessions(m, batch({ prompts: 5 }), NOW + 1000);
    expect(m.weeks).toHaveLength(1);
    expect(m.weeks[0].prompts).toBe(15);
    m = fromSessions(m, batch({ prompts: 3 }), NOW + 8 * DAY);
    expect(m.weeks).toHaveLength(2);
  });

  it("learns nothing while paused", () => {
    const m = { ...emptyMemory(NOW), paused: true };
    expect(fromSessions(m, batch({ prompts: 99 }), NOW)).toBe(m);
  });

  it("a deleted pattern stays gone; an edited one keeps your words", () => {
    let m = fromSessions(emptyMemory(NOW), batch({ prompts: 40, promptWords: 200, undos: 8 }), NOW);
    m = removeItem(m, "learned", "pat:undos");
    m = editItem(m, "learned", "pat:short-prompts", "Short prompts are on purpose: I iterate fast");
    m = fromSessions(m, batch({ prompts: 10, promptWords: 50, undos: 2 }), NOW + 1000);
    expect(m.learned.some((l) => l.id === "pat:undos")).toBe(false);
    expect(m.learned.find((l) => l.id === "pat:short-prompts")?.text).toBe("Short prompts are on purpose: I iterate fast");
  });

  it("notices tools you never use, and whether suggestions stuck", () => {
    let m = { ...emptyMemory(NOW), toolkit: [{ id: "superpowers", name: "Superpowers", kind: "plugin", source: "scan" as const, firstSeen: NOW - 30 * DAY, lastSeen: NOW }] };
    m = { ...m, suggestions: [{ id: "context7", name: "Context7", why: "", at: NOW - 20 * DAY, installedAt: NOW - 10 * DAY }] };
    m = fromSessions(m, batch({ prompts: 30, promptWords: 600, mcp: { context7: 4 } }), NOW);
    expect(m.learned.map((l) => l.text)).toEqual(expect.arrayContaining([
      "You have Superpowers installed but haven't used it in 4 weeks.",
      "You've used Context7 4 times since adding it.",
    ]));
  });

  it("you can add, mark better, and delete", () => {
    let m = addItem(emptyMemory(NOW), "pains", "Env vars differ between laptop and Vercel");
    const id = m.pains[0].id;
    m = setPainStatus(m, id, "better");
    expect(m.pains[0].status).toBe("better");
    m = removeItem(m, "pains", id);
    expect(m.pains).toEqual([]);
    m = addItem(m, "flow", "I sketch screens in Figma first", "idea");
    expect(m.flow.idea[0].text).toBe("I sketch screens in Figma first");
  });

  it("round-trips through the file and survives a hand-edited mess", () => {
    const m = fromSessions(fromProfile(emptyMemory(NOW), profile({ team: "large", pains: ["review"] }), NOW), batch({ prompts: 30, promptWords: 300 }), NOW);
    expect(memoryOf(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(memoryOf({ version: 2 })).toBeNull();
    const messy = memoryOf({ version: 1, pains: [{ id: "x", text: "ok", status: "weird", about: "nope" }, 7], weeks: [{ start: 1, prompts: -4, models: { a: "x" } }], toolkit: [{ id: "t" }] })!;
    expect(messy.pains).toEqual([{ id: "x", text: "ok", source: "you", at: 0, status: "open" }]);
    expect(messy.weeks[0].prompts).toBe(0);
    expect(messy.toolkit).toEqual([]);
  });

  it("writes a readable copy and a short brief for the AI", () => {
    let m = fromProfile(emptyMemory(NOW), profile({ team: "solo", pains: ["deploy"], notes: [{ text: "Vercel builds break on env vars", about: "deploy" }] }), NOW);
    m = fromSessions(m, batch({ prompts: 30, promptWords: 200, testRuns: 12, testFails: 6 }), NOW);
    const md = toMarkdown(m);
    expect(md).toContain("# Workflow memory");
    expect(md).toContain("- Vercel builds break on env vars");
    expect(md).toContain("**Ship:** Vercel builds break on env vars");
    const brief = memoryBrief(m);
    expect(brief).toContain("Pain: Vercel builds break on env vars");
    expect(brief).toContain("Noticed: 6 of 12 test runs failed");
  });

  it("weights needs by open pains and what sessions show", () => {
    let m = fromProfile(emptyMemory(NOW), profile({ pains: ["deploy"] }), NOW);
    m = fromSessions(m, batch({ prompts: 30, promptWords: 300, testRuns: 10, testFails: 6, models: { "claude-opus-4-8": 200 } }), NOW);
    expect(needWeights(m)).toMatchObject({ deploy: 3, testing: 2, models: 2 });
    expect(patterns(emptyMemory(NOW))).toEqual([]);
  });
});
