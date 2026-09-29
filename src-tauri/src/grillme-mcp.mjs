#!/usr/bin/env node
// ---------------------------------------------------------------------------
// grill-me MCP bridge — connects the Claude app (brainstorm partner) and
// Claude Code sessions (the coders) through Grill Me.
//
// Zero dependencies: speaks MCP (JSON-RPC 2.0, newline-delimited) over stdio.
// READS come straight from disk (Grill Me's project files, Claude Code
// transcripts, git). WRITES (handoffs, plans, questions, notes) go through
// Grill Me's loopback API, so nothing reaches a session or the task board
// until you approve it in Grill Me. Installed by Grill Me to
// ~/.grillme/bin/grillme-mcp.mjs — edit the source in src-tauri/src/.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, renameSync, lstatSync, realpathSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, basename, resolve } from "node:path";
import { createInterface } from "node:readline";

const HOME = homedir();
const ROOT = join(HOME, ".grillme");
const API = "http://127.0.0.1:4517";
const SERVER = { name: "grill-me", version: "1.0.0" };
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// ---- file helpers ----------------------------------------------------------

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function projectDir() {
  // hooks + Grill Me pass the project explicitly (a session belongs to its
  // project no matter which one is open in the app)
  const forced = process.env.GRILLME_PROJECT_DIR;
  if (forced && existsSync(forced)) {
    return { id: forced === ROOT ? "default" : basename(forced), dir: forced };
  }
  const settings = readJson(join(ROOT, "settings.json"), {});
  const id = typeof settings.activeProject === "string" ? settings.activeProject : "";
  if (id && id !== "default" && /^[a-z0-9-]+$/.test(id) && existsSync(join(ROOT, "projects", id))) {
    return { id, dir: join(ROOT, "projects", id) };
  }
  return { id: "default", dir: ROOT };
}

function members() {
  const { dir } = projectDir();
  const cfg = readJson(join(dir, "config.json"), readJson(join(ROOT, "config.json"), {}));
  return Array.isArray(cfg.teammates) ? cfg.teammates : [];
}

function titles() {
  const { dir } = projectDir();
  const a = readJson(join(dir, "settings.json"), {}).sessionTitles ?? {};
  const b = readJson(join(ROOT, "settings.json"), {}).sessionTitles ?? {};
  return { ...b, ...a };
}

/** Which session is calling? A Claude Code session runs inside its worktree. */
function selfMember() {
  const cwd = resolve(process.cwd());
  return members()
    .filter((m) => m.repoPath && (cwd === resolve(m.repoPath) || cwd.startsWith(resolve(m.repoPath) + "/")))
    .sort((a, b) => b.repoPath.length - a.repoPath.length)[0];
}

function findSession(key) {
  const all = members();
  if (!key) {
    const self = selfMember();
    return self ?? all[0];
  }
  const k = String(key).toLowerCase();
  const t = titles();
  return all.find((m) => m.id.toLowerCase() === k)
    ?? all.find((m) => (t[m.id] ?? "").toLowerCase() === k)
    ?? all.find((m) => m.name.toLowerCase() === k)
    ?? all.find((m) => (t[m.id] ?? m.name).toLowerCase().includes(k));
}

function label(m) {
  return titles()[m.id] || m.name || m.id;
}

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
}

function baseBranch(repo) {
  for (const b of ["main", "master"]) if (git(repo, ["rev-parse", "--verify", "--quiet", b])) return b;
  return "";
}

// Files Grill Me itself installs into every worktree (hooks, /ship,
// delegation playbook) — never count them as the session's work.
const MANAGED = [".claude/", "CLAUDE.md", "DELEGATION.md"];
const isManaged = (f) => MANAGED.some((m) => f === m || f.startsWith(m));

// Secret-bearing files never leave the Mac in a diff, stat, or new-file
// preview. Diffs are built only from files whose names pass this test.
const SECRET_FILE = /(^|\/)(\.env[^/]*|\.dev\.vars|[^/]*\.(pem|key|p12|pfx|keystore|jks|tfvars|tfstate)|id_[a-z0-9]+[^/]*|\.(npmrc|pypirc|netrc|git-credentials|htpasswd)|credentials[^/]*|[^/]*service[-_]?account[^/]*\.json|secrets?\.[^/]*|[^/]*\.secret[^/]*)$/i;
const safeName = (f) => !!f && !SECRET_FILE.test(f);

