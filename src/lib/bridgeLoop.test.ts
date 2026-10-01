import { describe, expect, it } from "vitest";
import {
  DRAFT_STALE_MS, approvalPings, draftStatus, parseReviews, phoneStep, questionsToDraft, repliesOwed, reviewDue,
  teamReplies, unreadReplies,
} from "./bridgeLoop";
import { buildWires, sessionMarks } from "./flow";
import { EMPTY_BRIDGE, parseBridge, type BridgeState } from "./bridge";
import type { TeamBridgeItem } from "../types";

const teamQ: TeamBridgeItem = { id: "tb-q", kind: "question", from: "m2", fromName: "Maya", to: null, session: "api", sessionTitle: "API", message: "Redis?", ts: 5, status: "pending" };

const b = (over: Partial<BridgeState>): BridgeState => ({ ...EMPTY_BRIDGE, ...over });

describe("live answers", () => {
  it("reads a question's draft state", () => {
    expect(draftStatus(undefined, 0)).toBe("none");
    expect(draftStatus({}, 0)).toBe("none");
    expect(draftStatus({ draftStarted: 100 }, 200)).toBe("drafting");
    expect(draftStatus({ draftStarted: 100 }, 100 + DRAFT_STALE_MS + 1)).toBe("failed");
    expect(draftStatus({ draftStarted: 100, draftError: "no claude" }, 200)).toBe("failed");
    expect(draftStatus({ draftStarted: 100, draft: "Use Postgres." }, 200)).toBe("ready");
  });

  it("drafts each open question once — local and teammates'", () => {
    const state = b({
      questions: [
        { id: "q1", ts: 1, answered: false, from: "s1", fromTitle: "UI", question: "Dark mode?" },
        { id: "q2", ts: 2, answered: false, from: "s1", question: "Started", draftStarted: 5 },
        { id: "q3", ts: 3, answered: true, from: "s1", question: "Done" },
        { id: "q4", ts: 4, answered: false, from: "s2", question: "Failed before", draftError: "x" },
      ],
      teamLocal: { "tb-old": { draft: "d" } },
    });
    const jobs = questionsToDraft(state, [teamQ, { ...teamQ, id: "tb-old" }], (id) => `#${id}`, new Set());
    expect(jobs).toEqual([
      { id: "q1", team: false, asker: "UI", question: "Dark mode?" },
      { id: "tb-q", team: true, asker: "Maya's API", question: "Redis?" },
    ]);
    // already kicked off this run (the file write lags the call)
    expect(questionsToDraft(state, [teamQ], String, new Set(["q1", "tb-q"]))).toEqual([]);
    // stale questions (asked before `since`) aren't drafted
    expect(questionsToDraft(state, [teamQ], String, new Set(), 100)).toEqual([]);
    // a teammate question dismissed here isn't drafted
    expect(questionsToDraft(b({ teamLocal: { "tb-q": { dismissed: true } } }), [teamQ], String, new Set())).toEqual([]);
  });

  it("shows the draft on the question wire, hides teammate questions dismissed here", () => {
    const state = b({ questions: [{ id: "q1", ts: 1, answered: false, from: "s1", question: "Dark mode?", draft: "No, light only.", draftTs: 2 }] });
    const [w] = buildWires(state, String, [], { now: 10 });
    expect(w.draft).toEqual({ status: "ready", text: "No, light only." });
    const team = buildWires(b({ teamLocal: { "tb-q": { draftStarted: 9 } } }), String, [teamQ], { now: 10 });
    expect(team[0].draft).toEqual({ status: "drafting", text: "" });
    expect(buildWires(b({ teamLocal: { "tb-q": { dismissed: true } } }), String, [teamQ])).toEqual([]);
  });

  it("parses teamLocal from bridge.json", () => {
    expect(parseBridge(JSON.stringify({ teamLocal: { x: { draft: "d" } } })).teamLocal).toEqual({ x: { draft: "d" } });
    expect(parseBridge(JSON.stringify({ teamLocal: [] })).teamLocal).toBeUndefined();
  });
});

