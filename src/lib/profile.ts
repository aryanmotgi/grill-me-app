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
  /** what they actually said, kept in their words: "deploys to Vercel break (env vars?)" */
  notes?: Note[];
  /** tools and vendors they named ("vercel", "linear", "postgres"): evidence, like the scan */
  mentions?: string[];
  /** the read-back: how they work, in two sentences they've confirmed */
  summary?: string;
  source: "form" | "interview";
  updated: number;
}

interface Choice<T extends string> { id: T; label: string }

/** One thing they told us, and the pain it's about (if any). */
export interface Note { text: string; about?: SolveTag }
export const MAX_NOTES = 8;
export const MAX_MENTIONS = 12;

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
    notes: notesOf(o.notes),
    mentions: mentionsOf(o.mentions),
    summary: typeof o.summary === "string" && o.summary.trim() ? o.summary.trim().slice(0, 500) : undefined,
    source: o.source === "interview" ? "interview" : "form",
    updated: typeof o.updated === "number" ? o.updated : 0,
  };
}

/** Notes, read defensively: short strings, an optional known pain. */
export function notesOf(v: unknown): Note[] {
  if (!Array.isArray(v)) return [];
  const out: Note[] = [];
  for (const n of v) {
    const text = typeof n === "string" ? n : n && typeof n === "object" ? (n as Record<string, unknown>).text : null;
    if (typeof text !== "string" || !text.trim()) continue;
    const about = n && typeof n === "object" ? (n as Record<string, unknown>).about : undefined;
    out.push({ text: text.trim().slice(0, 160), about: PAINS.some((c) => c.id === about) ? (about as SolveTag) : undefined });
  }
  return out.slice(0, MAX_NOTES);
}

/** Tool/vendor names, lowercased to plain words ("Vercel" → "vercel"). */
export function mentionsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const words = v.filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase().replace(/[^a-z0-9.+-]/g, "").slice(0, 32)).filter((x) => x.length > 1);
  return [...new Set(words)].slice(0, MAX_MENTIONS);
}

/** What they're building, worked out from the code (so we don't ask). */
export function buildingFromScan(scan?: ScanResult | null): Building | undefined {
  const all = [...(scan?.stack?.frameworks ?? []), ...(scan?.stack?.dependencies ?? []), ...(scan?.stack?.languages ?? [])].map((x) => x.toLowerCase());
  const has = (...xs: string[]) => xs.some((x) => all.some((a) => a === x || a.startsWith(`${x}/`) || a.startsWith(`@${x}`)));
  if (has("react-native", "expo", "flutter", "swiftui", "swift", "kotlin")) return "mobile";
  // a full-stack web framework means a web app; a server language with a
  // React admin on the side is still a backend
  if (has("next.js", "next", "nuxt", "sveltekit", "remix", "astro")) return "web";
  if (has("go", "rust", "elixir", "java", "pgx", "gin", "spring", "actix", "axum")) return "backend";
  if (has("react", "vue", "svelte", "angular", "solid-js")) return "web";
  if (has("pandas", "numpy", "torch", "tensorflow", "scikit-learn", "jupyter", "langchain")) return "data";
  if (has("express", "fastify", "hono", "fastapi", "django", "flask", "rails")) return "backend";
  return undefined;
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
  /** the need it was picked for */
  need?: SolveTag;
}

/** The stage an upgrade lights: the one its top need belongs to. */
export function stageFor(need: SolveTag, e?: CatalogEntry): StageId {
  const hit = STAGES.find((st) => st.tags.includes(need) || st.gap === need);
  if (hit) return hit.id;
  // needs outside the five stages (debugging, ui, database…) belong to Build;
  // only a gap pick with no pain behind it follows the tool's own stage
  if (PAINS.some((c) => c.id === need)) return "build";
  return STAGES.find((st) => e?.solves.some((t) => st.tags.includes(t)))?.id ?? "build";
}

/** Tags where the right tool depends on the vendor you already use: only
 *  suggest a vendor's tool when the scan shows you use that vendor. */
const VENDOR_TAGS: SolveTag[] = ["deploy", "database", "payments", "auth", "monitoring", "analytics"];
const KIND_BONUS: Record<string, number> = { mcp: 2, plugin: 2, skill: 2, cli: 1, app: 0, agent: -99 };

/** Words that name a vendor: from the scan (deps, commands, MCP names,
 *  packages) and from what they told us ("we deploy on Vercel"). */
function evidence(scan?: ScanResult | null, mentions: string[] = []): Set<string> {
  const d = detectionsFromScan(scan);
  const words = new Set<string>();
  for (const list of [...Object.values(d), mentions]) {
    for (const raw of list ?? []) {
      for (const w of raw.toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 2) words.add(w);
    }
  }
  return words;
}

/** Needs where people pick one vendor: if they already have one, a rival
 *  is noise (a Linear team doesn't want Atlassian). */
