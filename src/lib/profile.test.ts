import { describe, expect, it } from "vitest";
import builtinDoc from "../data/catalog.json";
import { parseCatalog } from "./catalog";
import type { ScanResult } from "./scan";
import { agentsFromScan, buildingFromScan, detectionsFromScan, emptyProfile, profileFacts, profileOf, suggestUpgrades, toolsYouHave, workflowStages, type WorkflowProfile } from "./profile";

const catalog = parseCatalog(builtinDoc)!;
const scan = (over: Partial<ScanResult> = {}): ScanResult => ({ ts: 1, sources: [], checked: [], ...over });
const profile = (over: Partial<WorkflowProfile> = {}): WorkflowProfile => ({ pains: [], agents: ["claude"], source: "form", updated: 1, ...over });

describe("profile from a scan", () => {
  it("pre-ticks the AI tools the scan saw", () => {
    const s = scan({ agents: { bins: ["claude", "cursor-agent"], apps: ["Codex.app", "Obsidian.app"] } });
    expect(agentsFromScan(s)).toEqual(["claude", "codex", "cursor"]);
    expect(emptyProfile(s).agents).toEqual(["claude", "codex", "cursor"]);
    expect(agentsFromScan(null)).toEqual([]);
  });
  it("feeds MCP hosts, plugins and deps to the matcher", () => {
    const s = scan({
      extensions: { mcp: [{ name: "pw", agent: "claude", scope: "user", transport: "stdio", command: "npx", packages: ["@playwright/mcp"] }], plugins: [{ name: "superpowers", marketplace: "m", agent: "claude" }], skills: [] },
      stack: { dependencies: ["vitest"] },
    });
    const d = detectionsFromScan(s);
    expect(d.mcp).toContain("@playwright/mcp");
    const ids = toolsYouHave(catalog, s).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["playwright-mcp", "superpowers", "vitest"]));
  });
  it("reads a saved profile defensively", () => {
    expect(profileOf(null)).toBeNull();
    const p = profileOf({ building: "web", team: "huge", pains: ["testing", "nope", "review", "deploy", "ui"], agents: ["claude", "rm -rf"] })!;
    expect(p.building).toBe("web");
    expect(p.team).toBeUndefined();
    expect(p.pains).toEqual(["testing", "review", "deploy"]);
    expect(p.agents).toEqual(["claude"]);
  });
});

