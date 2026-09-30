import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drives the real grill-me MCP server over stdio (isolated HOME) and checks
// the tool list it advertises.
function rpc(lines: object[], seed?: (home: string) => void): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const home = mkdtempSync(join(tmpdir(), "grillme-mcp-"));
    seed?.(home);
    const child = spawn(process.execPath, ["src-tauri/src/grillme-mcp.mjs"], { env: { ...process.env, HOME: home } });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const msgs = out.split("\n").filter(Boolean);
      if (msgs.length >= lines.filter((l) => "id" in l).length) {
        child.kill();
        resolve(msgs.map((m) => JSON.parse(m)));
      }
    });
    child.on("error", reject);
    setTimeout(() => { child.kill(); reject(new Error(`timeout; got: ${out}`)); }, 5000);
    for (const l of lines) child.stdin.write(`${JSON.stringify(l)}\n`);
  });
}

describe("grill-me MCP server", () => {
  it("annotates every tool; reads are read-only, proposals are not", async () => {
    const [, list] = await rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    const tools = (list.result as { tools: { name: string; annotations: Record<string, unknown> }[] }).tools;
    expect(tools.length).toBeGreaterThan(10);
    for (const t of tools) {
      expect(t.annotations.title).toBeTruthy();
      expect(t.annotations.openWorldHint).toBe(false);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.whats_new.readOnlyHint).toBe(true);
    expect(byName.get_diff.readOnlyHint).toBe(true);
    expect(byName.send_to_coder.readOnlyHint).toBe(false);
    expect(byName.save_plan.readOnlyHint).toBe(false);
    expect(byName.notes.readOnlyHint).toBe(false);
  });

  it("catch_up shows a teammate's goal and notes from the synced team brain", async () => {
    const now = Date.now();
    const [, res] = await rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "catch_up", arguments: { hours: 1 } } },
    ], (home) => {
      mkdirSync(join(home, ".grillme"), { recursive: true });
      writeFileSync(join(home, ".grillme", "brain.json"), JSON.stringify([
        { id: "g-1", kind: "goal", ts: now, text: "Ship the demo by 5pm" },
        { id: "n-1", kind: "note", ts: now, text: "judges love live demos", by: "Maya" },
      ]));
    });
    const text = JSON.stringify(res.result);
    expect(text).toContain("Ship the demo by 5pm");
    expect(text).toContain("judges love live demos");
  });

  it("ship_status blocks a session whose last tests failed", async () => {
    const [, res] = await rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ship_status", arguments: {} } },
    ], (home) => {
      const repo = join(home, "app");
      mkdirSync(repo);
      const g = (...a: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a]);
      g("init", "-q", "-b", "main");
      writeFileSync(join(repo, "a.txt"), "1");
      g("add", "-A"); g("commit", "-qm", "init");
      g("checkout", "-qb", "feature");
      writeFileSync(join(repo, "a.txt"), "2");
      g("commit", "-qam", "work");
      mkdirSync(join(home, ".grillme"), { recursive: true });
      writeFileSync(join(home, ".grillme", "config.json"), JSON.stringify({ teammates: [{ id: "s1", repoPath: repo }] }));
      writeFileSync(join(home, ".grillme", "tests.json"), JSON.stringify({ [repo]: { ok: false, ms: 3000, cmd: "npm test", at: Date.now(), tail: "1 failing: login breaks" } }));
    });
    const text = JSON.stringify(res.result);
    expect(text).toContain("blocked: tests failing");
    expect(text).toContain("1 commit ahead of main");
    expect(text).toContain("login breaks");
  });
});
