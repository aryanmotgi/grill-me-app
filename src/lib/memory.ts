// ---------------------------------------------------------------------------
// Workflow memory: what Grill Me knows about how you work, kept in one file
// on this Mac (~/.grillme/workflow-memory.json, plus a readable .md copy).
//
//   flow         idea → plan → build → test → review → ship: what you do at each
//   toolkit      agents, add-ons, apps: from the scan, and how much you use them
//   habits       level, team, how you use AI, how you prompt
//   pains        in your words, open / better / solved
//   suggestions  what was suggested, whether you installed it, used it, it helped
//   learned      patterns noticed while you work (from session counts)
//   moments      labelled struggles ("`vitest` failed 5 times in one session")
//   weeks        rolling weekly counts (last 8 weeks), never text
//
// It fills from the interview and the scan, and keeps learning from your
// sessions in Grill Me (src-tauri/src/learn.rs sends counts, not prompts).
// Every item is editable and deletable; deleting a learned pattern mutes it.
// Pure (no I/O): the app loads/saves it through Tauri.
// ---------------------------------------------------------------------------

import type { CatalogEntry, SolveTag } from "./catalog";
import { AGENTS, BUILDING, PAINS, STYLE, TEAM, type WorkflowProfile } from "./profile";
import type { ScanResult } from "./scan";
import type { Upgrade } from "./profile";

export type Source = "scan" | "you" | "spark" | "sessions";
export type FlowStage = "idea" | "plan" | "build" | "test" | "review" | "ship";
export const FLOW_STAGES: FlowStage[] = ["idea", "plan", "build", "test", "review", "ship"];

export interface MemItem { id: string; text: string; source: Source; at: number; edited?: boolean }
export interface Pain extends MemItem { about?: SolveTag; status: "open" | "better" | "solved" }
export interface ToolUse {
  id: string; name: string; kind: string; source: Source;
  firstSeen: number; lastSeen: number;
  /** uses in the last 4 weeks (skills, plugins, MCP servers, agents) */
  uses?: number; lastUsed?: number;
}
export interface SuggestionLog {
  id: string; name: string; why: string; at: number;
  installedAt?: number; uses?: number; helped?: "yes" | "no" | "unsure"; dismissed?: boolean;
}
export interface Learned { id: string; text: string; kind: "prompting" | "tools" | "struggle" | "models" | "suggestion"; at: number; evidence: string; edited?: boolean }
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
/** What learn_sessions returns (src-tauri/src/learn.rs). */
export type Batch = Omit<Week, "start"> & { tools: Record<string, number>; moments: Omit<Moment, "id">[]; from: number; to: number };

export interface WorkflowMemory {
  version: 1;
  updated: number;
  /** "Pause learning": the interview and you can still add things */
  paused?: boolean;
  flow: Record<FlowStage, MemItem[]>;
  toolkit: ToolUse[];
  habits: MemItem[];
  pains: Pain[];
  suggestions: SuggestionLog[];
  learned: Learned[];
  moments: Moment[];
  weeks: Week[];
  /** ids of learned patterns you deleted: they don't come back */
  muted: string[];
}

const WEEK = 7 * 86400_000;
const MAX = { items: 12, toolkit: 120, pains: 20, suggestions: 40, learned: 16, moments: 30, weeks: 8 };

export function emptyMemory(now = Date.now()): WorkflowMemory {
  return {
    version: 1, updated: now,
    flow: { idea: [], plan: [], build: [], test: [], review: [], ship: [] },
    toolkit: [], habits: [], pains: [], suggestions: [], learned: [], moments: [], weeks: [], muted: [],
  };
}

// -- reading it back (the file is user-editable) ------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const SOURCES: Source[] = ["scan", "you", "spark", "sessions"];
const src = (v: unknown): Source => (SOURCES.includes(v as Source) ? (v as Source) : "you");
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, n] of Object.entries(v)) if (typeof n === "number" && n > 0 && k.length < 120) out[k] = Math.round(n);
  return out;
};
function items(v: unknown): MemItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!isObj(x) || !str(x.id, 120) || !str(x.text)) return [];
    return [{ id: str(x.id, 120)!, text: str(x.text)!, source: src(x.source), at: num(x.at) ?? 0, ...(x.edited === true ? { edited: true } : {}) }];
  });
}
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

