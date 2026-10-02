// ---------------------------------------------------------------------------
// Coding DNA: what Grill Me knows about how you build software, kept in one
// file on this Mac (~/.grillme/coding-dna.json, plus a readable .md copy).
// Six strands:
//
//   Flow     idea → plan → build → test → review → ship: what you do at each
//   Toolkit  agents, models, add-ons, apps, and how much you actually use them
//   Rules    what your AIs should always / never do (personal or per project)
//   Habits   level, team, how you prompt, which models you lean on, how you commit
//   Pains    in your words, open / better / solved, plus struggles it noticed
//   Wins     what got better: Evolutions that stuck, pains solved, trends
//
// Plus Evolutions (what Grill Me suggested, and what happened) and weekly
// counts from your sessions. It fills from the interview, the scan, your
// sessions in Grill Me (counts, never prompts or code), and, if you opt in,
// your past (old sessions, git history, rules files, installs, commands).
// Every item is yours to edit or delete; a deleted pattern stays muted.
// Pure (no I/O): the app loads and saves it through Tauri.
// ---------------------------------------------------------------------------

import type { CatalogEntry, SolveTag } from "./catalog";
import { AGENTS, BUILDING, PAINS, STYLE, type Upgrade, type WorkflowProfile } from "./profile";
import type { ScanResult } from "./scan";

export type Source = "you" | "scan" | "sessions" | "spark" | "past";
export type Strand = "flow" | "toolkit" | "rules" | "habits" | "pains" | "wins";
export const STRANDS: { id: Strand; name: string; what: string }[] = [
  { id: "flow", name: "Flow", what: "How an idea becomes shipped code" },
  { id: "toolkit", name: "Toolkit", what: "What you build with, and what you actually use" },
  { id: "rules", name: "Rules", what: "What your AIs should always or never do" },
  { id: "habits", name: "Habits", what: "How you work: level, team, prompting, commits" },
  { id: "pains", name: "Pains", what: "What slows you down, in your words" },
  { id: "wins", name: "Wins", what: "What got better" },
];
export type FlowStage = "idea" | "plan" | "build" | "test" | "review" | "ship";
export const FLOW_STAGES: FlowStage[] = ["idea", "plan", "build", "test", "review", "ship"];

export interface Item { id: string; text: string; source: Source; at: number; edited?: boolean; from?: string }
export interface Pain extends Item { about?: SolveTag; status: "open" | "better" | "solved" }
export interface Rule extends Item {
  scope: "personal" | "project";
  /** project name for project rules */
  project?: string;
  /** proposed = Grill Me suggested it from a pattern; you approve it */
  status: "active" | "proposed";
  /** it already lives in one of your files (never re-written there) */
  inFile?: string;
}
export interface Tool {
  id: string; name: string; kind: string; source: Source; firstSeen: number; lastSeen: number;
  /** uses in the last 4 weeks (skills, plugins, MCP servers) */
  uses?: number; lastUsed?: number;
  /** you uninstalled it (the past or a later scan): never suggested again */
  removed?: boolean;
}
export interface Evolution {
  id: string; name: string; why: string; at: number;
  installedAt?: number; uses?: number; helped?: "yes" | "no" | "unsure"; dismissed?: boolean;
}
/** A pattern noticed in your counts. `strand` says where it shows. */
export interface Learned { id: string; text: string; strand: Strand; at: number; evidence: string; edited?: boolean; source: Source }
export interface Moment { id: string; kind: string; detail: string; at: number; project: string }

/** One week of counts from your sessions (no text, ever). */
export interface Week {
  start: number;
  sessions: number; prompts: number; promptWords: number; shortPrompts: number; planPrompts: number;
  questionPrompts: number; fileRefPrompts: number; frustratedPrompts: number;
  testRuns: number; testFails: number; retries: number; undos: number;
  models: Record<string, number>; skills: Record<string, number>; mcp: Record<string, number>;
  slash: Record<string, number>; subagents: Record<string, number>;
}
/** What the session learners return (src-tauri/src/learn.rs, past.rs). */
export type Batch = Omit<Week, "start"> & { tools: Record<string, number>; moments: Omit<Moment, "id">[]; from: number; to: number };

export interface CodingDNA {
  version: 1;
  updated: number;
  /** "Pause learning": nothing is learned from sessions or the past */
  paused?: boolean;
  flow: Record<FlowStage, Item[]>;
  toolkit: Tool[];
  rules: Rule[];
  habits: Item[];
  pains: Pain[];
  wins: Item[];
  evolutions: Evolution[];
  learned: Learned[];
  moments: Moment[];
  weeks: Week[];
  /** ids you deleted from what was learned: they don't come back */
  muted: string[];
  /** which past sources were read, and when */
  past: Partial<Record<PastSource, number>>;
}

export type PastSource = "claude" | "codex" | "git" | "rules" | "tools" | "terminal";

const WEEK = 7 * 86400_000;
const DAY = 86400_000;
const MAX = { items: 14, toolkit: 160, rules: 60, pains: 24, wins: 20, evolutions: 60, learned: 30, moments: 30, weeks: 8 };

export function emptyDNA(now = Date.now()): CodingDNA {
  return {
    version: 1, updated: now,
    flow: { idea: [], plan: [], build: [], test: [], review: [], ship: [] },
    toolkit: [], rules: [], habits: [], pains: [], wins: [], evolutions: [], learned: [], moments: [], weeks: [], muted: [], past: {},
  };
}

