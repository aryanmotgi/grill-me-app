// ---------------------------------------------------------------------------
// The setup interview, run on the user's own AI. The AI only asks questions
// and fills in the same fields the quick form has; Grill Me does the knowing
// (workflow and upgrades come from lib/profile, never from the AI). Every
// reply is validated, so a confused model can't put junk in the profile.
// Pure; the Rust side (src-tauri/src/interview.rs) just runs one turn.
// ---------------------------------------------------------------------------

import type { InterviewBrain } from "./aiConnect";
import type { ScanResult } from "./scan";
import { AGENTS, BUILDING, MAX_PAINS, PAINS, STYLE, TEAM, agentsFromScan, profileOf, type WorkflowProfile } from "./profile";

export interface Turn { who: "ai" | "you"; text: string }

export const BRAIN_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor", gemini: "Gemini" };

/** The first question is fixed, so the chat opens instantly with no AI call. */
export const OPENING = "Is it just you, or are you building with a team?";
export const OPENING_OPTIONS = ["Just me", "2–4 people", "5 or more"];
/** After this many answers we wrap up, whatever's left goes unasked. */
export const MAX_ANSWERS = 6;
export const MAX_ANSWER_CHARS = 1000;

const ids = (list: { id: string }[]) => list.map((c) => c.id);
const oneOf = (list: { id: string }[]) => ({ type: ["string", "null"], enum: [...ids(list), null] });

/** Flat, all-required schema: both Claude's --json-schema and Codex's
 *  --output-schema accept it (Codex needs every key required). */
export const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    say: { type: "string", description: "Your next message to the developer: one short question, or a one-line thanks when done." },
    options: { type: "array", items: { type: "string" }, maxItems: 6, description: "2 to 6 short answers they can tap for your question (empty when done)." },
    building: oneOf(BUILDING),
    team: oneOf(TEAM),
    style: oneOf(STYLE),
    pains: { type: "array", items: { type: "string", enum: ids(PAINS) }, maxItems: MAX_PAINS },
    agents: { type: "array", items: { type: "string", enum: ids(AGENTS) } },
    done: { type: "boolean" },
  },
  required: ["say", "options", "building", "team", "style", "pains", "agents", "done"],
} as const;

const describe = (list: { id: string; label: string }[]) => list.map((c) => `${c.id} (${c.label})`).join(", ");

export const SYSTEM_PROMPT = [
  "You are Grill Me's setup interviewer. Have a short, friendly chat with a developer to learn how they work.",
  "Ask ONE question at a time, under 25 words, casual and specific. Never repeat a question or ask about something already known.",
  "With each question give 2 to 6 short tap-able answers in `options` (a few words each). They can also type their own.",
  "Never give advice or recommend tools: Grill Me does that after the chat.",
  "Fill the fields from everything the developer has said so far. Use null or [] when unknown; never guess.",
  `building: ${describe(BUILDING)}.`,
  `team: ${describe(TEAM)}.`,
  `style (how they use AI to code): ${describe(STYLE)}.`,
  `pains (what slows them down, most important first, max ${MAX_PAINS}): ${describe(PAINS)}.`,
  `agents (AI coding tools they use): ${describe(AGENTS)}.`,
  "Set done=true once building, team, style and pains are known, or when the developer wants to stop. When done, `say` is a one-line thanks.",
].join("\n");

/** What the scan already knows, so the AI skips those questions. */
export function knownFromScan(scan?: ScanResult | null): string[] {
  const out: string[] = [];
  const agents = agentsFromScan(scan);
  if (agents.length) out.push(`AI tools installed: ${agents.join(", ")}`);
  const stack = [...(scan?.stack?.languages ?? []), ...(scan?.stack?.frameworks ?? [])];
  if (stack.length) out.push(`Project stack: ${stack.slice(0, 8).join(", ")}`);
  if (scan?.git?.usesPullRequests) out.push("Uses pull requests");
  return out;
}

const fieldsOf = (p: WorkflowProfile) => ({ building: p.building ?? null, team: p.team ?? null, style: p.style ?? null, pains: p.pains, agents: p.agents });

/** The per-turn prompt: known facts, fields so far, the whole chat. */
export function buildPrompt(turns: Turn[], profile: WorkflowProfile, scan?: ScanResult | null): string {
  const known = knownFromScan(scan);
  const chat = turns.map((t) => `${t.who === "ai" ? "Grill Me" : "Developer"}: ${t.text.slice(0, MAX_ANSWER_CHARS)}`).join("\n");
  const answers = turns.filter((t) => t.who === "you").length;
  return [
    known.length ? `Already known from a scan of their computer (don't ask):\n- ${known.join("\n- ")}` : "",
    `Fields so far: ${JSON.stringify(fieldsOf(profile))}`,
    `Conversation:\n${chat}`,
    answers >= MAX_ANSWERS - 1 ? "This is the last turn: fill what you can and set done=true." : "Write your next turn.",
  ].filter(Boolean).join("\n\n");
}

export interface Reply { say: string; options: string[]; done: boolean; profile: WorkflowProfile }

/** Validate the AI's reply and fold it into the profile. Fields the AI left
 *  empty keep what we had; anything outside the allowed values is dropped. */
export function mergeReply(profile: WorkflowProfile, raw: unknown): Reply {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const incoming = profileOf({ ...r, source: "interview" }) ?? { pains: [], agents: [], source: "interview", updated: 0 };
  const next: WorkflowProfile = {
    building: incoming.building ?? profile.building,
    team: incoming.team ?? profile.team,
    style: incoming.style ?? profile.style,
    pains: incoming.pains.length ? incoming.pains : profile.pains,
    agents: [...new Set([...profile.agents, ...incoming.agents])],
    source: "interview",
    updated: profile.updated,
  };
  const say = typeof r.say === "string" && r.say.trim() ? r.say.trim().slice(0, 400) : "Got it. Anything else that slows you down?";
  const options = Array.isArray(r.options)
    ? r.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim().slice(0, 48)).slice(0, 6)
    : [];
  return { say, options: r.done === true ? [] : options, done: r.done === true, profile: next };
}

/** Which fields are filled, for the live checklist above the chat. */
export function filled(p: WorkflowProfile): { label: string; done: boolean }[] {
  return [
    { label: "What you're building", done: !!p.building },
    { label: "Team", done: !!p.team },
    { label: "How you use AI", done: !!p.style },
    { label: "What slows you down", done: p.pains.length > 0 },
  ];
}

export const complete = (p: WorkflowProfile) => filled(p).every((f) => f.done);

/** True when the saved brain can run the interview. */
export const canInterview = (brain: InterviewBrain) => brain !== "form";
