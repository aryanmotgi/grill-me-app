// ---------------------------------------------------------------------------
// The setup interview, run on the user's own AI. It should feel like a sharp
// senior engineer: it opens with what the scan saw, finds where their time
// really goes, digs into the biggest pain, and ends with a read-back they can
// correct. The AI only asks and records (fields, their own words, tools they
// name); Grill Me does the knowing (workflow and upgrades come from
// lib/profile, never from the AI). Every reply is validated, so a confused
// model can't put junk in the profile.
// Pure; the Rust side (src-tauri/src/interview.rs) just runs one turn.
// ---------------------------------------------------------------------------

import type { InterviewBrain } from "./aiConnect";
import type { ScanResult } from "./scan";
import {
  AGENTS, BUILDING, LEVELS, MAX_MENTIONS, MAX_NOTES, MAX_PAINS, PAINS, STYLE, TEAM, agentsFromScan, buildingFromScan, levelFromScan, mentionsOf, notesOf, profileOf,
  type AiStyle, type Level, type Note, type TeamSize, type WorkflowProfile,
} from "./profile";
import type { SolveTag } from "./catalog";
import { TIPS, tipById, tipMenu, type Tip } from "./tips";

/** At most this many tips per interview, and one challenge. */
export const MAX_TIPS = 2;

export interface Turn { who: "ai" | "you"; text: string }

export const BRAIN_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor", gemini: "Gemini" };

export const OPENING_OPTIONS = ["Just me", "2–4 people", "5 or more"];
/** After this many answers we wrap up, whatever's left goes unasked. */
export const MAX_ANSWERS = 6;
export const MAX_ANSWER_CHARS = 1000;

const AGENT_LABEL: Record<string, string> = Object.fromEntries(AGENTS.map((a) => [a.id, a.label]));
const BUILDING_SAY: Record<string, string> = { web: "web app", mobile: "mobile app", backend: "backend", cli: "tool", data: "data project", other: "project" };

/** The first question is local (no AI call, so it's instant), but it opens
 *  with what the scan saw, so it never feels like a blank form. */
export function openingFor(scan?: ScanResult | null): string {
  const building = buildingFromScan(scan);
  // a backend is named by its language (Go), a web app by its framework (Next.js)
  const stack = building === "backend" ? scan?.stack?.languages?.[0] ?? scan?.stack?.frameworks?.[0] : scan?.stack?.frameworks?.[0] ?? scan?.stack?.languages?.[0];
  const agents = agentsFromScan(scan).map((a) => AGENT_LABEL[a] ?? a);
  const what = stack ? `a ${stack} ${building ? BUILDING_SAY[building] : "project"}` : "";
  const tools = agents.length ? agents.slice(0, 2).join(" and ") : "";
  const saw = what && tools ? `${what} with ${tools}` : what || (tools ? `${tools} on this Mac` : "");
  return saw ? `I can see ${saw}. Is it just you on it, or a team?` : "Is it just you, or are you building with a team?";
}

const ids = (list: { id: string }[]) => list.map((c) => c.id);
const oneOf = (list: { id: string }[]) => ({ type: ["string", "null"], enum: [...ids(list), null] });

/** Flat, all-required schema: both Claude's --json-schema and Codex's
 *  --output-schema accept it (Codex needs every key required). */