// -- reading it back (the file is yours to edit, so it's read defensively) -------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const SOURCES: Source[] = ["you", "scan", "sessions", "spark", "past"];
const src = (v: unknown): Source => (SOURCES.includes(v as Source) ? (v as Source) : "you");
const STRAND_IDS = STRANDS.map((s) => s.id);
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, n] of Object.entries(v)) if (typeof n === "number" && n > 0 && k.length < 120) out[k] = Math.round(n);
  return out;
};
const list = (v: unknown) => (Array.isArray(v) ? v : []);
function item(x: unknown): Item | null {
  if (!isObj(x) || !str(x.id, 120) || !str(x.text)) return null;
  return { id: str(x.id, 120)!, text: str(x.text)!, source: src(x.source), at: num(x.at) ?? 0, ...(x.edited === true ? { edited: true } : {}), ...(str(x.from, 160) ? { from: str(x.from, 160) } : {}) };
}
const items = (v: unknown) => list(v).map(item).filter((x): x is Item => !!x);
function week(v: unknown): Week | null {
  if (!isObj(v) || num(v.start) === undefined) return null;
  const n = (k: string) => Math.max(0, Math.round(num(v[k]) ?? 0));
  return {
    start: num(v.start)!, sessions: n("sessions"), prompts: n("prompts"), promptWords: n("promptWords"), shortPrompts: n("shortPrompts"),
    planPrompts: n("planPrompts"), questionPrompts: n("questionPrompts"), fileRefPrompts: n("fileRefPrompts"), frustratedPrompts: n("frustratedPrompts"),
    testRuns: n("testRuns"), testFails: n("testFails"), retries: n("retries"), undos: n("undos"),
    models: counts(v.models), skills: counts(v.skills), mcp: counts(v.mcp), slash: counts(v.slash), subagents: counts(v.subagents),
  };
}

export function dnaOf(raw: unknown): CodingDNA | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const d = emptyDNA(num(raw.updated) ?? 0);
  if (raw.paused === true) d.paused = true;
  if (isObj(raw.flow)) for (const s of FLOW_STAGES) d.flow[s] = items(raw.flow[s]).slice(0, MAX.items);
  d.habits = items(raw.habits).slice(0, MAX.items * 2);
  d.wins = items(raw.wins).slice(0, MAX.wins);
  d.pains = list(raw.pains).flatMap((p) => {
    const base = item(p);
    if (!base || !isObj(p)) return [];
    const status = p.status === "better" || p.status === "solved" ? p.status : "open";
    const about = PAINS.some((c) => c.id === p.about) ? (p.about as SolveTag) : undefined;
    return [{ ...base, status, ...(about ? { about } : {}) } as Pain];
  }).slice(0, MAX.pains);
  d.rules = list(raw.rules).flatMap((r) => {
    const base = item(r);
    if (!base || !isObj(r)) return [];
    return [{ ...base, scope: r.scope === "project" ? "project" : "personal", status: r.status === "proposed" ? "proposed" : "active",
      ...(str(r.project, 120) ? { project: str(r.project, 120) } : {}), ...(str(r.inFile, 200) ? { inFile: str(r.inFile, 200) } : {}) } as Rule];
  }).slice(0, MAX.rules);
  d.toolkit = list(raw.toolkit).flatMap((t) => {
    if (!isObj(t) || !str(t.id, 120) || !str(t.name, 120)) return [];
    return [{ id: str(t.id, 120)!, name: str(t.name, 120)!, kind: str(t.kind, 20) ?? "tool", source: src(t.source), firstSeen: num(t.firstSeen) ?? 0, lastSeen: num(t.lastSeen) ?? 0,
      ...(num(t.uses) !== undefined ? { uses: num(t.uses) } : {}), ...(num(t.lastUsed) !== undefined ? { lastUsed: num(t.lastUsed) } : {}), ...(t.removed === true ? { removed: true } : {}) }];
  }).slice(0, MAX.toolkit);
  d.evolutions = list(raw.evolutions).flatMap((s) => {
    if (!isObj(s) || !str(s.id, 120) || !str(s.name, 120)) return [];
    const helped: Evolution["helped"] = s.helped === "yes" || s.helped === "no" || s.helped === "unsure" ? s.helped : undefined;
    return [{ id: str(s.id, 120)!, name: str(s.name, 120)!, why: str(s.why) ?? "", at: num(s.at) ?? 0,
      ...(num(s.installedAt) !== undefined ? { installedAt: num(s.installedAt) } : {}), ...(num(s.uses) !== undefined ? { uses: num(s.uses) } : {}),
      ...(helped ? { helped } : {}), ...(s.dismissed === true ? { dismissed: true } : {}) }];
  }).slice(0, MAX.evolutions);
  d.learned = list(raw.learned).flatMap((l) => {
    if (!isObj(l) || !str(l.id, 120) || !str(l.text) || !STRAND_IDS.includes(l.strand as Strand)) return [];
    return [{ id: str(l.id, 120)!, text: str(l.text)!, strand: l.strand as Strand, at: num(l.at) ?? 0, evidence: str(l.evidence) ?? "", source: src(l.source), ...(l.edited === true ? { edited: true } : {}) }];
  }).slice(0, MAX.learned);
  d.moments = list(raw.moments).flatMap((x) => {
    if (!isObj(x) || !str(x.id, 120) || !str(x.detail)) return [];
    return [{ id: str(x.id, 120)!, kind: str(x.kind, 30) ?? "moment", detail: str(x.detail)!, at: num(x.at) ?? 0, project: str(x.project, 120) ?? "" }];
  }).slice(0, MAX.moments);
  d.weeks = list(raw.weeks).map(week).filter((w): w is Week => !!w).slice(-MAX.weeks);
  d.muted = list(raw.muted).filter((x): x is string => typeof x === "string").slice(0, 300);
  if (isObj(raw.past)) for (const k of ["claude", "codex", "git", "rules", "tools", "terminal"] as PastSource[]) { const t = num(raw.past[k]); if (t) d.past[k] = t; }
  return d;
}

// -- helpers -----------------------------------------------------------------------

