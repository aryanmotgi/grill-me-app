import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drives the real grill-me MCP server over stdio (isolated HOME) and checks
// the tool list it advertises. The server is the app binary in --mcp mode:
// build it first (cargo build in src-tauri), or point GRILLME_MCP_CMD at
// another command line (whitespace-separated, e.g. "/path/grill-me --mcp").
const MCP_CMD = (process.env.GRILLME_MCP_CMD ?? "src-tauri/target/debug/grill-me --mcp").trim().split(/\s+/);

function rpc(lines: object[], seed?: (home: string) => void, env: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const home = mkdtempSync(join(tmpdir(), "grillme-mcp-"));
    seed?.(home);
    const child = spawn(MCP_CMD[0], MCP_CMD.slice(1), { env: { ...process.env, HOME: home, ...env } });
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
    expect(byName.team_chat.readOnlyHint).toBe(true);
    expect(byName.post_team_chat.readOnlyHint).toBe(false);
  });

  it("team_chat reads the last N messages oldest-first; team_status counts unread", async () => {
    const now = Date.now();
    const [, chat, all, status] = await rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "team_chat", arguments: { count: 2 } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "team_chat", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "team_status", arguments: {} } },
    ], (home) => {
      const g = join(home, ".grillme");
      mkdirSync(g, { recursive: true });
      writeFileSync(join(g, "settings.json"), JSON.stringify({ appMode: "team", teamChatMe: { id: "m1", name: "Aryan" }, teamChatRead: { default: now - 25_000 } }));
      writeFileSync(join(g, "room.json"), JSON.stringify({ members: [{ id: "m1", name: "Aryan" }, { id: "m2", name: "Maya" }] }));
      writeFileSync(join(g, "team-chat.json"), JSON.stringify([
        { id: "tc-3", from: "m2", fromName: "Maya", role: "user", text: "@claude is the API done?", ts: now - 10_000 },
        { id: "tc-1", from: "m1", fromName: "Aryan", role: "user", text: "kicking off auth", ts: now - 30_000 },
        { id: "tc-2", from: "m2", fromName: "", role: "system", text: "Maya joined the room", ts: now - 20_000 },
        { id: "tc-4", from: "m2", fromName: "Claude (via Maya)", role: "assistant", text: "Not yet — tests failing.", ts: now - 5_000, replyTo: "tc-3" },
      ]));
    });
    const text = (r: Record<string, unknown>) => (r.result as { content: { text: string }[] }).content[0].text;
    const two = text(chat).split("\n");
    expect(two).toHaveLength(2);
    expect(two[0]).toContain("[tc-3]");
    expect(two[0]).toContain("Maya: @claude is the API done?");
    expect(two[1]).toContain("Claude (via Maya) ↩tc-3: Not yet — tests failing.");
    const lines = text(all).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Aryan: kicking off auth");
    expect(lines[1]).toContain("·: Maya joined the room");
    expect(text(status)).toContain("Team chat: 4 messages, 3 unread — read it with team_chat.");
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

  // ---- brain upgrades: search, starter kits ------------------------------------

  /** A session with a commit, a decision, notes, goal history and a past lesson. */
  function seedBrain(home: string) {
    const { gm } = seedSession(home);
    const now = Date.now();
    writeFileSync(join(gm, "decisions.json"), JSON.stringify([{ id: "d-1", text: "Google login only — no email/password", author: "me", epochMs: now }]));
    writeFileSync(join(gm, "bridge.json"), JSON.stringify({
      goal: "Leaderboard for the chess club", goalTs: now, plans: [], handoffs: [],
      notes: [{ id: "n-1", ts: now, text: "Login must work on the demo laptop", by: "Maya" }],
      questions: [{ id: "q-1", ts: now, answered: true, from: "s1", question: "Which login provider?", answer: "Google, per the decision" }],
    }));
    writeFileSync(join(gm, "brain.json"), JSON.stringify([{ id: "g-0", kind: "goal", ts: now - 86_400_000, text: "Puzzle trainer (dropped)" }]));
    writeFileSync(join(gm, "lessons.json"), JSON.stringify([{ project: "old", name: "Spring hack", date: "1700000000", summary: "Auth ate half the time", stack: ["Next.js"] }]));
    writeFileSync(join(gm, "starter-kits.json"), JSON.stringify([{ project: "old", name: "Spring hack", stack: ["Next.js", "Supabase"], decisions: ["Magic links"], files: [{ path: "lib/auth.ts", purpose: "auth helper", repo: "/x" }], playbook: [] }]));
  }

  it("search_brain ranks decisions, notes, questions and commits; read-only", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
    const [, list, hit, phrase, none, goal, lessons] = await rpc([
      init,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_brain", arguments: { query: "Why did we pick Google login?" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_brain", arguments: { query: "\"demo laptop\"" } } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search_brain", arguments: { query: "kubernetes" } } },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search_brain", arguments: { query: "puzzle", limit: 3 } } },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "past_lessons", arguments: {} } },
    ], seedBrain);
    const tools = (list.result as { tools: { name: string; annotations: Record<string, unknown> }[] }).tools;
    expect(tools.find((t) => t.name === "search_brain")?.annotations.readOnlyHint).toBe(true);
    const text = (r: Record<string, unknown>) => (r.result as { content: { text: string }[] }).content[0].text;
    const h = text(hit);
    expect(h).toMatch(/^\d+ results? for "Why did we pick Google login\?":\n1\. \[decision\] Google login only/);
    expect(h).toContain("[question] Which login provider?");
    expect(text(phrase)).toContain("[note] Login must work on the demo laptop");
    expect(text(none)).toContain('Nothing in the brain matches "kubernetes"');
    expect(text(goal)).toContain("[goal] Puzzle trainer (dropped)");
    expect(text(lessons)).toContain("**Starter kits:**\n- **Spring hack** starter kit");
    expect(text(lessons)).toContain("reusable files: lib/auth.ts (auth helper)");
    expect(text(lessons)).not.toContain("/x"); // kit repo paths stay local
  });

  it("--search= returns ranked JSON (commits included) for the Brain page", () => {
    const home = mkdtempSync(join(tmpdir(), "grillme-search-"));
    seedBrain(home);
    const run = (...a: string[]) => execFileSync(MCP_CMD[0], [...MCP_CMD.slice(1), ...a], { env: { ...process.env, HOME: home } }).toString();
    const r = JSON.parse(run("--search=login", "--limit=10")) as { kind: string; title: string; ref: string }[];
    expect(r[0].kind).toBe("decision");
    const commit = r.find((x) => x.kind === "commit");
    expect(commit?.title).toBe("add login");
    expect(commit?.ref).toMatch(/^s1:[0-9a-f]+$/);
    // a query that looks like a flag is just text
    expect(JSON.parse(run("--search=--sync", "--limit=5"))).toEqual([]);
  });

  // ---- push updates (resources + notifications) and requested actions -------

  const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
  type Msg = Record<string, unknown> & { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> };

  /** A long-lived stdio connection: send lines, wait for matching messages. */
  function live(seed: (home: string) => void) {
    const home = mkdtempSync(join(tmpdir(), "grillme-live-"));
    seed(home);
    const child = spawn(MCP_CMD[0], MCP_CMD.slice(1), { env: { ...process.env, HOME: home } });
    const got: Msg[] = [];
    const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line) as Msg; // a torn or interleaved line would throw here
        got.push(m);
        for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
      }
    });
    const wait = (pred: (m: Msg) => boolean, ms: number, what: string) => new Promise<Msg>((resolve, reject) => {
      const hit = got.find(pred);
      if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error(`timed out waiting for ${what}; got ${JSON.stringify(got)}`)), ms);
      waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
    return {
      home, got,
      send: (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`),
      reply: (id: number) => wait((m) => m.id === id, 5000, `reply ${id}`),
      wait,
      close: () => child.kill(),
    };
  }

  it("lists resources and reads grillme://flow", async () => {
    const [init, list, templates, flow, missing] = await rpc([
      INIT,
      { jsonrpc: "2.0", id: 2, method: "resources/list" },
      { jsonrpc: "2.0", id: 3, method: "resources/templates/list" },
      { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "grillme://flow" } },
      { jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "grillme://session/ghost" } },
    ], (home) => {
      const { gm } = seedSession(home);
      writeFileSync(join(gm, "bridge.json"), JSON.stringify({ plans: [], notes: [], handoffs: [],
        questions: [{ id: "q-1", ts: 1, answered: false, from: "s1", fromTitle: "Auth", question: "Email or Google login?" }],
        actions: [{ id: "a-1", ts: 2, status: "pending", kind: "run_tests", session: "s1", sessionTitle: "Auth", args: {}, reason: "before the merge" }] }));
    });
    expect((init.result as { capabilities: Record<string, unknown> }).capabilities).toMatchObject({ resources: { subscribe: true, listChanged: true }, logging: {} });
    const uris = (list.result as { resources: { uri: string }[] }).resources.map((r) => r.uri);
    expect(uris).toEqual(["grillme://project/brain", "grillme://sessions", "grillme://flow", "grillme://session/s1"]);
    expect(JSON.stringify(templates.result)).toContain("grillme://session/{id}");
    const text = (flow.result as { contents: { uri: string; text: string }[] }).contents[0].text;
    expect(text).toContain("[q-1] from Auth: Email or Google login?");
    expect(text).toContain("[a-1] run tests in Auth — before the merge");
    expect((missing as { error: { code: number } }).error.code).toBe(-32002);
  });

  it("pushes notifications/resources/updated over stdio when bridge.json changes", async () => {
    const c = live((home) => { seedSession(home); });
    try {
      c.send(INIT);
      await c.reply(1);
      c.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      c.send({ jsonrpc: "2.0", id: 2, method: "resources/subscribe", params: { uri: "grillme://flow" } });
      expect((await c.reply(2)).result).toEqual({});
      await new Promise((r) => setTimeout(r, 300)); // the watcher's baseline poll runs at start
      writeFileSync(join(c.home, ".grillme", "bridge.json"), JSON.stringify({ handoffs: [], plans: [], notes: [], questions: [],
        actions: [{ id: "a-9", ts: Date.now(), status: "pending", kind: "open_preview", args: {}, reason: "" }] }));
      const n = await c.wait((m) => m.method === "notifications/resources/updated", 5000, "resources/updated");
      expect(n.params).toEqual({ uri: "grillme://flow" });
      // the server keeps answering requests in between (one writer, whole lines)
      c.send({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "grillme://flow" } });
      expect(JSON.stringify((await c.reply(3)).result)).toContain("open the preview");
      // only what we subscribed to
      expect(c.got.some((m) => m.method === "notifications/resources/updated" && m.params?.uri !== "grillme://flow")).toBe(false);
    } finally {
      c.close();
    }
  }, 15_000);

  /** A port nothing listens on (Grill Me "not running"). */
  async function closedPort(): Promise<number> {
    const s: Server = createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    const port = (s.address() as { port: number }).port;
    await new Promise<void>((r) => s.close(() => r()));
    return port;
  }

  it("run_tests without the app fails like every other write — nothing is queued", async () => {
    const port = await closedPort();
    let home = "";
    const [, tests, plan] = await rpc([
      INIT,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_tests", arguments: { session: "Auth", reason: "before merge" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "save_plan", arguments: { title: "x", tasks: [{ title: "y" }] } } },
    ], (h) => { home = h; seedSession(h); }, { GRILLME_API_PORT: String(port) });
    const r = tests.result as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Grill Me isn't running — open the Grill Me app, then try again.");
    expect(r.content[0].text).toBe((plan.result as { content: { text: string }[] }).content[0].text);
    expect(existsSync(join(home, ".grillme", "bridge.json"))).toBe(false);
  });

  it("run_tests sends a pending action to Grill Me and says it's waiting for your OK", async () => {
    // a stand-in for the app's loopback API that saves the push into bridge.json the way bridge::push does
    let home = "";
    const bodies: { kind: string; item: Record<string, unknown>; project: string }[] = [];
    const api = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const v = JSON.parse(body);
        bodies.push({ ...v, url: req.url, auth: req.headers.authorization });
        const entry = { id: "a-1", ts: Date.now(), status: "pending", ...v.item };
        writeFileSync(join(home, ".grillme", "bridge.json"), JSON.stringify({ handoffs: [], plans: [], questions: [], notes: [], actions: [entry] }));
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(entry));
      });
    });
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (api.address() as { port: number }).port;
      const [, ok, gated, news] = await rpc([
        INIT,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_tests", arguments: { session: "Auth", reason: "check before merge" } } },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "restart_session", arguments: { session: "Auth", reason: "stuck" } } },
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "whats_new", arguments: {} } },
      ], (h) => { home = h; seedSession(h); writeFileSync(join(h, ".grillme", "api-token"), "tok\n"); }, { GRILLME_API_PORT: String(port) });
      expect((ok.result as { content: { text: string }[] }).content[0].text).toContain("waiting for your OK in Grill Me");
      expect(bodies[0]).toEqual({
        url: "/bridge/push", auth: "Bearer tok", kind: "action", project: "default",
        item: { kind: "run_tests", reason: "check before merge", session: "s1", sessionTitle: "Auth", args: {} },
      });
      const saved = JSON.parse(readFileSync(join(home, ".grillme", "bridge.json"), "utf8"));
      expect(saved.actions[0]).toMatchObject({ kind: "run_tests", session: "s1", status: "pending" });
      // the grill gate stops a thin restart before anything is sent
      expect((gated.result as { isError?: boolean; content: { text: string }[] }).content[0].text).toContain("Grill gate");
      expect(bodies).toHaveLength(1);
      expect((news.result as { content: { text: string }[] }).content[0].text).toContain("- action: run tests in Auth — waiting for the user's OK");
    } finally {
      api.close();
    }
  });
});
