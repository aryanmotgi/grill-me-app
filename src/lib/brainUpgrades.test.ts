import { describe, expect, it } from "vitest";
import { decisionWords, pendingProposals, similarDecision } from "./decisionSpot";
import { DRIFT_DISMISS_MS, DRIFT_EVERY_MS, driftDue, driftId, isDismissed, pairKey, parseDismissed, pruneDismissed } from "./drift";
import { groupResults, isWhyQuery, jumpFor, parseResults } from "./brainSearch";
import { EMPTY_BRIDGE, parseBridge } from "./bridge";

describe("decision similarity", () => {
  it("normalizes to content words", () => {
    expect(decisionWords("We'll use Postgres for the DB!")).toEqual(["postgre", "db"]); // plural-trimmed on both sides, so it still matches
    expect(decisionWords("JWT tokens, tokens")).toEqual(["jwt", "token"]);
  });
  it("matches the same decision in other words, not different ones", () => {
    expect(similarDecision("Use Postgres for the database", "We'll use postgres for the database.")).toBe(true);
    expect(similarDecision("Skip OAuth", "skip oauth for v1")).toBe(true);
    expect(similarDecision("Use Postgres", "Use Redis")).toBe(false);
    expect(similarDecision("Google login only", "Email login with magic links")).toBe(false);
    expect(similarDecision("", "x")).toBe(false);
  });
  it("lists pending proposals the log doesn't cover yet", () => {
    const b = parseBridge(JSON.stringify({
      ...EMPTY_BRIDGE,
      decisionProposals: [
        { id: "2", text: "Skip OAuth for v1", source: "Auth", quote: "", ts: 2, status: "pending" },
        { id: "1", text: "Use Postgres", source: "Chat: DB", quote: "", ts: 1, status: "pending" },
        { id: "3", text: "Dark mode first", source: "UI", quote: "", ts: 3, status: "dismissed" },
      ],
    }));
    expect(pendingProposals(b, []).map((p) => p.id)).toEqual(["1", "2"]);
    expect(pendingProposals(b, [{ text: "We'll skip OAuth for v1" }]).map((p) => p.id)).toEqual(["1"]);
    expect(pendingProposals(EMPTY_BRIDGE, [])).toEqual([]);
  });
});

describe("drift throttle + dismiss memory", () => {
  const now = 10_000_000;
  it("needs two recent finishes and 10 min since the last check", () => {
    expect(driftDue({ a: now - 60_000 }, now, undefined)).toBe(false);
    expect(driftDue({ a: now - 60_000, b: now - 31 * 60_000 }, now, undefined)).toBe(false);
    expect(driftDue({ a: now - 60_000, b: now - 29 * 60_000 }, now, undefined)).toBe(true);
    expect(driftDue({ a: now, b: now }, now, now - DRIFT_EVERY_MS + 1)).toBe(false);
    expect(driftDue({ a: now, b: now }, now, now - DRIFT_EVERY_MS)).toBe(true);
  });
  it("treats A⇄B and B⇄A as one pair and remembers rephrased reasons for 2h", () => {
    const c = { a: "Auth", b: "Login", why: "email login vs Google login", suggestion: "" };
    expect(pairKey(c)).toBe(pairKey({ a: "login", b: "auth" }));
    expect(driftId(c)).toBe(driftId({ ...c, a: "Login", b: "Auth" }));
    const dismissed = [{ pair: pairKey(c), why: c.why, ts: now - 1000 }];
    expect(isDismissed(c, dismissed, now)).toBe(true);
    expect(isDismissed({ ...c, a: "Login", b: "Auth", why: "Email login versus Google login" }, dismissed, now)).toBe(true);
    expect(isDismissed({ ...c, why: "both rewrite the router differently" }, dismissed, now)).toBe(false);
    expect(isDismissed(c, dismissed, now + DRIFT_DISMISS_MS)).toBe(false);
    expect(pruneDismissed(dismissed, now + DRIFT_DISMISS_MS)).toEqual([]);
    expect(parseDismissed([{ pair: "a", why: "b", ts: 1 }, { pair: 1 }, null, "x"])).toHaveLength(1);
    expect(parseDismissed("nope")).toEqual([]);
  });
});

describe("brain search helpers", () => {
  const raw = [
    { kind: "commit", title: "add login", snippet: "add login", ts: 1, source: "Auth", ref: "s1:abc123" },
    { kind: "decision", title: "Use Postgres", snippet: "Use Postgres", ts: 2, source: "me", ref: "d-1" },
    { kind: "turn", title: "build login", snippet: "…", ts: 3, source: "Auth", ref: "s1:4" },
    { kind: "bogus", title: "x" },
    { kind: "decision", title: "Skip OAuth", snippet: "", ts: 0, source: "", ref: "d-2" },
  ];
  it("keeps rank numbers and groups by kind", () => {
    const r = parseResults(raw);
    expect(r.map((x) => x.n)).toEqual([1, 2, 3, 4]);
    const g = groupResults(r);
    expect(g.map((x) => x.kind)).toEqual(["decision", "commit", "turn"]);
    expect(g[0].items.map((x) => x.n)).toEqual([2, 4]);
    expect(parseResults("nope")).toEqual([]);
  });
  it("detects why/what/when questions", () => {
    expect(isWhyQuery("Why did we pick Postgres?")).toBe(true);
    expect(isWhyQuery("  when was login added")).toBe(true);
    expect(isWhyQuery("whatever")).toBe(false);
    expect(isWhyQuery("postgres")).toBe(false);
  });
  it("jumps to the right place", () => {
    expect(jumpFor({ kind: "decision", ref: "d-1" })).toEqual({ to: "decisions" });
    expect(jumpFor({ kind: "commit", ref: "s1:abc" })).toEqual({ to: "session", id: "s1", tab: "changes" });
    expect(jumpFor({ kind: "turn", ref: "s1:4" })).toEqual({ to: "session", id: "s1", tab: "chat" });
    expect(jumpFor({ kind: "note", ref: "n-1" })).toBeNull();
    expect(jumpFor({ kind: "turn", ref: "" })).toBeNull();
  });
});
