import type { SessionStatus, Teammate } from "../types";

// ---------------------------------------------------------------------------
// Cost cap — a hard token-budget stop. When a session's cumulative today
// tokens blow the configured cap, it is auto-paused (SIGSTOP via pty_pause) so
// a runaway agent can't quietly burn the whole budget.
//
// Two invariants, shared with lib/attention's auto-pause:
//   • A needs-input session is NEVER capped — it is quiet because a HUMAN is
//     deciding, and pausing would bury the request.
//   • A rate-limited session is NEVER capped — it resumes on its own.
//
// Unlike CPU auto-pause this is a MONEY limit, not an idleness heuristic, so it
// deliberately ignores quiet time and on-screen state: a session actively
// burning tokens is exactly the one worth stopping. Kept React/Tauri-free so
// it is unit-testable without a backend.
// ---------------------------------------------------------------------------

/**
 * Cumulative session tokens that count against a cap: input + output.
 * Cache reads are near-free and excluded (mirrors cost.ts `total`).
 */
export function sessionTokens(t: Teammate): number {
  const tk = t.usage.tokens;
  return tk ? tk.input + tk.output : 0;
}

/**
 * Is a token count over its cap? `cap <= 0` means "no cap" — the feature is
 * off, so nothing is ever over. Strictly greater-than: hitting the cap exactly
 * is still within budget.
 */
export function isOverCap(tokens: number, cap: number): boolean {
  return cap > 0 && tokens > cap;
}

export interface CapCandidate {
  /** Hook/OSC-resolved status BEFORE any pause masking. */
  status: SessionStatus;
  alive: boolean;
  paused: boolean;
  rateLimited: boolean;
  /** Tokens counted against the cap — session tokens minus the resume baseline. */
  tokens: number;
  cap: number;
}

/**
 * Should this session be auto-paused for blowing its token cap? Fires for idle
 * OR working sessions — a budget stop is a hard money limit, not idleness, so
 * unlike CPU auto-pause it ignores quiet time and whether the pane is on screen.
 * Never fires on a needs-input session (a human is deciding), a rate-limited
 * one (resumes itself), or one already dead or paused.
 */
export function shouldCapPause(c: CapCandidate): boolean {
  return (
    isOverCap(c.tokens, c.cap) &&
    c.alive &&
    !c.paused &&
    !c.rateLimited &&
    c.status !== "needs-input"
  );
}