/** New files the session created that git doesn't track yet. */
function untracked(repo) {
  return git(repo, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter((f) => f && !isManaged(f) && !SECRET_FILE.test(f));
}

/** Changed + new files, minus Grill Me's own. */
function changedFiles(repo) {
  return git(repo, ["status", "--porcelain"]).split("\n").filter(Boolean)
    .filter((l) => !(l.startsWith("??") && isManaged(l.slice(3).trim())));
}

/** Small text contents of new files, so reviews and quizzes see them too.
 *  Symlinks are skipped (a link to ~/.grillme/… must not print its target)
 *  and anything resolving outside the repo or to a secret-named file too. */
function newFileText(repo, files) {
  const root = realpathSync(repo);
  return files.slice(0, 10).map((f) => {
    try {
      const full = join(repo, f);
      if (lstatSync(full).isSymbolicLink()) return `+++ new file ${f} (symlink, not shown)`;
      const real = realpathSync(full);
      if (!real.startsWith(`${root}/`) || !safeName(real)) return "";
      const buf = readFileSync(real);
      if (buf.length > 4000 || buf.includes(0)) return `+++ new file ${f} (${buf.length} bytes, not shown)`;
      return `+++ new file ${f}\n${buf.toString("utf8")}`;
    } catch { return ""; }
  }).filter(Boolean).join("\n");
}

/** Branch, commits beyond the base branch, file summary, and full diff
 *  (including brand-new files). */
function diffOf(m) {
  const repo = m.repoPath;
  const base = baseBranch(repo);
  const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const range = base && base !== branch ? `${base}...HEAD` : "";
  const fresh = untracked(repo);
  // list changed files first, drop secret-named ones, then diff only the rest
  const names = (args) => git(repo, ["diff", "--name-only", ...args]).split("\n").filter(safeName).slice(0, 200);
  const part = (args, mode) => {
    const files = names(args);
    return files.length ? git(repo, ["diff", ...mode, ...args, "--", ...files]) : "";
  };
  return {
    base, branch,
    log: range ? git(repo, ["log", "--oneline", "-20", `${base}..HEAD`]) : git(repo, ["log", "--oneline", "-20"]),
    stat: R([
      range && part([range], ["--stat"]),
      part(["HEAD"], ["--stat"]),
      fresh.length ? `new files: ${fresh.join(", ")}` : "",
    ].filter(Boolean).join("\n")),
    diff: R([
      range && part([range], []),
      part(["HEAD"], []),
      newFileText(repo, fresh),
    ].filter(Boolean).join("\n")),
  };
}

// ---- past hackathons (lessons carried across projects) ------------------------

const LESSONS = join(ROOT, "lessons.json");

/** Lessons from wrapped-up projects, newest first, skipping `exceptProject`. */
function lessonsText(exceptProject, n = 6) {
  const all = readJson(LESSONS, []).filter((l) => l.project !== exceptProject).slice(-n).reverse();
  return all.map((l) => [
    `- **${l.name ?? l.project}** (${l.date ? new Date(Number(l.date) * 1000).toISOString().slice(0, 10) : "?"}): ${l.summary ?? ""}`,
    l.stack?.length ? `  - stack: ${l.stack.join(", ")}` : null,
    l.worked?.length ? `  - worked: ${l.worked.join("; ")}` : null,
    l.mistakes?.length ? `  - avoid: ${l.mistakes.join("; ")}` : null,
    l.reuse?.length ? `  - reuse: ${l.reuse.join("; ")}` : null,
  ].filter(Boolean).join("\n")).join("\n");
}

// ---- transcripts ------------------------------------------------------------

function transcriptFile(repo) {
  const dir = join(HOME, ".claude", "projects", repo.replace(/\/+$/, "").replace(/[/.]/g, "-"));
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0] ?? null;
  } catch { return null; }
}

function tailLines(path, bytes = 1_500_000) {
  // read only the tail — transcripts grow to hundreds of MB
  const fd = openSync(path, "r");
  let buf;
  let start;
  try {
    const size = fstatSync(fd).size;
    start = Math.max(0, size - bytes);
    buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  if (start > 0) lines.shift();
  return lines.filter(Boolean);
}

function toolSummary(name, input = {}) {
  const s = (k) => (typeof input[k] === "string" ? input[k] : "");
  const b = (k) => basename(s(k));
  switch (name) {
    case "Read": return `read ${b("file_path")}`;
    case "Edit": case "MultiEdit": return `edited ${b("file_path")}`;
    case "Write": return `wrote ${b("file_path")}`;
    case "Bash": return s("description") || `ran ${s("command").split("\n")[0].slice(0, 80)}`;
    case "Grep": return `searched "${s("pattern")}"`;
    default: return name.replace(/^mcp__[^_]+__/, "");
  }
}

function userText(raw) {
  if (/<local-command-(stdout|stderr|caveat)>|<task-notification>/.test(raw)) return null;
  const cmd = raw.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) return cmd[1].trim();
  const t = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  return t || null;
}

/** In remote mode, redact raw text where it's read (before any clipping,
 *  so a truncated token can't slip under a pattern's minimum length). */
function R(text) {
  return REMOTE.on ? redact(text) : text;
}

/** Turns: [{ ask, at, tools: [..], reply }] oldest first. Remote mode can
 *  withhold conversations entirely (--no-transcripts). */