export function memoryOf(raw: unknown): WorkflowMemory | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const m = emptyMemory(num(raw.updated) ?? 0);
  if (raw.paused === true) m.paused = true;
  if (isObj(raw.flow)) for (const s of FLOW_STAGES) m.flow[s] = items(raw.flow[s]).slice(0, MAX.items);
  m.habits = items(raw.habits).slice(0, MAX.items * 2);
  m.pains = (Array.isArray(raw.pains) ? raw.pains : []).flatMap((p) => {
    const [base] = items([p]);
    if (!base || !isObj(p)) return [];
    const status = p.status === "better" || p.status === "solved" ? p.status : "open";
    const about = PAINS.some((c) => c.id === p.about) ? (p.about as SolveTag) : undefined;
    return [{ ...base, status, ...(about ? { about } : {}) } as Pain];
  }).slice(0, MAX.pains);
  m.toolkit = (Array.isArray(raw.toolkit) ? raw.toolkit : []).flatMap((t) => {
    if (!isObj(t) || !str(t.id, 120) || !str(t.name, 120)) return [];
    return [{ id: str(t.id, 120)!, name: str(t.name, 120)!, kind: str(t.kind, 20) ?? "tool", source: src(t.source), firstSeen: num(t.firstSeen) ?? 0, lastSeen: num(t.lastSeen) ?? 0, uses: num(t.uses), lastUsed: num(t.lastUsed) }];
  }).slice(0, MAX.toolkit);
  m.suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : []).flatMap((s) => {
    if (!isObj(s) || !str(s.id, 120) || !str(s.name, 120)) return [];
    const helped: SuggestionLog["helped"] = s.helped === "yes" || s.helped === "no" || s.helped === "unsure" ? s.helped : undefined;
    return [{ id: str(s.id, 120)!, name: str(s.name, 120)!, why: str(s.why) ?? "", at: num(s.at) ?? 0, installedAt: num(s.installedAt), uses: num(s.uses), ...(helped ? { helped } : {}), ...(s.dismissed === true ? { dismissed: true } : {}) }];
  }).slice(0, MAX.suggestions);
  const KINDS = ["prompting", "tools", "struggle", "models", "suggestion"];
  m.learned = (Array.isArray(raw.learned) ? raw.learned : []).flatMap((l) => {
    if (!isObj(l) || !str(l.id, 120) || !str(l.text) || !KINDS.includes(l.kind as string)) return [];
    return [{ id: str(l.id, 120)!, text: str(l.text)!, kind: l.kind as Learned["kind"], at: num(l.at) ?? 0, evidence: str(l.evidence) ?? "", ...(l.edited === true ? { edited: true } : {}) }];
  }).slice(0, MAX.learned);
  m.moments = (Array.isArray(raw.moments) ? raw.moments : []).flatMap((x) => {
    if (!isObj(x) || !str(x.id, 120) || !str(x.detail)) return [];
    return [{ id: str(x.id, 120)!, kind: str(x.kind, 30) ?? "moment", detail: str(x.detail)!, at: num(x.at) ?? 0, project: str(x.project, 120) ?? "" }];
  }).slice(0, MAX.moments);
  m.weeks = (Array.isArray(raw.weeks) ? raw.weeks : []).map(week).filter((w): w is Week => !!w).slice(-MAX.weeks);
  m.muted = (Array.isArray(raw.muted) ? raw.muted : []).filter((x): x is string => typeof x === "string").slice(0, 200);
  return m;
}

// -- small helpers -------------------------------------------------------------

const label = <T extends string>(list: { id: T; label: string }[], id?: T) => list.find((c) => c.id === id)?.label;
/** Short, stable id from text (so the same fact isn't added twice). */
export function idOf(prefix: string, text: string): string {
  let h = 0;
  for (const c of text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `${prefix}:${(h >>> 0).toString(36)}`;
}
/** Upsert by id; an item you edited keeps your words. */
function upsert<T extends { id: string; text?: string; edited?: boolean }>(list: T[], item: T, max: number): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item].slice(-max);
  const old = list[i];
  const next = old.edited ? { ...item, text: old.text, edited: true } : item;
  return list.map((x, j) => (j === i ? next : x));
}
const PAIN_STAGE: Partial<Record<SolveTag, FlowStage>> = {
  planning: "plan", "project-management": "plan", docs: "build", debugging: "build", ui: "build", database: "build",
  testing: "test", review: "review", deploy: "ship",
};
const sayPain = (t: SolveTag) => PAINS.find((c) => c.id === t)?.label ?? t;