describe("hand-off replies", () => {
  const sent = { ts: 1, status: "sent" as const, kind: "handoff" as const, session: "s1", message: "Add login", userExplanation: "" };
  it("knows which delivered hand-offs are owed a reply", () => {
    const state = b({
      handoffs: [
        { ...sent, id: "h1", deliveredAt: 10 },
        { ...sent, id: "h2" }, // never delivered
        { ...sent, id: "h3", deliveredAt: 10, result: { done: true, summary: "done" } },
        { ...sent, id: "h4", deliveredAt: 10, to: "m2" }, // a teammate's Mac reports it
        { ...sent, id: "h5", deliveredAt: 10, session: "s2" },
        { ...sent, id: "h6", deliveredAt: 10, status: "pending" },
      ],
    });
    expect(repliesOwed(state, "s1").map((h) => h.id)).toEqual(["h1"]);
  });

  it("draws unread replies as session → Claude wires, not as questions", () => {
    const state = b({
      handoffs: [
        { ...sent, id: "h1", sessionTitle: "Auth", result: { done: true, summary: "Login works; tests pass." }, resultTs: 50 },
        { ...sent, id: "h2", result: { done: false, summary: "seen" }, resultTs: 40, resultAck: true },
      ],
    });
    expect(unreadReplies(state).map((h) => h.id)).toEqual(["h1"]);
    const wires = buildWires(state, String);
    expect(wires).toHaveLength(1);
    expect(wires[0]).toMatchObject({ kind: "reply", action: "ack", list: "replies", done: true, label: "Login works; tests pass.", from: { kind: "session", id: "s1", title: "Auth" }, to: { kind: "brainstorm" } });
    expect(sessionMarks(wires, "s1")).toEqual({ waiting: 0, asked: 0 });
  });

  it("shows replies teammates' sessions sent back for my hand-offs", () => {
    const mine: TeamBridgeItem = { id: "tb-h", kind: "handoff", from: "me", fromName: "Aryan", to: "m2", toName: "Maya", session: "api", sessionTitle: "API", message: "Add caching", ts: 1, status: "sent", result: { done: true, summary: "Cached." }, resultTs: 9 };
    const theirs: TeamBridgeItem = { ...mine, id: "tb-x", from: "m3" };
    expect(teamReplies([mine, theirs], "me", EMPTY_BRIDGE).map((e) => e.id)).toEqual(["tb-h"]);
    expect(teamReplies([mine], "me", b({ teamLocal: { "tb-h": { replyAck: true } } }))).toEqual([]);
    const [w] = buildWires(EMPTY_BRIDGE, String, [], { me: "me", teamBridge: [mine] });
    expect(w).toMatchObject({ kind: "reply", list: "team-replies", from: { kind: "teammate", name: "Maya", sessionTitle: "API" } });
  });
});

describe("auto review", () => {
  it("keeps only well-formed reviews", () => {
    const r = parseReviews({
      s1: { summary: "Adds login.", risks: ["a", 3, "b", "c", "d"], verdict: "fix", reason: "tests fail", ts: 5, head: "abc" },
      s2: { summary: "x", verdict: "maybe" },
      s3: null,
    });
    expect(Object.keys(r)).toEqual(["s1"]);
    expect(r.s1.risks).toEqual(["a", "b", "c"]);
    expect(parseReviews([])).toEqual({});
  });
  it("throttles to one review per session every 3 minutes", () => {
    expect(reviewDue(undefined, 1000)).toBe(true);
    expect(reviewDue(0, 3 * 60_000)).toBe(true);
    expect(reviewDue(1000, 1000 + 60_000)).toBe(false);
  });
});

describe("phone approvals", () => {
  const state = b({
    handoffs: [{ id: "h1", ts: 1, status: "pending", kind: "handoff", session: "s1", sessionTitle: "Auth", message: "Add login", userExplanation: "x" }],
    plans: [{ id: "p1", ts: 2, status: "pending", title: "MVP", tasks: [{ title: "a" }, { title: "b" }] }],
    questions: [
      { id: "q1", ts: 3, answered: false, from: "s1", question: "?", draft: "Yes." },
      { id: "q2", ts: 3, answered: false, from: "s1", question: "?" },
    ],
    teamLocal: { "tb-q": { draft: "Use Redis." } },
  });

  it("maps a verified press to the same action as Flow", () => {
    expect(phoneStep({ action: "approve", list: "handoffs", id: "h1" }, state, [])).toEqual({ do: "send", id: "h1" });
    expect(phoneStep({ action: "dismiss", list: "handoffs", id: "h1" }, state, [])).toEqual({ do: "dismiss", list: "handoffs", id: "h1" });
    expect(phoneStep({ action: "approve", list: "plans", id: "p1" }, state, [])).toEqual({ do: "apply", id: "p1" });
    expect(phoneStep({ action: "approve", list: "questions", id: "q1" }, state, [])).toEqual({ do: "answer", id: "q1", text: "Yes." });
    expect(phoneStep({ action: "approve", list: "team", id: "tb-q" }, state, [teamQ])).toEqual({ do: "answer", id: "tb-q", text: "Use Redis." });
    expect(phoneStep({ action: "dismiss", list: "team", id: "tb-q" }, state, [teamQ])).toEqual({ do: "dismiss", list: "team", id: "tb-q" });
  });

  it("does nothing for items that are gone, handled, or have no draft", () => {
    expect(phoneStep({ action: "approve", list: "questions", id: "q2" }, state, [])).toBeNull();
    expect(phoneStep({ action: "approve", list: "handoffs", id: "nope" }, state, [])).toBeNull();
    const sent = b({ handoffs: [{ ...state.handoffs[0], status: "sent" }] });
    expect(phoneStep({ action: "approve", list: "handoffs", id: "h1" }, sent, [])).toBeNull();
    expect(phoneStep({ action: "approve", list: "team", id: "tb-q" }, state, [])).toBeNull(); // no longer open
  });

  it("pings only newly pending hand-offs and plans", () => {
    const pings = approvalPings(EMPTY_BRIDGE, state);
    expect(pings.map((p) => [p.list, p.id, p.title, p.label])).toEqual([
      ["handoffs", "h1", "Task for Auth", "Send"],
      ["plans", "p1", "Plan: MVP", "Add to board"],
    ]);
    expect(pings[1].body).toBe("a; b");
    expect(approvalPings(state, state)).toEqual([]);
  });
});