const label = <T extends string>(xs: { id: T; label: string }[], id?: T) => xs.find((c) => c.id === id)?.label;
/** Short, stable id from text, so the same fact isn't added twice. */
export function idOf(prefix: string, text: string): string {
  let h = 0;
  for (const c of text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `${prefix}:${(h >>> 0).toString(36)}`;
}
/** Upsert by id; an item you edited keeps your words. */
function upsert<T extends { id: string; text?: string; edited?: boolean }>(xs: T[], x: T, max: number): T[] {
  const i = xs.findIndex((o) => o.id === x.id);
  if (i < 0) return [...xs, x].slice(-max);
  const old = xs[i];
  return xs.map((o, j) => (j === i ? (old.edited ? { ...x, text: old.text, edited: true } : x) : o));
}
const PAIN_STAGE: Partial<Record<SolveTag, FlowStage>> = {
  planning: "plan", "project-management": "plan", docs: "build", debugging: "build", ui: "build", database: "build",
  testing: "test", review: "review", deploy: "ship",
};
const sayPain = (t: SolveTag) => PAINS.find((c) => c.id === t)?.label ?? t;
const pct = (a: number, b: number) => Math.round((100 * a) / Math.max(1, b));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// -- from the interview and the scan ---------------------------------------------------

/** What the interview learned: habits, pains in your words, where they sit in your flow. */
export function fromProfile(dna: CodingDNA, p: WorkflowProfile, now = Date.now()): CodingDNA {
  const d = { ...dna, flow: { ...dna.flow } };
  const habit = (key: string, text?: string) => { if (text) d.habits = upsert(d.habits, { id: `habit:${key}`, text, source: "you", at: now }, MAX.items * 2); };
  habit("team", p.team === "solo" ? "Works solo" : p.team === "small" ? "On a small team (2–4)" : p.team === "large" ? "On a team of 5 or more" : undefined);
  habit("level", p.level === "new" ? "New to coding with AI" : p.level === "senior" ? "Experienced developer" : p.level === "mid" ? "Comfortable developer" : undefined);
  habit("style", label(STYLE, p.style));
  habit("building", label(BUILDING, p.building));
  habit("agents", p.agents.length ? `Uses ${p.agents.map((a) => label(AGENTS, a) ?? a).join(", ")}` : undefined);
  habit("summary", p.summary);
  const flow = (stage: FlowStage, id: string, text: string) => { d.flow[stage] = upsert(d.flow[stage], { id, text, source: "you", at: now }, MAX.items); };
  if (p.style === "plan-first") flow("plan", "flow:plan-first", "Writes a plan first, then lets the AI code");
  if (p.style === "agents") flow("build", "flow:agents", "Agents do most of the building");
  if (p.style === "as-i-go") flow("build", "flow:as-i-go", "Asks the AI for help step by step while building");
  for (const t of p.pains) {
    const words = (p.notes ?? []).filter((n) => n.about === t).map((n) => n.text);
    const id = `pain:${t}`;
    const old = d.pains.find((x) => x.id === id);
    d.pains = upsert(d.pains, { id, text: words[0] ?? `${sayPain(t)} slows you down`, about: t, source: "you", at: now, status: old?.status ?? "open" }, MAX.pains);
  }
  for (const n of p.notes ?? []) flow((n.about && PAIN_STAGE[n.about]) || "build", idOf("note", n.text), n.text);
  d.updated = now;
  return d;
}

/** What the scan sees: the toolkit, and which Evolutions got installed. */
export function fromScan(dna: CodingDNA, scan: ScanResult | null | undefined, have: CatalogEntry[], now = Date.now()): CodingDNA {
  const seen = new Map<string, Tool>(dna.toolkit.map((t) => [t.id, t]));
  const add = (id: string, name: string, kind: string) => {
    const old = seen.get(id);
    seen.set(id, old ? { ...old, name, kind, lastSeen: now, removed: undefined } : { id, name, kind, source: "scan", firstSeen: now, lastSeen: now });
  };
  for (const e of have) add(e.id, e.name, e.kind);
  const known = new Set(have.flatMap((e) => [e.id, e.name.toLowerCase()]));
  for (const x of scan?.extensions?.mcp ?? []) if (!known.has(x.name.toLowerCase())) add(`mcp:${x.name.toLowerCase()}`, x.name, "mcp");
  for (const x of scan?.extensions?.plugins ?? []) if (!known.has(x.name.toLowerCase())) add(`plugin:${x.name.toLowerCase()}`, x.name, "plugin");
  for (const x of scan?.extensions?.skills ?? []) if (!known.has(x.name.toLowerCase())) add(`skill:${x.name.toLowerCase()}`, x.name, "skill");
  const haveIds = new Set(have.map((e) => e.id));
  const evolutions = dna.evolutions.map((s) => (!s.installedAt && haveIds.has(s.id) ? { ...s, installedAt: now } : s));
  const toolkit = [...seen.values()].map((t) => ({ ...t, ...(t.removed ? { removed: true } : {}) })).slice(-MAX.toolkit);
  const d = { ...dna, toolkit, evolutions, updated: now };
  return { ...d, wins: wins(d, now) };
}

/** Remember what was suggested (once per tool). */
export function logEvolutions(dna: CodingDNA, ups: Upgrade[], now = Date.now()): CodingDNA {
  let xs = dna.evolutions;
  for (const u of ups) if (!xs.some((s) => s.id === u.id)) xs = [...xs, { id: u.id, name: u.name, why: u.why, at: now }].slice(-MAX.evolutions);
  return { ...dna, evolutions: xs, updated: now };
}

// -- from your sessions (live) -------------------------------------------------------------

const addCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
};
const COUNT_KEYS = ["sessions", "prompts", "promptWords", "shortPrompts", "planPrompts", "questionPrompts", "fileRefPrompts", "frustratedPrompts", "testRuns", "testFails", "retries", "undos"] as const;
function emptyWeek(): Week {
  return { start: 0, sessions: 0, prompts: 0, promptWords: 0, shortPrompts: 0, planPrompts: 0, questionPrompts: 0, fileRefPrompts: 0, frustratedPrompts: 0, testRuns: 0, testFails: 0, retries: 0, undos: 0, models: {}, skills: {}, mcp: {}, slash: {}, subagents: {} };
}
function addWeek(w: Week, b: Omit<Week, "start">): Week {
  const out = { ...w };
  for (const k of COUNT_KEYS) out[k] += b[k] ?? 0;
  out.models = addCounts(out.models, b.models); out.skills = addCounts(out.skills, b.skills); out.mcp = addCounts(out.mcp, b.mcp);
  out.slash = addCounts(out.slash, b.slash); out.subagents = addCounts(out.subagents, b.subagents);
  return out;
}
const withMoments = (dna: CodingDNA, ms: Omit<Moment, "id">[]) => {
  const all = [...ms.map((x) => ({ ...x, at: x.at < 1e12 ? x.at * 1000 : x.at, id: idOf("moment", `${x.kind}${x.at}${x.detail}`) })), ...dna.moments];
  return [...new Map(all.map((x) => [x.id, x])).values()].sort((a, b) => b.at - a.at).slice(0, MAX.moments);
};

/** Fold one batch of session counts into this week, the toolkit's usage, the
 *  moments, the patterns, proposed rules and wins. Paused DNA learns nothing. */
