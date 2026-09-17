import type { Teammate } from "../types";
import type { AlertKind } from "../data/sounds";

// ---------------------------------------------------------------------------
// Rate-limit + soft-budget warning logic. Pure so the team-wide indicator, the
// budget meter, and the threshold-crossing sound all share ONE definition and
// stay unit-testable without a Tauri backend or WebAudio.
//
// Two independent signals:
//   1. Rate limit — a session's pty tail shows a real 429 / usage-limit /
//      overloaded message. The feed flags it per session; here we roll the
//      flagged sessions up into one team-wide readout.
//   2. Soft budget — today's summed token spend vs a configurable cap. We map
//      the spend ratio to a threshold band (50/80/100) and decide when a band
//      crossing should make a distinct sound (once, guarded by a high-water
//      mark in the caller).
// ---------------------------------------------------------------------------

/** One rate-limited session, rolled up for the team-wide indicator. */
export interface RateLimitedSession {
  id: string;
  name: string;
  /** Reset time parsed from the session's screen, or null when none shown. */
  resetsAt: string | null;
}

/**
 * Sessions the pty feed currently sees as rate-limited, with any reset time it
 * could read off the screen. Order preserved (config/list order) so the
 * indicator is stable.
 */
export function rateLimitedSessions(teammates: Teammate[]): RateLimitedSession[] {
  return teammates
    .filter((t) => t.rateLimited)
    .map((t) => ({ id: t.id, name: t.name, resetsAt: t.rateLimitResetsAt ?? null }));
}

/**
 * Pull a reset time out of a rate-limit message when the screen shows one, e.g.
 * "5-hour limit reached ∙ resets 3pm" → "3pm", "usage limit reached, resets at
 * 6:00am" → "6:00am". Returns null when no time is present (the common case —
 * many limit banners don't print one). `tail` may be lowercased; the returned
 * string is trimmed and space-normalized.
 */
export function parseResetHint(tail: string): string | null {
  const m = tail
    .toLowerCase()
    .match(/reset[s]?(?:\s+at)?\s+(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))/);
  if (!m) return null;
  return m[1].replace(/\s+/g, "").trim();
}

// --- Soft budget thresholds -------------------------------------------------

/** Budget warning bands, in percent of the soft cap. 0 = calm. */
export type BudgetLevel = 0 | 50 | 80 | 100;

/** Ordered ascending — the caller's high-water guard walks these. */
export const BUDGET_LEVELS: readonly BudgetLevel[] = [0, 50, 80, 100];

/** Highest threshold band the current spend ratio has reached. */
export function budgetLevel(ratio: number): BudgetLevel {
  if (ratio >= 1) return 100;
  if (ratio >= 0.8) return 80;
  if (ratio >= 0.5) return 50;
  return 0;
}

/**
 * Sound to fire when the budget band rises from `from` to `to`. Only the 80%
 * and 100% crossings make a sound (50% is a visual-only nudge); a downward or
 * flat move is silent. The caller keeps a high-water mark so each band's sound
 * fires at most once as spend climbs — that is the "fires once" guard.
 */
export function budgetAlertOnCross(from: BudgetLevel, to: BudgetLevel): AlertKind | null {
  if (to <= from) return null;
  if (to === 100) return "budget-max";
  if (to === 80) return "budget-warn";
  return null;
}

/** Spend ratio → whole-percent, clamped at 0 (may exceed 100 when over cap). */
export function budgetPct(ratio: number): number {
  return Math.max(0, Math.round(ratio * 100));
}

/**
 * One human line for the budget meter at each band, or null when calm. Used by
 * the home meter so the copy has a single source of truth.
 */
export function budgetWarning(level: BudgetLevel): string | null {
  switch (level) {
    case 100:
      return "team over the token budget";
    case 80:
      return "team at 80% of the token budget";
    case 50:
      return "team past 50% of the token budget";
    default:
      return null;
  }
}
