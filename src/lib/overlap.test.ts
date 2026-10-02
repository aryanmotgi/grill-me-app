import { describe, expect, it } from "vitest";
import { teamOverlaps } from "./overlap";
import type { TeamSession } from "../types";

const d = (over: Partial<TeamSession>): TeamSession => ({
  id: "x", member: "m2", memberName: "Maya", session: "me", title: "Login", status: "working",
  sentence: "", branch: "feat/login", tests: null, ts: 1, files: [], ...over,
});

describe("teamOverlaps", () => {
  it("finds files my sessions share with teammates' sessions", () => {
    const out = teamOverlaps(
      [{ title: "Auth API", files: ["src/auth.ts", "src/db.ts"] }],
      [d({ files: ["src/auth.ts"] }), d({ id: "y", memberName: "Sam", title: "Docs", files: ["README.md"] })],
      { machine: "mac-me" },
    );
    expect(out).toEqual([{ file: "src/auth.ts", mine: ["Auth API"], theirs: ["Maya's Login"] }]);
  });

  it("never flags my own sessions coming back through the room", () => {
    const mine = [{ title: "Auth API", files: ["src/auth.ts"] }];
    expect(teamOverlaps(mine, [d({ files: ["src/auth.ts"], machine: "mac-me" })], { machine: "mac-me" })).toEqual([]);
    expect(teamOverlaps(mine, [d({ files: ["src/auth.ts"], member: "m1" })], { member: "m1" })).toEqual([]);
  });

  it("merges several people on one file", () => {
    const out = teamOverlaps(
      [{ title: "A", files: ["f.ts"] }, { title: "B", files: ["f.ts"] }],
      [d({ files: ["f.ts"] }), d({ id: "y", memberName: "Sam", title: "API", files: ["f.ts"] })],
      {},
    );
    expect(out).toEqual([{ file: "f.ts", mine: ["A", "B"], theirs: ["Maya's Login", "Sam's API"] }]);
  });
});
