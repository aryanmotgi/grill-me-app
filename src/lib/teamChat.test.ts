import { describe, expect, it } from "vitest";
import {
  CHAT_CAP, CHAT_TEXT_CAP, cardText, chatTaskTitle, chatTime, claudeReplyMsg, claudeTranscript, isOnline, joinEventId,
  makeChatMsg, mentionsClaude, mentionsMe, needsClaudeReply, newChatId, normalizeChat, parseMentions, sessionCardMsg,
  systemMsg, unreadCount,
} from "./teamChat";
import type { TeamChatMsg, TeamChatSessionCard } from "../types";

const members = [
  { id: "m1", name: "Aryan" },
  { id: "m2", name: "Sam Lee" },
  { id: "m3", name: "maya" },
];

const msg = (over: Partial<TeamChatMsg>): TeamChatMsg => ({ id: "tc-x", from: "m1", fromName: "Aryan", role: "user", text: "hi", ts: 1, ...over });

describe("ids", () => {
  it("are tc-<time36>-<rand>", () => {
    expect(newChatId(1_700_000_000_000, 0)).toBe("tc-loyw3v28-0000");
    expect(newChatId(1_700_000_000_000, 0.999999)).toMatch(/^tc-loyw3v28-[0-9a-z]{4}$/);
    expect(newChatId()).not.toBe(newChatId());
  });
  it("join events are deterministic per room + member", () => {
    expect(joinEventId("K7M2P", "m2")).toBe("tc-join-K7M2P-m2");
  });
});

describe("mentions", () => {
  it("finds members by full name, first name or id, any case", () => {
    expect(parseMentions("@samlee can you look? cc @Maya and @m1", members)).toEqual(["m2", "m3", "m1"]);
    expect(parseMentions("@sam ping", members)).toEqual(["m2"]);
  });
  it("@claude, @all, no duplicates, unknowns ignored", () => {
    expect(parseMentions("@claude @all @claude @nobody", members)).toEqual(["claude", "m1", "m2", "m3"]);
  });
  it("ignores emails and trailing punctuation", () => {
    expect(parseMentions("mail sam@lee.dev", members)).toEqual([]);
    expect(parseMentions("thanks @maya.", members)).toEqual(["m3"]);
  });
  it("mentionsClaude needs the word on its own", () => {
    expect(mentionsClaude("@claude what's left?")).toBe(true);
    expect(mentionsClaude("hey @Claude, status")).toBe(true);
    expect(mentionsClaude("@claudette")).toBe(false);
    expect(mentionsClaude("me@claude.ai")).toBe(false);
    expect(mentionsClaude("no mention")).toBe(false);
  });
});

describe("building messages", () => {
  it("makeChatMsg trims, caps, parses mentions; empty → null", () => {
    const m = makeChatMsg({ from: "m1", fromName: "Aryan", text: "  @sam ship it  ", members, now: 5, rand: 0 })!;
    expect(m).toMatchObject({ from: "m1", fromName: "Aryan", role: "user", text: "@sam ship it", ts: 5, mentions: ["m2"] });
    expect(makeChatMsg({ from: "m1", fromName: "A", text: "   ", members, now: 5 })).toBeNull();
    expect(makeChatMsg({ from: "m1", fromName: "A", text: "x".repeat(CHAT_TEXT_CAP + 5), members, now: 5 })!.text).toHaveLength(CHAT_TEXT_CAP);
    expect("mentions" in makeChatMsg({ from: "m1", fromName: "A", text: "plain", members, now: 5 })!).toBe(false);
  });
  it("Claude replies are assistant messages via the asker", () => {
    expect(claudeReplyMsg({ me: "m2", meName: "Sam", text: " done ", replyTo: "tc-1", now: 9 })).toMatchObject({
      from: "m2", fromName: "Claude (via Sam)", role: "assistant", text: "done", replyTo: "tc-1",
    });
  });
  it("system lines keep a given id", () => {
    expect(systemMsg({ from: "m2", text: "Sam joined the room", now: 3, id: "tc-join-X-m2" })).toMatchObject({ id: "tc-join-X-m2", role: "system", fromName: "" });
  });
  it("session cards carry the digest only", () => {
    const card: TeamChatSessionCard = { kind: "session", member: "m1", memberName: "Aryan", session: "api", title: "API", status: "working", branch: "feat/api", tests: true, summary: "Login endpoint" };
    const m = sessionCardMsg({ me: "m1", meName: "Aryan", card, now: 4 });
    expect(m.role).toBe("system");
    expect(m.attach).toEqual(card);
    expect(cardText(card)).toBe("Aryan's “API” — working on feat/api · tests passing — Login endpoint");
    expect(cardText({ ...card, branch: "—", tests: null, summary: "" })).toBe("Aryan's “API” — working");
  });
  it("task titles come from the first line, without mentions", () => {
    expect(chatTaskTitle("\n  @sam add rate limiting to /login \nmore detail")).toBe("add rate limiting to /login");
    expect(chatTaskTitle("x".repeat(200))).toHaveLength(118);
  });
});

