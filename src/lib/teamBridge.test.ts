import { describe, expect, it } from "vitest";
import { inboundFor, newTeamHandoff, questionMirrorsToPush, teamQuestionsFor, toTeamHandoff } from "./teamBridge";
import type { BridgeHandoff, BridgeQuestion } from "./bridge";
import type { TeamBridgeItem } from "../types";

const h: BridgeHandoff = { id: "h1", ts: 5, status: "pending", kind: "handoff", session: "api", sessionTitle: "API", message: "Add rate limits", userExplanation: "so the demo survives judges hammering it", to: "m2", toName: "Maya" };

describe("team bridge", () => {
  it("turns an approved outbound hand-off into a room entry", () => {
    const e = toTeamHandoff(h, "m1", "Aryan", 99);
    expect(e).toMatchObject({ id: "h1", kind: "handoff", from: "m1", fromName: "Aryan", to: "m2", toName: "Maya", session: "api", sessionTitle: "API", message: "Add rate limits", ts: 99, status: "pending" });
    expect(e.userExplanation).toBe("so the demo survives judges hammering it");
  });

  it("splits inbound work from teammates' questions", () => {
    const items: TeamBridgeItem[] = [
      { id: "a", kind: "handoff", from: "m2", fromName: "Maya", to: "m1", session: "ui", message: "x", ts: 1, status: "pending" },
      { id: "b", kind: "handoff", from: "m2", fromName: "Maya", to: "m3", session: "ui", message: "x", ts: 1, status: "pending" },
      { id: "c", kind: "answer", from: "m2", fromName: "Maya", to: "m1", session: "ui", message: "x", ts: 1, status: "sent" },
      { id: "q1", kind: "question", from: "m2", fromName: "Maya", to: null, session: "api", message: "Postgres?", ts: 1, status: "pending" },
      { id: "q2", kind: "question", from: "m1", fromName: "Aryan", to: null, session: "ui", message: "mine", ts: 1, status: "pending" },
      { id: "q3", kind: "question", from: "m2", fromName: "Maya", to: null, session: "api", message: "old", ts: 1, status: "answered" },
    ];
    expect(inboundFor(items, "m1").map((e) => e.id)).toEqual(["a"]);
    expect(teamQuestionsFor(items, "m1").map((e) => e.id)).toEqual(["q1"]);
  });

  it("mirrors open local questions once and closes them when answered", () => {
    const local: BridgeQuestion[] = [
      { id: "q1", ts: 1, answered: false, from: "api", question: "Which DB?" },
      { id: "q2", ts: 2, answered: true, from: "api", question: "done", answer: "pg" },
      { id: "q3", ts: 3, answered: true, from: "api", question: "never mirrored — already closed" },
    ];
    const team: TeamBridgeItem[] = [{ id: "q2", kind: "question", from: "m1", fromName: "Aryan", to: null, session: "api", message: "done", ts: 2, status: "pending" }];
    const push = questionMirrorsToPush(local, team, "m1", "Aryan", (id) => `#${id}`);
    expect(push.map((e) => [e.id, e.status])).toEqual([["q1", "pending"], ["q2", "answered"]]);
    expect(push[0].sessionTitle).toBe("#api");
    expect(questionMirrorsToPush(local, [...team, push[0], { ...team[0], status: "answered" }], "m1", "Aryan", () => "")).toEqual([]);
  });

  it("writes a fresh hand-off from the Flow page", () => {
    const e = newTeamHandoff({ me: "m1", meName: "Aryan", to: "m2", toName: "Maya", session: "api", sessionTitle: "API", message: "  ship it  ", now: 7 });
    expect(e.id.startsWith("tb-")).toBe(true);
    expect(e).toMatchObject({ kind: "handoff", to: "m2", session: "api", message: "ship it", status: "pending" });
  });
});
