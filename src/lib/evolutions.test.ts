import { describe, expect, it } from "vitest";
import builtinDoc from "../data/catalog.json";
import { parseCatalog } from "./catalog";
import { addItem, emptyDNA, fromProfile, fromSessions, setHelped, logEvolutions, type Batch, type CodingDNA } from "./dna";
import { CATEGORY_NAMES, applyPolish, evolve, optsFromDNA, pathWith, polishPrompt } from "./evolutions";
import { toolsYouHave, type WorkflowProfile } from "./profile";
import type { ScanResult } from "./scan";

const catalog = parseCatalog(builtinDoc)!;
const NOW = 1_790_000_000_000;
const scan = (over: Partial<ScanResult> = {}): ScanResult => ({ ts: 1, sources: [], checked: [], ...over });
const batch = (over: Partial<Batch> = {}): Batch => ({
  sessions: 1, prompts: 0, promptWords: 0, shortPrompts: 0, planPrompts: 0, questionPrompts: 0, fileRefPrompts: 0, frustratedPrompts: 0,
  testRuns: 0, testFails: 0, retries: 0, undos: 0, models: {}, skills: {}, mcp: {}, slash: {}, subagents: {}, tools: {}, moments: [], from: 0, to: 0, ...over,
});

const goScan = scan({ agents: { bins: ["claude", "gh"], apps: [] }, git: { usesPullRequests: true }, stack: { languages: ["Go", "SQL"], frameworks: [], dependencies: ["pgx", "testcontainers-go"] }, instructions: [{ file: "CLAUDE.md", scope: "project", bytes: 900, headings: [] }] });
const senior: WorkflowProfile = { building: "backend", team: "solo", level: "senior", style: "plan-first", pains: ["review", "database"], agents: ["claude"], source: "interview", updated: 1,
  notes: [{ text: "300-line diffs: I skim by line 150 and miss bugs", about: "review" }] };

describe("Evolutions", () => {
  it("top 3 are different kinds of tools, each with why, fit and a before/after", () => {
    let dna: CodingDNA = fromProfile(emptyDNA(NOW), senior, NOW);
    dna = fromSessions(dna, batch({ prompts: 40, promptWords: 600, testRuns: 20, testFails: 9 }), NOW);
    const ev = evolve(senior, catalog, toolsYouHave(catalog, goScan), goScan, dna);
    expect(ev.top).toHaveLength(3);
    const cats = ev.top.map((t) => t.category).filter(Boolean);
    expect(new Set(cats).size).toBe(cats.length);
    expect(ev.top[0].why).toBe('You said: "300-line diffs: I skim by line 150 and miss bugs"');
    for (const t of ev.top) {
      expect(t.fits).toMatch(/Claude Code|any agent/);
      expect(t.change.before.length).toBeGreaterThan(5);
      expect(t.change.after.length).toBeGreaterThan(5);
    }
    // the DNA's failing tests become a reason, in its own words
    expect(ev.top.some((t) => t.why.includes("test runs failed")) || ev.explore.some((t) => t.why.includes("test runs failed"))).toBe(true);
    expect(ev.explore.length).toBeGreaterThan(5);
    expect(ev.explore.some((t) => ev.top.some((x) => x.id === t.id))).toBe(false);
  });

  it("offers a bundle when its pieces fit (safe migrations for a Postgres project)", () => {
    const ev = evolve(senior, catalog, toolsYouHave(catalog, goScan), goScan, null);
    const b = ev.bundles.find((x) => x.id === "safe-migrations");
    expect(b).toBeTruthy();
    expect(b!.members.length).toBeGreaterThanOrEqual(2);
  });

  it("never suggests a tool you removed, or one that didn't help; cools that kind of tool", () => {
    const base = evolve(senior, catalog, toolsYouHave(catalog, goScan), goScan, null);
    const first = base.top.find((t) => t.kind !== "tip")!;
    let dna = logEvolutions(fromProfile(emptyDNA(NOW), senior, NOW), [{ id: first.id, name: first.name, stage: "review", kind: first.kind, why: "", what: "" }], NOW);
    dna = setHelped(dna, first.id, "no", NOW);
    const o = optsFromDNA(dna, catalog);
    expect(o.avoid?.has(first.id)).toBe(true);
    if (first.category) expect(o.coolCategories?.has(first.category)).toBe(true);
    const after = evolve(senior, catalog, toolsYouHave(catalog, goScan), goScan, dna);
    expect(after.top.some((t) => t.id === first.id)).toBe(false);
    expect(after.explore.some((t) => t.id === first.id)).toBe(false);
    const removed: CodingDNA = { ...emptyDNA(NOW), toolkit: [{ id: "tool:squawk", name: "squawk", kind: "npm", source: "past", firstSeen: 0, lastSeen: 0, removed: true }] };
    const ev = evolve(senior, catalog, toolsYouHave(catalog, goScan), goScan, removed);
    expect([...ev.top, ...ev.explore].some((t) => t.id === "squawk")).toBe(false);
  });

  it("puts quick, free setups first for people new to this", () => {
    const newbie: WorkflowProfile = { building: "web", team: "solo", level: "new", pains: ["debugging", "deploy"], agents: ["cursor"], source: "interview", updated: 1 };
    const s = scan({ agents: { bins: [], apps: ["Cursor.app"] }, stack: { languages: ["TypeScript"], frameworks: ["Next.js"], dependencies: ["next"] } });
    const ev = evolve(newbie, catalog, toolsYouHave(catalog, s), s, null);
    for (const t of ev.top.filter((x) => x.kind !== "tip")) expect(t.cost).not.toBe("paid");
  });

  it("draws the path before and after", () => {
    const ev = evolve(senior, catalog, toolsYouHave(catalog, goScan), goScan, null);
    const t = ev.top.find((x) => x.kind !== "tip")!;
    const { before, after } = pathWith(toolsYouHave(catalog, goScan), goScan, senior, t);
    expect(after.find((s) => s.id === t.stage)?.lit).toBe(true);
    expect(after.find((s) => s.id === t.stage)?.added).toBe(true);
    expect(before).toHaveLength(5);
  });

  it("an AI may reword the why from the facts, and junk is ignored", () => {
    const ev = evolve(senior, catalog, toolsYouHave(catalog, goScan), goScan, addItem(emptyDNA(NOW), "pains", "Reviews take forever"));
    const prompt = polishPrompt(ev.top, "Pains:\n- Reviews take forever");
    expect(prompt).toContain("Don't invent");
    expect(prompt).toContain(ev.top[0].id);
    const out = applyPolish(ev.top, { items: [{ id: ev.top[0].id, why: "You skim long diffs, so a reviewer agent reads them first." }, { id: ev.top[1].id, why: "x" }, { id: "nope", why: "made up but long enough to pass" }] });
    expect(out[0].why).toBe("You skim long diffs, so a reviewer agent reads them first.");
    expect(out[1].why).toBe(ev.top[1].why);
    expect(applyPolish(ev.top, "garbage")).toEqual(ev.top);
  });

  it("names every category", () => {
    for (const e of catalog.entries) if (e.category) expect(CATEGORY_NAMES[e.category]).toBeTruthy();
  });
  it("never pushes a CI or task-tracker vendor without evidence", () => {
    const empty: WorkflowProfile = { pains: [], agents: [], source: "form", updated: 1 };
    const ev = evolve(empty, catalog, [], null, null);
    for (const t of [...ev.top, ...ev.explore]) expect(["circleci-mcp", "atlassian-mcp", "asana-mcp", "jira-cli", "linear-mcp"]).not.toContain(t.id);
  });
});
