// ---------------------------------------------------------------------------
// The coach: small, instant, free advice that a bare terminal never gives you.
//
//   ratesForModel   what a session's model actually costs (estimate)
//   sessionStats    one session's spend, turns and context weight, in words
//   promptHints     before you send: vague asks, many tasks in one, huge
//                   pastes, a big model on a small job. Each hint says what
//                   it saves and can carry a one-click fix.
//
// Pure and local: no AI call, no network. It reads the draft and the session
// tallies Grill Me already has.
// ---------------------------------------------------------------------------

import { estimateCost, type TokenRates } from "./cost";
import type { Teammate } from "../types";

/** List prices per 1M tokens (USD). An estimate, never a bill. */
const RATES: { match: RegExp; family: ModelFamily; rates: TokenRates }[] = [
  { match: /opus/i, family: "opus", rates: { input: 5, output: 25, cacheRead: 0.5 } },
  { match: /haiku/i, family: "haiku", rates: { input: 1, output: 5, cacheRead: 0.1 } },
  { match: /sonnet/i, family: "sonnet", rates: { input: 3, output: 15, cacheRead: 0.3 } },
];
export type ModelFamily = "opus" | "sonnet" | "haiku" | "other";

export function familyOf(model: string | undefined): ModelFamily {
  return RATES.find((r) => r.match.test(model ?? ""))?.family ?? "other";
}

/** The rates for this model; unknown models price like Sonnet. */
export function ratesForModel(model: string | undefined): TokenRates {
  return RATES.find((r) => r.match.test(model ?? ""))?.rates ?? RATES[2].rates;
}

/** Above this many tokens re-read per message, a session is getting heavy. */
export const HEAVY_CONTEXT = 120_000;

export interface SessionStats {
  cost: number;
  turns: number;
  /** average tokens the model re-reads per message (≈ context size) */
  perTurn: number;
  /** cost of one more message at this size */
  nextMsg: number;
  family: ModelFamily;
  heavy: boolean;
}

/** One session's spend and weight, or null before it has real tallies. */
export function sessionStats(mate: Pick<Teammate, "usage"> | undefined): SessionStats | null {
  const tk = mate?.usage.tokens;
  if (!tk || tk.turns <= 0 || tk.input + tk.output + tk.cacheRead <= 0) return null;
  const rates = ratesForModel(mate!.usage.model);
  const perTurn = Math.round((tk.input + tk.cacheRead) / tk.turns);
  const avgOut = tk.output / tk.turns;
  const nextMsg = estimateCost({ input: 0, cacheRead: perTurn, output: avgOut }, rates);
  return { cost: estimateCost(tk, rates), turns: tk.turns, perTurn, nextMsg, family: familyOf(mate!.usage.model), heavy: perTurn >= HEAVY_CONTEXT };
}

/** "$0.42", "$12", "<$0.01" */
export function money(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

/** "38k", "1.2M" */
export function kTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// -- before you send ----------------------------------------------------------

export interface HintFix {
  label: string;
  /** "send" types a command into the session first (e.g. /model sonnet);
   *  "split" opens the parallel-tasks screen with the draft;
   *  "append" adds text to the draft */
  kind: "send" | "split" | "append";
  value: string;
}
export interface Hint {
  id: "vague" | "many" | "paste" | "small-on-big" | "heavy";
  text: string;
  fix?: HintFix;
}

const VAGUE = /\b(fix|broken|doesn'?t work|not working|wrong|bug|error|issue|help|make it (work|better))\b/i;
const SPECIFIC = /(@\S+|\/\S+\.\w+|\b\w+\.(tsx?|jsx?|py|rs|go|rb|css|html|json|md|sql)\b|`[^`]+`|error:|exception|line \d+|\d{3,})/i;
const SMALL = /\b(rename|typo|spelling|copy|wording|text|label|color|colour|padding|margin|spacing|font|icon|comment|bump|format|lint|import)\b/i;
const BIG = /\b(architect|design|refactor|migrat|rewrite|plan|investigate|debug|why|race|concurren|security|performance)\w*/i;

/** Lines that look like separate tasks: bullets, numbers or checkboxes. */
export function taskLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => /^([-*•]|\d+[.)]|\[ ?\])\s+\S/.test(l));
}

/**
 * What's worth saying about this draft before it goes out, most useful first.
 * Quiet for normal, specific prompts: an empty list is the common case.
 */
export function promptHints(draft: string, stats: SessionStats | null): Hint[] {
  const text = draft.trim();
  if (text.length < 3 || text.startsWith("/")) return [];
  const words = text.split(/\s+/).length;
  const out: Hint[] = [];

  const tasks = taskLines(text);
  if (tasks.length >= 3) {
    out.push({ id: "many", text: `This is ${tasks.length} tasks. Run them side by side and they finish in about the time of the longest one.`,
      fix: { label: "Split into parallel sessions", kind: "split", value: text } });
  }
  if (words <= 12 && VAGUE.test(text) && !SPECIFIC.test(text)) {
    out.push({ id: "vague", text: "Say which file, or paste the error. Vague asks usually take extra back-and-forth turns.",
      fix: { label: "Add the error", kind: "append", value: "\n\nThe error:\n" } });
  }
  if (text.length > 6000) {
    out.push({ id: "paste", text: `That's a ${kTokens(Math.round(text.length / 4))}-token paste, and it's re-read on every message after. Keep only the lines that matter.` });
  }
  if (stats?.family === "opus" && words <= 40 && SMALL.test(text) && !BIG.test(text) && tasks.length < 3) {
    out.push({ id: "small-on-big", text: "Small change on Opus. Sonnet does this kind of edit well for about 40% less.",
      fix: { label: "Switch to Sonnet", kind: "send", value: "/model sonnet" } });
  }
  if (stats?.heavy) {
    out.push({ id: "heavy", text: `Each message re-reads ~${kTokens(stats.perTurn)} tokens (${money(stats.nextMsg)} a message). Compacting keeps the gist and cuts that.`,
      fix: { label: "Compact first", kind: "send", value: "/compact" } });
  }
  return out;
}

// -- one-click asks ------------------------------------------------------------

/** Things people type all day, worded so the agent gets it right first time. */
export const QUICK_ASKS: { label: string; prompt: string }[] = [
  { label: "Run the tests", prompt: "Run the test suite. If anything fails, show me the failing test and the cause in one line, then fix it." },
  { label: "Fix the last error", prompt: "Look at the last error in this session. Tell me the cause in one line, then fix it and show me it works." },
  { label: "What changed?", prompt: "In 3 short bullets, what did you change since my last message, and why?" },
  { label: "Check before shipping", prompt: "Review your changes for bugs, missed edge cases and leftover debug code. List the problems first, then fix them." },
];
