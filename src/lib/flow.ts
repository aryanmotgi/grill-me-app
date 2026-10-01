// ---------------------------------------------------------------------------
// Flow view: who is talking to whom right now. Pure helpers — the bridge's
// pending items become "wires" between the brainstorm side (Claude app /
// claude.ai), the shared brain, and coder sessions. Every wire waits on one
// click from the user, so the view is the approval queue drawn as a map.
// ---------------------------------------------------------------------------

import type { BridgeState } from "./bridge";
import { draftStatus, teamReplies, unreadReplies, type DraftStatus } from "./bridgeLoop";
import type { Teammate, TeamBridgeItem, TeamSession } from "../types";

export type FlowEnd =
  | { kind: "brainstorm" }
  | { kind: "brain" }
  | { kind: "session"; id: string; title: string }
  | { kind: "teammate"; member: string; name: string; session?: string; sessionTitle?: string };

export interface Wire {
  id: string;
  /** what is moving along it */
  kind: "task" | "answer" | "plan" | "question" | "reply";
  from: FlowEnd;
  to: FlowEnd;
  label: string;
  ts: number;
  /** the click that lets it through ("ack" = a reply: just read it) */
  action: "send" | "apply" | "answer" | "ack";
  /** "team" = a teammate's question (lives in team-bridge.json; dismissing hides it on this Mac);
   *  "replies" / "team-replies" = a session's result report on a hand-off */
  list: "handoffs" | "plans" | "questions" | "team" | "replies" | "team-replies";
  /** questions: Claude's drafted answer */
  draft?: { status: DraftStatus; text: string };
  /** replies: did the session finish the task? */
  done?: boolean;
}

