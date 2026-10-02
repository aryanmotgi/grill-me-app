// ---------------------------------------------------------------------------
// Workflow profile: what we know about how someone works (scan + answers),
// their workflow as five stages, and up to three upgrades with reasons.
// Grill Me "does the knowing": everything here is fixed rules over the
// catalog and the scan, so the quick form (no AI) gets the same results as
// the interview. Pure; the UI is in WorkflowSetup.tsx.
// ---------------------------------------------------------------------------

import type { Catalog, CatalogEntry, Detections, SolveTag } from "./catalog";
import { matchDetections } from "./catalog";
import type { ScanResult } from "./scan";

export type Building = "web" | "mobile" | "backend" | "cli" | "data" | "other";
export type TeamSize = "solo" | "small" | "large";
export type AiStyle = "plan-first" | "as-i-go" | "agents" | "new";

export interface WorkflowProfile {
  building?: Building;
  team?: TeamSize;
  style?: AiStyle;
  /** what slows them down, most important first (max 3) */
  pains: SolveTag[];
  /** AI tools they use: "claude", "codex", "cursor"… */
  agents: string[];
  source: "form" | "interview";
  updated: number;
}

interface Choice<T extends string> { id: T; label: string }

export const BUILDING: Choice<Building>[] = [
  { id: "web", label: "A web app" }, { id: "mobile", label: "A mobile app" }, { id: "backend", label: "A backend or API" },
  { id: "cli", label: "A tool or library" }, { id: "data", label: "Data or AI" }, { id: "other", label: "Something else" },
];
export const TEAM: Choice<TeamSize>[] = [
  { id: "solo", label: "Just me" }, { id: "small", label: "2–4 people" }, { id: "large", label: "5 or more" },
];
export const STYLE: Choice<AiStyle>[] = [
  { id: "plan-first", label: "I plan first, then let it code" }, { id: "as-i-go", label: "I ask as I go" },
  { id: "agents", label: "Agents do most of the work" }, { id: "new", label: "I'm just starting with AI" },
];
/** `say` reads in "You said ___ slows you down." */
export const PAINS: (Choice<SolveTag> & { say: string })[] = [
  { id: "testing", label: "Testing", say: "testing" }, { id: "review", label: "Code review", say: "code review" }, { id: "planning", label: "Planning", say: "planning" },
  { id: "debugging", label: "Bugs and debugging", say: "debugging" }, { id: "docs", label: "Looking things up", say: "looking things up" }, { id: "deploy", label: "Deploying", say: "deploying" },
  { id: "ui", label: "Design and UI", say: "UI work" }, { id: "database", label: "Databases", say: "database work" }, { id: "project-management", label: "Keeping track of tasks", say: "keeping track of tasks" },
];
export const AGENTS: Choice<string>[] = [
  { id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex" }, { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" }, { id: "copilot", label: "Copilot" }, { id: "windsurf", label: "Windsurf" },
];
export const MAX_PAINS = 3;

const labelOf = <T extends string>(list: Choice<T>[], id?: T) => list.find((c) => c.id === id)?.label;

/** Agent ids a scan saw, for pre-ticking "Which AI tools do you use?". */
const BIN_AGENT: Record<string, string> = { claude: "claude", codex: "codex", "cursor-agent": "cursor", agent: "cursor", gemini: "gemini", copilot: "copilot" };
const APP_AGENT: Record<string, string> = { "Cursor.app": "cursor", "Windsurf.app": "windsurf", "Codex.app": "codex", "Claude.app": "claude" };
export function agentsFromScan(scan?: ScanResult | null): string[] {
  const found = new Set<string>();
  for (const b of scan?.agents?.bins ?? []) if (BIN_AGENT[b]) found.add(BIN_AGENT[b]);
  for (const a of scan?.agents?.apps ?? []) if (APP_AGENT[a]) found.add(APP_AGENT[a]);
  return AGENTS.map((a) => a.id).filter((id) => found.has(id));
}

export function emptyProfile(scan?: ScanResult | null): WorkflowProfile {
  return { pains: [], agents: agentsFromScan(scan), source: "form", updated: 0 };
}

/** Reads a saved profile defensively (settings.json is user-editable). */
export function profileOf(v: unknown): WorkflowProfile | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pick = <T extends string>(list: Choice<T>[], x: unknown) => list.some((c) => c.id === x) ? (x as T) : undefined;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  return {
    building: pick(BUILDING, o.building),
    team: pick(TEAM, o.team),
    style: pick(STYLE, o.style),
    pains: strs(o.pains).filter((p): p is SolveTag => PAINS.some((c) => c.id === p)).slice(0, MAX_PAINS),
    agents: strs(o.agents).filter((a) => AGENTS.some((c) => c.id === a)),
    source: o.source === "interview" ? "interview" : "form",
    updated: typeof o.updated === "number" ? o.updated : 0,
  };
}