// -- filling it ------------------------------------------------------------------

/** What the interview learned: habits, pains in your words, where they sit in your flow. */
export function fromProfile(mem: WorkflowMemory, p: WorkflowProfile, now = Date.now()): WorkflowMemory {
  const m = { ...mem, flow: { ...mem.flow } };
  const habit = (key: string, text?: string) => { if (text) m.habits = upsert(m.habits, { id: `habit:${key}`, text, source: "you", at: now }, MAX.items * 2); };
  habit("team", p.team === "solo" ? "Works solo" : p.team === "small" ? "On a small team (2–4)" : p.team === "large" ? "On a team of 5 or more" : undefined);
  habit("level", p.level === "new" ? "New to coding with AI" : p.level === "senior" ? "Experienced developer" : p.level === "mid" ? "Comfortable developer" : undefined);
  habit("style", label(STYLE, p.style));
  habit("building", label(BUILDING, p.building));
  habit("agents", p.agents.length ? `Uses ${p.agents.map((a) => label(AGENTS, a) ?? a).join(", ")}` : undefined);
  habit("summary", p.summary);
  if (p.style === "plan-first") m.flow.plan = upsert(m.flow.plan, { id: "flow:plan-first", text: "Writes a plan first, then lets the AI code", source: "you", at: now }, MAX.items);
  if (p.style === "agents") m.flow.build = upsert(m.flow.build, { id: "flow:agents", text: "Agents do most of the building", source: "you", at: now }, MAX.items);
  if (p.style === "as-i-go") m.flow.build = upsert(m.flow.build, { id: "flow:as-i-go", text: "Asks the AI for help step by step while building", source: "you", at: now }, MAX.items);
  // pains: their words when we have them, else the plain label
  for (const t of p.pains) {
    const words = (p.notes ?? []).filter((n) => n.about === t).map((n) => n.text);
    const text = words[0] ?? `${sayPain(t)} slows you down`;
    const id = `pain:${t}`;
    const old = m.pains.find((x) => x.id === id);
    m.pains = upsert(m.pains, { id, text, about: t, source: "you", at: now, status: old?.status ?? "open" }, MAX.pains);
  }
  // the details, in their words, under the stage they belong to
  for (const n of p.notes ?? []) {
    const stage = (n.about && PAIN_STAGE[n.about]) || "build";
    m.flow[stage] = upsert(m.flow[stage], { id: idOf("note", n.text), text: n.text, source: "you", at: now }, MAX.items);
  }
  m.updated = now;
  return m;
}

/** What the scan sees: the toolkit, and which suggestions got installed. */
export function fromScan(mem: WorkflowMemory, scan: ScanResult | null | undefined, have: CatalogEntry[], now = Date.now()): WorkflowMemory {
  const m = { ...mem };
  const seen = new Map<string, ToolUse>(m.toolkit.map((t) => [t.id, t]));
  const add = (id: string, name: string, kind: string) => {
    const old = seen.get(id);
    seen.set(id, old ? { ...old, name, kind, lastSeen: now } : { id, name, kind, source: "scan", firstSeen: now, lastSeen: now });
  };
  for (const e of have) add(e.id, e.name, e.kind);
  const known = new Set(have.flatMap((e) => [e.id, e.name.toLowerCase()]));
  for (const x of scan?.extensions?.mcp ?? []) if (!known.has(x.name.toLowerCase())) add(`mcp:${x.name.toLowerCase()}`, x.name, "mcp");
  for (const x of scan?.extensions?.plugins ?? []) if (!known.has(x.name.toLowerCase())) add(`plugin:${x.name.toLowerCase()}`, x.name, "plugin");
  for (const x of scan?.extensions?.skills ?? []) if (!known.has(x.name.toLowerCase())) add(`skill:${x.name.toLowerCase()}`, x.name, "skill");
  m.toolkit = [...seen.values()].slice(-MAX.toolkit);
  const haveIds = new Set(have.map((e) => e.id));
  m.suggestions = m.suggestions.map((s) => (!s.installedAt && haveIds.has(s.id) ? { ...s, installedAt: now } : s));
  m.updated = now;
  return m;
}

