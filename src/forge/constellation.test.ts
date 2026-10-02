import { describe, expect, it } from "vitest";
import builtinDoc from "../data/catalog.json";
import { parseCatalog } from "../lib/catalog";
import type { ScanResult } from "../lib/scan";
import { MAX_KIDS, constellationFromScan, stageIndexOf } from "./constellation";

const catalog = parseCatalog(builtinDoc)!;
const scan = (over: Partial<ScanResult>): ScanResult => ({ ts: 1, sources: [], checked: [], ...over });

describe("forge constellation", () => {
  it("groups each agent's tools, MCPs first, and caps them", () => {
    const s = scan({
      agents: { bins: ["claude", "codex", "ollama"], apps: [] },
      extensions: {
        mcp: [{ name: "linear", agent: "claude", scope: "user" }, { name: "ccsquad", agent: "claude", scope: "user" }, { name: "ccsquad", agent: "codex", scope: "user" }],
        plugins: Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, marketplace: "m", agent: "claude" })),
        skills: [],
      },
    });
    const { stars, links } = constellationFromScan(s);
    expect(stars.filter((x) => x.kind === "agent").map((x) => x.label)).toEqual(["Claude Code", "Codex"]);
    const claudeKids = stars.filter((x) => x.parent === "agent:claude");
    expect(claudeKids[0]).toMatchObject({ label: "linear", sub: "MCP" });
    expect(claudeKids.filter((x) => !x.id.startsWith("more:"))).toHaveLength(MAX_KIDS);
    expect(claudeKids[claudeKids.length - 1]?.label).toBe("+5 more");
    // ccsquad appears once, linked to Codex too
    expect(stars.filter((x) => x.label === "ccsquad")).toHaveLength(1);
    expect(links).toContainEqual(["tool:ccsquad", "agent:codex"]);
  });
  it("still has a centre when nothing was found", () => {
    expect(constellationFromScan(null).stars).toEqual([{ id: "agent:you", label: "Your AI", kind: "agent" }]);
  });
  it("finds the stage a tool belongs to", () => {
    expect(stageIndexOf("playwright", catalog)).toBe(2); // Test
    expect(stageIndexOf("linear", catalog)).toBe(0); // Plan
    expect(stageIndexOf("definitely-not-a-tool", catalog)).toBeNull();
  });
});
