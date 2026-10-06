import { describe, it, expect } from "vitest";
import { applyPolicy, policyOf, shows, DEFAULT_POLICY } from "./share";
import type { TeamSession } from "../types";

const row = (over: Partial<TeamSession> = {}): TeamSession => ({
  id: "m1:s1", member: "m1", memberName: "Aryan", session: "s1",
  title: "Rewrite the relay", status: "working", sentence: "editing relay.rs",
  branch: "feat/relay", tests: true, files: ["src/relay.rs", "src/room.rs"], ...over,
} as TeamSession);

describe("what teammates are allowed to see", () => {
  it("publishes nothing at all on the strictest setting — not an empty shell", () => {
    // the point: there is no row to inspect, so you are simply not in the team
    expect(applyPolicy({ see: "nothing" }, [row()])).toEqual([]);
  });

  it("at 'status' says you're working and nothing else", () => {
    const [d] = applyPolicy({ see: "status" }, [row()]);
    expect(d.status).toBe("working");
    expect(d.title).toBe("Working");
    expect(d.sentence).toBe("");
    expect(d.branch).toBe("");
    expect(d.files).toEqual([]);
    expect(d.tests).toBeNull();
  });

  it("at 'work' shares the title and branch but still no file list", () => {
    const [d] = applyPolicy({ see: "work" }, [row()]);
    expect(d.title).toBe("Rewrite the relay");
    expect(d.branch).toBe("feat/relay");
    expect(d.files).toEqual([]);
  });

  it("at 'files' nothing is withheld — today's behaviour, unchanged", () => {
    const rows = [row()];
    expect(applyPolicy({ see: "files" }, rows)).toEqual(rows);
  });

  it("never publishes the file list below 'files'", () => {
    for (const see of ["nothing", "status", "work"] as const) {
      for (const d of applyPolicy({ see }, [row()])) {
        expect(d.files).toEqual([]);
      }
    }
  });

  it("at 'work' the summary can still name a file — the known limit, on purpose", () => {
    // "editing relay.rs" is the substance of what you're working on; dropping it
    // would leave 'work' saying almost nothing 'status' doesn't. Anyone who
    // wants no filename to leave the Mac picks 'status'.
    const [d] = applyPolicy({ see: "work" }, [row()]);
    expect(d.sentence).toContain("relay.rs");
    const [q] = applyPolicy({ see: "status" }, [row()]);
    expect(JSON.stringify(q)).not.toContain("relay.rs");
  });
});

describe("reading the setting back", () => {
  it("falls back to today's behaviour when unset or nonsense", () => {
    expect(policyOf(undefined)).toEqual(DEFAULT_POLICY);
    expect(policyOf({})).toEqual(DEFAULT_POLICY);
    expect(policyOf({ sharePolicy: { see: "everything" } })).toEqual(DEFAULT_POLICY);
  });

  it("keeps a valid half when the other half is junk", () => {
    expect(policyOf({ sharePolicy: { see: "status", control: "nope" } }))
      .toEqual({ see: "status" });
  });

  it("levels stack upward", () => {
    expect(shows({ see: "files" }, "work")).toBe(true);
    expect(shows({ see: "status" }, "work")).toBe(false);
  });
});
