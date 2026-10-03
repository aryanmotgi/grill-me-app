// ---------------------------------------------------------------------------
// Goal watch: you say what you're trying to get done; every prompt you send
// is checked against it (on goal, or a side quest), and the Spark speaks up
// when you drift: "Your last 3 prompts were side quests" / "35 min on side
// quests". The check is one tiny AI call per prompt, with a free word-match
// fallback when no AI is connected. Pure; the UI runs the call and stores
// the log per project.
// ---------------------------------------------------------------------------

export type Verdict = "on" | "side" | "pending";
export interface WatchEntry { at: number; text: string; session: string; verdict: Verdict; why?: string }

/** Keep the log short: the meter and nudges only look at the recent past. */
export const KEEP = 60;

export function record(log: WatchEntry[], e: Omit<WatchEntry, "verdict">): WatchEntry[] {
  return [...log, { ...e, text: e.text.replace(/\s+/g, " ").trim().slice(0, 240), verdict: "pending" as const }].slice(-KEEP);
}

export function settle(log: WatchEntry[], at: number, verdict: "on" | "side", why?: string): WatchEntry[] {
  return log.map((e) => (e.at === at ? { ...e, verdict, why } : e));
}

/** Prompts that say nothing about direction: slash commands, "yes", "continue". */
export function isNeutral(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith("/") || t.split(/\s+/).length <= 2 || /^(yes|yep|ok|okay|go|continue|do it|sure|thanks|ty|y|n|no)\b[.!]*$/.test(t);
}

const STOP = new Set("the a an and or to of in on for with my our your is are be it this that from by at as add make fix build app page".split(" "));
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Free fallback: does the prompt share a meaningful word with the goal? */
export function wordMatch(goal: string, text: string): "on" | "side" {
  const g = words(goal);
  for (const w of words(text)) if (g.has(w) || [...g].some((x) => x.startsWith(w) || w.startsWith(x))) return "on";
  return "side";
}

export const WATCH_SYSTEM = [
  "You check whether a developer's message to their coding agent moves them toward their stated goal.",
  "on_goal is true when the message directly advances the goal, or is work the goal needs (setup, a bug blocking it, its tests, deploying it).",
  "on_goal is false for unrelated features, polish or exploration that doesn't serve the goal.",
  "why: at most 10 plain words.",
].join("\n");
export const WATCH_SCHEMA = {
  type: "object", additionalProperties: false, required: ["on_goal", "why"],
  properties: { on_goal: { type: "boolean" }, why: { type: "string" } },
} as const;
export const watchPrompt = (goal: string, text: string) => `Goal: ${goal.slice(0, 300)}\n\nTheir message: ${text.slice(0, 600)}`;

export function parseWatch(raw: unknown): { verdict: "on" | "side"; why: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { on_goal?: unknown; why?: unknown };
  if (typeof r.on_goal !== "boolean") return null;
  return { verdict: r.on_goal ? "on" : "side", why: typeof r.why === "string" ? r.why.trim().slice(0, 100) : "" };
}

export interface WatchSummary {
  /** judged prompts in the window, and how many were on goal */
  total: number;
  on: number;
  /** side quests in a row, most recent last */
  sideStreak: number;
  /** minutes since the last on-goal prompt, when side quests followed it */
  sideMinutes: number;
  nudge: string | null;
}

/** The meter over the last `n` judged prompts, plus whether to say something. */
export function summarize(log: WatchEntry[], goal: string, now = Date.now(), n = 10): WatchSummary {
  const judged = log.filter((e) => e.verdict !== "pending");
  const recent = judged.slice(-n);
  const on = recent.filter((e) => e.verdict === "on").length;
  let sideStreak = 0;
  for (let i = judged.length - 1; i >= 0 && judged[i].verdict === "side"; i--) sideStreak++;
  const lastOn = [...judged].reverse().find((e) => e.verdict === "on");
  const firstSide = sideStreak ? judged[judged.length - sideStreak] : undefined;
  const since = firstSide ? (lastOn && lastOn.at > firstSide.at ? lastOn.at : firstSide.at) : now;
  const sideMinutes = sideStreak ? Math.round((now - since) / 60_000) : 0;
  const g = goal.length > 70 ? `${goal.slice(0, 69)}…` : goal;
  let nudge: string | null = null;
  if (sideStreak >= 3 && sideMinutes >= 20) nudge = `${sideMinutes} min on side quests. Your goal: ${g}`;
  else if (sideStreak >= 3) nudge = `Your last ${sideStreak} prompts were side quests. Your goal: ${g}`;
  return { total: recent.length, on, sideStreak, sideMinutes, nudge };
}
