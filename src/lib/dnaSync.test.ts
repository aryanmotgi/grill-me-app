import { describe, expect, it } from "vitest";
import { addItem, emptyDNA, fromProfile, setRule } from "./dna";
import { END, START, agentsOf, blockFor, changeOf, currentBlock, strip, targetsFor, withBlock } from "./dnaSync";

const NOW = 1_790_000_000_000;
function dna() {
  let d = fromProfile(emptyDNA(NOW), { team: "solo", level: "senior", style: "plan-first", pains: [], agents: ["claude", "codex"], source: "interview", updated: 1 }, NOW);
  d = addItem(d, "rules", "Never push directly to main.");
  d = addItem(d, "rules", "Use pnpm, not npm.", { scope: "project", project: "shop" });
  d = addItem(d, "rules", "Run the tests after every change.");
  d = { ...d, toolkit: [{ id: "claude-code", name: "Claude Code", kind: "agent", source: "scan", firstSeen: NOW, lastSeen: NOW }, { id: "codex-cli", name: "Codex", kind: "agent", source: "scan", firstSeen: NOW, lastSeen: NOW }] };
  return d;
}

describe("DNA Sync", () => {
  it("offers the files each of your AIs reads", () => {
    const d = dna();
    const ts = targetsFor("/Users/me", [{ name: "shop", path: "/Users/me/code/shop" }], agentsOf(d));
    expect(ts.map((t) => t.label)).toEqual(["~/.claude/CLAUDE.md", "~/.codex/AGENTS.md", "shop/AGENTS.md", "shop/CLAUDE.md"]);
  });

  it("puts personal rules and how you work in personal files, project rules in the project", () => {
    const d = dna();
    const [claude, , agents] = targetsFor("/Users/me", [{ name: "shop", path: "/s" }], agentsOf(d));
    const personal = blockFor(d, claude, "");
    expect(personal).toContain("How I work: Works solo; Experienced developer; I plan first, then let it code.");
    expect(personal).toContain("- Never push directly to main.");
    expect(personal).not.toContain("pnpm");
    expect(blockFor(d, agents, "")).toBe("## Project rules (from my Coding DNA)\n- Use pnpm, not npm.");
  });

  it("never repeats a rule you already wrote in that file, and skips proposed rules", () => {
    let d = dna();
    d = { ...d, rules: [...d.rules, { id: "p", text: "Reproduce bugs first.", source: "sessions", at: NOW, scope: "personal", status: "proposed" }] };
    const [claude] = targetsFor("/h", [], agentsOf(d));
    const mine = "# Mine\n- never push DIRECTLY to main!\n";
    const block = blockFor(d, claude, mine);
    expect(block).not.toContain("Never push");
    expect(block).toContain("Run the tests");
    expect(block).not.toContain("Reproduce");
    expect(blockFor(setRule(d, "p", { status: "active" }), claude, mine)).toContain("Reproduce bugs first.");
  });

  it("adds the block at the end, replaces it in place, removes it, and never touches yours", () => {
    const mine = "# Mine\n- my rule\n";
    const a = withBlock(mine, "## My Coding DNA\n- one");
    expect(a).toBe(`# Mine\n- my rule\n\n${START}\n## My Coding DNA\n- one\n${END}\n`);
    expect(strip(a)).toBe(mine);
    const withAfter = `${a}# More of mine\n`;
    const b = withBlock(withAfter, "## My Coding DNA\n- two");
    expect(currentBlock(b)).toBe("## My Coding DNA\n- two");
    expect(strip(b)).toBe(`${mine}# More of mine\n`);
    expect(withBlock(b, "")).toBe(`${mine}# More of mine\n`);
    expect(withBlock("", "x")).toBe(`${START}\nx\n${END}\n`);
    expect(strip(withBlock("no newline", "x")).trimEnd()).toBe("no newline");
  });

  it("writes a Cursor rule file only when it's new or ours", () => {
    const ours = withBlock("", "- rule", true);
    expect(ours).toContain("alwaysApply: true");
    expect(withBlock(ours, "- rule 2", true)).toContain("- rule 2");
    expect(withBlock("someone else's rules", "- rule", true)).toBe("someone else's rules");
    const t = { path: "/r/.cursor/rules/coding-dna.mdc", label: "", scope: "project" as const, reads: "", whole: true };
    expect(changeOf(t, "someone else's rules", true, "someone else's rules")).toBe("blocked");
  });

  it("describes each change", () => {
    const t = { path: "/x", label: "", scope: "personal" as const, reads: "" };
    expect(changeOf(t, "", false, withBlock("", "a"))).toBe("new");
    const f = withBlock("mine\n", "a");
    expect(changeOf(t, f, true, withBlock(f, "b"))).toBe("update");
    expect(changeOf(t, f, true, withBlock(f, "a"))).toBe("same");
    expect(changeOf(t, f, true, withBlock(f, ""))).toBe("remove");
  });
});
