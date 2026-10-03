// ---------------------------------------------------------------------------
// Plan limits for the Overview bars (src-tauri/src/usage.rs): where you are,
// where an even pace would put you, and a plain forecast ("At this pace you
// hit the limit in 1h 20m, 40m before it resets"). Pure.
// ---------------------------------------------------------------------------

export interface LimitWindow { label: string; pct: number; resetsAt: string | null; windowMins: number }
export interface AgentUsage { agent: string; windows: LimitWindow[]; source: "live" | "cache"; ageSecs: number }

export type LimitTone = "ok" | "warn" | "hot";
export interface Forecast { tone: LimitTone; text: string }

/** "45m", "1h 20m", "2d 3h" */
export function span(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ""}`;
}

/** How far through the window we are, 0..1, or null when unknown. */
export function paceFrac(w: LimitWindow, now = Date.now()): number | null {
  const reset = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
  if (!Number.isFinite(reset) || w.windowMins <= 0) return null;
  const start = reset - w.windowMins * 60_000;
  return Math.min(1, Math.max(0, (now - start) / (w.windowMins * 60_000)));
}

/** Minutes until it resets, or null. */
export function minsToReset(w: LimitWindow, now = Date.now()): number | null {
  const reset = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
  return Number.isFinite(reset) ? Math.max(0, (reset - now) / 60_000) : null;
}

/** The one sentence under a bar. */
export function forecast(w: LimitWindow, now = Date.now()): Forecast {
  const left = minsToReset(w, now);
  const resets = left !== null ? `Resets in ${span(left)}` : "";
  if (w.pct >= 100) return { tone: "hot", text: `Limit reached.${resets ? ` ${resets}.` : ""}` };
  const frac = paceFrac(w, now);
  const elapsed = frac !== null ? frac * w.windowMins : null;
  // too early, or too little used, to project anything honest
  if (elapsed === null || left === null || elapsed < 10 || w.pct < 3) {
    return { tone: w.pct >= 80 ? "warn" : "ok", text: w.pct >= 80 ? `Getting close.${resets ? ` ${resets}.` : ""}` : `Plenty left.${resets ? ` ${resets}.` : ""}` };
  }
  const perMin = w.pct / elapsed;
  const toFull = (100 - w.pct) / perMin;
  if (toFull < left) {
    return { tone: toFull < 60 || w.pct >= 80 ? "hot" : "warn", text: `At this pace you hit the limit in ${span(toFull)}, ${span(left - toFull)} before it resets.` };
  }
  return { tone: w.pct >= 80 ? "warn" : "ok", text: `On pace. ${resets}.` };
}

export const toneOf = (pct: number): LimitTone => (pct >= 90 ? "hot" : pct >= 70 ? "warn" : "ok");
export const AGENT_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