export const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    say: { type: "string", description: "Your next message: one short question. When done, a one-line thanks." },
    options: { type: "array", items: { type: "string" }, maxItems: 5, description: "2 to 5 likely answers to your question, specific to them, under 7 words each. [] for open questions or when done." },
    building: oneOf(BUILDING),
    team: oneOf(TEAM),
    style: oneOf(STYLE),
    pains: { type: "array", items: { type: "string", enum: ids(PAINS) }, maxItems: MAX_PAINS },
    agents: { type: "array", items: { type: "string", enum: ids(AGENTS) } },
    notes: {
      type: "array", maxItems: 3,
      description: "New facts from their LAST answer, first person in their words, under 15 words each.",
      items: {
        type: "object", additionalProperties: false, required: ["text", "about"],
        properties: { text: { type: "string" }, about: { type: ["string", "null"], enum: [...ids(PAINS), null] } },
      },
    },
    mentions: { type: "array", items: { type: "string" }, maxItems: 6, description: "Tools, services or vendors named in their LAST answer, lowercase one word each (vercel, linear, postgres)." },
    summary: { type: "string", description: "Only when done: two sentences, to them, describing how they work and where their time goes. No advice, no predictions. Otherwise empty." },
    level: { type: ["string", "null"], enum: [...LEVELS, null], description: "How experienced they seem: new, mid or senior." },
    tip: { type: ["string", "null"], enum: [...TIPS.map((t) => t.id), null], description: "A tip id from the menu that fits the problem they just described, or null." },
    challenge: { type: "boolean", description: "True only if `say` gently pushes back on a habit of theirs." },
    done: { type: "boolean" },
  },
  required: ["say", "options", "building", "team", "style", "pains", "agents", "notes", "mentions", "summary", "level", "tip", "challenge", "done"],
} as const;

const describe = (list: { id: string; label: string }[]) => list.map((c) => `${c.id} (${c.label})`).join(", ");

export const SYSTEM_PROMPT = [
  "You are Grill Me, a senior engineer having a quick setup chat with a developer. Your goal: find out, concretely, where their time really goes.",
  "Ask ONE question at a time, under 25 words, plain and specific. Sound like a sharp colleague who gets it, not a survey.",
  "Use what the scan shows instead of asking. Never ask what they're building or which AI tools they use.",
  "Flow: team size is already asked. Next ask what slows them down most. Then dig into the biggest pain once or twice: the concrete moment, the tool, what they've tried (e.g. \"Breaks only on Vercel, or locally too?\"). If there's room, touch a second pain. Then wrap up.",
  "Don't ask how they use AI as its own question; record style if they mention it.",
  "options: 2 to 5 likely answers to your exact question, in their situation (they can always type instead). Use [] for open questions.",
  "`say` is only ever a question (or the final thanks): never a fix, a suggestion, \"have you tried…\" or \"set up X\". Tools come after the chat; advice goes in `tip`. If they ask you something, answer in one short sentence, then ask your question.",
  "Tips: when their LAST answer describes a concrete problem, you may set `tip` to the ONE id from the tip menu that fits exactly what they just said (not their pain in general). Grill Me shows the tip; don't repeat it in `say`. Never a tip already given; skip it when nothing fits well.",
  "Grill them, gently: once in the chat, when their own answers show a habit that causes their pain, you should challenge it (rerunning flaky tests until green, fixing every PR themselves, skipping the error log), ask one kind, curious question that challenges it, e.g. \"What would it take to send that back with a failing test instead?\" A question, never a lecture. Set challenge=true on that turn only.",
  "Talk to their level. new: plain words, no jargon (explain any term in a few words), warm and encouraging. mid: normal. senior: short, direct and technical; skip the basics. Set `level` from how they write and what they describe.",
  "notes: only NEW facts from their last answer, as a short first-person quote in their words (\"I review most PRs myself\"), tagged `about` with the pain they relate to (or null). mentions: tools/vendors named in their last answer.",
  "Fill the fields from everything said so far. Use null or [] when unknown; never guess.",
  `building: ${describe(BUILDING)}.`,
  `team: ${describe(TEAM)}.`,
  `style (how they use AI to code): ${describe(STYLE)}.`,
  `pains (what slows them down, most important first, max ${MAX_PAINS}): ${describe(PAINS)}.`,
  `agents (AI coding tools they use): ${describe(AGENTS)}.`,
  "Set done=true once you know their top pain and have dug into it at least once, or when they want to stop. When done: `say` is only a short thank-you (no tip, no fix, no \"one thing to try\") and `summary` is two sentences to them (\"You…\") describing how they work and where their time goes, with their specifics. Describe, never prescribe: no \"the fix is…\", no advice, no promises. Otherwise `summary` is \"\".",
].join("\n");

