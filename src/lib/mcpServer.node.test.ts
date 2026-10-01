import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drives the real grill-me MCP server over stdio (isolated HOME) and checks
// the tool list it advertises. The server is the app binary in --mcp mode:
// build it first (cargo build in src-tauri), or point GRILLME_MCP_CMD at
// another command line (whitespace-separated, e.g. "/path/grill-me --mcp").
const MCP_CMD = (process.env.GRILLME_MCP_CMD ?? "src-tauri/target/debug/grill-me --mcp").trim().split(/\s+/);

function rpc(lines: object[], seed?: (home: string) => void): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const home = mkdtempSync(join(tmpdir(), "grillme-mcp-"));
    seed?.(home);
    const child = spawn(MCP_CMD[0], MCP_CMD.slice(1), { env: { ...process.env, HOME: home } });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const msgs = out.split("\n").filter(Boolean);
      if (msgs.length >= lines.filter((l) => "id" in l).length) {
        child.kill();
        // async tools can answer out of order — hand back in request order
        resolve(msgs.map((m) => JSON.parse(m)).sort((a, b) => a.id - b.id));
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

  it("scopes a call to one project by name, and refuses unknown ones", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
    const [, scoped, unknown, list] = await rpc([
      init,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whats_new", arguments: { project: "rouge hack" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whats_new", arguments: { project: "nope" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_projects", arguments: {} } },
    ], (home) => {
      const g = join(home, ".grillme");
      mkdirSync(join(g, "projects", "rouge"), { recursive: true });
      mkdirSync(join(home, "a")); mkdirSync(join(home, "b"));
      writeFileSync(join(g, "projects.json"), JSON.stringify([{ id: "rouge", name: "Rouge Hack", path: join(home, "b") }]));
      writeFileSync(join(g, "config.json"), JSON.stringify({ teammates: [{ id: "alpha-session", repoPath: join(home, "a") }] }));
      writeFileSync(join(g, "projects", "rouge", "config.json"), JSON.stringify({ teammates: [{ id: "bravo-session", repoPath: join(home, "b") }] }));
    });
    const s = JSON.stringify(scoped.result);
    expect(s).toContain("bravo-session");
    expect(s).not.toContain("alpha-session");
    expect((unknown.result as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(unknown.result)).toContain("Rouge Hack");
    const l = JSON.stringify(list.result);
    expect(l).toContain("Rouge Hack (id: rouge)");
    expect(l).not.toContain(tmpdir()); // project paths never leave the Mac
  });

  it("team_status lists each teammate's shared sessions", async () => {
    const [, res] = await rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "team_status", arguments: {} } },
    ], (home) => {
      const g = join(home, ".grillme");
      mkdirSync(g, { recursive: true });
      writeFileSync(join(g, "settings.json"), JSON.stringify({ appMode: "team" }));
      writeFileSync(join(g, "room.json"), JSON.stringify({ members: [{ id: "m1", name: "Maya" }, { id: "m2", name: "Devon", presence: { status: "idle" } }] }));
      writeFileSync(join(g, "team-sessions.json"), JSON.stringify([
        { id: "m1:api", member: "m1", memberName: "Maya", session: "api", title: "API", status: "working", sentence: "working in api.ts", branch: "feat/api", tests: false, ts: Date.now() },
      ]));
    });
    const text = (res.result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("Maya: 1 session");
    expect(text).toContain('"API" working (working in api.ts) on feat/api · TESTS FAILING');
    expect(text).toContain("Devon: idle");
  });

  it("open_questions includes teammates' questions from the team bridge", async () => {
    const [, res] = await rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "open_questions", arguments: {} } },
    ], (home) => {
      const g = join(home, ".grillme");
      mkdirSync(g, { recursive: true });
      writeFileSync(join(g, "bridge.json"), JSON.stringify({ handoffs: [], plans: [], notes: [], questions: [
        { id: "q-local", ts: 1, answered: false, from: "ui", fromTitle: "UI", question: "Dark mode first?" },
      ] }));
      writeFileSync(join(g, "team-bridge.json"), JSON.stringify([
        { id: "q-local", kind: "question", from: "m1", fromName: "Aryan", to: null, session: "ui", sessionTitle: "UI", message: "Dark mode first?", ts: 1, status: "pending" },
        { id: "q-maya", kind: "question", from: "m2", fromName: "Maya", to: null, session: "api", sessionTitle: "API", message: "Redis or in-memory?", ts: 2, status: "pending" },
        { id: "q-old", kind: "question", from: "m2", fromName: "Maya", to: null, session: "api", message: "answered already", ts: 3, status: "answered" },
      ]));
    });
    const text = (res.result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("id q-local from UI: Dark mode first?");
    expect(text).toContain('id q-maya from Maya\'s "API" (teammate): Redis or in-memory?');
    expect(text).not.toContain("answered already");
    expect(text.match(/Dark mode first/g)?.length).toBe(1);
  });

  // ---- the bridge loop: reviews, hand-off replies, answer drafts -----------

  /** A one-commit feature branch worktree registered as session s1. */
  function seedSession(home: string) {
    const repo = join(home, "app");
    mkdirSync(repo);
    const g = (...a: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a]);
    g("init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "1");
    g("add", "-A"); g("commit", "-qm", "init");
    g("checkout", "-qb", "feature");
    writeFileSync(join(repo, "a.txt"), "2");
    g("commit", "-qam", "add login");
    const gm = join(home, ".grillme");
    mkdirSync(gm, { recursive: true });
    writeFileSync(join(gm, "config.json"), JSON.stringify({ teammates: [{ id: "s1", name: "Auth", repoPath: repo }] }));
    return { repo, gm };
  }

  it("whats_new and ship_status carry each session's latest review", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
    const [, news, ship] = await rpc([
      init,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whats_new", arguments: {} } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ship_status", arguments: {} } },
    ], (home) => {
      const { gm } = seedSession(home);
      writeFileSync(join(gm, "reviews.json"), JSON.stringify({ s1: { verdict: "fix", summary: "Adds login but skips the password check.", risks: ["anyone can log in"], reason: "bug", ts: Date.now() } }));
    });
    for (const r of [news, ship]) {
      const text = (r.result as { content: { text: string }[] }).content[0].text;
      expect(text).toContain("FIX — Adds login but skips the password check. Risks: anyone can log in.");
    }
  });

  it("catch_up and whats_new report replies to hand-offs once, as news", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
    const [, caught, news, again] = await rpc([
      init,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "catch_up", arguments: { hours: 1 } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whats_new", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "whats_new", arguments: {} } },
    ], (home) => {
      const { gm } = seedSession(home);
      writeFileSync(join(gm, "bridge.json"), JSON.stringify({ handoffs: [
        { id: "h1", ts: 1, status: "sent", kind: "handoff", session: "s1", sessionTitle: "Auth", message: "Add login", deliveredAt: 2,
          result: { done: true, summary: "Login page works; tests pass." }, resultTs: Date.now() },
      ], plans: [], questions: [], notes: [] }));
    });
    const text = (r: Record<string, unknown>) => (r.result as { content: { text: string }[] }).content[0].text;
    expect(text(caught)).toContain("**Replies to your hand-offs:**\n- **Auth** (done) on \"Add login\": Login page works; tests pass.");
    expect(text(news)).toContain("## Replies to your hand-offs");
    expect(text(again)).not.toContain("Replies to your hand-offs"); // its cursor moved
  });

  it("--answer-input / --review-input / --reply-input gather what Grill Me's checks need", () => {
    const home = mkdtempSync(join(tmpdir(), "grillme-cli-"));
    const { gm } = seedSession(home);
    writeFileSync(join(gm, "bridge.json"), JSON.stringify({
      goal: "Ship the demo", plans: [], notes: [],
      questions: [{ id: "q-1", ts: 1, answered: false, from: "s1", fromTitle: "Auth", question: "Email or Google login?" }],
      handoffs: [{ id: "h-1", ts: 1, status: "sent", kind: "handoff", session: "s1", message: "Add login", deliveredAt: 2 }],
    }));
    writeFileSync(join(gm, "tests.json"), JSON.stringify({ [join(home, "app")]: { ok: false, cmd: "npm test", tail: "1 failing", at: 1 } }));
    const run = (...a: string[]) => execFileSync(MCP_CMD[0], [...MCP_CMD.slice(1), ...a], { env: { ...process.env, HOME: home } }).toString();
    const ans = JSON.parse(run("--answer-input", "q-1"));
    expect(ans).toMatchObject({ session: "Auth", question: "Email or Google login?", goal: "Ship the demo" });
    expect(run("--answer-input", "nope")).toBe("");
    const rev = JSON.parse(run("--review-input", "s1"));
    expect(rev.commits).toContain("add login");
    expect(rev.diff).toContain("+2");
    expect(rev.tests).toMatchObject({ ok: false, cmd: "npm test" });
    // no transcript yet: the session hasn't taken a turn on the hand-off
    expect(run("--reply-input", "h-1")).toBe("");
  });
});