const ONE_VENDOR: SolveTag[] = ["project-management", "deploy", "database", "monitoring", "analytics", "auth", "payments"];
const vendorOf = (e: CatalogEntry) => e.id.split("-")[0];

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
  const mentions = p.mentions ?? [];
  const words = evidence(scan, mentions);
  const named = new Set(mentions);
  // per one-vendor need, the vendors they already use
  const usedFor = new Map<SolveTag, Set<string>>();
  for (const e of have) {
    if (e.kind === "agent") continue;
    for (const t of e.solves) if (ONE_VENDOR.includes(t)) usedFor.set(t, (usedFor.get(t) ?? new Set()).add(vendorOf(e)));
  }
  const rival = (e: CatalogEntry, t: SolveTag) => !!usedFor.get(t)?.size && !usedFor.get(t)!.has(vendorOf(e));
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
    // their own words beat a paraphrase
    const note = (p.notes ?? []).find((n) => n.about && pains.includes(n.about));
    if (note) return `You said: "${note.text}"`;
    if (pains.length) return `You said ${joinAnd(pains.map(say))} ${pains.length > 1 ? "slow" : "slows"} you down.`;
    return gapWhy.get(covers[0]) ?? "";
  };

  const agents = new Set(p.agents);
  const fits = (e: CatalogEntry) => agents.size === 0 || e.agents.some((a) => a === "any" || agents.has(a));
  const pool = catalog.entries.filter((e) =>
    !haveIds.has(e.id) && e.kind !== "agent" && e.kind !== "app" && fits(e) && vendorOk(e, words) && (e.install?.command || e.install?.mcp));

  const out: Upgrade[] = [];
  const met = new Set<SolveTag>();

  // a missing instruction file is the cheapest, biggest win for any agent.
  // CLAUDE.md only when Claude is the only agent; anything mixed (or a team)
  // gets AGENTS.md, the one file every agent reads
  if (scan?.instructions && !hasInstructions(scan) && agents.size > 0) {
    const claudeOnly = agents.size === 1 && agents.has("claude") && p.team !== "small" && p.team !== "large";
    const team = p.team === "small" || p.team === "large";
    out.push({
      id: "instructions-file", stage: "build", kind: "tip", name: claudeOnly ? "A CLAUDE.md for this project" : "An AGENTS.md for this project",
      why: team ? "Everyone's agents start without shared rules, so every PR looks different." : "Your agents start every session without knowing your project's rules.",
      what: team ? "One shared file with how to run, test and style the code. Claude Code, Codex and Cursor all read it first." : "One short file with how to run, test and style the code. Every session reads it first.",
      docs: claudeOnly ? "https://code.claude.com/docs/en/memory" : "https://agents.md",
    });
  }

  // two passes: first each pick must cover a need no earlier pick covers;
  // then (if there's room) the next best for needs already touched, so a
  // clear answer still gets three suggestions
  for (const strict of [true, false]) {
    while (out.length < max) {
      let best: { e: CatalogEntry; score: number; covers: SolveTag[] } | null = null;
      for (const e of pool) {
        if (out.some((u) => u.id === e.id)) continue;
        const covers = order.filter((t) => (!strict || !met.has(t)) && e.solves.includes(t) && !rival(e, t));
        if (!covers.length) continue;
        const rank = order.indexOf(covers[0]);
        // the top need decides; ties go to tools they named, focused tools
        // (it's their main job), tools made for their AI, the right kind,
        // and ones that also cover more
        const score = (order.length - rank) * 100
          // a tool they named wins, but only where the vendor is the point
          // (they said Vercel: a Vercel deploy tool, not Vercel for "docs")
          + (VENDOR_TAGS.includes(covers[0]) && (named.has(vendorOf(e)) || named.has(e.id)) ? 50 : 0)
          + (e.solves[0] === covers[0] ? 8 : 0)
          + (e.agents.some((a) => a !== "any" && agents.has(a)) ? 4 : 0)
          + (KIND_BONUS[e.kind] ?? 0)
          + (covers.length - 1) * 3
          + (e.verified ? 1 : 0)
          // a web app's bugs live in the browser: browser tools fit it
          + (p.building === "web" && e.solves.includes("browser") ? 8 : 0)
          - (p.building && p.building !== "web" && p.building !== "mobile" && e.solves.includes("browser") ? 40 : 0)
          // second pass: don't stack two tools on the same need
          - (strict ? 0 : out.filter((u) => u.need === covers[0]).length * 150);
        if (!best || score > best.score) best = { e, score, covers };
      }
      if (!best) break;
      for (const t of best.covers) met.add(t);
      out.push({
        id: best.e.id, name: best.e.name, stage: stageFor(best.covers[0], best.e), kind: best.e.kind, why: whyFor(best.covers), what: best.e.what,
        command: best.e.install?.command, docs: best.e.install?.docs ?? best.e.source, need: best.covers[0],
      });
    }
  }
  return out.slice(0, max);
}