const TEST_TOOLS = ["vitest", "jest", "playwright", "@playwright/test", "cypress", "pytest", "testcontainers", "testcontainers-go", "mocha", "rspec"];
const SHIP_HINTS = ["vercel", "netlify", "flyctl", "fly", "railway", "wrangler", "docker", "supabase", "heroku", "kubectl", "terraform"];

/** What the scan knows, so the AI asks about what it can't see. */
export function knownFromScan(scan?: ScanResult | null): string[] {
  const out: string[] = [];
  const agents = agentsFromScan(scan);
  if (agents.length) out.push(`AI tools installed: ${agents.join(", ")}`);
  const stack = [...(scan?.stack?.languages ?? []), ...(scan?.stack?.frameworks ?? [])];
  if (stack.length) out.push(`Project stack: ${stack.slice(0, 8).join(", ")}`);
  const building = buildingFromScan(scan);
  if (building) out.push(`Building: ${building}`);
  const ext = scan?.extensions;
  const extras = [...(ext?.mcp ?? []).map((m) => `${m.name} (MCP)`), ...(ext?.plugins ?? []).map((p) => `${p.name} (plugin)`)];
  if (extras.length) out.push(`Agent add-ons: ${extras.slice(0, 8).join(", ")}${ext?.skills?.length ? `, ${ext.skills.length} skills` : ""}`);
  if (scan?.instructions) {
    const files = scan.instructions.filter((i) => i.bytes > 0).map((i) => i.file.split("/").pop());
    out.push(files.length ? `Agent instruction files: ${files.join(", ")}` : "No agent instruction file (CLAUDE.md / AGENTS.md) with content");
  }
  const deps = (scan?.stack?.dependencies ?? []).map((d) => d.toLowerCase());
  const tests = TEST_TOOLS.filter((t) => deps.includes(t));
  out.push(tests.length ? `Test tools in the project: ${tests.join(", ")}` : scan?.stack ? "No test framework found in the project" : "");
  const cmds = new Set([...(scan?.history ?? []).map((h) => h.cmd), ...deps, ...(scan?.agents?.bins ?? [])]);
  const ship = SHIP_HINTS.filter((h) => cmds.has(h));
  if (ship.length) out.push(`Ships with: ${ship.join(", ")}`);
  const g = scan?.git;
  if (g?.commits30d !== undefined) out.push(`${g.commits30d} commits in the last 30 days${g.usesPullRequests ? ", uses pull requests" : ""}`);
  else if (g?.usesPullRequests) out.push("Uses pull requests");
  return out.filter(Boolean);
}

const fieldsOf = (p: WorkflowProfile) => ({ team: p.team ?? null, style: p.style ?? null, pains: p.pains, agents: p.agents, building: p.building ?? null });

/** The per-turn prompt: known facts, fields and notes so far, the whole chat. */
export interface PromptOpts {
  /** the developer's correction to the read-back */
  correction?: string;
  /** a challenge was already asked */
  challenged?: boolean;
  /** "go easy on me": no challenges at all */
  gentle?: boolean;
}