export function fromSessions(dna: CodingDNA, b: Batch, now = Date.now()): CodingDNA {
  if (dna.paused) return dna;
  if (!b.prompts && !b.testRuns && !Object.keys(b.models).length) return dna;
  const start = Math.floor(now / WEEK) * WEEK;
  const cur = addWeek(dna.weeks.find((w) => w.start === start) ?? { ...emptyWeek(), start }, b);
  const d: CodingDNA = { ...dna, weeks: [...dna.weeks.filter((w) => w.start !== start), cur].sort((x, y) => x.start - y.start).slice(-MAX.weeks) };
  d.moments = withMoments(d, b.moments);
  return refresh(d, now);
}

/** Recompute everything derived from the counts. */
export function refresh(dna: CodingDNA, now = Date.now()): CodingDNA {
  const d = { ...dna };
  d.toolkit = d.toolkit.map((t) => { const uses = toolUses(recent(d), t.id, t.name); return { ...t, uses, ...(uses > (t.uses ?? 0) ? { lastUsed: now } : {}) }; });
  d.evolutions = d.evolutions.map((s) => (s.installedAt ? { ...s, uses: toolUses(recent(d), s.id, s.name) } : s));
  const live = patterns(recent(d), d, now, "sessions", "pat");
  d.learned = mergeLearned(d, live.filter((l) => !l.id.startsWith("past:")), now);
  d.rules = proposeRules(d, now);
  d.wins = wins(d, now);
  d.updated = now;
  return d;
}

/** The last `n` weeks, added up. */
export function recent(dna: CodingDNA, n = 4): Week {
  return dna.weeks.slice(-n).reduce((acc, w) => addWeek(acc, w), emptyWeek());
}

/** "superpowers:brainstorming" belongs to the Superpowers plugin; an MCP server
 *  name matches the tool it came from. */
function toolUses(r: Week, id: string, name: string): number {
  const keys = new Set([norm(id), norm(name), norm(id.replace(/^(mcp|plugin|skill):/, "")), norm(id.replace(/-(mcp|plugin|cli|skill)$/, ""))]);
  let n = 0;
  for (const [k, c] of Object.entries(r.skills)) if (keys.has(norm(k.split(":")[0])) || keys.has(norm(k))) n += c;
  for (const [k, c] of Object.entries(r.mcp)) if (keys.has(norm(k))) n += c;
  for (const [k, c] of Object.entries(r.slash)) if (keys.has(norm(k.split(":")[0]))) n += c;
  return n;
}

// -- patterns ---------------------------------------------------------------------------------

const MIN_PROMPTS = 20;

/** Plain-language patterns from a set of counts. `prefix` keeps live ("pat")
 *  and past ("past:claude") patterns apart; each id is stable, so deleting one
 *  mutes it and editing one keeps your words. */
export function patterns(r: Omit<Week, "start">, dna: CodingDNA, now: number, source: Source, prefix: string, window = "the last 4 weeks"): Learned[] {
  const out: Learned[] = [];
  const add = (key: string, strand: Strand, text: string, evidence: string) => {
    const id = `${prefix}:${key}`;
    if (!dna.muted.includes(id)) out.push({ id, strand, text, evidence, at: now, source });
  };
  if (r.prompts >= MIN_PROMPTS) {
    const avg = Math.round(r.promptWords / r.prompts);
    if (avg < 12) add("short-prompts", "habits", `Your prompts are short: about ${avg} words on average.`, `${r.prompts} prompts in ${window}`);
    else if (avg > 80) add("long-prompts", "habits", `You write detailed prompts: about ${avg} words on average.`, `${r.prompts} prompts in ${window}`);
    const plan = pct(r.planPrompts, r.prompts);
    if (plan >= 25) add("plans-first", "flow", `You ask for a plan first in about ${plan}% of your prompts.`, `${r.planPrompts} of ${r.prompts} prompts`);
    else if (plan < 5 && r.prompts >= 40) add("rarely-plans", "habits", `You rarely ask for a plan before coding (${plan}% of prompts).`, `${r.planPrompts} of ${r.prompts} prompts`);
    const fr = pct(r.frustratedPrompts, r.prompts);
    if (fr >= 8) add("frustrated", "pains", `About ${fr}% of your messages say something like "still not working".`, `${r.frustratedPrompts} of ${r.prompts} prompts`);
  }
  if (r.testRuns >= 10) {
    const f = pct(r.testFails, r.testRuns);
    if (f >= 30) add("tests-fail", "pains", `${r.testFails} of ${r.testRuns} test runs failed (${f}%) in ${window}.`, "test runs in your sessions");
  } else if (r.prompts >= 60 && r.testRuns <= 2) add("no-tests", "pains", "Your agents almost never run tests in your sessions.", `${r.testRuns} test runs in ${r.prompts} prompts`);
  if (r.undos >= 5) add("undos", "pains", `You undid AI work ${r.undos} times in ${window}.`, "git restore / reset / revert");
  if (r.retries >= 6) add("retries", "pains", `Builds and tests got re-run ${r.retries} times without changes in between.`, "repeated commands");
  const turns = Object.values(r.models).reduce((a, b) => a + b, 0);
  const top = Object.entries(r.models).sort((a, b) => b[1] - a[1])[0];
  if (turns >= 100 && top && /opus/i.test(top[0]) && pct(top[1], turns) >= 70) add("opus-heavy", "habits", `Most of your turns (${pct(top[1], turns)}%) run on ${top[0]}. Small tasks could use a cheaper model.`, `${turns} model turns`);
  else if (turns >= 30 && top) add("models", "toolkit", `Your main model: ${top[0]} (${pct(top[1], turns)}% of turns).`, `${turns} model turns`);
  const used = [...Object.entries(r.skills), ...Object.entries(r.mcp).map(([k, v]) => [`${k} (MCP)`, v] as [string, number])].sort((a, b) => b[1] - a[1]);
  if (used[0] && used[0][1] >= 5) add("leans-on", "toolkit", `You lean on ${used.slice(0, 2).map(([k, n]) => `${k.split(":")[0]} (${n}×)`).join(" and ")}.`, "skill and MCP calls");
  const sub = Object.entries(r.subagents).sort((a, b) => b[1] - a[1])[0];
  if (sub && sub[1] >= 5) add("subagents", "habits", `You hand work to subagents often (${Object.values(r.subagents).reduce((a, b) => a + b, 0)} times, mostly ${sub[0]}).`, "subagent calls");
  // live only: what's installed but idle, and whether Evolutions stuck
  if (source === "sessions") {
    const idle = dna.toolkit.filter((t) => !t.removed && ["plugin", "skill", "mcp"].includes(t.kind) && now - t.firstSeen > 14 * DAY && !(t.uses ?? 0));
    if (r.prompts >= MIN_PROMPTS) for (const t of idle.slice(0, 3)) add(`idle:${t.id}`, "toolkit", `You have ${t.name} installed but haven't used it in 4 weeks.`, "no calls in your sessions");
    for (const s of dna.evolutions) {
      if (!s.installedAt || s.dismissed) continue;
      if ((s.uses ?? 0) > 0) add(`evo-used:${s.id}`, "wins", `You've used ${s.name} ${s.uses} times since adding it.`, "after Grill Me suggested it");
      else if (now - s.installedAt > 7 * DAY) add(`evo-idle:${s.id}`, "toolkit", `You added ${s.name} but haven't used it yet.`, "a week after installing");
    }
  }
  return out;
}

