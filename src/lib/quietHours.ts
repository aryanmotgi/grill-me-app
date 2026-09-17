// ---------------------------------------------------------------------------
// Do-not-disturb schedule: is a given moment inside the user's quiet hours?
// Pure so it unit-tests without a clock — playAlert reads the setting and calls
// this with `new Date()`. Times are "HH:MM" 24h strings. The window is
// half-open [start, end): the start minute is quiet, the end minute is not, so
// a 22:00–07:00 window silences through 06:59 and rings again at 07:00.
// Wrap-around past midnight is handled. Malformed input fails open (not quiet)
// so a bad setting can never silently swallow every alert.
// ---------------------------------------------------------------------------

/** Parse "HH:MM" → minutes since midnight (0..1439), or null if malformed. */
export function parseHhMm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * True when `now` falls inside the quiet window [start, end).
 * `start === end` is an empty window (never quiet). Bad input → false.
 */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const s = parseHhMm(start);
  const e = parseHhMm(end);
  if (s === null || e === null || s === e) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return s < e
    // same-day window, e.g. 09:00–17:00
    ? cur >= s && cur < e
    // wraps midnight, e.g. 22:00–07:00
    : cur >= s || cur < e;
}

/**
 * Should alerts (sound AND OS notification) be suppressed right now for this
 * settings object? Reads the same `quietHours` shape playAlert reads. A
 * settings object without a valid enabled quietHours block (e.g. the Settings
 * "test" button) is never silenced, so previews always fire. `at` is injected
 * for testability; defaults to the wall clock.
 */
export function notificationsSilenced(
  settings: Record<string, unknown>,
  at: Date = new Date(),
): boolean {
  const qh = settings.quietHours as
    | { enabled?: boolean; start?: string; end?: string }
    | undefined;
  if (!qh?.enabled || typeof qh.start !== "string" || typeof qh.end !== "string") {
    return false;
  }
  return inQuietHours(at, qh.start, qh.end);
}
