// ---------------------------------------------------------------------------
// Evolutions: what Grill Me suggests, explained like someone who knows the
// whole AI-coding world and how you work.
//
//   top 3     different kinds of tools, each with
//               why     quoting you (or a pattern from your sessions)
//               fits    how it fits your setup (your AI, stack, cost, time)
//               change  your Plan → Build → Test → Review → Ship before/after
//   bundles   small sets that work together, when 2+ pieces fit you
//   explore   everything else that would help, by category
//
// Ranking is lib/profile's (suggestUpgrades / rankAll); this adds the Coding
// DNA (weights, things to avoid, your level) and the story around each pick.
// Pure: the "why" can be polished by your AI in the UI, with these as the facts.
// ---------------------------------------------------------------------------

import type { Bundle, Catalog, CatalogEntry, Category, SolveTag, StageChange } from "./catalog";
import { needWeights, removedTools, type CodingDNA } from "./dna";
import { PAINS, STAGES, rankAll, suggestUpgrades, workflowStages, type Level, type StageId, type SuggestOpts, type Upgrade, type WorkflowProfile } from "./profile";
import type { ScanResult } from "./scan";

export interface EvolutionPick {
  id: string; name: string; kind: string; category?: Category; cost?: string; setupMin?: number;
  need?: SolveTag; stage: StageId;
  /** why you: their words, a pattern, or the gap */
  why: string;
  /** how it fits their setup */
  fits: string;
  /** what changes in their workflow */
  change: StageChange & { stageName: string };
  what: string; command?: string; docs?: string;
}
export interface BundlePick { id: string; name: string; why: string; members: { id: string; name: string; have: boolean }[]; solves: SolveTag[] }
export interface Evolutions { top: EvolutionPick[]; bundles: BundlePick[]; explore: EvolutionPick[] }

export const CATEGORY_NAMES: Record<Category, string> = {
  "notes-memory": "Notes & memory", planning: "Planning", "skill-pack": "Skill packs", testing: "Testing", review: "Code review", docs: "Docs & search",
  design: "Design", deploy: "Deploy", database: "Databases", security: "Security", voice: "Voice", models: "Models", ci: "CI", monitoring: "Monitoring",
  "project-management": "Tasks", browser: "Browser", quality: "Code quality", editor: "Editors", terminal: "Terminals", agent: "Agents", other: "Other",
};
const AGENT_NAME: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", gemini: "Gemini CLI", copilot: "Copilot", windsurf: "Windsurf" };

/** What the DNA tells the ranking: weights, words, what to avoid, your level. */
export function optsFromDNA(dna: CodingDNA | null | undefined, catalog: Catalog, level?: Level): SuggestOpts {
  if (!dna) return { diverse: true, level };
  const evidence: Partial<Record<SolveTag, string>> = {};
  // only real words: not the stand-in label Grill Me writes when there were none
  for (const p of dna.pains) if (p.about && p.status !== "solved" && (p.source === "you" || p.edited) && !/slows you down$/.test(p.text)) evidence[p.about] ??= `You said: "${p.text}"`;
  const pat = (k: string) => dna.learned.find((l) => l.id.endsWith(`:${k}`))?.text;
  const tests = pat("tests-fail") ?? pat("no-tests");
  if (tests) evidence.testing ??= tests;
  if (pat("opus-heavy")) evidence.models ??= pat("opus-heavy");
  if (pat("undos")) evidence.debugging ??= pat("undos");
  const removed = removedTools(dna);
  const avoid = new Set<string>([
    ...dna.evolutions.filter((e) => e.dismissed || e.helped === "no").map((e) => e.id),
    ...catalog.entries.filter((e) => removed.has(e.id) || removed.has(e.name.toLowerCase().replace(/[^a-z0-9]+/g, ""))).map((e) => e.id),
  ]);
  const cool = new Set<string>(dna.evolutions.filter((e) => e.helped === "no").map((e) => catalog.entries.find((c) => c.id === e.id)?.category).filter((c): c is Category => !!c));
  const lvl = level ?? (dna.habits.some((h) => h.id === "habit:level" && /new/i.test(h.text)) ? "new" : undefined);
  return { weights: needWeights(dna), evidence, avoid, coolCategories: cool, level: lvl, diverse: true };
}

/** "Works with Claude Code · free · ~5 min" */
function fitsLine(e: CatalogEntry | undefined, p: WorkflowProfile): string {
  if (!e) return "Built into how your agents already work · free · ~10 min";
  const mine = p.agents.filter((a) => e.agents.includes(a)).map((a) => AGENT_NAME[a] ?? a);
  const who = mine.length ? `Made for ${mine.join(" and ")}` : e.agents.includes("any") ? (p.agents.length ? `Works with ${p.agents.map((a) => AGENT_NAME[a] ?? a).join(" and ")}` : "Works with any agent") : "";
  const cost = e.cost === "free" ? "free" : e.cost === "freemium" ? "free to start" : e.cost === "paid" ? "paid" : "";
  const time = e.setupMin ? `~${e.setupMin} min to set up` : "";
  return [who, cost, time].filter(Boolean).join(" · ");
}