/** New patterns replace old ones of the same family; your edits win; past
 *  patterns stay until you delete them. */
function mergeLearned(dna: CodingDNA, live: Learned[], now: number): Learned[] {
  const keepPast = dna.learned.filter((l) => l.id.startsWith("past:"));
  const merged = live.map((l) => { const old = dna.learned.find((x) => x.id === l.id); return old?.edited ? { ...l, text: old.text, edited: true } : l; });
  void now;
  return [...merged, ...keepPast].slice(0, MAX.learned);
}

/** Rules Grill Me proposes from what it saw. You approve them first. */
const PROPOSALS: { when: string; id: string; text: string; why: string }[] = [
  { when: "tests-fail", id: "rule:fix-causes", text: "When a test fails, find the cause. Never loosen an assertion, skip a test or add a sleep to make it pass.", why: "your tests fail often" },
  { when: "undos", id: "rule:small-steps", text: "Make one small change at a time and show me the diff before moving on.", why: "you often undo AI work" },
  { when: "rarely-plans", id: "rule:plan-first", text: "For anything bigger than a small fix, write a short plan and wait for my OK before coding.", why: "you rarely ask for a plan first" },
  { when: "frustrated", id: "rule:reproduce", text: "Before fixing a bug, reproduce it with a failing test or a tiny script.", why: "\"still not working\" comes up a lot" },
  { when: "no-tests", id: "rule:run-tests", text: "Run the tests after every change, and tell me the result.", why: "tests rarely run in your sessions" },
];
function proposeRules(dna: CodingDNA, now: number): Rule[] {
  let rules = dna.rules;
  const seen = new Set(dna.learned.map((l) => l.id.split(":").pop()));
  for (const p of PROPOSALS) {
    if (!seen.has(p.when) || dna.muted.includes(p.id) || rules.some((r) => r.id === p.id)) continue;
    rules = [...rules, { id: p.id, text: p.text, source: "sessions" as const, at: now, scope: "personal" as const, status: "proposed" as const, from: `suggested because ${p.why}` }].slice(-MAX.rules);
  }
  return rules;
}

/** What got better: Evolutions that stuck, pains solved, test failures dropping. */
function wins(dna: CodingDNA, now: number): Item[] {
  let out = dna.wins.filter((w) => w.source === "you" || w.edited);
  const add = (id: string, text: string) => { if (!dna.muted.includes(id)) out = upsert(out, { id, text, source: "sessions", at: now }, MAX.wins); };
  for (const s of dna.evolutions) if (s.helped === "yes") add(`win:helped:${s.id}`, `${s.name} helped`);
  for (const p of dna.pains) if (p.status === "solved") add(`win:solved:${p.id}`, `Solved: ${p.text}`);
  const ws = dna.weeks;
  if (ws.length >= 4) {
    const before = ws.slice(-4, -2).reduce((a, w) => addWeek(a, w), emptyWeek());
    const after = ws.slice(-2).reduce((a, w) => addWeek(a, w), emptyWeek());
    if (before.testRuns >= 10 && after.testRuns >= 10) {
      const b = pct(before.testFails, before.testRuns), a = pct(after.testFails, after.testRuns);
      if (b - a >= 15) add("win:tests", `Test failures dropped from ${b}% to ${a}%`);
    }
    if (before.prompts >= 20 && after.prompts >= 20) {
      const b = pct(before.frustratedPrompts, before.prompts), a = pct(after.frustratedPrompts, after.prompts);
      if (b - a >= 5) add("win:calmer", `Fewer "still not working" moments: ${b}% → ${a}% of messages`);
    }
  }
  return out;
}

// -- from your past (opt-in, one source at a time) -------------------------------------------------

export interface GitStats { repo: string; commits: number; weeksActive: number; conventional: number; aiCoauthored: number; reverts: number; medianLines: number; bigCommits: number; testFileShare: number; branchPrefixes: string[]; merges: number }
export interface RuleLine { text: string; file: string; scope: "personal" | "project"; project: string }
export interface ToolEvent { tool: string; action: "added" | "removed"; via: string; at: number }
export interface PastResults {
  claude?: Batch; codex?: Batch; git?: GitStats[]; rules?: RuleLine[]; tools?: ToolEvent[]; terminal?: [string, number][];
}

/** Something learned from the past, waiting for you to keep or drop it. */
export interface Candidate {
  id: string; strand: Strand; text: string; from: PastSource; detail?: string;
  /** a pattern (shown and muted like live ones) rather than an item */
  pattern?: boolean;
}

const AGENT_CMDS: Record<string, string> = { claude: "Claude Code", codex: "Codex", "cursor-agent": "Cursor agent", gemini: "Gemini CLI", aider: "Aider", opencode: "OpenCode", amp: "Amp", goose: "Goose" };

