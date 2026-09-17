import type { ActivityEvent, Teammate } from "../types";

// ---------------------------------------------------------------------------
// Home dashboard pure helpers — token-budget math and activity-ticker copy.
// Kept free of React/Tauri so they're unit-testable and the widgets that use
// them stay dumb.
// ---------------------------------------------------------------------------

/** Team-wide soft budget for a day of agent work. Deliberately a soft cap —
 *  the meter turns amber near it, it never blocks anything. Overridable via
 *  appSettings.tokenBudget. */
export const DEFAULT_TOKEN_BUDGET = 5_000_000;

/** Fraction of the cap at which the meter starts warning (amber). */
export const BUDGET_WARN_AT = 0.8;

export interface TokenBudget {
  /** input + output summed across sessions with real transcript tallies. */
  spent: number;
  cap: number;
  /** spent / cap, unclamped (may exceed 1 when over budget). */
  ratio: number;
  /** at/over the warn threshold — the meter goes amber. */
  near: boolean;
  /** strictly over the cap. */
  over: boolean;
  /** biggest single spender, or null when no session has tokens yet. */
  top: { id: string; name: string; tokens: number } | null;
}

/**
 * Token budget from real per-session tallies. "Spent" = input + output tokens
 * (cache reads are near-free and excluded, so the meter tracks real cost).
 * Sessions without a transcript contribute nothing rather than a fake zero.
 */
export function tokenBudget(
  teammates: Teammate[],
  cap: number = DEFAULT_TOKEN_BUDGET,
): TokenBudget {
  let spent = 0;
  let top: TokenBudget["top"] = null;
  for (const t of teammates) {
    const tk = t.usage.tokens;
    if (!tk) continue;
    const used = tk.input + tk.output;
    if (used <= 0) continue;
    spent += used;
    if (!top || used > top.tokens) top = { id: t.id, name: t.name, tokens: used };
  }
  const ratio = cap > 0 ? spent / cap : 0;
  return { spent, cap, ratio, near: ratio >= BUDGET_WARN_AT, over: ratio > 1, top };
}

/** Total input+output tokens across sessions — the "today" band figure. */
export function totalTokens(teammates: Teammate[]): number {
  return tokenBudget(teammates).spent;
}

/** One session's real contribution to today's token burn. */
export interface TokenBurnBar {
  id: string;
  name: string;
  /** input + output for this session (cache reads excluded, matching the budget). */
  tokens: number;
}

export interface TokenBurn {
  /** input + output summed across every session with a real tally. */
  total: number;
  /** per-session spend, biggest first — the bars of the burn chart. */
  bars: TokenBurnBar[];
  /** largest single-session spend, for scaling bar heights (0 when empty). */
  max: number;
}

/**
 * Break today's token spend down by session for the home burn chart. Uses the
 * same accounting as {@link tokenBudget} (input + output, cache reads excluded,
 * zero-tally sessions dropped) so the total here always matches the meter. When
 * nothing has real tokens the bars are empty and `total` is 0 — the widget then
 * shows an honest empty state rather than a fabricated curve.
 */
export function tokenBurn(teammates: Teammate[]): TokenBurn {
  const bars: TokenBurnBar[] = [];
  let total = 0;
  let max = 0;
  for (const t of teammates) {
    const tk = t.usage.tokens;
    if (!tk) continue;
    const used = tk.input + tk.output;
    if (used <= 0) continue;
    total += used;
    if (used > max) max = used;
    bars.push({ id: t.id, name: t.name, tokens: used });
  }
  bars.sort((a, b) => b.tokens - a.tokens);
  return { total, bars, max };
}

/**
 * One human line for the live activity ticker. `nameOf` resolves an actor id
 * to a display name (falls back to the id). Pure so the ticker component just
 * cycles strings.
 */
export function activityLine(e: ActivityEvent, nameOf: (id: string) => string): string {
  const who = nameOf(e.actor);
  switch (e.kind) {
    case "commit":
      return `${who} committed ${e.text}`;
    case "merge":
      // merge text already reads "merged X → main"
      return `${who} ${e.text}`;
    case "message":
    case "status":
    default:
      return `${who} ${e.text}`;
  }
}