function turns(repo) {
  if (REMOTE.on && REMOTE.noTranscripts) return { turns: [], updated: null };
  const tf = transcriptFile(repo);
  if (!tf) return { turns: [], updated: null };
  const out = [];
  let cur = null;
  for (const line of tailLines(tf.f)) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain || o.isMeta) continue;
    const c = o.message?.content;
    if (o.type === "user") {
      let text = null;
      if (typeof c === "string") text = userText(c);
      else if (Array.isArray(c)) {
        const t = c.filter((x) => x.type === "text").map((x) => userText(x.text ?? "")).filter(Boolean);
        if (t.length) text = t.join("\n");
      }
      if (text) { cur = { ask: R(text), at: o.timestamp, tools: [], reply: "" }; out.push(cur); }
    } else if (o.type === "assistant" && Array.isArray(c) && cur) {
      for (const x of c) {
        if (x.type === "text" && x.text?.trim()) cur.reply = R(x.text.trim());
        if (x.type === "tool_use") cur.tools.push(R(toolSummary(x.name, x.input)));
      }
    }
  }
  return { turns: out, updated: tf.t };
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const ago = (ms) => {
  if (!ms) return "never";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

function sessionCard(m) {
  const { turns: ts, updated } = turns(m.repoPath);
  const last = ts[ts.length - 1];
  const working = updated && Date.now() - updated < 20_000;
  const changed = changedFiles(m.repoPath).length;
  return [
    `### ${label(m)}  (id: ${m.id})`,
    `branch: ${git(m.repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]) || "?"} · ${changed} changed files · ${working ? "WORKING now" : `last active ${ago(updated)}`}`,
    last ? `last ask: "${clip(last.ask, 200)}"` : "no conversation yet",
    last && last.tools.length ? `did: ${clip(last.tools.slice(-8).join(", "), 300)}` : null,
    last && last.reply ? `last reply: ${clip(last.reply, 500)}` : null,
  ].filter(Boolean).join("\n");
}

// ---- bridge (writes go through Grill Me) -----------------------------------

function bridgeState() {
  return readJson(join(projectDir().dir, "bridge.json"), { handoffs: [], questions: [], plans: [], notes: [] });
}

async function push(kind, item) {
  let token = "";
  try { token = readFileSync(join(ROOT, "api-token"), "utf8").trim(); } catch { /* none */ }
  let res;
  try {
    res = await fetch(`${API}/bridge/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind, item }),
    });
  } catch {
    throw new Error("Grill Me isn't running — open the Grill Me app, then try again.");
  }
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("unknown route")) throw new Error("This Grill Me build doesn't have the bridge yet — update Grill Me (grill update), then try again.");
    throw new Error(`Grill Me refused: ${body}`);
  }
  return res.json();
}


// ---- shared brain: catch-up digests -------------------------------------------
// One notebook per project: goal + decisions + notes + plans + what every
// session did. `catchUp(since)` renders everything new since a moment; the
// cursors file remembers each reader's "last seen" (a hook per session, a
// Grill Me Chat per chat, the Claude app).

const CURSORS = () => join(projectDir().dir, "brain-cursors.json");

function cursor(key) {
  const v = readJson(CURSORS(), {})[key];
  return typeof v === "number" ? v : 0;
}

function setCursor(key, ms) {
  const all = readJson(CURSORS(), {});
  all[key] = ms;
  const tmp = `${CURSORS()}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(all, null, 2)); renameSync(tmp, CURSORS()); } catch { /* best effort */ }
}

const tsOf = (x) => (typeof x === "number" ? x : Date.parse(x ?? "") || 0);

/** Markdown of everything new since `since` (ms). Empty string = nothing new.
 *  `exclude` = a member id whose own turns to skip (it already knows them). */
function catchUp(since, { exclude, full = false } = {}) {
  const { dir, id } = projectDir();
  const b = bridgeState();
  const out = [];
  if (full && b.goal) out.push(`**Goal:** ${b.goal}`);
  else if (b.goalTs && tsOf(b.goalTs) > since && b.goal) out.push(`**New goal:** ${b.goal}`);

  const dl = deadlineLine(since, full);
  if (dl) out.push(dl);

  // team brain: notes are mirrored to teammates as "brain-<noteId>" decisions —
  // don't show our own notes twice
  const ownNotes = new Set((b.notes ?? []).map((n) => `brain-${n.id}`));
  const decisions = readJson(join(dir, "decisions.json"), [])
    .filter((d) => !ownNotes.has(d.id))
    .filter((d) => full || tsOf(d.epochMs) > since);
  if (decisions.length) out.push(`**${full ? "Decisions" : "New decisions"}:**\n${decisions.slice(-12).map((d) => `- ${d.text}`).join("\n")}`);

  const notes = (b.notes ?? []).filter((n) => full || tsOf(n.ts) > since);
  if (notes.length) out.push(`**${full ? "Notes" : "New notes"}:**\n${notes.slice(-12).map((n) => `- ${n.text}${n.by ? ` (${n.by})` : ""}`).join("\n")}`);

  const plans = (b.plans ?? []).filter((p) => p.status === "applied" && (full || tsOf(p.ts) > since));
  if (plans.length) out.push(`**${full ? "Plans" : "New plans"}:**\n${plans.slice(-5).map((p) => `- ${p.title}: ${p.tasks.map((t) => t.title).join("; ")}`).join("\n")}`);

  if (full) {
    const tasks = readJson(join(dir, "tasks.json"), []).filter((t) => t.status !== "done");
    if (tasks.length) out.push(`**Open tasks:**\n${tasks.slice(0, 15).map((t) => `- [${t.status}] ${t.title}`).join("\n")}`);
  }

  const activity = [];
  for (const m of members()) {
    if (m.id === exclude) continue;
    const fresh = turns(m.repoPath).turns.filter((t) => full ? true : tsOf(t.at) > since);
    const recent = full ? fresh.slice(-1) : fresh.slice(-4);
    for (const t of recent) {
      activity.push(`- **${label(m)}**: asked "${clip(t.ask, 140)}"${t.tools.length ? ` → ${clip(t.tools.slice(-5).join(", "), 160)}` : ""}${t.reply ? ` → ${clip(t.reply.replace(/\s+/g, " "), 220)}` : ""}`);
    }
    if (!full && since) {
      const log = git(m.repoPath, ["log", "--oneline", `--since=@${Math.floor(since / 1000)}`, "-8"]);
      if (log) activity.push(`- **${label(m)}** commits:\n${log.split("\n").map((l) => `  - ${l}`).join("\n")}`);
    }
  }
  if (activity.length) out.push(`**${full ? "Sessions" : "Session activity"}:**\n${activity.join("\n")}`);

  const openQ = (b.questions ?? []).filter((q) => !q.answered);
  if (openQ.length && (full || openQ.some((q) => tsOf(q.ts) > since))) {
    out.push(`**Open questions for the brainstorm side:**\n${openQ.map((q) => `- ${q.fromTitle ?? q.from}: ${q.question}`).join("\n")}`);
  }
  if (full) {
    const lessons = lessonsText(id);
    if (lessons) out.push(`**Lessons from past hackathons:**\n${lessons}`);
  }
  return out.length ? `*Project: ${id}*\n\n${out.join("\n\n")}` : "";
}

// ---- deadline (hack clock) ------------------------------------------------------

const THRESHOLDS_MIN = [720, 360, 180, 60, 30, 15];

function fmtLeft(ms) {
  if (ms <= 0) return "time's up";
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** Full view: always show time left. Incremental: only when a threshold
 *  (12h, 6h, 3h, 1h, 30m, 15m) was crossed since the reader last looked. */
function deadlineLine(since, full) {
  const end = Number(bridgeState().deadline) || 0;
  if (!end) return "";
  const now = Date.now();
  const left = end - now;
  if (full) return `**⏰ Deadline:** ${fmtLeft(left)} left.`;
  const crossed = THRESHOLDS_MIN.some((t) => {
    const at = end - t * 60000;
    return since < at && at <= now;
  }) || (since < end && end <= now);
  return crossed ? `**⏰ ${fmtLeft(left)} left in the hackathon.** Prioritize the demo path; cut anything that isn't needed for it.` : "";
}

// ---- inputs for Grill Me's AI checks (Grill Me runs claude; these gather) ------

/** Mismatch + board check for one session's latest turn. Empty when there's
 *  nothing to compare against or no new turn since the last check. */
function checkInput(member) {
  const m = members().find((x) => x.id === member);
  if (!m) return "";
  const { dir } = projectDir();
  const b = bridgeState();
  const decisions = readJson(join(dir, "decisions.json"), []).slice(-15).map((d) => d.text);
  const tasks = readJson(join(dir, "tasks.json"), []).filter((t) => t.status !== "done").slice(0, 25).map((t) => ({ id: t.id, title: t.title, status: t.status }));
  if (!b.goal && !decisions.length && !tasks.length) return "";
  const key = `check:${member}`;
  const since = cursor(key);
  const fresh = turns(m.repoPath).turns.filter((t) => tsOf(t.at) > since);
  const last = fresh[fresh.length - 1];
  if (!last) return "";
  setCursor(key, Date.now());
  return JSON.stringify({
    session: label(m),
    goal: b.goal ?? "",
    decisions,
    openTasks: tasks,
    latestTurn: { ask: clip(last.ask, 1500), tools: last.tools.slice(-30), reply: clip(last.reply, 2500) },
    changedFiles: changedFiles(m.repoPath).slice(0, 40),
  }, null, 1);
}

function cutInput() {
  const { dir } = projectDir();
  const b = bridgeState();
  const end = Number(b.deadline) || 0;
  return JSON.stringify({
    timeLeft: end ? fmtLeft(end - Date.now()) : "unknown",
    goal: b.goal ?? "",
    decisions: readJson(join(dir, "decisions.json"), []).slice(-15).map((d) => d.text),
    openTasks: readJson(join(dir, "tasks.json"), []).filter((t) => t.status !== "done").map((t) => `[${t.status}] ${t.title}`),
    sessions: members().map((m) => {
      const t = turns(m.repoPath).turns.slice(-1)[0];
      return { name: label(m), lastAsk: t ? clip(t.ask, 300) : "", lastReply: t ? clip(t.reply, 600) : "" };
    }),
  }, null, 1);
}

function readme() {
  const m = members()[0];
  if (!m) return "";
  for (const f of ["README.md", "readme.md", "README"]) {
    try { return clip(R(readFileSync(join(m.repoPath, f), "utf8")), 3000); } catch { /* next */ }
  }
  return "";
}

function workSummary(turnsPer = 6) {
  return members().map((m) => ({
    session: label(m),
    commits: diffOf(m).log.split("\n").filter(Boolean).slice(0, 25),
    recentWork: turns(m.repoPath).turns.slice(-turnsPer).map((t) => ({ ask: clip(t.ask, 300), did: t.tools.slice(-8), reply: clip(t.reply, 500) })),
  }));
}

function pitchInput() {
  const { dir } = projectDir();
  const b = bridgeState();
  return JSON.stringify({
    goal: b.goal ?? "",
    decisions: readJson(join(dir, "decisions.json"), []).slice(-20).map((d) => d.text),
    readme: readme(),
    work: workSummary(),
    playbook: skillText("pitch") ?? "",
  }, null, 1);
}

function quizInput(member) {
  const m = findSession(member);
  if (!m) return "";
  const d = diffOf(m);
  if (!d.diff && !d.log) return "";
  return JSON.stringify({
    session: label(m),
    commits: d.log,
    files: d.stat,
    diff: clip(d.diff, 16000),
    recentWork: turns(m.repoPath).turns.slice(-3).map((t) => ({ ask: clip(t.ask, 300), reply: clip(t.reply, 600) })),
  }, null, 1);
}

function wrapupInput() {
  const { dir, id } = projectDir();
  const b = bridgeState();
  return JSON.stringify({
    project: id,
    goal: b.goal ?? "",
    decisions: readJson(join(dir, "decisions.json"), []).slice(-25).map((d) => d.text),
    notes: (b.notes ?? []).slice(-25).map((n) => n.text),
    tasks: readJson(join(dir, "tasks.json"), []).map((t) => `[${t.status}] ${t.title}`),
    work: workSummary(4),
  }, null, 1);
}

function kickoffInput() {
  return JSON.stringify({
    readme: readme(),
    pastLessons: lessonsText(projectDir().id, 5),
    brainstormPlaybook: skillText("brainstorm") ?? "",
    breakdownPlaybook: skillText("breakdown") ?? "",
    existingSessions: members().map((m) => label(m)),
  }, null, 1);
}

/** CLI modes (hooks and Grill Me call the script directly, not over MCP). */
function cliMode(argv) {
  const flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  if (flag("--project")) process.env.GRILLME_PROJECT_DIR = flag("--project");
  const now = Date.now();
  if (argv.includes("--sync")) {
    // Claude Code hook (SessionStart / UserPromptSubmit): stdout becomes context
    const member = flag("--sync");
    const key = `hook:${member}`;
    const since = cursor(key);
    const text = catchUp(since, { exclude: member, full: since === 0 || argv.includes("--full") });
    setCursor(key, now);
    if (text) process.stdout.write(`<grill-me-sync>\nShared project brain from Grill Me — new since your last message (from the brainstorm side and other sessions). Use it; don't repeat it back.\n\n${text}\n</grill-me-sync>\n`);
    return true;
  }
  if (argv.includes("--catchup-chat")) {
    const key = `chat:${flag("--catchup-chat")}`;
    const since = cursor(key);
    const text = catchUp(since, { full: since === 0 });
    setCursor(key, now);
    process.stdout.write(text);
    return true;
  }
  if (argv.includes("--check-input")) {
    process.stdout.write(checkInput(flag("--check-input")));
    return true;
  }
  if (argv.includes("--kickoff-input")) { process.stdout.write(kickoffInput()); return true; }
  if (argv.includes("--pitch-input")) { process.stdout.write(pitchInput()); return true; }
  if (argv.includes("--quiz-input")) { process.stdout.write(quizInput(flag("--quiz-input"))); return true; }
  if (argv.includes("--wrapup-input")) { process.stdout.write(wrapupInput()); return true; }
  if (argv.includes("--cut-input")) {
    process.stdout.write(cutInput());
    return true;
  }
  if (argv.includes("--digest")) {
    // Grill Me's Brain page: read-only, no cursor
    const since = Number(flag("--digest")) || 0;
    process.stdout.write(catchUp(since, { full: since === 0 }) || "Nothing new.");
    return true;
  }
  return false;
}

// ---- skills (hackathon playbooks, shared with Grill Me's composer) ----------

const SKILLS = [
  ["prep", "Prep hack", "Before the event: stack, repo, rules"],
  ["intra", "Intra-hack", "Keep the team on track mid-build"],
  ["brainstorm", "Brainstorm", "Generate and pick an idea"],
  ["breakdown", "Breakdown", "Split the idea into tasks"],
  ["finalize", "Finalize", "Polish, fix, cut scope"],
  ["pitch", "Pitch", "Demo script and slides"],
];

function skillText(id) {
  try { return readFileSync(join(ROOT, "skills", `${id}.md`), "utf8"); } catch { return null; }
}

// ---- tools -------------------------------------------------------------------

const ROLE_NOTE = "Brainstorm side = the Claude app. Coder side = a Claude Code session running inside a Grill Me worktree.";

const TOOLS = [
  {
    name: "whats_new",
    description: "Catch up on every coding session in the open Grill Me project: what each is working on, what it just did, its last reply, and anything waiting (questions from coders, pending handoffs/plans). Call this first whenever the user asks what's going on.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_session",
    description: "Read the recent conversation of one coding session as turns (the user's ask, tools used, final reply). `session` is a session id or title from whats_new; omit to read the calling session.",
    inputSchema: { type: "object", properties: { session: { type: "string" }, turns: { type: "number", description: "How many recent turns (default 3, max 10)" } } },
  },
  {
    name: "get_diff",
    description: "The code a session changed: its commits vs main, a file summary, and the diff (truncated). Use it to explain the change to the user in plain English and flag anything risky.",
    inputSchema: { type: "object", properties: { session: { type: "string" } } },
  },
  {
    name: "get_plan",
    description: "The team's saved decisions, open tasks, and shared notes. Coders should read this before starting work.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "save_plan",
    description: "Propose a plan: tasks for the board plus the decision behind it. The user approves it in Grill Me before anything is saved. Use after brainstorming lands on a plan.",
    inputSchema: {
      type: "object",
      required: ["title", "tasks"],
      properties: {
        title: { type: "string" },
        decision: { type: "string", description: "What was decided and why, one or two sentences" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            required: ["title"],
            properties: { title: { type: "string" }, desc: { type: "string" }, files: { type: "array", items: { type: "string" } } },
          },
        },
      },
    },
  },
  {
    name: "send_to_coder",
    description: "Hand a task to a Claude Code session. GRILL GATE: before calling, ask the user to explain the plan back in their own words and push back if it's vague. Pass their explanation verbatim as `user_explanation` — the call is rejected without a real one. The user approves the handoff in Grill Me before it's typed into the session.",
    inputSchema: {
      type: "object",
      required: ["session", "message", "user_explanation"],
      properties: {
        session: { type: "string", description: "Session id or title from whats_new" },
        message: { type: "string", description: "The full instruction for the coder" },
        user_explanation: { type: "string", description: "The user's own words explaining the plan back" },
      },
    },
  },
  {
    name: "ask_brainstorm",
    description: "(Coder side) Ask the brainstorm side a question — a product or design call you shouldn't make alone. The user sees it in Grill Me and answers with the Claude app; the answer comes back to this session.",
    inputSchema: { type: "object", required: ["question"], properties: { question: { type: "string" }, context: { type: "string" } } },
  },
  {
    name: "open_questions",
    description: "Questions coders have asked the brainstorm side that are still unanswered.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "answer_question",
    description: "Answer a coder's question (id from open_questions). The answer is sent back to that session after the user approves it in Grill Me.",
    inputSchema: { type: "object", required: ["id", "answer"], properties: { id: { type: "string" }, answer: { type: "string" } } },
  },
  {
    name: "notes",
    description: "Shared scratchpad both sides can read and add to (ideas, constraints, links). action=read or add.",
    inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["read", "add"] }, text: { type: "string" } } },
  },
  {
    name: "past_lessons",
    description: "Lessons from past hackathons (stack, what worked, mistakes, reusable pieces). Use when starting a new project or choosing a stack.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "catch_up",
    description: "Everything new in this project since you last asked (or in the last `hours`): goal, decisions, notes, plans, what each session did, commits. Call at the start of a conversation and whenever the user returns.",
    inputSchema: { type: "object", properties: { hours: { type: "number", description: "Look back this many hours instead of since last call" } } },
  },
  {
    name: "set_goal",
    description: "Set the project's one-line goal in the shared brain (what we're building and for whom). Both sides see it.",
    inputSchema: { type: "object", required: ["goal"], properties: { goal: { type: "string" } } },
  },
  {
    name: "team_status",
    description: "In team mode: every teammate's presence, branch, and tasks. (Teammates' conversations live on their machines and aren't readable.)",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, args = {}) {
  const self = selfMember();
  switch (name) {
    case "whats_new": {
      const all = members();
      if (!all.length) return "No sessions — open a project in Grill Me first.";
      const b = bridgeState();
      const waiting = [
        ...b.questions.filter((q) => !q.answered).map((q) => `- QUESTION from ${q.fromTitle ?? q.from} (id ${q.id}): ${q.question}`),
        ...b.handoffs.filter((h) => h.status === "pending").map((h) => `- handoff to ${h.session} waiting for the user's OK`),
        ...b.plans.filter((p) => p.status === "pending").map((p) => `- plan "${p.title}" waiting for the user's OK`),
      ];
      return [
        `Project: ${projectDir().id}. ${ROLE_NOTE}${self ? ` You are the coder session "${label(self)}".` : ""}`,
        ...all.map(sessionCard),
        waiting.length ? `## Waiting\n${waiting.join("\n")}` : "Nothing waiting.",
      ].join("\n\n");
    }
    case "read_session": {
      const m = findSession(args.session);
      if (!m) return `No session "${args.session}". Call whats_new for the list.`;
      const n = Math.min(10, Math.max(1, Number(args.turns) || 3));
      const { turns: ts } = turns(m.repoPath);
      if (!ts.length) return `${label(m)} has no conversation yet.`;
      return ts.slice(-n).map((t, i) => [
        `## Turn ${ts.length - Math.min(n, ts.length) + i + 1}${t.at ? ` (${t.at})` : ""}`,
        `USER: ${clip(t.ask, 1500)}`,
        t.tools.length ? `TOOLS: ${clip(t.tools.join(", "), 800)}` : null,
        t.reply ? `CLAUDE: ${clip(t.reply, 3000)}` : "CLAUDE: (no reply yet)",
      ].filter(Boolean).join("\n")).join("\n\n");
    }
    case "get_diff": {
      const m = findSession(args.session);
      if (!m) return `No session "${args.session}".`;
      const d = diffOf(m);
      return [
        `Session ${label(m)} on ${d.branch}${d.base ? ` (vs ${d.base})` : ""}`,
        d.log ? `## Commits\n${d.log}` : "No commits beyond the base branch.",
        d.stat ? `## Files\n${d.stat}` : "No changes.",
        d.diff ? `## Diff\n${clip(d.diff, 24000)}` : null,
      ].filter(Boolean).join("\n\n");
    }
    case "past_lessons": {
      const l = lessonsText(null, 20);
      return l || "No past hackathons wrapped up yet.";
    }
    case "get_plan": {
      const { dir } = projectDir();
      const decisions = readJson(join(dir, "decisions.json"), []);
      const tasks = readJson(join(dir, "tasks.json"), []).filter((t) => t.status !== "done");
      const notes = bridgeState().notes;
      return [
        decisions.length ? `## Decisions\n${decisions.slice(-10).map((d) => `- ${d.text}`).join("\n")}` : "No decisions yet.",
        tasks.length ? `## Open tasks\n${tasks.map((t) => `- [${t.status}] ${t.title}${t.owner ? ` (${t.owner})` : ""}`).join("\n")}` : "No open tasks.",
        notes.length ? `## Notes\n${notes.slice(-15).map((n) => `- ${n.text}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
    }
    case "save_plan": {
      if (!Array.isArray(args.tasks) || !args.tasks.length) throw new Error("A plan needs at least one task.");
      await push("plan", { title: String(args.title), decision: args.decision ? String(args.decision) : "", tasks: args.tasks.slice(0, 20) });
      return "Plan sent to Grill Me — the user approves it there, then the tasks land on the board and the decision is logged.";
    }
    case "send_to_coder": {
      const m = findSession(args.session);
      if (!m) return `No session "${args.session}". Call whats_new for the list.`;
      const exp = String(args.user_explanation ?? "").trim();
      if (exp.length < 40 || exp === String(args.message).trim()) {
        throw new Error("Grill gate: ask the user to explain the plan back in their own words (a few sentences) and pass that as user_explanation.");
      }
      await push("handoff", { session: m.id, sessionTitle: label(m), message: String(args.message), userExplanation: exp });
      return `Handoff to ${label(m)} is waiting for the user's OK in Grill Me.`;
    }
    case "ask_brainstorm": {
      await push("question", { from: self?.id ?? "unknown", fromTitle: self ? label(self) : "a session", question: String(args.question), context: args.context ? String(args.context) : "" });
      return "Question sent. Keep working on anything that doesn't depend on it — the answer arrives in this session once the user approves it.";
    }
    case "open_questions": {
      const q = bridgeState().questions.filter((x) => !x.answered);
      return q.length ? q.map((x) => `- id ${x.id} from ${x.fromTitle ?? x.from}: ${x.question}${x.context ? `\n  context: ${x.context}` : ""}`).join("\n") : "No open questions.";
    }
    case "answer_question": {
      await push("answer", { id: String(args.id), answer: String(args.answer) });
      return "Answer sent — it goes back to the coder after the user approves it in Grill Me.";
    }
    case "notes": {
      if (args.action === "add") {
        if (!args.text) throw new Error("text is required to add a note");
        await push("note", { text: String(args.text), by: self ? label(self) : "Claude app" });
        return "Note added.";
      }
      const n = bridgeState().notes;
      return n.length ? n.slice(-30).map((x) => `- ${x.text}${x.by ? ` (${x.by})` : ""}`).join("\n") : "No notes yet.";
    }
    case "catch_up": {
      const key = REMOTE.on ? "remote" : "app";
      const since = args.hours ? Date.now() - Number(args.hours) * 3_600_000 : cursor(key);
      const text = catchUp(since, { full: since === 0 });
      setCursor(key, Date.now());
      return text || "Nothing new since last time.";
    }
    case "set_goal": {
      await push("goal", { goal: String(args.goal) });
      return "Goal saved to the shared brain.";
    }
    case "team_status": {
      const settings = readJson(join(ROOT, "settings.json"), {});
      if (settings.appMode !== "team") return "Grill Me is in solo mode — no teammates.";
      const room = readJson(join(ROOT, "room.json"), {});
      const people = Array.isArray(room.members) ? room.members : [];
      const tasks = readJson(join(projectDir().dir, "tasks.json"), []);
      return people.length
        ? people.map((p) => `- ${p.name ?? p.id}: ${p.presence ?? "?"}; tasks: ${tasks.filter((t) => t.owner === p.id && t.status !== "done").map((t) => t.title).join(", ") || "none"}`).join("\n")
        : "No teammates in the room yet.";
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// ---- JSON-RPC (shared by stdio and HTTP) ---------------------------------------

// Remote mode (claude.ai over Tailscale Funnel): read-only unless the user
// allowed proposals, and every tool result passes through redact().
const REMOTE = { on: false, allowWrites: false, noTranscripts: false };
const WRITE_TOOLS = new Set(["save_plan", "send_to_coder", "ask_brainstorm", "answer_question", "set_goal"]);
// Writes that land as PENDING items the user approves in Grill Me. The rest
// (goal, notes, questions) flow straight into every session's context, so
// they're never allowed from the internet — even with proposals on.
const REMOTE_PROPOSALS = new Set(["save_plan", "send_to_coder", "answer_question"]);

function toolsFor() {
  if (!REMOTE.on) return TOOLS;
  return TOOLS.filter((t) => !WRITE_TOOLS.has(t.name) || (REMOTE.allowWrites && REMOTE_PROPOSALS.has(t.name)));
}

/** Strip anything that looks like a credential before it leaves the Mac. */
export function redact(text) {
  return String(text)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[redacted private key]")
    // well-known token shapes
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{15,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|AC[a-f0-9]{32}|SK[a-f0-9]{32}|[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,})\b/g, "[redacted]")
    // credentials inside URLs: scheme://user:pass@host
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^:\s\/@]+):[^@\s\/]+@/gi, "$1:[redacted]@")
    // Authorization: Bearer / Basic, curl -u user:pass
    .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+\/=-]{8,}/g, "$1 [redacted]")
    .replace(/(\s-u\s+|\s--user\s+)(["']?)[^\s:"']+:[^\s"']+\2/g, "$1$2[redacted]$2")
    // NAME=value / "name": "value" / name is value, for secret-ish names
    .replace(/\b([A-Za-z0-9_.-]*(?:key|secret|token|passw(?:or)?d|pwd|credential|auth)[A-Za-z0-9_.-]*)(["']?\s*(?:[=:]|\s+is\s+)\s*)(["']?)[^\s"'`,;]{6,}\3/gi, "$1$2$3[redacted]$3");
}

async function handle(req) {
  const { id, method, params = {} } = req ?? {};
  const reply = (result) => (id === undefined ? null : { jsonrpc: "2.0", id, result });
  const fail = (code, message) => (id === undefined ? null : { jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {}, prompts: {} },
        serverInfo: SERVER,
        instructions:
          "Grill Me bridge. In the Claude app you are the user's brainstorm partner and reviewer; Claude Code sessions are the coders. " +
          "Start with catch_up (or whats_new). Save decisions the user makes with notes/save_plan so the coders see them. Explain code changes (get_diff) in plain English. Turn agreed plans into save_plan. " +
          "Before send_to_coder, grill the user: make them explain the plan back and push back on vague answers. " +
          "In a Claude Code session: read get_plan before starting, and use ask_brainstorm for product/design calls." +
          (REMOTE.on && !REMOTE.allowWrites ? " This connection is read-only: you can see everything but not change anything." : ""),
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: toolsFor() });
    case "tools/call": {
      const name = params.name;
      const args = params.arguments ?? {};
      if (!toolsFor().some((t) => t.name === name)) {
        return reply({ content: [{ type: "text", text: `Tool ${name} isn't available on this connection.` }], isError: true });
      }
      if (REMOTE.on && name === "notes" && String(args.action).toLowerCase() !== "read") {
        return reply({ content: [{ type: "text", text: "Adding notes isn't available over this connection." }], isError: true });
      }
      try {
        const text = await callTool(name, args);
        return reply({ content: [{ type: "text", text: REMOTE.on ? redact(text) : text }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: String(e?.message ?? e) }], isError: true });
      }
    }
    case "prompts/list":
      return reply({ prompts: SKILLS.map(([name, title, description]) => ({ name, title, description })) });
    case "prompts/get": {
      const s = SKILLS.find(([n]) => n === params.name);
      if (!s) return fail(-32602, `Unknown prompt ${params.name}`);
      const body = skillText(s[0]) ?? `# ${s[1]}\n\n${s[2]}. (Playbook not written yet — edit ~/.grillme/skills/${s[0]}.md)`;
      return reply({ description: s[2], messages: [{ role: "user", content: { type: "text", text: body } }] });
    }
    default:
      if (method?.startsWith("notifications/")) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

// ---- stdio (Claude app + Claude Code, local) -------------------------------------

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

function serveStdio() {
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    handle(req).then((msg) => { if (msg) send(msg); }).catch((e) => process.stderr.write(`[grill-me mcp] ${e?.stack ?? e}\n`));
  });
}

