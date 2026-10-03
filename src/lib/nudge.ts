// ---------------------------------------------------------------------------
// Commit-nudge policy, extracted so it can be tested without the UI.
//
// The nudge asks an idle session to commit a large pile of uncommitted work.
// Repeating that ask is never useful: if the session declined once (say the
// new files are failing tests it does not want to commit), asking again an
// hour later costs a real agent turn and gets the same answer. So we ask once
// per pile, and only earn a fresh ask once the pile has actually shrunk.
// ---------------------------------------------------------------------------

export const NUDGE_THRESHOLD = 10;
export const NUDGE_STABLE_MS = 30 * 60_000;
export const NUDGE_COOLDOWN_MS = 60 * 60_000;

export type NudgeState = {
  /** When the pile first crossed the threshold, or undefined if it is under. */
  bigSince?: number;
  /** When we last asked. */
  nudgedAt?: number;
  /** We have asked about the current pile and not seen it shrink since. */
  asked?: boolean;
};

/** Should we ask this session to commit right now? */
export function shouldNudge(
  changes: number,
  idle: boolean,
  now: number,
  s: NudgeState,
): boolean {
  if (changes < NUDGE_THRESHOLD) return false;
  if (s.asked) return false;                       // already asked about this pile
  if (!idle) return false;
  if (s.bigSince === undefined) return false;      // only just crossed; wait for it to settle
  if (now - s.bigSince <= NUDGE_STABLE_MS) return false;
  if (now - (s.nudgedAt ?? 0) <= NUDGE_COOLDOWN_MS) return false;
  return true;
}

/** Fold one observation into the state. */
export function nextNudgeState(changes: number, now: number, s: NudgeState): NudgeState {
  if (changes < NUDGE_THRESHOLD) return {};        // pile gone: the next one earns a fresh ask
  return { ...s, bigSince: s.bigSince ?? now };
}
