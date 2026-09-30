import { describe, expect, it } from "vitest";
import { buildWires, digestChanged, digestSessions, sessionMarks, sessionSentence, teamSessionsByMember } from "./flow";
import type { BridgeState } from "./bridge";
import type { Teammate, TeamBridgeItem } from "../types";

const bridge: BridgeState = {
  handoffs: [
    { id: "h1", ts: 300, status: "pending", kind: "handoff", session: "s1", sessionTitle: "Rouge main", message: "Build the login page\nwith email only", userExplanation: "…" },
    { id: "h2", ts: 100, status: "sent", kind: "handoff", session: "s1", message: "old", userExplanation: "" },
    { id: "h3", ts: 250, status: "pending", kind: "answer", session: "s2", message: "Use Postgres.", userExplanation: "" },
  ],
  plans: [{ id: "p1", ts: 200, status: "pending", title: "MVP", decision: "email login", tasks: [{ title: "a" }, { title: "b" }] }],
  questions: [
    { id: "q1", ts: 50, answered: false, from: "s2", fromTitle: "API", question: "Postgres or SQLite?" },
    { id: "q2", ts: 60, answered: true, from: "s2", question: "done one" },
  ],
  notes: [],
};

describe("buildWires", () => {
  it("turns pending items into wires, oldest first, and skips resolved ones", () => {
    const wires = buildWires(bridge, (id) => `#${id}`);
    expect(wires.map((w) => w.id)).toEqual(["q1", "p1", "h3", "h1"]);
    const task = wires.find((w) => w.id === "h1")!;
    expect(task.kind).toBe("task");
    expect(task.to).toEqual({ kind: "session", id: "s1", title: "Rouge main" });
    expect(task.label).toBe("Build the login page with email only");
    expect(task.action).toBe("send");
    const q = wires.find((w) => w.id === "q1")!;
    expect(q.from).toEqual({ kind: "session", id: "s2", title: "API" });
    expect(q.to).toEqual({ kind: "brainstorm" });
    const plan = wires.find((w) => w.id === "p1")!;
    expect(plan.to).toEqual({ kind: "brain" });
    expect(plan.label).toBe("MVP · 2 tasks");
  });

  it("falls back to the session title lookup and clips long labels", () => {
    const long: BridgeState = { ...bridge, plans: [], questions: [], handoffs: [
      { id: "h", ts: 1, status: "pending", kind: "handoff", session: "s9", message: "x".repeat(200), userExplanation: "" },
    ] };
    const [w] = buildWires(long, (id) => (id === "s9" ? "Nine" : id));
    expect(w.to).toEqual({ kind: "session", id: "s9", title: "Nine" });
    expect(w.label.length).toBe(110);
    expect(w.label.endsWith("…")).toBe(true);
  });
});

describe("sessionMarks", () => {
  it("counts what waits to go in and what waits to come out", () => {
    const wires = buildWires(bridge, (id) => id);
    expect(sessionMarks(wires, "s1")).toEqual({ waiting: 1, asked: 0 });
    expect(sessionMarks(wires, "s2")).toEqual({ waiting: 1, asked: 1 });
    expect(sessionMarks(wires, "s3")).toEqual({ waiting: 0, asked: 0 });
  });
});

describe("sessionSentence", () => {
  const base = { health: "ok", status: "idle", currentFile: "—", lastActiveMin: 0 } as unknown as Teammate;
  it("ranks the states", () => {
    expect(sessionSentence({ ...base, health: "disconnected" } as Teammate)).toBe("worktree not connected");
    expect(sessionSentence({ ...base, status: "needs-input" } as Teammate)).toBe("needs a decision");
    expect(sessionSentence({ ...base, status: "working", currentFile: "src/app/login.tsx" } as Teammate)).toBe("working in login.tsx");
    expect(sessionSentence({ ...base, lastActiveMin: 7 } as Teammate)).toBe("quiet 7m");
    expect(sessionSentence(base)).toBe("idle");
  });
});

