// Claude plan usage (5-hour session + weekly), as Claude Code's status line
// caches it. Pure formatting helpers for the status-bar meter.

export interface PlanWindow { pct: number | null; resetsAt: string | null }
export interface PlanUsage { session: PlanWindow; week: PlanWindow; ageSecs: number }

/** "7m", "1h 40m", "1d 9h" until a reset time; "" when unknown or passed. */
export function untilLabel(resetsAt: string | null, now = Date.now()): string {
  const t = resetsAt ? Date.parse(resetsAt) : NaN;
  if (!Number.isFinite(t) || t <= now) return "";
  const mins = Math.floor((t - now) / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Severity band for coloring: under 80 fine, 80+ warn, 95+ hot. */
export function usageTone(pct: number | null): "ok" | "warn" | "hot" {
  if (pct === null) return "ok";
  return pct >= 95 ? "hot" : pct >= 80 ? "warn" : "ok";
}

/** The status line refreshes the cache every minute while Claude Code runs. */
export const STALE_SECS = 30 * 60;
