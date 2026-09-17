// ---------------------------------------------------------------------------
// Pure windowing for the session timeline scrubber.
//
// The scrubber does line-position scrubbing over a session's recent output
// (the pty ring buffer, ANSI-stripped by pty_screen). The "playhead" is a line
// index; the viewport shows a fixed run of lines ENDING at the playhead, so
// dragging left scrolls back through older output and dragging fully right
// lands on the newest line. There is no true time index in the ring — this is
// honestly "scroll through recent output", not timestamped replay.
// ---------------------------------------------------------------------------

export interface ScrubWindow {
  /** first visible line index, inclusive (clamped to ≥ 0) */
  top: number;
  /** last visible line index, inclusive — the playhead */
  bottom: number;
  /** the visible slice of lines, `lines[top..=bottom]` */
  window: string[];
}

/** Clamp a raw playhead to a valid line index for `lines`. Empty → 0. */
export function clampPlayhead(lines: string[], playhead: number): number {
  if (lines.length === 0) return 0;
  if (!Number.isFinite(playhead)) return lines.length - 1;
  return Math.min(lines.length - 1, Math.max(0, Math.floor(playhead)));
}

/**
 * The visible window ending at `playhead`, at most `viewport` lines tall.
 * Playhead and viewport are both clamped defensively so callers can pass raw
 * slider values without pre-validating.
 */
export function scrubWindow(
  lines: string[],
  playhead: number,
  viewport: number,
): ScrubWindow {
  if (lines.length === 0) return { top: 0, bottom: 0, window: [] };
  const rows = Math.max(1, Math.floor(viewport));
  const bottom = clampPlayhead(lines, playhead);
  const top = Math.max(0, bottom - rows + 1);
  return { top, bottom, window: lines.slice(top, bottom + 1) };
}
