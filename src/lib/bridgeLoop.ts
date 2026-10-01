// ---------------------------------------------------------------------------
// The bridge loop, pure half: which questions need a drafted answer, which
// delivered hand-offs are owed a reply, when a session is due a review, and
// what a phone button press means. The effectful engine (claude calls,
// pings, polling) is components/BridgeLoop.ts.
// ---------------------------------------------------------------------------

import type { BridgeHandoff, BridgeState, DraftSlot } from "./bridge";
import type { TeamBridgeItem } from "../types";

/** A draft that started this long ago and never landed (app quit mid-call) is a failure. */
export const DRAFT_STALE_MS = 3 * 60_000;
/** Min gap between two reviews of the same session. */
export const REVIEW_EVERY_MS = 3 * 60_000;

export type DraftStatus = "none" | "drafting" | "ready" | "failed";

export function draftStatus(slot: DraftSlot | undefined, now: number): DraftStatus {
  if (!slot) return "none";
  if (typeof slot.draft === "string" && slot.draft.trim()) return "ready";
  if (slot.draftError) return "failed";
  if (typeof slot.draftStarted === "number") return now - slot.draftStarted > DRAFT_STALE_MS ? "failed" : "drafting";
  return "none";
}

export interface DraftJob { id: string; team: boolean; asker: string; question: string }

/** Open questions (mine and teammates') that never had a draft started.
 *  `asked` = ids already kicked off this run (the file write lags the call);
 *  `since` = skip older questions (no burst of drafts for stale ones at startup). */
export function questionsToDraft(
  b: BridgeState, teamQuestions: TeamBridgeItem[], titleOf: (id: string) => string, asked: ReadonlySet<string>, since = 0,
): DraftJob[] {
  const jobs: DraftJob[] = [];
  for (const q of b.questions) {
    if (q.ts < since || q.answered || q.dismissed || asked.has(q.id) || q.draftStarted !== undefined || q.draft !== undefined || q.draftError) continue;
    jobs.push({ id: q.id, team: false, asker: q.fromTitle || titleOf(q.from), question: q.question });
  }
  for (const q of teamQuestions) {
    const local = b.teamLocal?.[q.id];
    if (q.ts < since || asked.has(q.id) || local?.dismissed || local?.draftStarted !== undefined || local?.draft !== undefined) continue;
    jobs.push({ id: q.id, team: true, asker: `${q.fromName}'s ${q.sessionTitle || q.session || "session"}`, question: q.message });
  }
  return jobs;
}

/** Delivered hand-offs to `sessionId` still owed a result report. Routed
 *  ones (`to` set) are delivered on the teammate's Mac — they report there. */
export function repliesOwed(b: BridgeState, sessionId: string): BridgeHandoff[] {
  return b.handoffs.filter((h) => h.status === "sent" && h.session === sessionId && !h.to && typeof h.deliveredAt === "number" && !h.result);
}

/** Replies the user hasn't acknowledged yet, oldest first. */
export function unreadReplies(b: BridgeState): BridgeHandoff[] {
  return b.handoffs.filter((h) => h.result && h.result.summary && !h.resultAck).sort((x, y) => (x.resultTs ?? 0) - (y.resultTs ?? 0));
}

/** Results teammates' sessions sent back for hand-offs I routed to them. */
export function teamReplies(items: TeamBridgeItem[], me: string, b: BridgeState): TeamBridgeItem[] {
  return items.filter((e) => e.from === me && e.result && e.result.summary && !b.teamLocal?.[e.id]?.replyAck);
}

// ---- auto review ----------------------------------------------------------------

export type Verdict = "ship" | "fix" | "wait";
export interface Review { summary: string; risks: string[]; verdict: Verdict; reason: string; ts: number; head?: string; session?: string }