export function buildPrompt(turns: Turn[], profile: WorkflowProfile, scan?: ScanResult | null, opts: PromptOpts = {}): string {
  const { correction } = opts;
  const known = knownFromScan(scan);
  const chat = turns.map((t) => `${t.who === "ai" ? "Grill Me" : "Developer"}: ${t.text.slice(0, MAX_ANSWER_CHARS)}`).join("\n");
  const answers = turns.filter((t) => t.who === "you").length;
  const notes = (profile.notes ?? []).map((n) => `- ${n.text}`).join("\n");
  const level = profile.level ?? levelFromScan(scan);
  const given = profile.tips ?? [];
  const tipsLeft = correction === undefined && given.length < MAX_TIPS;
  const rules = [
    level ? `Their level so far: ${level}${profile.level ? "" : " (a guess from the scan)"}.` : "",
    opts.gentle ? "They asked you to go easy: no challenges." : opts.challenged ? "You already challenged them once: no more challenges." : "",
    tipsLeft ? (given.length ? `Tips already given (never repeat): ${given.join(", ")}.` : "") : "No more tips in this chat: set tip to null.",
  ].filter(Boolean).join("\n");
  const next = correction !== undefined
    ? `You already summed up: "${profile.summary ?? ""}". The developer corrected it: "${correction.slice(0, MAX_ANSWER_CHARS)}". Update the fields and notes, write the corrected summary, and set done=true.`
    : answers >= MAX_ANSWERS - 1 ? "This is the last turn: fill what you can and set done=true."
    : answers >= 4 ? (opts.challenged || opts.gentle
      ? "You likely know enough. Unless their top pain is still vague, wrap up now (done=true)."
      : "You likely know enough. If their answers show a habit worth challenging, ask that one question first; otherwise wrap up now (done=true).")
    : "Write your next turn.";
  return [
    known.length ? `What the scan of their computer shows (don't ask about these):\n- ${known.join("\n- ")}` : "",
    `Fields so far: ${JSON.stringify(fieldsOf(profile))}`,
    notes ? `Notes so far (don't repeat):\n${notes}` : "",
    rules,
    tipsLeft ? `Tip menu:\n${tipMenu()}` : "",
    `Conversation:\n${chat}`,
    next,
  ].filter(Boolean).join("\n\n");
}

export interface Reply { say: string; options: string[]; done: boolean; summary: string; tip?: Tip; challenge: boolean; profile: WorkflowProfile }

/** Validate the AI's reply and fold it into the profile. Fields the AI left
 *  empty keep what we had; anything outside the allowed values is dropped. */
export function mergeReply(profile: WorkflowProfile, raw: unknown): Reply {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const incoming = profileOf({ ...r, source: "interview" }) ?? { pains: [], agents: [], source: "interview", updated: 0 };
  const summary = typeof r.summary === "string" ? r.summary.trim().slice(0, 500) : "";
  const next: WorkflowProfile = {
    building: incoming.building ?? profile.building,
    team: incoming.team ?? profile.team,
    style: incoming.style ?? profile.style,
    pains: incoming.pains.length ? incoming.pains : profile.pains,
    agents: [...new Set([...profile.agents, ...incoming.agents])],
    notes: addNotes(profile.notes ?? [], notesOf(r.notes)),
    mentions: [...new Set([...(profile.mentions ?? []), ...mentionsOf(r.mentions)])].slice(0, MAX_MENTIONS),
    summary: summary || profile.summary,
    level: LEVELS.includes(r.level as Level) ? (r.level as Level) : profile.level,
    tips: profile.tips ?? [],
    source: "interview",
    updated: profile.updated,
  };
  // a tip only if it's new, fits a pain they've actually got, and there's room
  const t = tipById(r.tip);
  const fits = !!t && (next.pains.includes(t.pain) || (next.notes ?? []).some((n) => n.about === t.pain));
  const tip = t && fits && !next.tips!.includes(t.id) && next.tips!.length < MAX_TIPS ? t : undefined;
  if (tip) next.tips = [...next.tips!, tip.id];
  const say = typeof r.say === "string" && r.say.trim() ? r.say.trim().slice(0, 400) : "Got it. What else slows you down?";
  const options = Array.isArray(r.options)
    ? r.options.filter((o): o is string => typeof o === "string" && /[a-z0-9]/i.test(o)).map((o) => o.trim().slice(0, 60)).slice(0, 5)
    : [];
  return { say, options: r.done === true ? [] : options, done: r.done === true, summary, tip, challenge: r.challenge === true && r.done !== true, profile: next };
}