export interface WireOpts {
  now?: number;
  /** my room id — teammates' replies to hand-offs I routed */
  me?: string;
  teamBridge?: TeamBridgeItem[];
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** Pending bridge items as wires, oldest first (waited longest = top).
 *  `teamQuestions` = teammates' open questions (they end at Claude too). */
export function buildWires(b: BridgeState, titleOf: (id: string) => string, teamQuestions: TeamBridgeItem[] = [], opts: WireOpts = {}): Wire[] {
  const now = opts.now ?? Date.now();
  const wires: Wire[] = [];
  for (const h of b.handoffs) {
    if (h.status !== "pending") continue;
    const local: FlowEnd = { kind: "session", id: h.session, title: h.sessionTitle || titleOf(h.session) };
    wires.push({
      id: h.id,
      kind: h.kind === "answer" ? "answer" : "task",
      // inbound from a teammate: their name is the source; outbound to one: their session is the target
      from: h.from ? { kind: "teammate", member: "", name: h.from } : { kind: "brainstorm" },
      to: h.to ? { kind: "teammate", member: h.to, name: h.toName || h.to, session: h.session, sessionTitle: h.sessionTitle } : local,
      label: clip(h.message, 110),
      ts: h.ts,
      action: "send",
      list: "handoffs",
    });
  }
  for (const q of teamQuestions) {
    const local = b.teamLocal?.[q.id];
    if (local?.dismissed) continue;
    wires.push({
      id: q.id,
      kind: "question",
      from: { kind: "teammate", member: q.from, name: q.fromName, session: q.session, sessionTitle: q.sessionTitle },
      to: { kind: "brainstorm" },
      label: clip(q.message, 110),
      ts: q.ts,
      action: "answer",
      list: "team",
      draft: { status: draftStatus(local, now), text: local?.draft ?? "" },
    });
  }
  for (const p of b.plans) {
    if (p.status !== "pending") continue;
    wires.push({
      id: p.id,
      kind: "plan",
      from: { kind: "brainstorm" },
      to: { kind: "brain" },
      label: `${clip(p.title, 70)} · ${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"}`,
      ts: p.ts,
      action: "apply",
      list: "plans",
    });
  }
  for (const q of b.questions) {
    if (q.answered || q.dismissed) continue;
    wires.push({
      id: q.id,
      kind: "question",
      from: { kind: "session", id: q.from, title: q.fromTitle || titleOf(q.from) },
      to: { kind: "brainstorm" },
      label: clip(q.question, 110),
      ts: q.ts,
      action: "answer",
      list: "questions",
      draft: { status: draftStatus(q, now), text: q.draft ?? "" },
    });
  }
  // replies: a session reports back on a hand-off it was given
  for (const h of unreadReplies(b)) {
    wires.push({
      id: h.id,
      kind: "reply",
      from: { kind: "session", id: h.session, title: h.sessionTitle || titleOf(h.session) },
      to: h.from ? { kind: "teammate", member: "", name: h.from } : { kind: "brainstorm" },
      label: clip(h.result?.summary ?? "", 220),
      ts: h.resultTs ?? h.ts,
      action: "ack",
      list: "replies",
      done: !!h.result?.done,
    });
  }
  for (const e of teamReplies(opts.teamBridge ?? [], opts.me ?? "", b)) {
    wires.push({
      id: e.id,
      kind: "reply",
      from: { kind: "teammate", member: e.to ?? "", name: e.toName || e.to || "teammate", session: e.session, sessionTitle: e.sessionTitle },
      to: { kind: "brainstorm" },
      label: clip(e.result?.summary ?? "", 220),
      ts: e.resultTs ?? e.ts,
      action: "ack",
      list: "team-replies",
      done: !!e.result?.done,
    });
  }
  return wires.sort((a, b2) => a.ts - b2.ts);
}

/** Per-session badges: things waiting to go in, questions waiting to come out. */
export function sessionMarks(wires: Wire[], sessionId: string): { waiting: number; asked: number } {
  let waiting = 0;
  let asked = 0;
  for (const w of wires) {
    if (w.to.kind === "session" && w.to.id === sessionId) waiting++;
    if (w.kind === "question" && w.from.kind === "session" && w.from.id === sessionId) asked++;
  }
  return { waiting, asked };
}

/** One plain sentence for what a session is doing. */
export function sessionSentence(t: Teammate): string {
  if (t.health === "disconnected") return "worktree not connected";
  if (t.status === "needs-input") return "needs a decision";
  if (t.flag === "looping") return "looks stuck in a loop";
  if (t.flag === "stalled") return "stalled — no output for a while";
  if (t.status === "working")
    return t.currentFile !== "—" && t.currentFile
      ? `working in ${t.currentFile.split("/").pop()}`
      : "working";
  if (t.lastActiveMin > 0) return `quiet ${t.lastActiveMin}m`;
  return "idle";
}

// ---- teammates' sessions (team-sessions.json over the room) ---------------

/** What this Mac publishes about its sessions. Titles come from the caller
 *  (they live in settings); tests from the auto-test store. */
export function digestSessions(args: {
  sessions: Teammate[];
  titleOf: (t: Teammate) => string;
  testsOf: (id: string) => boolean | null;
  member: string;
  memberName: string;
  now: number;
}): TeamSession[] {
  return args.sessions.map((t) => ({
    id: `${args.member}:${t.id}`,
    member: args.member,
    memberName: args.memberName,
    session: t.id,
    title: args.titleOf(t),
    status: t.status,
    sentence: sessionSentence(t),
    branch: t.branch,
    tests: args.testsOf(t.id),
    ts: args.now,
  }));
}

/** True when anything but the timestamp moved — publish only then. */
export function digestChanged(prev: TeamSession[], next: TeamSession[]): boolean {
  const strip = (d: TeamSession) => JSON.stringify({ ...d, ts: 0 });
  if (prev.length !== next.length) return true;
  const a = prev.map(strip).sort();
  const b = next.map(strip).sort();
  return a.some((x, i) => x !== b[i]);
}

/** Fresh sessions grouped by room member; stale ones (a Mac that went quiet) drop out. */
export function teamSessionsByMember(all: TeamSession[], now: number, staleMs = 90_000): Map<string, TeamSession[]> {
  const out = new Map<string, TeamSession[]>();
  for (const d of all) {
    if (now - d.ts > staleMs) continue;
    const list = out.get(d.member) ?? [];
    list.push(d);
    out.set(d.member, list);
  }
  for (const list of out.values()) list.sort((x, y) => x.title.localeCompare(y.title));
  return out;
}
