// ---------------------------------------------------------------------------
// Shared display formatters — the ONE place numbers and times get shaped.
// Components must not roll their own token/mem/time formatting.
// ---------------------------------------------------------------------------

/** "1.0" → "1" so we render "1k", "2G" instead of "1.0k", "2.0G". */
const trimZero = (s: string) => s.replace(/\.0$/, "");

/**
 * Token counts: 0 → "0" (never "0k"), 850 → "850", 1500 → "1.5k",
 * 12000 → "12k", 2_400_000 → "2.4M".
 */
export const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${trimZero((n / 1000).toFixed(1))}k`;
  return `${n}`;
};

/** Memory in MB: 512 → "512M", 1228 → "1.2G". */
export const fmtMem = (mb: number): string =>
  mb >= 1024 ? `${trimZero((mb / 1024).toFixed(1))}G` : `${Math.round(mb)}M`;

/**
 * USD for cost estimates: 0 → "$0.00", a tiny non-zero amount → "<$0.01" (so a
 * real-but-fractional-cent spend never reads as free), otherwise two decimals
 * with thousands separators: 1234.5 → "$1,234.50".
 */
export const fmtUsd = (n: number): string => {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Wall-clock "HH:MM" — the legacy string shape ts fields still carry. */
export const fmtClock = (epochMs: number): string => {
  const d = new Date(epochMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/**
 * Relative time for feeds: "now" (<1m), "5m ago", "2h ago", then an
 * absolute "Sep 15 14:30" once it's 12h+ old (or in the future/clock skew).
 */
export const fmtRelTime = (epochMs: number, nowMs: number = Date.now()): string => {
  const diff = nowMs - epochMs;
  if (diff >= 0 && diff < 60_000) return "now";
  const mins = Math.floor(diff / 60_000);
  if (mins >= 1 && mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours >= 1 && hours < 12) return `${hours}h ago`;
  const d = new Date(epochMs);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Full local timestamp for tooltips: "Tue Sep 15 2026 14:30:05". */
export const fmtFullTime = (epochMs: number): string => {
  const d = new Date(epochMs);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
