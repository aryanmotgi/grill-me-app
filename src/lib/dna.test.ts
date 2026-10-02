import { describe, expect, it } from "vitest";
import builtinDoc from "../data/catalog.json";
import { parseCatalog } from "./catalog";
import {
  addItem, applyPast, dnaBrief, dnaOf, editItem, emptyDNA, fromProfile, fromScan, fromSessions, logEvolutions, muteCandidates,
  needWeights, pastCandidates, recent, removeItem, removedTools, setHelped, setPainStatus, setRule, strandView, toMarkdown,
  type Batch, type CodingDNA, type PastResults,
} from "./dna";
import { toolsYouHave, type WorkflowProfile } from "./profile";

const catalog = parseCatalog(builtinDoc)!;
const NOW = 1_790_000_000_000;
const DAY = 86400_000;
const profile = (over: Partial<WorkflowProfile> = {}): WorkflowProfile => ({ pains: [], agents: ["claude"], source: "interview", updated: 1, ...over });
const batch = (over: Partial<Batch> = {}): Batch => ({
  sessions: 1, prompts: 0, promptWords: 0, shortPrompts: 0, planPrompts: 0, questionPrompts: 0, fileRefPrompts: 0, frustratedPrompts: 0,
  testRuns: 0, testFails: 0, retries: 0, undos: 0, models: {}, skills: {}, mcp: {}, slash: {}, subagents: {}, tools: {}, moments: [], from: 0, to: 0, ...over,
});
const texts = (xs: { text: string }[]) => xs.map((x) => x.text);