describe("workflow and upgrades", () => {
  it("marks stages covered by tools and habits, never by the agent itself", () => {
    const s = scan({ agents: { bins: ["claude"], apps: [] }, git: { usesPullRequests: true }, stack: { dependencies: ["vitest"] } });
    const st = workflowStages(toolsYouHave(catalog, s), s, profile());
    const by = Object.fromEntries(st.map((x) => [x.id, x]));
    expect(by.test.covered).toBe(true);
    expect(by.review.tools[0]).toBe("Pull requests");
    expect(by.plan.covered).toBe(false);
    expect(by.ship.covered).toBe(false);
  });
  it("puts what slows you down first, with a reason, and never repeats a need", () => {
    const s = scan({ agents: { bins: ["claude"], apps: [] } });
    const ups = suggestUpgrades(profile({ pains: ["testing", "review"] }), catalog, toolsYouHave(catalog, s), s);
    expect(ups.length).toBe(3);
    expect(ups[0].why).toBe("You said testing slows you down.");
    expect(ups[1].why).toBe("You said code review slows you down.");
    const tags = ups.map((u) => catalog.entries.find((e) => e.id === u.id)?.solves ?? []);
    expect(tags[0]).toContain("testing");
    expect(tags[1]).toContain("review");
    expect(new Set(ups.map((u) => u.id)).size).toBe(3);
  });
  it("never suggests what you already have, or a vendor you don't use", () => {
    const s = scan({ agents: { bins: ["claude"], apps: [] }, extensions: { mcp: [{ name: "playwright", agent: "claude", scope: "user" }], plugins: [], skills: [] } });
    const ups = suggestUpgrades(profile({ pains: ["deploy", "testing"] }), catalog, toolsYouHave(catalog, s), s);
    const ids = ups.map((u) => u.id);
    expect(ids).not.toContain("playwright-mcp");
    for (const v of ["vercel", "netlify", "wrangler", "railway", "flyctl", "supabase", "cloudflare"]) {
      expect(ids.some((id) => id.startsWith(v))).toBe(false);
    }
  });
  it("suggests the vendor's tool when the scan shows you use it", () => {
    const s = scan({ agents: { bins: ["claude"], apps: [] }, history: [{ cmd: "vercel", count: 12 }] });
    const ups = suggestUpgrades(profile({ pains: ["deploy"] }), catalog, toolsYouHave(catalog, s), s);
    expect(ups[0].id.startsWith("vercel")).toBe(true);
  });
  it("suggests an instruction file when the scan found none", () => {
    const s = scan({ agents: { bins: ["claude"], apps: [] }, instructions: [] });
    const ups = suggestUpgrades(profile(), catalog, toolsYouHave(catalog, s), s);
    expect(ups[0].id).toBe("instructions-file");
    expect(ups[0].name).toContain("CLAUDE.md");
  });
  it("only suggests tools that work with your AI", () => {
    const ups = suggestUpgrades(profile({ agents: ["codex"], pains: ["review", "testing", "planning"] }), catalog, [], null);
    for (const u of ups) {
      const e = catalog.entries.find((x) => x.id === u.id)!;
      expect(e.agents.some((a) => a === "any" || a === "codex")).toBe(true);
    }
  });
  it("lists facts with where they came from", () => {
    const s = scan({ stack: { languages: ["TypeScript"], frameworks: ["React"] } });
    const f = profileFacts(profile({ building: "web", pains: ["testing"] }), s, []);
    expect(f).toEqual(expect.arrayContaining([
      { label: "Building", value: "A web app", from: "you" },
      { label: "Stack", value: "TypeScript, React", from: "scan" },
      { label: "Slows you down", value: "Testing", from: "you" },
    ]));
  });
  it("counts what they said as evidence: a Vercel pain gets a Vercel tool", () => {
    const s = scan({ agents: { bins: [], apps: ["Cursor.app"] }, stack: { dependencies: ["next"] } });
    const p = profile({ agents: ["cursor"], pains: ["debugging", "deploy"], mentions: ["vercel"], notes: [{ text: "works on my laptop, breaks on Vercel", about: "deploy" }] });
    const ups = suggestUpgrades(p, catalog, toolsYouHave(catalog, s), s);
    const deploy = ups.find((u) => u.id.startsWith("vercel"));
    expect(deploy).toBeTruthy();
    expect(deploy!.why).toBe('You said: "works on my laptop, breaks on Vercel"');
  });
  it("never suggests a rival of a tool you already use", () => {
    const s = scan({ agents: { bins: ["claude", "codex"], apps: [] }, extensions: { mcp: [{ name: "linear", agent: "claude", scope: "user" }], plugins: [], skills: [] } });
    const ups = suggestUpgrades(profile({ agents: ["claude", "codex"], pains: ["project-management", "review"] }), catalog, toolsYouHave(catalog, s), s);
    for (const rival of ["atlassian", "asana", "notion"]) expect(ups.some((u) => u.id.startsWith(rival))).toBe(false);
  });
  it("gives a mixed or team setup AGENTS.md, Claude alone CLAUDE.md", () => {
    const s = scan({ agents: { bins: ["claude", "codex"], apps: [] }, instructions: [] });
    const mixed = suggestUpgrades(profile({ agents: ["claude", "codex"], team: "large" }), catalog, toolsYouHave(catalog, s), s);
    expect(mixed[0].name).toContain("AGENTS.md");
    expect(mixed[0].why).toMatch(/shared rules/);
  });
  it("fills all three when one tool covers several needs", () => {
    const s = scan({ agents: { bins: ["claude", "gh"], apps: [] }, git: { usesPullRequests: true }, instructions: [{ file: "CLAUDE.md", scope: "project", bytes: 900, headings: [] }] });
    const ups = suggestUpgrades(profile({ style: "plan-first", pains: ["review", "database", "testing"] }), catalog, toolsYouHave(catalog, s), s);
    expect(ups.length).toBe(3);
    expect(new Set(ups.map((u) => u.id)).size).toBe(3);
  });
  it("puts a debugging pick in Build, not Plan", () => {
    const ups = suggestUpgrades(profile({ agents: ["cursor"], pains: ["debugging"] }), catalog, [], null);
    expect(ups[0].stage).toBe("build");
  });
  it("works out what you're building from the code", () => {
    expect(buildingFromScan(scan({ stack: { frameworks: ["Next.js", "React"] } }))).toBe("web");
    expect(buildingFromScan(scan({ stack: { languages: ["Go", "SQL"], dependencies: ["pgx"] } }))).toBe("backend");
    expect(buildingFromScan(scan({ stack: { dependencies: ["expo", "react"] } }))).toBe("mobile");
    expect(buildingFromScan(null)).toBeUndefined();
  });
  it("reads notes and mentions defensively", () => {
    const p = profileOf({ notes: ["plain string", { text: "flaky testcontainers", about: "testing" }, { text: "", about: "x" }, { text: "y", about: "evil" }, 7], mentions: ["Vercel", "Linear!", "", 3] })!;
    expect(p.notes).toEqual([{ text: "plain string", about: undefined }, { text: "flaky testcontainers", about: "testing" }, { text: "y", about: undefined }]);
    expect(p.mentions).toEqual(["vercel", "linear"]);
  });
  it("doesn't push browser tools on a backend, or a named vendor for an unrelated need", () => {
    const s = scan({ agents: { bins: ["claude"], apps: [] }, history: [{ cmd: "vercel", count: 3 }] });
    const backend = suggestUpgrades(profile({ building: "backend", pains: ["testing", "review"] }), catalog, toolsYouHave(catalog, s), s);
    for (const u of backend) expect(catalog.entries.find((e) => e.id === u.id)?.solves.includes("browser") ?? false).toBe(false);
    const docs = suggestUpgrades(profile({ pains: ["docs"], mentions: ["vercel"] }), catalog, toolsYouHave(catalog, s), s);
    expect(docs[0].id.startsWith("vercel")).toBe(false);
  });
});