/** Remember what was suggested (once per tool). */
export function logSuggestions(mem: WorkflowMemory, ups: Upgrade[], now = Date.now()): WorkflowMemory {
  let list = mem.suggestions;
  for (const u of ups) if (!list.some((s) => s.id === u.id)) list = [...list, { id: u.id, name: u.name, why: u.why, at: now }].slice(-MAX.suggestions);
  return { ...mem, suggestions: list, updated: now };
}

const addCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
};

/** Fold one learning batch (session counts) into this week, the toolkit's
 *  usage, the moments, and the patterns. Paused memory learns nothing. */
export function fromSessions(mem: WorkflowMemory, b: Batch, now = Date.now()): WorkflowMemory {
  if (mem.paused) return mem;
  if (!b.prompts && !b.testRuns && !Object.keys(b.models).length) return mem;
  const start = Math.floor(now / WEEK) * WEEK;
  const weeks = [...mem.weeks];
  const cur = weeks.find((w) => w.start === start) ?? { ...emptyWeek(), start };
  const keys = ["sessions", "prompts", "promptWords", "shortPrompts", "planPrompts", "questionPrompts", "fileRefPrompts", "frustratedPrompts", "testRuns", "testFails", "retries", "undos"] as const;
  for (const k of keys) cur[k] += b[k] ?? 0;
  cur.models = addCounts(cur.models, b.models); cur.skills = addCounts(cur.skills, b.skills); cur.mcp = addCounts(cur.mcp, b.mcp);
  cur.slash = addCounts(cur.slash, b.slash); cur.subagents = addCounts(cur.subagents, b.subagents);
  const next: WorkflowMemory = { ...mem, weeks: [...weeks.filter((w) => w.start !== start), cur].sort((x, y) => x.start - y.start).slice(-MAX.weeks) };
  // moments: a few labelled struggles, newest first
  const ms = [...b.moments.map((x) => ({ ...x, at: x.at * 1000, id: idOf("moment", `${x.kind}${x.at}${x.detail}`) })), ...mem.moments];
  next.moments = [...new Map(ms.map((x) => [x.id, x])).values()].sort((x, y) => y.at - x.at).slice(0, MAX.moments);
  next.toolkit = usage(next, now);
  next.suggestions = next.suggestions.map((s) => ({ ...s, uses: s.installedAt ? toolUses(next, s.id, s.name) : s.uses }));
  next.learned = patterns(next, now);
  next.updated = now;
  return next;
}

function emptyWeek(): Week {
  return { start: 0, sessions: 0, prompts: 0, promptWords: 0, shortPrompts: 0, planPrompts: 0, questionPrompts: 0, fileRefPrompts: 0, frustratedPrompts: 0, testRuns: 0, testFails: 0, retries: 0, undos: 0, models: {}, skills: {}, mcp: {}, slash: {}, subagents: {} };
}

/** The last 4 weeks, added up. */
export function recent(mem: WorkflowMemory, weeks = 4): Week {
  const out = emptyWeek();
  for (const w of mem.weeks.slice(-weeks)) {
    for (const k of Object.keys(out) as (keyof Week)[]) {
      if (k === "start") continue;
      const v = w[k];
      if (typeof v === "number") (out[k] as number) += v;
      else (out[k] as Record<string, number>) = addCounts(out[k] as Record<string, number>, v as Record<string, number>);
    }
  }
  return out;
}