export function parseReviews(raw: unknown): Record<string, Review> {
  const out: Record<string, Review> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, r] of Object.entries(raw as Record<string, Partial<Review>>)) {
    if (!r || typeof r.summary !== "string" || !["ship", "fix", "wait"].includes(r.verdict as string)) continue;
    out[id] = {
      summary: r.summary, verdict: r.verdict as Verdict, reason: typeof r.reason === "string" ? r.reason : "",
      risks: Array.isArray(r.risks) ? r.risks.filter((x): x is string => typeof x === "string").slice(0, 3) : [],
      ts: typeof r.ts === "number" ? r.ts : 0, head: r.head, session: r.session,
    };
  }
  return out;
}

/** Throttle: one review per session per REVIEW_EVERY_MS (Rust also skips an unchanged tree). */
export function reviewDue(lastRun: number | undefined, now: number): boolean {
  return lastRun === undefined || now - lastRun >= REVIEW_EVERY_MS;
}

export const VERDICT_LABEL: Record<Verdict, string> = { ship: "ready to ship", fix: "needs a fix", wait: "not done yet" };

// ---- phone approvals ------------------------------------------------------------

export type PhoneList = "handoffs" | "plans" | "questions" | "team";
export interface PhoneAction { action: "approve" | "dismiss"; list: PhoneList; id: string }

/** What a verified phone press does — the same thing as the button in Flow.
 *  null = the item is gone or no longer waiting (nothing to do). */
export type PhoneStep =
  | { do: "send"; id: string }
  | { do: "apply"; id: string }
  | { do: "answer"; id: string; text: string }
  | { do: "dismiss"; list: PhoneList; id: string };

export function phoneStep(a: PhoneAction, b: BridgeState, teamQuestions: TeamBridgeItem[]): PhoneStep | null {
  if (a.list === "handoffs") {
    const h = b.handoffs.find((x) => x.id === a.id);
    if (!h || h.status !== "pending") return null;
    return a.action === "approve" ? { do: "send", id: h.id } : { do: "dismiss", list: "handoffs", id: h.id };
  }
  if (a.list === "plans") {
    const p = b.plans.find((x) => x.id === a.id);
    if (!p || p.status !== "pending") return null;
    return a.action === "approve" ? { do: "apply", id: p.id } : { do: "dismiss", list: "plans", id: p.id };
  }
  if (a.list === "questions") {
    const q = b.questions.find((x) => x.id === a.id);
    if (!q || q.answered || q.dismissed) return null;
    if (a.action === "dismiss") return { do: "dismiss", list: "questions", id: q.id };
    return q.draft?.trim() ? { do: "answer", id: q.id, text: q.draft } : null;
  }
  const q = teamQuestions.find((x) => x.id === a.id);
  const local = b.teamLocal?.[a.id];
  if (!q || local?.dismissed) return null;
  if (a.action === "dismiss") return { do: "dismiss", list: "team", id: a.id };
  return local?.draft?.trim() ? { do: "answer", id: a.id, text: local.draft } : null;
}

/** Newly pending hand-offs and plans that deserve an approve-from-phone ping. */
export function approvalPings(prev: BridgeState, next: BridgeState): { list: PhoneList; id: string; title: string; body: string; label: string }[] {
  const seen = new Set([...prev.handoffs, ...prev.plans].map((x) => x.id));
  const one = (s: string, n: number) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  return [
    ...next.handoffs.filter((h) => h.status === "pending" && !seen.has(h.id)).map((h) => ({
      list: "handoffs" as const, id: h.id,
      title: h.kind === "answer" ? `Answer for ${h.sessionTitle || h.session}` : `Task for ${h.sessionTitle || h.session}`,
      body: one(h.message, 200), label: h.to ? "Send to teammate" : "Send",
    })),
    ...next.plans.filter((p) => p.status === "pending" && !seen.has(p.id)).map((p) => ({
      list: "plans" as const, id: p.id, title: `Plan: ${one(p.title, 60)}`,
      body: one(p.tasks.map((t) => t.title).join("; "), 200), label: "Add to board",
    })),
  ];
}