const STAGE_NAME: Record<StageId, string> = { plan: "Plan", build: "Build", test: "Test", review: "Review", ship: "Ship" };
/** A generic before/after when the catalog has none for this tool. */
function changeFor(e: CatalogEntry | undefined, u: { id: string; stage: StageId; what: string }, covered: Set<StageId>): StageChange & { stageName: string } {
  if (e?.changes) return { ...e.changes, stageName: STAGE_NAME[e.changes.stage] };
  if (u.id === "instructions-file") {
    return { stage: "build", stageName: "Build", before: "Every session starts without your project's rules", after: "Every session reads how to run, test and style your code first (DNA Sync can write it for you)" };
  }
  const st = STAGES.find((s) => s.id === u.stage)!;
  return {
    stage: u.stage, stageName: st.name,
    before: covered.has(u.stage) ? `${st.name} works, with room to improve` : `Nothing helps with ${st.doing} yet`,
    after: u.what,
  };
}

function pick(u: Upgrade, catalog: Catalog, p: WorkflowProfile, covered: Set<StageId>): EvolutionPick {
  const e = catalog.entries.find((x) => x.id === u.id);
  const change = changeFor(e, u, covered);
  return {
    id: u.id, name: u.name, kind: u.kind, category: e?.category, cost: e?.cost, setupMin: e?.setupMin, need: u.need,
    // the stage it lights is where its change happens
    stage: change.stage,
    why: u.why, fits: fitsLine(e, p), change, what: u.what, command: u.command, docs: u.docs,
  };
}

/** The top 3, bundles that fit, and everything else to explore. */
export function evolve(p: WorkflowProfile, catalog: Catalog, have: CatalogEntry[], scan: ScanResult | null | undefined, dna?: CodingDNA | null): Evolutions {
  const o = optsFromDNA(dna, catalog, p.level);
  const covered = new Set(workflowStages(have, scan, p).filter((s) => s.covered).map((s) => s.id));
  const top = suggestUpgrades(p, catalog, have, scan, 3, o).map((u) => pick(u, catalog, p, covered));
  const topIds = new Set(top.map((t) => t.id));
  const ranked = rankAll(p, catalog, have, scan, o);
  const explore = ranked.filter((r) => !topIds.has(r.e.id)).slice(0, 60).map((r) => pick({
    id: r.e.id, name: r.e.name, kind: r.e.kind, why: r.why, what: r.e.what, stage: STAGES.find((s) => s.tags.includes(r.covers[0]) || s.gap === r.covers[0])?.id ?? "build",
    command: r.e.install?.command, docs: r.e.install?.docs ?? r.e.source, need: r.covers[0],
  }, catalog, p, covered));
  // bundles: at least two pieces you'd use (one you already have counts),
  // and it covers something you need
  const haveIds = new Set(have.map((e) => e.id));
  const fitIds = new Set([...topIds, ...ranked.map((r) => r.e.id)]);
  // what you actually need: your pains, what your DNA weighs, and what the top picks are for
  const needs = new Set<SolveTag>([...p.pains, ...Object.keys(o.weights ?? {}) as SolveTag[], ...top.map((t) => t.need).filter((t): t is SolveTag => !!t)]);
  const bundles = (catalog.bundles ?? []).flatMap((b: Bundle): BundlePick[] => {
    const members = b.members.map((id) => ({ id, name: catalog.entries.find((e) => e.id === id)?.name ?? id, have: haveIds.has(id) }));
    const useful = members.filter((m) => m.have || fitIds.has(m.id));
    const missing = members.filter((m) => !m.have && fitIds.has(m.id));
    // its main purpose has to be something you need
    if (useful.length < 2 || !missing.length || !b.solves.length || !needs.has(b.solves[0])) return [];
    return [{ id: b.id, name: b.name, why: b.why, members, solves: b.solves }];
  }).slice(0, 4);
  return { top, bundles, explore };
}

/** The path before and after adding a pick: which stages have help. */
export function pathWith(have: CatalogEntry[], scan: ScanResult | null | undefined, p: WorkflowProfile, add?: EvolutionPick) {
  const before = workflowStages(have, scan, p).map((s) => ({ id: s.id, name: s.name, lit: s.covered }));
  const after = before.map((s) => (add && s.id === add.stage ? { ...s, lit: true, added: true } : { ...s, added: false }));
  return { before, after };
}

export const painLabel = (t?: SolveTag) => (t ? PAINS.find((c) => c.id === t)?.label ?? t : "");

/** The facts an AI may use to write each "why" in one warm sentence. Grounded:
 *  it rewords these, it doesn't invent. */
export function polishPrompt(picks: EvolutionPick[], brief: string): string {
  return [
    "Rewrite each suggestion's reason as ONE short sentence to the developer (under 28 words), warm and specific.",
    "Use only the facts given here and in their Coding DNA. Quote their words when the reason quotes them. Don't invent numbers or tools.",
    "",
    "Their Coding DNA:", brief || "(empty)", "",
    "Suggestions:",
    ...picks.map((x) => `- id ${x.id}: ${x.name} (${x.what}). Reason: ${x.why} What changes at ${x.change.stageName}: before "${x.change.before}", after "${x.change.after}".`),
  ].join("\n");
}
export const POLISH_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "why"], properties: { id: { type: "string" }, why: { type: "string" } } } } },
} as const;
/** Keep a polished line only for picks we asked about, and only if it's sane. */
export function applyPolish(picks: EvolutionPick[], raw: unknown): EvolutionPick[] {
  const items = (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : []) as { id?: unknown; why?: unknown }[];
  return picks.map((x) => {
    const it = items.find((i) => i.id === x.id);
    const why = typeof it?.why === "string" ? it.why.trim() : "";
    return why && why.length >= 12 && why.length <= 240 ? { ...x, why } : x;
  });
}