/** "superpowers:brainstorming" belongs to the Superpowers plugin; an MCP
 *  server name matches the tool it came from. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
function toolUses(mem: WorkflowMemory, id: string, name: string): number {
  const r = recent(mem);
  const keys = new Set([norm(id), norm(name), norm(id.replace(/^(mcp|plugin|skill):/, "")), norm(id.replace(/-(mcp|plugin|cli|skill)$/, ""))]);
  let n = 0;
  for (const [k, c] of Object.entries(r.skills)) if (keys.has(norm(k.split(":")[0])) || keys.has(norm(k))) n += c;
  for (const [k, c] of Object.entries(r.mcp)) if (keys.has(norm(k))) n += c;
  for (const [k, c] of Object.entries(r.slash)) if (keys.has(norm(k.split(":")[0]))) n += c;
  return n;
}
function usage(mem: WorkflowMemory, now: number): ToolUse[] {
  return mem.toolkit.map((t) => {
    const uses = toolUses(mem, t.id, t.name);
    return { ...t, uses, ...(uses > (t.uses ?? 0) ? { lastUsed: now } : {}) };
  });
}

// -- what it noticed ------------------------------------------------------------

const pct = (a: number, b: number) => Math.round((100 * a) / Math.max(1, b));
const MIN_PROMPTS = 20;

/** Plain-language patterns from the last 4 weeks of counts. Each has a
 *  stable id: deleting one mutes it; editing one keeps your words. */
export function patterns(mem: WorkflowMemory, now = Date.now()): Learned[] {
  const r = recent(mem);
  const out: Learned[] = [];
  const add = (id: string, kind: Learned["kind"], text: string, evidence: string) => { if (!mem.muted.includes(id)) out.push({ id, kind, text, evidence, at: now }); };
  if (r.prompts >= MIN_PROMPTS) {
    const avg = Math.round(r.promptWords / r.prompts);
    if (avg < 12) add("pat:short-prompts", "prompting", `Your prompts are short: about ${avg} words on average.`, `${r.prompts} prompts in 4 weeks`);
    else if (avg > 80) add("pat:long-prompts", "prompting", `You write detailed prompts: about ${avg} words on average.`, `${r.prompts} prompts in 4 weeks`);
    const plan = pct(r.planPrompts, r.prompts);
    if (plan >= 25) add("pat:plans-first", "prompting", `You ask for a plan first in about ${plan}% of your prompts.`, `${r.planPrompts} of ${r.prompts} prompts`);
    else if (plan < 5 && r.prompts >= 40) add("pat:rarely-plans", "prompting", `You rarely ask for a plan before coding (${plan}% of prompts).`, `${r.planPrompts} of ${r.prompts} prompts`);
    const fr = pct(r.frustratedPrompts, r.prompts);
    if (fr >= 8) add("pat:frustrated", "struggle", `About ${fr}% of your messages say something like "still not working".`, `${r.frustratedPrompts} of ${r.prompts} prompts`);
  }
  if (r.testRuns >= 10) {
    const f = pct(r.testFails, r.testRuns);
    if (f >= 30) add("pat:tests-fail", "struggle", `${r.testFails} of ${r.testRuns} test runs failed (${f}%) in the last 4 weeks.`, "test runs in your sessions");
  } else if (r.prompts >= 60 && r.testRuns <= 2) add("pat:no-tests", "struggle", "Your agents almost never run tests in your sessions.", `${r.testRuns} test runs in ${r.prompts} prompts`);
  if (r.undos >= 5) add("pat:undos", "struggle", `You undid AI work ${r.undos} times in the last 4 weeks.`, "git restore / reset / revert");
  if (r.retries >= 6) add("pat:retries", "struggle", `Builds and tests got re-run ${r.retries} times without changes in between.`, "repeated commands");
  // models
  const turns = Object.values(r.models).reduce((a, b) => a + b, 0);
  const top = Object.entries(r.models).sort((a, b) => b[1] - a[1])[0];
  if (turns >= 100 && top && /opus/i.test(top[0]) && pct(top[1], turns) >= 70) add("pat:opus-heavy", "models", `Most of your turns (${pct(top[1], turns)}%) run on ${top[0]}. Small tasks could use a cheaper model.`, `${turns} model turns`);
  // tools: what you lean on, what you never touch
  const used = [...Object.entries(r.skills), ...Object.entries(r.mcp).map(([k, v]) => [`${k} (MCP)`, v] as [string, number])].sort((a, b) => b[1] - a[1]);
  if (used[0] && used[0][1] >= 5) add("pat:leans-on", "tools", `You lean on ${used.slice(0, 2).map(([k, n]) => `${k.split(":")[0]} (${n}×)`).join(" and ")}.`, "skill and MCP calls");
  const idle = mem.toolkit.filter((t) => ["plugin", "skill", "mcp"].includes(t.kind) && now - t.firstSeen > 14 * 86400_000 && !(t.uses ?? 0));
  if (r.prompts >= MIN_PROMPTS) for (const t of idle.slice(0, 3)) add(`pat:idle:${t.id}`, "tools", `You have ${t.name} installed but haven't used it in 4 weeks.`, "no calls in your sessions");
  // suggestions: did they stick?
  for (const s of mem.suggestions) {
    if (!s.installedAt || s.dismissed) continue;
    if ((s.uses ?? 0) > 0) add(`pat:sugg-used:${s.id}`, "suggestion", `You've used ${s.name} ${s.uses} times since adding it.`, "after the suggestion");
    else if (now - s.installedAt > 7 * 86400_000) add(`pat:sugg-idle:${s.id}`, "suggestion", `You added ${s.name} but haven't used it yet.`, "a week after installing");
  }
  // edits you made win
  return out.slice(0, MAX.learned).map((l) => {
    const old = mem.learned.find((x) => x.id === l.id);
    return old?.edited ? { ...l, text: old.text, edited: true } : l;
  });
}

