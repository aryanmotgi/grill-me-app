// ---------------------------------------------------------------------------
// "Today" on the Overview: Grill Me gathers the facts (what you asked each
// session, what it changed, whether tests passed, today's commits), your AI
// writes them up in 2-3 plain sentences. Written once and reused until
// something new happens, so it costs about a cent a few times a day. Pure.
// ---------------------------------------------------------------------------

export interface SessionDay { title: string; asks: string[]; files: string[]; tests?: "pass" | "fail" }
export interface Commit { message: string; at: number }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Start of today, local time. */
export function startOfDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The facts the AI may use, or "" when nothing happened today. */
export function recapFacts(sessions: SessionDay[], commits: Commit[]): string {
  const lines: string[] = [];
  for (const s of sessions) {
    if (!s.asks.length && !s.files.length) continue;
    lines.push(`Session "${clip(s.title, 60)}": asked ${s.asks.map((a) => `"${clip(a.replace(/\s+/g, " "), 90)}"`).join(", ") || "nothing new"}; changed ${s.files.length ? s.files.slice(0, 8).join(", ") : "no files"}${s.tests ? `; tests ${s.tests === "pass" ? "pass" : "fail"}` : ""}.`);
  }
  for (const c of commits.slice(0, 12)) lines.push(`Commit: ${clip(c.message.split("\n")[0], 90)}`);
  return lines.join("\n");
}

/** A short fingerprint, so the recap is only rewritten when the facts change. */
export function sig(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const RECAP_SYSTEM = [
  "Write a 2-3 sentence recap of today's coding work for the developer, in plain English, second person (\"You added…\").",
  "Use only the facts given. Say what got built or fixed, not file names unless they help. Mention failing tests if any. No praise, no filler, no lists.",
].join("\n");

export const RECAP_SCHEMA = { type: "object", additionalProperties: false, required: ["recap"], properties: { recap: { type: "string" } } } as const;

export function parseRecap(raw: unknown): string | null {
  const r = raw && typeof raw === "object" ? (raw as { recap?: unknown }).recap : undefined;
  const t = typeof r === "string" ? r.trim() : "";
  return t.length >= 10 ? t.slice(0, 600) : null;
}

/** Rewrite only when the facts changed, and not more than every 20 minutes. */
export function needsRewrite(cached: { day: number; sig: string; at: number } | undefined, factsSig: string, now = Date.now()): boolean {
  if (!cached || cached.day !== startOfDay(now)) return true;
  if (cached.sig === factsSig) return false;
  return now - cached.at > 20 * 60_000;
}
