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