// -- you, editing it ---------------------------------------------------------------

export type Section = "flow" | "habits" | "pains" | "learned" | "moments" | "toolkit" | "suggestions";

/** Change an item's words (kept over future updates). */
export function editItem(mem: WorkflowMemory, section: Section, id: string, text: string, stage?: FlowStage): WorkflowMemory {
  const t = text.trim().slice(0, 300);
  if (!t) return removeItem(mem, section, id, stage);
  const ed = <T extends { id: string }>(list: T[]) => list.map((x) => (x.id === id ? { ...x, text: t, edited: true } : x));
  const m = { ...mem, updated: Date.now() };
  if (section === "flow" && stage) m.flow = { ...m.flow, [stage]: ed(m.flow[stage]) };
  if (section === "habits") m.habits = ed(m.habits);
  if (section === "pains") m.pains = ed(m.pains);
  if (section === "learned") m.learned = ed(m.learned);
  return m;
}

/** Delete an item. A deleted pattern stays muted, so it doesn't come back. */
export function removeItem(mem: WorkflowMemory, section: Section, id: string, stage?: FlowStage): WorkflowMemory {
  const drop = <T extends { id: string }>(list: T[]) => list.filter((x) => x.id !== id);
  const m = { ...mem, updated: Date.now() };
  if (section === "flow" && stage) m.flow = { ...m.flow, [stage]: drop(m.flow[stage]) };
  if (section === "habits") m.habits = drop(m.habits);
  if (section === "pains") m.pains = drop(m.pains);
  if (section === "learned") { m.learned = drop(m.learned); m.muted = [...new Set([...m.muted, id])]; }
  if (section === "moments") m.moments = drop(m.moments);
  if (section === "toolkit") m.toolkit = drop(m.toolkit);
  if (section === "suggestions") m.suggestions = drop(m.suggestions);
  return m;
}

/** Add something yourself. */
export function addItem(mem: WorkflowMemory, section: "flow" | "habits" | "pains", text: string, stage: FlowStage = "build", now = Date.now()): WorkflowMemory {
  const t = text.trim().slice(0, 300);
  if (!t) return mem;
  const item = { id: idOf(section, t), text: t, source: "you" as const, at: now, edited: true };
  if (section === "flow") return { ...mem, flow: { ...mem.flow, [stage]: upsert(mem.flow[stage], item, MAX.items) }, updated: now };
  if (section === "habits") return { ...mem, habits: upsert(mem.habits, item, MAX.items * 2), updated: now };
  return { ...mem, pains: upsert(mem.pains, { ...item, status: "open" as const }, MAX.pains), updated: now };
}

export const setPainStatus = (mem: WorkflowMemory, id: string, status: Pain["status"]): WorkflowMemory =>
  ({ ...mem, pains: mem.pains.map((p) => (p.id === id ? { ...p, status } : p)), updated: Date.now() });
export const setHelped = (mem: WorkflowMemory, id: string, helped: SuggestionLog["helped"]): WorkflowMemory =>
  ({ ...mem, suggestions: mem.suggestions.map((s) => (s.id === id ? { ...s, helped } : s)), updated: Date.now() });

// -- reading it out ------------------------------------------------------------------

