import { describe, expect, it } from "vitest";
import { divergence } from "./BranchGraph";
import type { BranchOverview } from "../data/sources/git";

const base: BranchOverview = {
  ok: true,
  error: null,
  branch: "feat/x",
  onMain: false,
  ahead: 0,
  behind: 0,
  lastSubject: "wip",
  lastTs: 0,
  changedFiles: 0,
};

describe("divergence", () => {
  it("reports on-main branches as synced", () => {
    expect(divergence({ ...base, onMain: true, branch: "main" })).toEqual({ label: "on main", tone: "sync" });
  });

  it("flags branches with both ahead and behind as diverged", () => {
    expect(divergence({ ...base, ahead: 3, behind: 2 })).toEqual({ label: "diverged", tone: "diverged" });
  });

  it("labels ahead-only and behind-only branches", () => {
    expect(divergence({ ...base, ahead: 4 })).toEqual({ label: "ahead", tone: "ahead" });
    expect(divergence({ ...base, behind: 5 })).toEqual({ label: "behind", tone: "behind" });
  });

  it("treats a branch level with main as in sync", () => {
    expect(divergence({ ...base, ahead: 0, behind: 0 })).toEqual({ label: "in sync", tone: "sync" });
  });
});
