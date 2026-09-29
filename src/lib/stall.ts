import type { SessionStatus } from "../types";

// ---------------------------------------------------------------------------
// Stall + loop detection. Pure functions so the pty feed and every attention
// surface share ONE definition of "this session is stuck" — and so the rules
// are unit-testable without a Tauri backend. These piggyback the quiet/status
// the pty feed already derives (quietMs, OSC/hook status, pause) — no new
// polling. A stalled session went silent unexpectedly; a looping session is
// still producing output, but the output keeps repeating.
// ---------------------------------------------------------------------------

/** Default minutes of silence before a working-then-quiet session is stalled. */
export const DEFAULT_STALL_MIN = 5;

/** How many recent screen tails to keep for the loop heuristic. */
export const LOOP_SAMPLES = 4;

/** A volatile progress line — a repainting braille spinner frame and/or the
 *  "esc to interrupt" hint — that changes every frame while the body repeats.
 *  Dropped before comparison so a spinning cursor never masks a real loop. */
function isVolatileLine(l: string): boolean {
  return /esc to interrupt/i.test(l) || /[⠀-⣿]/.test(l);
}

/** Line-set Jaccard similarity of two screen tails (0..1). Blank/whitespace and
 *  volatile spinner lines are ignored so a repainting frame does not sway it. */
function tailSimilarity(a: string, b: string): number {
  const lines = (s: string) =>
    new Set(
      s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !isVolatileLine(l)),
    );
  const A = lines(a);
  const B = lines(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Has this session stalled? It was working, then went silent past the
 * threshold — while it is NOT waiting on a human (needs-input) and NOT paused.
 * `status` is the pre-pause OSC/hook status the feed derives. The caller gates
 * on alive + not-rate-limited (a rate-limited session is quiet on purpose and
 * resumes itself).
 */
export function isStalled(
  quietMs: number,
  status: SessionStatus,
  paused: boolean,
  thresholdMin: number,
): boolean {
  if (paused || status === "needs-input") return false;
  return quietMs > Math.max(1, thresholdMin) * 60_000;
}

/**
 * Does recent output keep repeating? A loop MOVES and comes back: the latest
 * screen tail is near-identical to several earlier ones, AND somewhere in the
 * window the screen was clearly different (A → B → A → B). A screen that just
 * sits still — a long-running command, thinking, a ticking status line — is
 * busy, not looping, so a window with no real change never counts.
 */
export function looksLooping(recentTails: string[]): boolean {
  const tails = recentTails.map((t) => t.trim()).filter((t) => t.length > 0);
  // need a few samples before trusting a repeat, and enough content to judge
  if (tails.length < 3) return false;
  const last = tails[tails.length - 1];
  if (last.replace(/\s+/g, "").length < 24) return false;
  const prev = tails.slice(0, -1);
  const similar = prev.filter((t) => tailSimilarity(t, last) >= 0.9).length;
  if (similar < 2) return false;
  // evidence of motion: at least one sample clearly unlike the latest
  return prev.some((t) => tailSimilarity(t, last) < 0.6);
}