describe("team session digest", () => {
  const mk = (id: string, status: "idle" | "working" | "needs-input", branch = "main") =>
    ({ id, status, branch, health: "ok", currentFile: "—", lastActiveMin: 0 }) as unknown as Teammate;

  it("publishes title, status, branch and tests per session under the member's id", () => {
    const d = digestSessions({
      sessions: [mk("s1", "working", "feat/x"), mk("s2", "idle")],
      titleOf: (t) => `T-${t.id}`,
      testsOf: (id) => (id === "s1" ? false : null),
      member: "m2", memberName: "Maya", now: 1000,
    });
    expect(d.map((x) => x.id)).toEqual(["m2:s1", "m2:s2"]);
    expect(d[0]).toMatchObject({ member: "m2", memberName: "Maya", session: "s1", title: "T-s1", status: "working", branch: "feat/x", tests: false, ts: 1000 });
    expect(d[1].tests).toBeNull();
  });

  it("only counts as changed when something besides the timestamp moved", () => {
    const base = digestSessions({ sessions: [mk("s1", "idle")], titleOf: () => "A", testsOf: () => null, member: "m", memberName: "M", now: 1 });
    const later = digestSessions({ sessions: [mk("s1", "idle")], titleOf: () => "A", testsOf: () => null, member: "m", memberName: "M", now: 2 });
    const moved = digestSessions({ sessions: [mk("s1", "working")], titleOf: () => "A", testsOf: () => null, member: "m", memberName: "M", now: 2 });
    expect(digestChanged(base, later)).toBe(false);
    expect(digestChanged(base, moved)).toBe(true);
    expect(digestChanged(base, [])).toBe(true);
  });

  it("groups fresh sessions by member and drops stale ones", () => {
    const now = 100_000;
    const all = [
      ...digestSessions({ sessions: [mk("b", "idle"), mk("a", "idle")], titleOf: (t) => t.id, testsOf: () => null, member: "m1", memberName: "A", now }),
      ...digestSessions({ sessions: [mk("z", "idle")], titleOf: (t) => t.id, testsOf: () => null, member: "m2", memberName: "B", now: now - 120_000 }),
    ];
    const by = teamSessionsByMember(all, now);
    expect([...by.keys()]).toEqual(["m1"]);
    expect(by.get("m1")!.map((d) => d.title)).toEqual(["a", "b"]);
  });
});

describe("buildWires with teammates", () => {
  it("routes outbound hand-offs to the teammate, inbound ones from them, and lists their questions", () => {
    const b: BridgeState = {
      handoffs: [
        { id: "out", ts: 1, status: "pending", kind: "handoff", session: "api", sessionTitle: "API", message: "go", userExplanation: "", to: "m2", toName: "Maya" },
        { id: "in", ts: 2, status: "pending", kind: "handoff", session: "ui", sessionTitle: "UI", message: "please", userExplanation: "", from: "Maya" },
      ],
      plans: [], questions: [], notes: [],
    };
    const tq: TeamBridgeItem[] = [{ id: "tq", kind: "question", from: "m2", fromName: "Maya", to: null, session: "api", sessionTitle: "API", message: "Redis or memory?", ts: 3, status: "pending" }];
    const w = buildWires(b, (id) => id, tq);
    expect(w.map((x) => x.id)).toEqual(["out", "in", "tq"]);
    expect(w[0].to).toEqual({ kind: "teammate", member: "m2", name: "Maya", session: "api", sessionTitle: "API" });
    expect(w[1].from).toEqual({ kind: "teammate", member: "", name: "Maya" });
    expect(w[1].to).toEqual({ kind: "session", id: "ui", title: "UI" });
    expect(w[2]).toMatchObject({ list: "team", action: "answer", to: { kind: "brainstorm" } });
    expect(w[2].from).toMatchObject({ kind: "teammate", name: "Maya", sessionTitle: "API" });
  });
});
