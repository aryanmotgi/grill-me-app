// ---------------------------------------------------------------------------
// Flow view: who is talking to whom right now. Pure helpers — the bridge's
// pending items become "wires" between the brainstorm side (Claude app /
// claude.ai), the shared brain, and coder sessions. Every wire waits on one
// click from the user, so the view is the approval queue drawn as a map.
// ---------------------------------------------------------------------------

import { describeAction, type BridgeAction, type BridgeState, type DecisionProposal } from "./bridge";
import { draftStatus, teamReplies, unreadReplies, type DraftStatus } from "./bridgeLoop";
import type { DriftConflict } from "./drift";
import type { Teammate, TeamBridgeItem, TeamSession } from "../types";

export type FlowEnd =
  | { kind: "brainstorm" }
  | { kind: "brain" }
  | { kind: "session"; id: string; title: string }
  | { kind: "teammate"; member: string; name: string; session?: string; sessionTitle?: string }
  /** a session known only by its title (drift warnings, decision sources) */
  | { kind: "named"; title: string };

export interface Wire {
  id: string;
  /** what is moving along it */
  kind: "task" | "answer" | "plan" | "question" | "reply" | "decision" | "drift" | "action";
  from: FlowEnd;
  to: FlowEnd;
  label: string;
  ts: number;
  /** the click that lets it through ("ack" = a reply or an action's outcome: just
   *  read it; "save" = log a spotted decision; "dismiss" = a drift warning, nothing
   *  to approve; "run" = run an action Claude requested) */
  action: "send" | "apply" | "answer" | "ack" | "save" | "dismiss" | "run";
  /** "team" = a teammate's question (lives in team-bridge.json; dismissing hides it on this Mac);
   *  "replies" / "team-replies" = a session's result report on a hand-off */
  list: "handoffs" | "plans" | "questions" | "team" | "replies" | "team-replies" | "decisions" | "drift" | "actions";
  /** questions: Claude's drafted answer */
  draft?: { status: DraftStatus; text: string };
  /** replies: did the session finish the task? actions: did it work? */
  done?: boolean;
  /** decisions: the words that showed it was agreed; drift: what to do about it */
  detail?: string;
  /** actions: the request itself (status, reason, outcome) */
  request?: BridgeAction;
}

export interface WireOpts {
  now?: number;
  /** my room id — teammates' replies to hand-offs I routed */
  me?: string;
  teamBridge?: TeamBridgeItem[];
  /** pending "Decision?" proposals (already filtered against the log) */
  proposals?: DecisionProposal[];
  /** live drift warnings, minus dismissed ones */
  drift?: (DriftConflict & { id: string; ts: number })[];
  /** session id → title, to put a decision's source on its session */
  sessions?: { id: string; title: string }[];
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
  for (const p of opts.proposals ?? []) {
    const local = opts.sessions?.find((s) => s.title === p.source);
    wires.push({
      id: p.id,
      kind: "decision",
      from: p.source.startsWith("Chat:") ? { kind: "brainstorm" } : local ? { kind: "session", id: local.id, title: local.title } : { kind: "named", title: p.source },
      to: { kind: "brain" },
      label: clip(p.text, 200),
      ts: p.ts,
      action: "save",
      list: "decisions",
      ...(p.quote ? { detail: clip(p.quote, 200) } : {}),
    });
  }
  for (const d of opts.drift ?? []) {
    wires.push({
      id: d.id,
      kind: "drift",
      from: { kind: "named", title: d.a },
      to: { kind: "named", title: d.b },
      label: clip(d.why, 220),
      ts: d.ts,
      action: "dismiss",
      list: "drift",
      ...(d.suggestion ? { detail: clip(d.suggestion, 220) } : {}),
    });
  }
  // actions Claude asked to run: pending/running ones wait on Run; finished
  // ones stay until the user has read the outcome
  for (const a of b.actions ?? []) {
    const finished = a.status === "done" || a.status === "failed";
    if (!(a.status === "pending" || a.status === "running" || (finished && !a.outcomeAck))) continue;
    wires.push({
      id: a.id,
      kind: "action",
      from: { kind: "brainstorm" },
      to: actionTarget(a, titleOf),
      label: finished ? clip(a.outcome?.summary ?? "", 220) : clip(describeAction(a, titleOf), 110),
      ts: finished ? a.outcomeTs ?? a.ts : a.ts,
      action: finished ? "ack" : "run",
      list: "actions",
      done: finished ? a.status === "done" && a.outcome?.ok !== false : undefined,
      request: a,
    });
  }
  return wires.sort((a, b2) => a.ts - b2.ts);
}

/** Where an action lands: its session, or a stand-in for preview / a new session. */
function actionTarget(a: BridgeAction, titleOf: (id: string) => string): FlowEnd {
  if (a.kind === "create_session") return { kind: "named", title: `new session · ${a.args?.branch ?? "?"}` };
  if (a.session) return { kind: "session", id: a.session, title: a.sessionTitle || titleOf(a.session) };
  return { kind: "named", title: "Preview" };
}

/** The Run button's words and the warning shown next to it. */
export function actionCopy(a: BridgeAction, titleOf: (id: string) => string = (x) => x): { run: string; note: string } {
  const who = a.sessionTitle || (a.session ? titleOf(a.session) : "the session");
  switch (a.kind) {
    case "run_tests": return { run: "Run tests", note: `Runs your test command in ${who}'s worktree.` };
    case "restart_session": return { run: "Restart", note: `Restarting kills ${who}'s terminal — the turn it's on right now is lost.` };
    case "open_preview": return { run: "Open preview", note: "Uses a running dev server, or starts the dev script in a shell tab." };
    case "create_session": return { run: "Create session", note: `New worktree on ${a.args?.branch ?? "?"}; the task is typed in as its first message.` };
    default: return { run: "Run", note: "" };
  }
}

/** Per-session badges: things waiting to go in, questions waiting to come out. */
export function sessionMarks(wires: Wire[], sessionId: string): { waiting: number; asked: number } {
  let waiting = 0;
  let asked = 0;
  for (const w of wires) {
    if (w.to.kind === "session" && w.to.id === sessionId && w.action !== "ack") waiting++;
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
/** Enough to spot overlap without shipping a whole repo listing. */
export const DIGEST_FILES_MAX = 20;

export function digestSessions(args: {
  sessions: Teammate[];
  titleOf: (t: Teammate) => string;
  testsOf: (id: string) => boolean | null;
  member: string;
  memberName: string;
  machine?: string;
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
    files: (t.changes ?? []).map((c) => c.file).slice(0, DIGEST_FILES_MAX),
    ...(args.machine ? { machine: args.machine } : {}),
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
