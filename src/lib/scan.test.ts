import { describe, expect, it } from "vitest";
import { SCAN_SOURCES, scanSummary, type ScanResult } from "./scan";

describe("scan sources", () => {
  it("terminal history and packages are off by default", () => {
    const off = SCAN_SOURCES.filter((s) => !s.defaultOn).map((s) => s.id);
    expect(off).toEqual(["packages", "history"]);
  });
});

describe("scanSummary", () => {
  it("turns a scan into plain lines", () => {
    const s: ScanResult = {
      ts: 1, sources: ["agents", "extensions", "git", "history"], checked: [],
      agents: { bins: ["claude", "codex", "agent", "cursor-agent"], apps: ["Obsidian.app"] },
      extensions: { mcp: [{ name: "linear", agent: "claude", scope: "user" }, { name: "linear", agent: "codex", scope: "user" }], plugins: [], skills: [{ name: "a", description: "", agent: "claude" }] },
      git: { commits30d: 40, usesPullRequests: true, branchPrefixes: ["feat", "fix"] },
      history: [{ cmd: "bun", count: 9 }],
    };
    expect(scanSummary(s)).toEqual([
      { label: "AI coding tools", value: "Claude Code, Codex, Cursor" },
      { label: "Apps", value: "Obsidian" },
      { label: "MCP servers", value: "linear" },
      { label: "Skills", value: "1 installed" },
      { label: "Git", value: "40 commits in 30 days · uses pull requests · branches like feat/…, fix/…" },
      { label: "You run most", value: "bun" },
    ]);
  });
  it("shortens long lists", () => {
    const s: ScanResult = { ts: 1, sources: ["agents"], checked: [], agents: { bins: [], apps: ["A.app", "B.app", "C.app", "D.app", "E.app", "F.app"] } };
    expect(scanSummary(s)[0].value).toBe("A, B, C, D +2 more");
  });
});