/** Turn what the past readers found into candidates you review. */
export function pastCandidates(r: PastResults, dna: CodingDNA, now = Date.now()): Candidate[] {
  const out: Candidate[] = [];
  const add = (from: PastSource, c: Omit<Candidate, "from">) => { if (!dna.muted.includes(c.id)) out.push({ ...c, from }); };
  for (const src of ["claude", "codex"] as const) {
    const b = r[src];
    if (!b) continue;
    const who = src === "claude" ? "Claude Code" : "Codex";
    if (b.sessions) add(src, { pattern: true, id: `past:${src}:volume`, strand: "habits", text: `${b.sessions} ${who} sessions and ${b.prompts} prompts in the last 6 months.`, detail: "your past sessions" });
    for (const l of patterns(b, dna, now, "past", `past:${src}`, "the last 6 months")) add(src, { pattern: true, id: l.id, strand: l.strand, text: `${who}: ${l.text}`, detail: l.evidence });
    for (const m of b.moments.slice(0, 5)) add(src, { id: idOf(`past:${src}:moment`, m.detail + m.at), strand: "pains", text: `${m.detail} (${m.project})`, detail: new Date(m.at * 1000).toISOString().slice(0, 10) });
  }
  for (const g of r.git ?? []) {
    if (g.commits < 5) continue;
    const per = Math.max(1, Math.round(g.commits / Math.max(1, g.weeksActive)));
    add("git", { pattern: true, id: `past:git:${g.repo}:cadence`, strand: "habits", text: `${g.repo}: about ${per} commits a week when active (${g.commits} in a year).` });
    add("git", { pattern: true, id: `past:git:${g.repo}:size`, strand: "habits", text: `${g.repo}: a typical commit changes ${g.medianLines} lines${g.bigCommits ? `; ${g.bigCommits} commits changed over 500` : ""}.` });
    if (pct(g.conventional, g.commits) >= 60) add("git", { id: `past:git:${g.repo}:conventional`, strand: "rules", text: "Write commit messages as conventional commits (feat:, fix:, chore:…).", detail: `${pct(g.conventional, g.commits)}% of ${g.repo}'s commits already do` });
    if (g.aiCoauthored) add("git", { pattern: true, id: `past:git:${g.repo}:ai`, strand: "habits", text: `${g.repo}: ${pct(g.aiCoauthored, g.commits)}% of commits were co-authored with an AI.` });
    if (g.reverts >= 3) add("git", { pattern: true, id: `past:git:${g.repo}:reverts`, strand: "pains", text: `${g.repo}: ${g.reverts} commits were reverted in the last year.` });
    add("git", { pattern: true, id: `past:git:${g.repo}:tests`, strand: g.testFileShare >= 15 ? "flow" : "pains", text: g.testFileShare >= 15 ? `${g.repo}: tests change with the code (${g.testFileShare}% of changed files are tests).` : `${g.repo}: tests rarely change with the code (${g.testFileShare}% of changed files).` });
    if (g.branchPrefixes.length) add("git", { id: `past:git:${g.repo}:branches`, strand: "rules", text: `Name branches like ${g.branchPrefixes.slice(0, 3).join(", ")}…`, detail: `how ${g.repo}'s branches are named` });
    if (g.merges >= 3) add("git", { pattern: true, id: `past:git:${g.repo}:prs`, strand: "flow", text: `${g.repo}: changes land through merges / pull requests (${g.merges} in a year).` });
  }
  for (const l of r.rules ?? []) {
    add("rules", { id: idOf(`past:rules:${l.scope}:${l.project}`, l.text), strand: "rules", text: l.text, detail: `${l.scope === "project" ? `project ${l.project}` : "personal"} · from ${l.file}` });
  }
  const last = new Map<string, ToolEvent>();
  for (const e of r.tools ?? []) last.set(e.tool, e);
  for (const e of last.values()) {
    add("tools", { id: `past:tools:${e.action}:${e.tool}`, strand: "toolkit", text: `${e.action === "added" ? "Installed" : "Removed"} ${e.tool} (${e.via})`, detail: e.at ? new Date(e.at * 1000).toISOString().slice(0, 10) : undefined });
  }
  const term = r.terminal ?? [];
  if (term.length) {
    add("terminal", { pattern: true, id: "past:terminal:top", strand: "habits", text: `Your most-used commands: ${term.slice(0, 8).map(([n]) => n).join(", ")}.` });
    const agents = term.filter(([n]) => AGENT_CMDS[n]).map(([n, c]) => `${AGENT_CMDS[n]} (${c}×)`);
    if (agents.length) add("terminal", { pattern: true, id: "past:terminal:agents", strand: "toolkit", text: `You start ${agents.join(", ")} from the terminal.` });
  }
  return out;
}

/** Keep the candidates you ticked. Past session counts also become the
 *  starting point for live learning (so patterns show right away). */
export function applyPast(dna: CodingDNA, picked: Candidate[], r: PastResults, sources: PastSource[], now = Date.now()): CodingDNA {
  if (dna.paused) return dna;
  const d: CodingDNA = { ...dna, flow: { ...dna.flow }, past: { ...dna.past } };
  for (const s of sources) d.past[s] = now;
  for (const c of picked) {
    const base = { id: c.id, text: c.text, source: "past" as const, at: now, from: c.detail ? `${c.from}: ${c.detail}` : c.from };
    if (c.pattern) {
      d.learned = [...d.learned.filter((l) => l.id !== c.id), { id: c.id, text: c.text, strand: c.strand, at: now, evidence: c.detail ?? c.from, source: "past" as const }].slice(-MAX.learned);
    } else if (c.strand === "rules") {
      const line = (r.rules ?? []).find((l) => idOf(`past:rules:${l.scope}:${l.project}`, l.text) === c.id);
      d.rules = upsert(d.rules, { ...base, scope: line?.scope ?? "personal", status: "active", ...(line?.project ? { project: line.project } : {}), ...(line ? { inFile: line.file } : {}) }, MAX.rules);
    } else if (c.strand === "toolkit" && c.from === "tools") {
      const ev = (r.tools ?? []).filter((e) => `past:tools:${e.action}:${e.tool}` === c.id).pop();
      if (ev) {
        const id = `tool:${ev.tool}`;
        const old = d.toolkit.find((t) => t.id === id || norm(t.name) === norm(ev.tool));
        d.toolkit = old ? d.toolkit.map((t) => (t === old ? { ...t, removed: ev.action === "removed" ? true : undefined } : t))
          : [...d.toolkit, { id, name: ev.tool, kind: ev.via, source: "past", firstSeen: (ev.at || 0) * 1000 || now, lastSeen: now, ...(ev.action === "removed" ? { removed: true } : {}) }];
      }
    } else if (c.strand === "pains") {
      d.pains = upsert(d.pains, { ...base, status: "open" }, MAX.pains);
    } else if (c.strand === "flow") {
      d.flow.build = upsert(d.flow.build, base, MAX.items);
    } else if (c.strand === "wins") {
      d.wins = upsert(d.wins, base, MAX.wins);
    } else {
      d.learned = [...d.learned.filter((l) => l.id !== c.id), { id: c.id, text: c.text, strand: c.strand, at: now, evidence: c.detail ?? "", source: "past" as const }].slice(-MAX.learned);
    }
  }
  // dropped candidates stay dropped
  return { ...d, updated: now };
}