// ---- HTTP (claude.ai over Tailscale Funnel) ---------------------------------------
// Streamable-HTTP MCP, JSON responses only. Loopback only — Funnel is the
// sole way in. The URL carries a 64-hex secret (/mcp/<secret>); anything
// else is a 404 so the endpoint doesn't reveal itself. Rate-limited and
// every request is logged to ~/.grillme/remote-access.jsonl.

const ACCESS_LOG = join(ROOT, "remote-access.jsonl");
const RATE_PER_MIN = 120;
const MAX_BODY = 1_000_000;

/** Remote responses: every text that leaves the Mac goes through redact(),
 *  and internal errors become generic (no paths, no stack traces). */
function scrubOutgoing(msg) {
  if (!msg) return msg;
  if (msg.error) return { ...msg, error: { code: msg.error.code, message: msg.error.code === -32601 || msg.error.code === -32602 ? msg.error.message : "Internal error" } };
  const r = msg.result;
  if (r?.content) r.content = r.content.map((c) => (c.type === "text" ? { ...c, text: redact(c.text) } : c));
  if (r?.messages) r.messages = r.messages.map((m) => (m.content?.type === "text" ? { ...m, content: { ...m.content, text: redact(m.content.text) } } : m));
  return msg;
}

async function serveHttp(port, secretFile) {
  const { createServer } = await import("node:http");
  const { timingSafeEqual } = await import("node:crypto");
  const { appendFileSync, statSync: st, renameSync: mv } = await import("node:fs");
  // re-read on every request, so "New secret" takes effect even if this
  // process somehow outlived the app that started it
  const secretNow = () => {
    const s = readFileSync(secretFile, "utf8").trim();
    return /^[0-9a-f]{64}$/.test(s) ? Buffer.from(s) : null;
  };
  if (!secretNow()) throw new Error("bad secret file");
  const authedHits = [];
  const strangerHits = [];
  const within = (arr, limit) => {
    const now = Date.now();
    while (arr.length && now - arr[0] > 60_000) arr.shift();
    if (arr.length >= limit) return false;
    arr.push(now);
    return true;
  };

  const log = (entry) => {
    try {
      if (existsSync(ACCESS_LOG) && st(ACCESS_LOG).size > 1_000_000) mv(ACCESS_LOG, `${ACCESS_LOG}.1`);
      appendFileSync(ACCESS_LOG, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
    } catch { /* logging never breaks serving */ }
  };
  const authed = (path, auth) => {
    const secret = secretNow();
    if (!secret) return false;
    const fromPath = path.startsWith("/mcp/") ? path.slice(5).split("/")[0] : "";
    const fromHeader = /^Bearer\s+(\S+)$/i.exec(auth ?? "")?.[1] ?? "";
    const given = Buffer.from(fromPath || fromHeader);
    return given.length === secret.length && timingSafeEqual(given, secret);
  };
  const end = (res, code, body, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };

  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    // Funnel proxies from loopback; the forwarded-for header is the caller
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    const who = fwd || (req.headers["tailscale-funnel-request"] ? "funnel" : "local");
    // auth FIRST: strangers get their own bucket and always a plain 404, so
    // they can neither lock out the real client nor learn a server is here
    if (!(path === "/mcp" || path.startsWith("/mcp/")) || !authed(path, req.headers.authorization)) {
      if (within(strangerHits, 60)) log({ who, status: 404 });
      return end(res, 404, "Not found", "text/plain");
    }
    if (!within(authedHits, RATE_PER_MIN)) { log({ who, status: 429 }); return end(res, 429, '{"error":"slow down"}'); }
    if (req.method !== "POST") return end(res, 405, '{"error":"POST only"}');
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) req.destroy(); else chunks.push(c); });
    req.on("end", async () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return end(res, 400, '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}'); }
      // one message per request: batches would multiply the rate limit
      if (Array.isArray(body)) return end(res, 400, '{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Batches are not supported"}}');
      const r = await handle(body).catch(() => ({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32603, message: "Internal error" } }));
      log({ who, status: 200, method: body?.method, tool: body?.params?.name });
      if (!r) { res.writeHead(202); return res.end(); }
      end(res, 200, JSON.stringify(scrubOutgoing(r)));
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 16;
  server.listen(port, "127.0.0.1", () => process.stderr.write(`[grill-me mcp] remote on 127.0.0.1:${port}\n`));

  // never outlive Grill Me: if the parent goes away, close the door
  const parent = process.ppid;
  setInterval(() => {
    let alive = true;
    try { process.kill(parent, 0); } catch { alive = false; }
    if (!alive || process.ppid !== parent) process.exit(0);
  }, 3000).unref();
}

const argv = process.argv.slice(2);
if (argv.includes("--http")) {
  REMOTE.on = true;
  REMOTE.allowWrites = argv.includes("--allow-writes");
  REMOTE.noTranscripts = argv.includes("--no-transcripts");
  const i = argv.indexOf("--http");
  const j = argv.indexOf("--secret-file");
  serveHttp(Number(argv[i + 1]) || 4519, argv[j + 1]).catch((e) => { process.stderr.write(`[grill-me mcp] ${e}\n`); process.exit(1); });
} else if (!cliMode(argv)) {
  serveStdio();
}