/** Everything a scan saw, in the shape the catalog matcher wants. */
export function detectionsFromScan(scan?: ScanResult | null): Detections {
  if (!scan) return {};
  const mcp: string[] = [];
  for (const m of scan.extensions?.mcp ?? []) {
    mcp.push(m.name);
    if (m.host) mcp.push(m.host);
    if (m.command) mcp.push(m.command);
    mcp.push(...(m.packages ?? []));
  }
  return {
    bins: [...(scan.agents?.bins ?? []), ...(scan.history ?? []).map((h) => h.cmd)],
    apps: scan.agents?.apps ?? [],
    mcp,
    skills: (scan.extensions?.skills ?? []).map((s) => s.name),
    plugins: (scan.extensions?.plugins ?? []).map((p) => p.name),
    npm: scan.packages?.npmGlobal ?? [],
    brew: [...(scan.packages?.brew ?? []), ...(scan.packages?.brewCasks ?? [])],
    deps: scan.stack?.dependencies ?? [],
  };
}

/** Catalog tools this person already has. */
export function toolsYouHave(catalog: Catalog, scan?: ScanResult | null): CatalogEntry[] {
  return matchDetections(catalog, detectionsFromScan(scan));
}

// -- "Here's what we know" ------------------------------------------------------

export interface Fact { label: string; value: string; from: "scan" | "you" }

export function profileFacts(p: WorkflowProfile, scan: ScanResult | null | undefined, have: CatalogEntry[]): Fact[] {
  const out: Fact[] = [];
  const b = labelOf(BUILDING, p.building);
  if (b) out.push({ label: "Building", value: b, from: "you" });
  const t = labelOf(TEAM, p.team);
  if (t) out.push({ label: "Team", value: t, from: "you" });
  if (p.agents.length) out.push({ label: "AI tools", value: p.agents.map((a) => labelOf(AGENTS, a) ?? a).join(", "), from: "you" });
  const s = labelOf(STYLE, p.style);
  if (s) out.push({ label: "How you use AI", value: s, from: "you" });
  const stack = [...(scan?.stack?.languages ?? []), ...(scan?.stack?.frameworks ?? [])];
  if (stack.length) out.push({ label: "Stack", value: shortList(stack, 6), from: "scan" });
  const extras = have.filter((e) => e.kind !== "agent").map((e) => e.name);
  if (extras.length) out.push({ label: "Already set up", value: shortList(extras, 5), from: "scan" });
  if (p.pains.length) out.push({ label: "Slows you down", value: p.pains.map((x) => labelOf(PAINS, x) ?? x).join(", "), from: "you" });
  return out;
}

