import type { Health, SessionStatus } from "../types";

// ---------------------------------------------------------------------------
// Attention + auto-pause policy. Pure functions so the pty feed and every
// attention surface (TopBar badge, home "needs you" queue, notifications)
// share ONE definition of "this session needs a human" — and so the rules
// are unit-testable without a Tauri backend.
//
// Invariant: pausing changes the PROCESS state, never the ATTENTION state.
// A session waiting on a human decision is quiet BECAUSE it is waiting —
// auto-pause must not treat that quiet as idleness, and a paused session
// that needs input must keep surfacing everywhere.
// ---------------------------------------------------------------------------

export interface AutoPauseCandidate {
  /** Hook/OSC-resolved status BEFORE any pause masking. */
  status: SessionStatus;
  alive: boolean;
  paused: boolean;
  rateLimited: boolean;
  /** Session pane currently on screen — never pause what the user watches. */
  isViewed: boolean;
  quietMs: number;
  idleThresholdMs: number;
}

/**
 * May this session be auto-paused (SIGSTOP) to save CPU?
 * Never true for a needs-input session: it is quiet because it is blocked
 * on a human, and pausing it would hide the request.
 */
export function autoPauseEligible(c: AutoPauseCandidate): boolean {
  return (
    c.alive &&
    !c.paused &&
    !c.rateLimited &&
    !c.isViewed &&
    c.status !== "needs-input" &&
    c.quietMs > c.idleThresholdMs
  );
}

/**
 * Status to display for a session, given process pause state.
 * needs-input always wins — whether it came from OSC/BEL, a hook event,
 * or a rate limit — even while the process is paused. Only a genuinely
 * idle/working paused session displays as idle.
 */
export function resolveDisplayStatus(
  status: SessionStatus,
  paused: boolean,
  rateLimited: boolean,
): SessionStatus {
  if (rateLimited || status === "needs-input") return "needs-input";
  return paused ? "idle" : status;
}

/**
 * Attention predicate: does this session need a human?
 * Deliberately ignores `paused` — a paused session that needs input still
 * needs you; a paused working/idle session does not. A stall/loop `flag`
 * (set by the pty feed) also pulls a session into the attention surfaces.
 */
export function needsAttention(t: {
  status: SessionStatus;
  health: Health;
  paused?: boolean;
  flag?: "stalled" | "looping";
}): boolean {
  return t.status === "needs-input" || t.health !== "ok" || t.flag != null;
}
