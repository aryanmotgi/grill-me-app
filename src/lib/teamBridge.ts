// ---------------------------------------------------------------------------
// Team bridge: hand-offs, questions and answers between teammates' Grill Mes,
// carried by the room as team-bridge.json. Pure helpers; the feed in
// BridgePanel does the I/O. Human in the loop on BOTH ends: the sender
// approves sending, the receiver approves typing it into their session.
// ---------------------------------------------------------------------------

import type { BridgeHandoff, BridgeQuestion } from "./bridge";
import type { TeamBridgeItem } from "../types";

export const newTeamId = () => `tb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** An approved local hand-off addressed to a teammate → the room entry. */
export function toTeamHandoff(h: BridgeHandoff, me: string, meName: string, now: number): TeamBridgeItem {
  return {
    id: h.id,
    kind: h.kind,
    from: me,
    fromName: meName,
    to: h.to ?? null,
    toName: h.toName,
    session: h.session,
    sessionTitle: h.sessionTitle,
    message: h.message,
    ...(h.questionId ? { questionId: h.questionId } : {}),
    ...(h.userExplanation ? { userExplanation: h.userExplanation } : {}),
    ts: now,
    status: "pending",
  };
}

/** A hand-off the user writes on the Flow page for a teammate's session. */
export function newTeamHandoff(args: { me: string; meName: string; to: string; toName: string; session: string; sessionTitle: string; message: string; now: number }): TeamBridgeItem {
  return {
    id: newTeamId(), kind: "handoff", from: args.me, fromName: args.meName, to: args.to, toName: args.toName,
    session: args.session, sessionTitle: args.sessionTitle, message: args.message.trim(), ts: args.now, status: "pending",
  };
}

/** A local coder's question, mirrored so teammates' Claudes can answer it. */
export function questionMirror(q: BridgeQuestion, me: string, meName: string, sessionTitle: string): TeamBridgeItem {
  return {
    id: q.id, kind: "question", from: me, fromName: meName, to: null,
    session: q.from, sessionTitle, message: q.question, ...(q.context ? { context: q.context } : {}),
    ts: q.ts, status: q.answered ? "answered" : "pending",
  };
}

/** Items a teammate routed to one of MY sessions that still need my OK. */
export function inboundFor(items: TeamBridgeItem[], me: string): TeamBridgeItem[] {
  return items.filter((e) => e.to === me && e.status === "pending" && (e.kind === "handoff" || e.kind === "answer"));
}

/** Teammates' open questions (mine are already in the local bridge). */
export function teamQuestionsFor(items: TeamBridgeItem[], me: string): TeamBridgeItem[] {
  return items.filter((e) => e.kind === "question" && e.status === "pending" && e.from !== me);
}

/** Local questions whose room mirror is missing or out of date. */
export function questionMirrorsToPush(local: BridgeQuestion[], team: TeamBridgeItem[], me: string, meName: string, titleOf: (id: string) => string): TeamBridgeItem[] {
  const byId = new Map(team.map((e) => [e.id, e]));
  const out: TeamBridgeItem[] = [];
  for (const q of local) {
    const want = questionMirror(q, me, meName, q.fromTitle || titleOf(q.from));
    const have = byId.get(q.id);
    if (!have) {
      if (!q.answered && !q.dismissed) out.push(want); // never mirror already-closed history
    } else if (have.status === "pending" && (q.answered || q.dismissed)) {
      out.push({ ...have, status: q.dismissed && !q.answered ? "dismissed" : "answered" });
    }
  }
  return out;
}