/** New notes, minus ones that say mostly the same as one we have, capped. */
function addNotes(have: Note[], add: Note[]): Note[] {
  const words = (n: Note) => new Set(n.text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const same = (a: Set<string>, b: Set<string>) => {
    let both = 0;
    for (const w of a) if (b.has(w)) both++;
    return both / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
  };
  const out = [...have];
  for (const n of add) {
    const w = words(n);
    if (!out.some((o) => same(words(o), w))) out.push(n);
  }
  return out.slice(0, MAX_NOTES);
}

// -- the quick questions (no AI): typed answers count too ------------------------

const PAIN_WORDS: [SolveTag, RegExp][] = [
  ["testing", /\btest|flaky|coverage|e2e|playwright|jest|vitest|pytest/i],
  ["review", /review|\bprs?\b|pull request|diff/i],
  ["planning", /\bplan|spec|architect|scope/i],
  ["debugging", /\bbug|debug|crash|broken|breaks|error|fix/i],
  ["docs", /\bdocs?\b|look(ing)? (stuff|things)? ?up|documentation|google|stack ?overflow/i],
  ["deploy", /deploy|ship|vercel|netlify|prod|release|\bci\b|env var/i],
  ["ui", /\bui\b|design|css|layout|styl/i],
  ["database", /database|\bdb\b|sql|postgres|migration|schema|supabase|prisma/i],
  ["project-management", /track|tasks?\b|tickets?|who('s| is) (doing|working)|jira|linear|organi[sz]/i],
];

/** Typed words → a team size, a style, pains (best effort, never throws). */
export function teamFromText(text: string): TeamSize | undefined {
  const t = text.toLowerCase();
  if (/just me|solo|alone|myself|only me|by myself/.test(t)) return "solo";
  const n = Number(t.match(/\d+/)?.[0]);
  if (n) return n <= 1 ? "solo" : n <= 4 ? "small" : "large";
  if (/big team|large|company|org/.test(t)) return "large";
  if (/team|we |us |couple|few|friend|cofounder|partner/.test(t)) return "small";
  return undefined;
}
export function styleFromText(text: string): AiStyle | undefined {
  const t = text.toLowerCase();
  if (/new|start|beginner|learning|never|first time/.test(t)) return "new";
  if (/agent|autonom|let it (run|do)|does most|background/.test(t)) return "agents";
  if (/plan|spec|design doc|outline|first/.test(t)) return "plan-first";
  if (/as i go|ask|chat|prompt|small|step/.test(t)) return "as-i-go";
  return undefined;
}
export function painsFromText(text: string): SolveTag[] {
  return PAIN_WORDS.filter(([, re]) => re.test(text)).map(([id]) => id).slice(0, MAX_PAINS);
}

/** A read-back when there's no AI to write one: built from the fields. */
export function localSummary(p: WorkflowProfile): string {
  const team = p.team === "solo" ? "You're building on your own" : p.team === "small" ? "You're on a small team" : p.team === "large" ? "You're on a team of five or more" : "You're building";
  const style = p.style === "plan-first" ? ", planning first and then letting AI code" : p.style === "as-i-go" ? ", asking AI for help as you go" : p.style === "agents" ? ", with agents doing most of the work" : p.style === "new" ? ", just getting started with AI" : "";
  const pains = p.pains.map((x) => PAINS.find((c) => c.id === x)?.say ?? x);
  const slow = pains.length ? ` Most of your time goes to ${pains.length < 2 ? pains[0] : `${pains.slice(0, -1).join(", ")} and ${pains[pains.length - 1]}`}.` : "";
  return `${team}${style}.${slow}`;
}

/** True when the saved brain can run the interview. */
export const canInterview = (brain: InterviewBrain) => brain !== "form";
