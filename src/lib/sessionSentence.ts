// ---------------------------------------------------------------------------
// One plain sentence for where a session is, for people who don't read
// branches and status dots: "Working on Login.tsx", "Waiting for your
// answer", "Done: 3 files changed, tests pass". Pure; the tone tells the UI
// which color to use.
// ---------------------------------------------------------------------------

import type { Teammate } from "../types";

export type SentenceTone = "needs" | "working" | "done" | "quiet" | "stopped";
export interface Sentence { text: string; tone: SentenceTone }

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function sessionSentence(
  t: Pick<Teammate, "status" | "currentFile" | "changes" | "flag" | "rateLimited" | "rateLimitResetsAt" | "capReached" | "lastActiveMin" | "trustPrompt" | "paused">,
  testsOk: boolean | null = null,
): Sentence {
  if (t.trustPrompt) return { text: "Asking to trust its folder", tone: "needs" };
  if (t.capReached) return { text: "Stopped at its cost cap", tone: "stopped" };
  if (t.rateLimited) return { text: `Paused by the usage limit${t.rateLimitResetsAt ? `, back at ${t.rateLimitResetsAt}` : ""}`, tone: "stopped" };
  if (t.status === "needs-input") return { text: "Waiting for your answer", tone: "needs" };
  if (t.paused) return { text: "Paused", tone: "stopped" };
  if (t.status === "working") {
    if (t.flag === "looping") return { text: "Repeating itself, may be stuck", tone: "needs" };
    if (t.flag === "stalled") return { text: `Quiet for ${t.lastActiveMin}m, may be stuck`, tone: "needs" };
    const f = t.currentFile && t.currentFile !== "—" ? base(t.currentFile) : "";
    return { text: f ? `Working on ${f}` : "Working", tone: "working" };
  }
  const n = t.changes.length;
  if (n === 0) return { text: "Ready for your next message", tone: "quiet" };
  const tests = testsOk === true ? ", tests pass" : testsOk === false ? ", tests fail" : "";
  return { text: `Done: ${plural(n, "file")} changed${tests}`, tone: testsOk === false ? "needs" : "done" };
}

/** The one line at the top: what deserves attention right now. */
export function headline(rows: { said: Sentence }[]): string {
  const n = (t: Sentence["tone"]) => rows.filter((r) => r.said.tone === t).length;
  if (!rows.length) return "Nothing running yet. Start a session and it shows up here.";
  if (n("needs")) return n("needs") === 1 ? "One session needs you." : `${n("needs")} sessions need you.`;
  if (n("stopped")) return n("stopped") === 1 ? "One session is stopped." : `${n("stopped")} sessions are stopped.`;
  const parts = [n("working") && `${n("working")} working`, n("done") && `${n("done")} done and ready to review`].filter(Boolean);
  return parts.length ? `All good: ${parts.join(", ")}.` : "All quiet. Every session is waiting for your next message.";
}