const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const shortList = (xs: string[], max: number) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} +${xs.length - max} more`);

// -- "Here's your workflow" -----------------------------------------------------

export type StageId = "plan" | "build" | "test" | "review" | "ship";
/** `tags` cover a stage; `gap` is what to look for when nothing does. */
export interface Stage { id: StageId; name: string; doing: string; tags: SolveTag[]; gap: SolveTag }
export const STAGES: Stage[] = [
  { id: "plan", name: "Plan", doing: "planning", tags: ["planning", "project-management", "notes"], gap: "planning" },
  { id: "build", name: "Build", doing: "looking up docs while you build", tags: ["docs", "search", "memory"], gap: "docs" },
  { id: "test", name: "Test", doing: "testing", tags: ["testing", "browser"], gap: "testing" },
  { id: "review", name: "Review", doing: "reviewing code", tags: ["review", "code-quality", "git"], gap: "review" },
  { id: "ship", name: "Ship", doing: "shipping", tags: ["deploy", "ci", "monitoring"], gap: "ci" },
];

export interface StageView { id: StageId; name: string; doing: string; gap: SolveTag; tools: string[]; covered: boolean }

/** Each stage with the tools (and habits) that already cover it. Agents
 *  themselves don't count: every coding agent "can test", that's no tool. */
export function workflowStages(have: CatalogEntry[], scan?: ScanResult | null, p?: WorkflowProfile): StageView[] {
  return STAGES.map((st) => {
    const tools = have.filter((e) => e.kind !== "agent" && e.solves.some((t) => st.tags.includes(t))).map((e) => e.name);
    if (st.id === "review" && scan?.git?.usesPullRequests) tools.unshift("Pull requests");
    if (st.id === "plan" && p?.style === "plan-first") tools.unshift("You plan first");
    if (st.id === "build" && hasInstructions(scan)) tools.unshift("Instruction file");
    return { id: st.id, name: st.name, doing: st.doing, gap: st.gap, tools: [...new Set(tools)], covered: tools.length > 0 };
  });
}

const hasInstructions = (scan?: ScanResult | null) => (scan?.instructions ?? []).some((i) => i.bytes > 0);

// -- Up to three upgrades -------------------------------------------------------

export interface Upgrade {
  id: string;
  name: string;
  /** the workflow stage it lights up */
  stage: StageId;
  /** catalog kind, for the card's badge ("tip" for built-in advice) */
  kind: string;
  /** why it's suggested to *this* person */
  why: string;
  /** what it does */
  what: string;
  command?: string;
  docs?: string;
}

/** The stage an upgrade lights: the one its top need belongs to. */
export function stageFor(need: SolveTag, e?: CatalogEntry): StageId {
  const hit = STAGES.find((st) => st.tags.includes(need) || st.gap === need)
    ?? STAGES.find((st) => e?.solves.some((t) => st.tags.includes(t)));
  // needs outside the five stages (debugging, ui, database…) belong to Build
  return hit?.id ?? "build";
}

/** Tags where the right tool depends on the vendor you already use: only
 *  suggest a vendor's tool when the scan shows you use that vendor. */
const VENDOR_TAGS: SolveTag[] = ["deploy", "database", "payments", "auth", "monitoring", "analytics"];
const KIND_BONUS: Record<string, number> = { mcp: 2, plugin: 2, skill: 2, cli: 1, app: 0, agent: -99 };

/** Words in the scan that name a vendor: deps, commands, MCP names, packages. */
function evidence(scan?: ScanResult | null): Set<string> {
  const d = detectionsFromScan(scan);
  const words = new Set<string>();
  for (const list of Object.values(d)) {
    for (const raw of list ?? []) {
      for (const w of raw.toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 2) words.add(w);
    }
  }
  return words;
}

/** Vendors nearly everyone has, so their tools need no evidence. */
const EVERYONE_HAS = new Set(["github", "gh", "docker"]);

function vendorOk(e: CatalogEntry, words: Set<string>): boolean {
  if (!e.solves.some((t) => VENDOR_TAGS.includes(t))) return true;
  const vendor = e.id.split("-")[0];
  return EVERYONE_HAS.has(vendor) || words.has(vendor);
}

/**
 * Up to three upgrades. Needs come from (1) what the person said slows them
 * down, in their order, then (2) workflow stages nothing covers yet. Each
 * pick must cover a need no earlier pick covers, so the three are different.
 */
export function suggestUpgrades(p: WorkflowProfile, catalog: Catalog, have: CatalogEntry[], scan?: ScanResult | null, max = 3): Upgrade[] {
  const haveIds = new Set(have.map((e) => e.id));
  const words = evidence(scan);
  const stages = workflowStages(have, scan, p);
  const say = (t: SolveTag) => PAINS.find((c) => c.id === t)?.say ?? t;

  // needs in priority order: your pains first (in your order), then gaps
  const order: SolveTag[] = [...p.pains];
  const gapWhy = new Map<SolveTag, string>();
  for (const st of stages) {
    if (st.covered || order.includes(st.gap)) continue;
    order.push(st.gap);
    gapWhy.set(st.gap, `Nothing in your setup helps with ${st.doing} yet.`);
  }
  const whyFor = (covers: SolveTag[]) => {
    const pains = covers.filter((t) => p.pains.includes(t));
    if (pains.length) return `You said ${joinAnd(pains.map(say))} ${pains.length > 1 ? "slow" : "slows"} you down.`;
    return gapWhy.get(covers[0]) ?? "";
  };

  const agents = new Set(p.agents);
  const fits = (e: CatalogEntry) => agents.size === 0 || e.agents.some((a) => a === "any" || agents.has(a));
  const pool = catalog.entries.filter((e) =>
    !haveIds.has(e.id) && e.kind !== "agent" && e.kind !== "app" && fits(e) && vendorOk(e, words) && (e.install?.command || e.install?.mcp));

  const out: Upgrade[] = [];
  const met = new Set<SolveTag>();

  // a missing instruction file is the cheapest, biggest win for any agent
  if (scan?.instructions && !hasInstructions(scan) && agents.size > 0) {
    out.push({
      id: "instructions-file", stage: "build", kind: "tip", name: agents.has("claude") ? "A CLAUDE.md for this project" : "An AGENTS.md for this project",
      why: "Your agents start every session without knowing your project's rules.",
      what: "One short file with how to run, test and style the code. Every session reads it first.",
      docs: agents.has("claude") ? "https://code.claude.com/docs/en/memory" : "https://agents.md",
    });
  }

  while (out.length < max) {
    let best: { e: CatalogEntry; score: number; covers: SolveTag[] } | null = null;
    for (const e of pool) {
      if (out.some((u) => u.id === e.id)) continue;
      const covers = order.filter((t) => !met.has(t) && e.solves.includes(t));
      if (!covers.length) continue;
      const rank = order.indexOf(covers[0]);
      // the top need decides; ties go to focused tools (it's their main job),
      // tools made for your AI, the right kind, and ones that also cover more
      const score = (order.length - rank) * 100
        + (e.solves[0] === covers[0] ? 8 : 0)
        + (e.agents.some((a) => a !== "any" && agents.has(a)) ? 4 : 0)
        + (KIND_BONUS[e.kind] ?? 0)
        + (covers.length - 1) * 3
        + (e.verified ? 1 : 0);
      if (!best || score > best.score) best = { e, score, covers };
    }
    if (!best) break;
    for (const t of best.covers) met.add(t);
    out.push({
      id: best.e.id, name: best.e.name, stage: stageFor(best.covers[0], best.e), kind: best.e.kind, why: whyFor(best.covers), what: best.e.what,
      command: best.e.install?.command, docs: best.e.install?.docs ?? best.e.source,
    });
  }
  return out.slice(0, max);
}