/** Candidates you un-ticked: remember not to offer them again. */
export const muteCandidates = (dna: CodingDNA, ids: string[]): CodingDNA => ({ ...dna, muted: [...new Set([...dna.muted, ...ids])].slice(-300) });

// -- you, editing it ---------------------------------------------------------------------------

export type Where = { strand: Strand; id: string; stage?: FlowStage; kind?: "learned" | "moment" | "item" };

/** Every item shown on a strand: its own items plus patterns and moments that belong there. */
export interface View { id: string; text: string; source: Source; at: number; kind: "item" | "learned" | "moment"; stage?: FlowStage; detail?: string; rule?: Rule; pain?: Pain; tool?: Tool }
export function strandView(dna: CodingDNA, strand: Strand): View[] {
  const learned = dna.learned.filter((l) => l.strand === strand).map((l): View => ({ id: l.id, text: l.text, source: l.source, at: l.at, kind: "learned", detail: l.evidence }));
  switch (strand) {
    case "flow": return [...FLOW_STAGES.flatMap((s) => dna.flow[s].map((x): View => ({ ...x, kind: "item", stage: s, detail: x.from }))), ...learned];
    case "toolkit": return [...dna.toolkit.map((t): View => ({ id: t.id, text: t.name, source: t.source, at: t.lastSeen, kind: "item", tool: t, detail: t.removed ? "removed" : t.uses ? `used ${t.uses}× in 4 weeks` : t.kind })), ...learned];
    case "rules": return [...dna.rules.map((r): View => ({ id: r.id, text: r.text, source: r.source, at: r.at, kind: "item", rule: r, detail: r.from })), ...learned];
    case "habits": return [...dna.habits.map((x): View => ({ ...x, kind: "item", detail: x.from })), ...learned];
    case "pains": return [...dna.pains.map((p): View => ({ ...p, kind: "item", pain: p, detail: p.from })), ...learned, ...dna.moments.map((m): View => ({ id: m.id, text: m.detail, source: "sessions", at: m.at, kind: "moment", detail: m.project }))];
    case "wins": return [...dna.wins.map((x): View => ({ ...x, kind: "item", detail: x.from })), ...learned];
  }
}

/** Change an item's words (kept over future updates). Empty text deletes it. */
export function editItem(dna: CodingDNA, w: Where, text: string): CodingDNA {
  const t = text.trim().slice(0, 300);
  if (!t) return removeItem(dna, w);
  const ed = <T extends { id: string }>(xs: T[]) => xs.map((x) => (x.id === w.id ? { ...x, text: t, edited: true } : x));
  const d = { ...dna, updated: Date.now() };
  if (w.kind === "learned") { d.learned = ed(d.learned); return d; }
  if (w.strand === "flow" && w.stage) d.flow = { ...d.flow, [w.stage]: ed(d.flow[w.stage]) };
  if (w.strand === "habits") d.habits = ed(d.habits);
  if (w.strand === "pains") d.pains = ed(d.pains);
  if (w.strand === "rules") d.rules = ed(d.rules);
  if (w.strand === "wins") d.wins = ed(d.wins);
  return d;
}

/** Delete an item. Learned things stay muted, so they don't come back. */
export function removeItem(dna: CodingDNA, w: Where): CodingDNA {
  const drop = <T extends { id: string }>(xs: T[]) => xs.filter((x) => x.id !== w.id);
  const d = { ...dna, updated: Date.now() };
  const mute = () => { d.muted = [...new Set([...d.muted, w.id])].slice(-300); };
  if (w.kind === "learned") { d.learned = drop(d.learned); mute(); return d; }
  if (w.kind === "moment") { d.moments = drop(d.moments); return d; }
  if (w.strand === "flow" && w.stage) d.flow = { ...d.flow, [w.stage]: drop(d.flow[w.stage]) };
  if (w.strand === "habits") d.habits = drop(d.habits);
  if (w.strand === "pains") d.pains = drop(d.pains);
  if (w.strand === "rules") { d.rules = drop(d.rules); mute(); }
  if (w.strand === "wins") { d.wins = drop(d.wins); mute(); }
  if (w.strand === "toolkit") d.toolkit = drop(d.toolkit);
  return d;
}

/** Add something yourself. */
export function addItem(dna: CodingDNA, strand: "flow" | "habits" | "pains" | "rules" | "wins", text: string, opts: { stage?: FlowStage; scope?: Rule["scope"]; project?: string; source?: Source } = {}, now = Date.now()): CodingDNA {
  const t = text.trim().slice(0, 300);
  if (!t) return dna;
  const base = { id: idOf(strand, t), text: t, source: opts.source ?? ("you" as Source), at: now, edited: true };
  const d = { ...dna, updated: now };
  if (strand === "flow") d.flow = { ...d.flow, [opts.stage ?? "build"]: upsert(d.flow[opts.stage ?? "build"], base, MAX.items) };
  if (strand === "habits") d.habits = upsert(d.habits, base, MAX.items * 2);
  if (strand === "pains") d.pains = upsert(d.pains, { ...base, status: "open" }, MAX.pains);
  if (strand === "wins") d.wins = upsert(d.wins, base, MAX.wins);
  if (strand === "rules") d.rules = upsert(d.rules, { ...base, scope: opts.scope ?? "personal", status: "active", ...(opts.project ? { project: opts.project } : {}) }, MAX.rules);
  return d;
}