const STAGE_NAME: Record<FlowStage, string> = { idea: "Idea", plan: "Plan", build: "Build", test: "Test", review: "Review", ship: "Ship" };
const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

/** The readable copy (~/.grillme/workflow-memory.md). */
export function toMarkdown(mem: WorkflowMemory): string {
  const L: string[] = ["# Workflow memory", "", `_Kept by Grill Me on this Mac. Updated ${day(mem.updated)}. Edit it in Grill Me (Memory)._`, ""];
  const list = (xs: { text: string }[]) => xs.map((x) => `- ${x.text}`);
  if (mem.habits.length) L.push("## How you work", ...list(mem.habits), "");
  const flow = FLOW_STAGES.filter((s) => mem.flow[s].length);
  if (flow.length) { L.push("## Your flow"); for (const s of flow) L.push(`- **${STAGE_NAME[s]}:** ${mem.flow[s].map((x) => x.text).join("; ")}`); L.push(""); }
  if (mem.pains.length) L.push("## What slows you down", ...mem.pains.map((p) => `- ${p.text}${p.status !== "open" ? ` _(${p.status})_` : ""}`), "");
  if (mem.learned.length) L.push("## Noticed while you work", ...list(mem.learned), "");
  if (mem.moments.length) L.push("## Recent struggles", ...mem.moments.slice(0, 8).map((x) => `- ${day(x.at)} · ${x.project}: ${x.detail}`), "");
  if (mem.toolkit.length) L.push("## Your toolkit", ...mem.toolkit.slice(0, 60).map((t) => `- ${t.name} (${t.kind})${t.uses ? ` · used ${t.uses}× in 4 weeks` : ""}`), "");
  if (mem.suggestions.length) L.push("## Suggestions", ...mem.suggestions.map((s) => `- ${s.name}: ${s.installedAt ? "installed" : "not installed"}${s.uses ? `, used ${s.uses}×` : ""}${s.helped ? `, helped: ${s.helped}` : ""}`), "");
  return L.join("\n");
}

/** A compact summary for the AI (the Spark, the "why" text). Facts only. */
export function memoryBrief(mem: WorkflowMemory, max = 2400): string {
  const lines = [
    ...mem.habits.map((h) => `- ${h.text}`),
    ...FLOW_STAGES.flatMap((s) => mem.flow[s].map((x) => `- ${STAGE_NAME[s]}: ${x.text}`)),
    ...mem.pains.filter((p) => p.status !== "solved").map((p) => `- Pain${p.status === "better" ? " (getting better)" : ""}: ${p.text}`),
    ...mem.learned.map((l) => `- Noticed: ${l.text}`),
    ...mem.moments.slice(0, 4).map((x) => `- Struggle: ${x.detail}`),
    `- Toolkit: ${mem.toolkit.slice(0, 30).map((t) => t.name).join(", ")}`,
    ...mem.suggestions.filter((s) => s.installedAt).map((s) => `- Added ${s.name}${s.uses ? `, used ${s.uses}×` : ", not used yet"}${s.helped ? `, helped: ${s.helped}` : ""}`),
  ];
  let out = "";
  for (const l of lines) { if (out.length + l.length > max) break; out += `${l}\n`; }
  return out.trim();
}

/** How much each need matters now: open pains (your words) and struggles
 *  the sessions show. Feeds the recommender. */
export function needWeights(mem: WorkflowMemory): Partial<Record<SolveTag, number>> {
  const w: Partial<Record<SolveTag, number>> = {};
  const bump = (t: SolveTag, n: number) => { w[t] = (w[t] ?? 0) + n; };
  for (const p of mem.pains) if (p.about && p.status !== "solved") bump(p.about, p.status === "better" ? 1 : 3);
  const ids = new Set(mem.learned.map((l) => l.id));
  if (ids.has("pat:tests-fail") || ids.has("pat:no-tests")) bump("testing", 2);
  if (ids.has("pat:undos") || ids.has("pat:frustrated")) bump("debugging", 1);
  if (ids.has("pat:rarely-plans")) bump("planning", 1);
  if (ids.has("pat:opus-heavy")) bump("models", 2);
  if (ids.has("pat:retries")) bump("ci", 1);
  return w;
}

export { TEAM };