describe("Coding DNA", () => {
  it("fills from the interview: habits, pains in their words, notes in the flow", () => {
    const d = fromProfile(emptyDNA(NOW), profile({
      team: "solo", level: "senior", style: "plan-first", pains: ["testing", "review"],
      notes: [{ text: "Testcontainers flake 1 in 10", about: "testing" }], summary: "You plan first and lose time on flaky tests.",
    }), NOW);
    expect(texts(d.habits)).toEqual(expect.arrayContaining(["Works solo", "Experienced developer", "You plan first and lose time on flaky tests."]));
    expect(d.pains.find((p) => p.about === "testing")?.text).toBe("Testcontainers flake 1 in 10");
    expect(texts(d.flow.test)).toContain("Testcontainers flake 1 in 10");
    expect(texts(d.flow.plan)).toContain("Writes a plan first, then lets the AI code");
  });

  it("keeps your edits when the same fact comes in again", () => {
    let d = fromProfile(emptyDNA(NOW), profile({ team: "solo" }), NOW);
    d = editItem(d, { strand: "habits", id: "habit:team" }, "Solo, with a designer friend sometimes");
    d = fromProfile(d, profile({ team: "solo" }), NOW + 1);
    expect(d.habits.find((h) => h.id === "habit:team")?.text).toBe("Solo, with a designer friend sometimes");
  });

  it("tracks the toolkit from the scan and notices installed Evolutions", () => {
    const scan = { ts: 1, sources: [], checked: [], agents: { bins: ["claude"], apps: [] }, extensions: { mcp: [{ name: "my-private-mcp", agent: "claude", scope: "user" }], plugins: [], skills: [] }, stack: { dependencies: ["vitest"] } } as never;
    let d = logEvolutions(emptyDNA(NOW), [{ id: "vitest", name: "Vitest", stage: "test", kind: "cli", why: "w", what: "x" }], NOW);
    d = fromScan(d, scan, toolsYouHave(catalog, scan), NOW + DAY);
    expect(d.toolkit.map((t) => t.id)).toEqual(expect.arrayContaining(["claude-code", "vitest", "mcp:my-private-mcp"]));
    expect(d.evolutions[0].installedAt).toBe(NOW + DAY);
  });

  it("learns patterns from session counts into the right strands, proposes rules", () => {
    const d = fromSessions(emptyDNA(NOW), batch({ prompts: 50, promptWords: 400, planPrompts: 1, frustratedPrompts: 6, testRuns: 20, testFails: 9, undos: 6, models: { "claude-opus-4-8": 300, "claude-haiku": 20 }, skills: { "superpowers:brainstorming": 7 },
      moments: [{ kind: "test-loop", detail: "`vitest` failed 4 times in one session", at: NOW / 1000, project: "app" }] }), NOW);
    const by = (s: string) => d.learned.filter((l) => l.strand === s).map((l) => l.id);
    expect(by("habits")).toEqual(expect.arrayContaining(["pat:short-prompts", "pat:rarely-plans", "pat:opus-heavy"]));
    expect(by("pains")).toEqual(expect.arrayContaining(["pat:frustrated", "pat:tests-fail", "pat:undos"]));
    expect(by("toolkit")).toContain("pat:leans-on");
    expect(d.learned.find((l) => l.id === "pat:tests-fail")?.text).toBe("9 of 20 test runs failed (45%) in the last 4 weeks.");
    const proposed = d.rules.filter((r) => r.status === "proposed").map((r) => r.id);
    expect(proposed).toEqual(expect.arrayContaining(["rule:fix-causes", "rule:small-steps", "rule:plan-first", "rule:reproduce"]));
    expect(strandView(d, "pains").some((v) => v.kind === "moment" && v.text.includes("vitest"))).toBe(true);
  });

  it("adds up a week and rolls over to the next", () => {
    let d = fromSessions(emptyDNA(NOW), batch({ prompts: 10 }), NOW);
    d = fromSessions(d, batch({ prompts: 5 }), NOW + 1000);
    expect(d.weeks).toHaveLength(1);
    expect(recent(d).prompts).toBe(15);
    d = fromSessions(d, batch({ prompts: 3 }), NOW + 8 * DAY);
    expect(d.weeks).toHaveLength(2);
  });

  it("learns nothing while paused, from sessions or the past", () => {
    const d = { ...emptyDNA(NOW), paused: true };
    expect(fromSessions(d, batch({ prompts: 99 }), NOW)).toBe(d);
    expect(applyPast(d, [], {}, ["claude"], NOW)).toBe(d);
  });

  it("a deleted pattern or proposed rule stays gone; an edited pattern keeps your words", () => {
    let d = fromSessions(emptyDNA(NOW), batch({ prompts: 40, promptWords: 200, undos: 8 }), NOW);
    d = removeItem(d, { strand: "pains", id: "pat:undos", kind: "learned" });
    d = removeItem(d, { strand: "rules", id: "rule:small-steps" });
    d = editItem(d, { strand: "habits", id: "pat:short-prompts", kind: "learned" }, "Short prompts on purpose: I iterate fast");
    d = fromSessions(d, batch({ prompts: 10, promptWords: 50, undos: 2 }), NOW + 1000);
    expect(d.learned.some((l) => l.id === "pat:undos")).toBe(false);
    expect(d.rules.some((r) => r.id === "rule:small-steps")).toBe(false);
    expect(d.learned.find((l) => l.id === "pat:short-prompts")?.text).toBe("Short prompts on purpose: I iterate fast");
  });

  it("notices idle tools, Evolutions that stuck, and wins", () => {
    let d: CodingDNA = { ...emptyDNA(NOW), toolkit: [{ id: "superpowers", name: "Superpowers", kind: "plugin", source: "scan" as const, firstSeen: NOW - 30 * DAY, lastSeen: NOW }] };
    d = { ...d, evolutions: [{ id: "context7", name: "Context7", why: "", at: NOW - 20 * DAY, installedAt: NOW - 10 * DAY }] };
    d = fromSessions(d, batch({ prompts: 30, promptWords: 600, mcp: { context7: 4 } }), NOW);
    expect(texts(d.learned)).toEqual(expect.arrayContaining([
      "You have Superpowers installed but haven't used it in 4 weeks.",
      "You've used Context7 4 times since adding it.",
    ]));
    expect(d.learned.find((l) => l.id === "pat:evo-used:context7")?.strand).toBe("wins");
    d = setHelped(d, "context7", "yes", NOW);
    expect(texts(d.wins)).toContain("Context7 helped");
  });

  it("calls out a trend as a win", () => {
    let d = emptyDNA(NOW);
    const w = (fails: number) => batch({ prompts: 30, promptWords: 300, testRuns: 20, testFails: fails, from: 0 });
    for (let i = 0; i < 4; i++) d = fromSessions(d, w(i < 2 ? 10 : 2), NOW + i * 7 * DAY);
    expect(texts(d.wins)).toContain("Test failures dropped from 50% to 10%");
  });

  it("you can add, approve, scope, mark better, and delete", () => {
    let d = addItem(emptyDNA(NOW), "pains", "Env vars differ between laptop and Vercel");
    d = setPainStatus(d, d.pains[0].id, "solved", NOW);
    expect(texts(d.wins)).toContain("Solved: Env vars differ between laptop and Vercel");
    d = addItem(d, "rules", "Use pnpm, never npm", { scope: "project", project: "shop" });
    const r = d.rules[0];
    expect(r).toMatchObject({ scope: "project", project: "shop", status: "active" });
    d = setRule(d, r.id, { scope: "personal" });
    expect(d.rules[0].scope).toBe("personal");
    d = addItem(d, "flow", "I sketch screens in Figma first", { stage: "idea" });
    expect(d.flow.idea[0].text).toBe("I sketch screens in Figma first");
  });

  it("turns the past into candidates you review, and keeps only what you tick", () => {
    const past: PastResults = {
      claude: batch({ sessions: 14, prompts: 526, promptWords: 2600, testRuns: 70, testFails: 30, undos: 19, moments: [{ kind: "test-loop", detail: "`vitest` failed 5 times in one session", at: 1_780_000_000, project: "shop" }] }),
      git: [{ repo: "shop", commits: 210, weeksActive: 30, conventional: 190, aiCoauthored: 150, reverts: 4, medianLines: 228, bigCommits: 12, testFileShare: 8, branchPrefixes: ["feat/", "fix/"], merges: 40 }],
      rules: [{ text: "Never push directly to main.", file: "~/.claude/CLAUDE.md", scope: "personal", project: "" }, { text: "Use pnpm, not npm.", file: "shop/AGENTS.md", scope: "project", project: "shop" }],
      tools: [{ tool: "warp", action: "added", via: "brew", at: 1 }, { tool: "warp", action: "removed", via: "brew", at: 2 }, { tool: "gitleaks", action: "added", via: "brew", at: 3 }],
      terminal: [["cd", 900], ["claude", 400], ["git", 300], ["codex", 40]],
    };
    const cs = pastCandidates(past, emptyDNA(NOW), NOW);
    const t = texts(cs);
    expect(t).toEqual(expect.arrayContaining([
      "14 Claude Code sessions and 526 prompts in the last 6 months.",
      "Claude Code: 30 of 70 test runs failed (43%) in the last 6 months.",
      "Write commit messages as conventional commits (feat:, fix:, chore:…).",
      "shop: 71% of commits were co-authored with an AI.",
      "shop: tests rarely change with the code (8% of changed files).",
      "Never push directly to main.",
      "Removed warp (brew)",
      "You start Claude Code (400×), Codex (40×) from the terminal.",
    ]));
    expect(t).not.toContain("Installed warp (brew)"); // the last event wins
    const keep = cs.filter((c) => ["Never push directly to main.", "Use pnpm, not npm.", "Removed warp (brew)"].includes(c.text) || c.id === "past:claude:tests-fail");
    let d = applyPast(emptyDNA(NOW), keep, past, ["claude", "git", "rules", "tools", "terminal"], NOW);
    d = muteCandidates(d, cs.filter((c) => !keep.includes(c)).map((c) => c.id));
    expect(d.rules.find((r) => r.text === "Use pnpm, not npm.")).toMatchObject({ scope: "project", project: "shop", inFile: "shop/AGENTS.md", source: "past" });
    expect(removedTools(d).has("warp")).toBe(true);
    expect(d.learned.find((l) => l.id === "past:claude:tests-fail")?.strand).toBe("pains");
    expect(d.past.git).toBe(NOW);
    expect(pastCandidates(past, d, NOW).some((c) => c.text.startsWith("shop: about"))).toBe(false); // dropped stays dropped
  });

  it("round-trips through the file and survives a hand-edited mess", () => {
    const d = fromSessions(fromProfile(emptyDNA(NOW), profile({ team: "large", pains: ["review"] }), NOW), batch({ prompts: 30, promptWords: 300, undos: 9 }), NOW);
    expect(dnaOf(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(dnaOf({ version: 2 })).toBeNull();
    const messy = dnaOf({ version: 1, pains: [{ id: "x", text: "ok", status: "weird", about: "nope" }, 7], weeks: [{ start: 1, prompts: -4, models: { a: "x" } }], toolkit: [{ id: "t" }], rules: [{ id: "r", text: "Be nice", scope: "galaxy" }], learned: [{ id: "l", text: "t", strand: "vibes" }] })!;
    expect(messy.pains).toEqual([{ id: "x", text: "ok", source: "you", at: 0, status: "open" }]);
    expect(messy.weeks[0].prompts).toBe(0);
    expect(messy.toolkit).toEqual([]);
    expect(messy.rules[0]).toMatchObject({ scope: "personal", status: "active" });
    expect(messy.learned).toEqual([]);
  });

  it("writes a readable copy and a brief for any AI (no proposed rules)", () => {
    let d = fromProfile(emptyDNA(NOW), profile({ team: "solo", pains: ["deploy"], notes: [{ text: "Vercel builds break on env vars", about: "deploy" }] }), NOW);
    d = fromSessions(d, batch({ prompts: 30, promptWords: 200, testRuns: 12, testFails: 6 }), NOW);
    d = addItem(d, "rules", "Never push directly to main.");
    const md = toMarkdown(d);
    expect(md).toContain("# Coding DNA");
    expect(md).toContain("## Rules");
    expect(md).toContain("- Never push directly to main.");
    expect(md).toContain("**Ship:** Vercel builds break on env vars");
    expect(md).not.toContain("find the cause"); // proposed, not approved
    const brief = dnaBrief(d);
    expect(brief).toContain("Pains:");
    expect(brief).toContain("6 of 12 test runs failed");
    expect(dnaBrief(d, 2000, "rules")).toBe("Rules:\n- Never push directly to main.");
  });

  it("weights needs by open pains and what sessions show", () => {
    let d = fromProfile(emptyDNA(NOW), profile({ pains: ["deploy"] }), NOW);
    d = fromSessions(d, batch({ prompts: 30, promptWords: 300, testRuns: 10, testFails: 6, models: { "claude-opus-4-8": 200 } }), NOW);
    expect(needWeights(d)).toMatchObject({ deploy: 3, testing: 2, models: 2 });
  });
});