export const setPainStatus = (dna: CodingDNA, id: string, status: Pain["status"], now = Date.now()): CodingDNA => {
  const d = { ...dna, pains: dna.pains.map((p) => (p.id === id ? { ...p, status } : p)), updated: now };
  return { ...d, wins: wins(d, now) };
};
export const setRule = (dna: CodingDNA, id: string, patch: Partial<Pick<Rule, "status" | "scope" | "project">>): CodingDNA =>
  ({ ...dna, rules: dna.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)), updated: Date.now() });
export const setHelped = (dna: CodingDNA, id: string, helped: Evolution["helped"], now = Date.now()): CodingDNA => {
  const d = { ...dna, evolutions: dna.evolutions.map((s) => (s.id === id ? { ...s, helped } : s)), updated: now };
  return { ...d, wins: wins(d, now) };
};

// -- reading it out ---------------------------------------------------------------------------------

const STAGE_NAME: Record<FlowStage, string> = { idea: "Idea", plan: "Plan", build: "Build", test: "Test", review: "Review", ship: "Ship" };
const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

/** The readable copy (~/.grillme/coding-dna.md). */
export function toMarkdown(dna: CodingDNA): string {
  const L: string[] = ["# Coding DNA", "", `_Kept by Grill Me on this Mac. Updated ${day(dna.updated)}. Edit it in Grill Me → DNA._`, ""];
  for (const s of STRANDS) {
    const v = strandView(dna, s.id).filter((x) => !(x.rule && x.rule.status === "proposed"));
    if (!v.length) continue;
    L.push(`## ${s.name}`);
    for (const x of v.slice(0, 40)) {
      const pre = x.stage ? `**${STAGE_NAME[x.stage]}:** ` : x.rule ? `${x.rule.scope === "project" ? `(${x.rule.project ?? "project"}) ` : ""}` : "";
      const tail = x.pain && x.pain.status !== "open" ? ` _(${x.pain.status})_` : x.tool?.removed ? " _(removed)_" : "";
      L.push(`- ${pre}${x.text}${tail}`);
    }
    L.push("");
  }
  if (dna.evolutions.length) L.push("## Evolutions", ...dna.evolutions.map((s) => `- ${s.name}: ${s.installedAt ? "added" : "not added"}${s.uses ? `, used ${s.uses}×` : ""}${s.helped ? `, helped: ${s.helped}` : ""}`), "");
  return L.join("\n");
}

/** A compact brief for an AI (the Spark, the "why" text, the MCP tool). Facts only. */
export function dnaBrief(dna: CodingDNA, max = 2600, strand?: Strand): string {
  const strands = strand ? STRANDS.filter((s) => s.id === strand) : STRANDS;
  let out = "";
  for (const s of strands) {
    const v = strandView(dna, s.id).filter((x) => !(x.rule && x.rule.status === "proposed") && !x.tool?.removed);
    if (!v.length) continue;
    const head = `${s.name}:\n`;
    if (out.length + head.length > max) break;
    out += head;
    for (const x of v.slice(0, s.id === "toolkit" ? 25 : 12)) {
      const l = `- ${x.stage ? `${STAGE_NAME[x.stage]}: ` : ""}${x.text}${x.pain && x.pain.status !== "open" ? ` (${x.pain.status})` : ""}\n`;
      if (out.length + l.length > max) break;
      out += l;
    }
  }
  return out.trim();
}

/** How much each need matters now: open pains and what sessions show. Feeds Evolutions. */
export function needWeights(dna: CodingDNA): Partial<Record<SolveTag, number>> {
  const w: Partial<Record<SolveTag, number>> = {};
  const bump = (t: SolveTag, n: number) => { w[t] = (w[t] ?? 0) + n; };
  for (const p of dna.pains) if (p.about && p.status !== "solved") bump(p.about, p.status === "better" ? 1 : 3);
  const keys = new Set(dna.learned.map((l) => l.id.split(":").pop()));
  if (keys.has("tests-fail") || keys.has("no-tests")) bump("testing", 2);
  if (keys.has("undos") || keys.has("frustrated")) bump("debugging", 1);
  if (keys.has("rarely-plans")) bump("planning", 1);
  if (keys.has("opus-heavy")) bump("models", 2);
  if (keys.has("retries")) bump("ci", 1);
  return w;
}

/** Tools you removed: never suggest them again. */
export const removedTools = (dna: CodingDNA) => new Set(dna.toolkit.filter((t) => t.removed).flatMap((t) => [t.id, norm(t.name)]));

/** Import, merge mode: everything in `b` that `a` doesn't have (by id), plus
 *  b's mutes and past reads. `a` wins where both have an item. */
export function mergeDNA(a: CodingDNA, b: CodingDNA, now = Date.now()): CodingDNA {
  const uni = <T extends { id: string }>(x: T[], y: T[], max: number) => [...x, ...y.filter((i) => !x.some((j) => j.id === i.id))].slice(0, max);
  const flow = { ...a.flow };
  for (const s of FLOW_STAGES) flow[s] = uni(a.flow[s], b.flow[s], MAX.items);
  const weeks = [...a.weeks, ...b.weeks.filter((w) => !a.weeks.some((x) => x.start === w.start))].sort((x, y) => x.start - y.start).slice(-MAX.weeks);
  return {
    ...a, updated: now, flow,
    toolkit: uni(a.toolkit, b.toolkit, MAX.toolkit), rules: uni(a.rules, b.rules, MAX.rules), habits: uni(a.habits, b.habits, MAX.items * 2),
    pains: uni(a.pains, b.pains, MAX.pains), wins: uni(a.wins, b.wins, MAX.wins), evolutions: uni(a.evolutions, b.evolutions, MAX.evolutions),
    learned: uni(a.learned, b.learned, MAX.learned), moments: uni(a.moments, b.moments, MAX.moments), weeks,
    muted: [...new Set([...a.muted, ...b.muted])].slice(-300), past: { ...b.past, ...a.past },
  };
}

/** "Not for me": never suggested again (you can undo it from history). */
export const dismissEvolution = (dna: CodingDNA, id: string, name: string, dismissed = true, now = Date.now()): CodingDNA => {
  const has = dna.evolutions.some((e) => e.id === id);
  const evolutions = has ? dna.evolutions.map((e) => (e.id === id ? { ...e, dismissed: dismissed || undefined } : e)) : [...dna.evolutions, { id, name, why: "", at: now, ...(dismissed ? { dismissed: true } : {}) }];
  return { ...dna, evolutions, updated: now };
};