describe("normalizeChat", () => {
  it("drops junk, dedupes by id (last wins), sorts by time", () => {
    const out = normalizeChat([
      { id: "b", text: "two", ts: 2, role: "user", from: "m1" },
      null, { id: 3 }, { id: "c", text: "no ts" },
      { id: "a", text: "one", ts: 1, role: "weird" },
      { id: "b", text: "two (edited)", ts: 2, role: "user", from: "m1" },
      { id: "d", text: "card", ts: 3, role: "system", attach: { kind: "session", title: "API", status: "bogus" } },
    ]);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "d"]);
    expect(out[0].role).toBe("user");
    expect(out[1].text).toBe("two (edited)");
    expect(out[2].attach).toMatchObject({ title: "API", status: "idle", tests: null });
    expect(normalizeChat("nope")).toEqual([]);
  });
  it("keeps the newest CHAT_CAP", () => {
    const raw = Array.from({ length: CHAT_CAP + 20 }, (_, i) => ({ id: `m${i}`, text: "x", ts: i }));
    const out = normalizeChat(raw);
    expect(out).toHaveLength(CHAT_CAP);
    expect(out[0].id).toBe("m20");
  });
});

describe("unread + mentions", () => {
  const all = [
    msg({ id: "1", from: "m1", ts: 10 }),
    msg({ id: "2", from: "m2", ts: 20, mentions: ["m1"] }),
    msg({ id: "3", from: "m2", ts: 30, role: "system" }),
    msg({ id: "4", from: "m1", ts: 40, role: "assistant" }),
  ];
  it("counts others' messages after the read mark", () => {
    expect(unreadCount(all, "m1", 0)).toBe(2);
    expect(unreadCount(all, "m1", 25)).toBe(1);
    expect(unreadCount(all, "m1", 50)).toBe(0);
  });
  it("mentionsMe: someone else's message naming me", () => {
    expect(mentionsMe(all[1], "m1")).toBe(true);
    expect(mentionsMe(all[1], "m3")).toBe(false);
    expect(mentionsMe(msg({ from: "m1", mentions: ["m1"] }), "m1")).toBe(false);
    expect(mentionsMe(all[1], "")).toBe(false);
  });
});

describe("needsClaudeReply (dedupe: only the sender answers, once)", () => {
  const ask = msg({ id: "tc-ask", from: "m1", text: "@claude what's left?", mentions: ["claude"] });
  it("the sender's machine answers", () => {
    expect(needsClaudeReply(ask, [ask], "m1")).toBe(true);
  });
  it("teammates' machines never do", () => {
    expect(needsClaudeReply(ask, [ask], "m2")).toBe(false);
  });
  it("not twice", () => {
    const reply = msg({ id: "tc-r", role: "assistant", replyTo: "tc-ask" });
    expect(needsClaudeReply(ask, [ask, reply], "m1")).toBe(false);
  });
  it("only people's messages that mention @claude", () => {
    expect(needsClaudeReply(msg({ from: "m1", text: "no ping" }), [], "m1")).toBe(false);
    expect(needsClaudeReply(msg({ from: "m1", role: "assistant", text: "@claude" }), [], "m1")).toBe(false);
    expect(needsClaudeReply(msg({ from: "m1", text: "@claude hi" }), [], "m1")).toBe(true);
    expect(needsClaudeReply(ask, [ask], "")).toBe(false);
  });
});

describe("claudeTranscript", () => {
  it("is the last 30, names + text, cards flattened", () => {
    const many = Array.from({ length: 40 }, (_, i) => msg({ id: `${i}`, text: `t${i}`, ts: i }));
    const t = claudeTranscript(many);
    expect(t).toHaveLength(30);
    expect(t[0]).toEqual({ name: "Aryan", role: "user", text: "t10" });
    const card: TeamChatSessionCard = { kind: "session", member: "m1", memberName: "Aryan", session: "s", title: "API", status: "idle", branch: "", tests: null, summary: "" };
    expect(claudeTranscript([msg({ role: "system", text: "shared", attach: card })])[0]).toEqual({ name: "(system)", role: "system", text: "shared\n[shared session] Aryan's “API” — idle" });
  });
});

describe("display helpers", () => {
  it("presence and times", () => {
    expect(isOnline(1_000, 15_000)).toBe(true);
    expect(isOnline(1_000, 30_000)).toBe(false);
    expect(chatTime(100_000, 120_000)).toBe("now");
    expect(chatTime(0, 5 * 60_000)).toBe("5m");
  });
});
