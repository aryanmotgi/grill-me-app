// ---------------------------------------------------------------------------
// Drift alarm, pure half: when to ask Claude whether sessions are building in
// contradicting directions, and which warnings the user already waved off.
// The effectful side (claude call, toasts, alerts) is components/BrainWatch.ts.
// ---------------------------------------------------------------------------

import { similarDecision } from "./decisionSpot";

export interface DriftConflict { a: string; b: string; why: string; suggestion: string }
/** A dismissed warning: the pair (order-free) and its reason, remembered for a while. */
export interface DriftDismissal { pair: string; why: string; ts: number }

/** Sessions must have finished turns within this window to be compared… */
export const DRIFT_WINDOW_MS = 30 * 60_000;
/** …and the check runs at most this often. */
export const DRIFT_EVERY_MS = 10 * 60_000;
/** A dismissed warning stays quiet this long. */
export const DRIFT_DISMISS_MS = 2 * 3_600_000;

/** Due when ≥ 2 sessions finished a turn in the last 30 min and the last check was ≥ 10 min ago. */
export function driftDue(finishedAt: Record<string, number>, now: number, lastRun: number | undefined): boolean {
  if (lastRun !== undefined && now - lastRun < DRIFT_EVERY_MS) return false;
  return Object.values(finishedAt).filter((t) => now - t <= DRIFT_WINDOW_MS).length >= 2;
}

/** "a ⇄ b" with the names sorted, so A-vs-B and B-vs-A are one pair. */
export function pairKey(c: Pick<DriftConflict, "a" | "b">): string {
  return [c.a.trim().toLowerCase(), c.b.trim().toLowerCase()].sort().join(" ⇄ ");
}

/** Short stable hash of a warning (pair + normalized reason) — React keys and dedupe. */
export function driftId(c: DriftConflict): string {
  const s = `${pairKey(c)}|${c.why.toLowerCase().replace(/\s+/g, " ").trim()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `drift-${(h >>> 0).toString(36)}`;
}

/** Waved off already? Same pair, and the same reason in other words (the model rephrases). */
export function isDismissed(c: DriftConflict, dismissed: DriftDismissal[], now: number): boolean {
  const key = pairKey(c);
  return dismissed.some((d) => now - d.ts < DRIFT_DISMISS_MS && d.pair === key && (d.why === c.why || similarDecision(d.why, c.why)));
}

/** Drop expired dismissals (kept in settings, so it mustn't grow forever). */
export function pruneDismissed(dismissed: DriftDismissal[], now: number): DriftDismissal[] {
  return dismissed.filter((d) => now - d.ts < DRIFT_DISMISS_MS).slice(-50);
}

export function parseDismissed(raw: unknown): DriftDismissal[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is DriftDismissal => !!d && typeof d.pair === "string" && typeof d.why === "string" && typeof d.ts === "number");
}
