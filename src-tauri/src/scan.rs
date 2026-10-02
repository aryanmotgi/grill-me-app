// ---------------------------------------------------------------------------
// Workflow scan: what AI-coding setup is on this computer, read locally and
// only with the user's permission (one checkbox per source in onboarding).
//
// Rules, because these files hold secrets:
// - MCP configs: server NAMES, transport, URL host and package-like command
//   args only. Never env values, headers, tokens or paths.
// - Instruction files: name, size and headings — never the body.
// - Git: counts and naming patterns — never commit text or code.
// - Shell history (opt-in): the first word of each command only, kept when it
//   looks like a program name and appears 3+ times. The rest of the line —
//   where people paste keys — is dropped as it is read.
// Every file read and command run is listed in `checked`, which the UI shows.
// Each parser below is separate and fails quietly: a tool changing its config
// format loses that one section, never the scan.
// ---------------------------------------------------------------------------

use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

pub const SOURCES: &[&str] = &["agents", "extensions", "instructions", "stack", "git", "packages", "history"];

/// Agent CLIs we look for on PATH (login shell, same PATH sessions get).
const AGENT_BINS: &[&str] = &["claude", "codex", "cursor-agent", "agent", "gemini", "copilot", "aider", "opencode", "amp", "goose", "ollama"];
/// Desktop apps we look for in /Applications and ~/Applications.
const APPS: &[&str] = &[
    "Claude.app", "ChatGPT.app", "Codex.app", "Cursor.app", "Windsurf.app", "Devin.app", "Zed.app", "Visual Studio Code.app",
    "Obsidian.app", "Notion.app", "Linear.app", "Figma.app", "Raycast.app", "Warp.app", "Ghostty.app", "iTerm.app", "Docker.app", "Ollama.app",
];

struct Scan {
    home: PathBuf,
    checked: Vec<Value>,
}

impl Scan {
    fn note(&mut self, source: &str, item: impl Into<String>) {
        self.checked.push(json!({ "source": source, "item": item.into() }));
    }
    /// "~/…" for display — the UI shows exactly what was looked at.
    fn tilde(&self, p: &Path) -> String {
        match p.strip_prefix(&self.home) {
            Ok(rest) => format!("~/{}", rest.display()),
            Err(_) => p.display().to_string(),
        }
    }
    fn read(&mut self, source: &str, p: &Path, why: &str) -> Option<String> {
        let text = std::fs::read(p).ok().map(|b| String::from_utf8_lossy(&b).into_owned());
        if text.is_some() {
            let shown = self.tilde(p);
            self.note(source, format!("{shown} ({why})"));
        }
        text
    }
}

fn home() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."))
}

/// Run a command with a timeout; stdout or "" on failure.
fn run(cmd: &str, args: &[&str], cwd: Option<&Path>, secs: u64) -> String {
    let mut c = Command::new(cmd);
    c.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    let Ok(mut child) = c.spawn() else { return String::new() };
    let mut out = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(o) = out.as_mut() {
            let _ = std::io::Read::read_to_string(o, &mut s);
        }
        s
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(secs);
    loop {
        match child.try_wait() {
            Ok(Some(st)) => return if st.success() { reader.join().unwrap_or_default() } else { String::new() },
            Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                return String::new();
            }
        }
    }
}

// ---- safety filters -----------------------------------------------------------------

const SECRETISH: &[&str] = &["key", "token", "secret", "password", "passwd", "bearer", "auth", "credential", "session"];

/// An argument worth keeping: looks like a package or program name, not a
/// path, flag value, URL with query, or anything secret-shaped.
pub(crate) fn safe_arg(a: &str) -> bool {
    let l = a.to_ascii_lowercase();
    a.len() <= 60
        && !a.starts_with('-')
        && !a.contains('=')
        && !a.contains(':')
        && !a.starts_with('/')
        && !a.starts_with('~')
        && !a.starts_with('.')
        && !SECRETISH.iter().any(|s| l.contains(s))
        && a.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '/' | '-' | '_' | '.'))
        && a.chars().any(|c| c.is_ascii_alphabetic())
        // long random-looking runs (tokens) have no separators and many digits
        && !(a.len() > 24 && a.chars().filter(|c| c.is_ascii_digit()).count() > 6)
}

/// The host of an http(s) URL, nothing else (no path, no query).
pub(crate) fn url_host(u: &str) -> Option<String> {
    let rest = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?.rsplit('@').next()?;
    let host = host.split(':').next()?.to_ascii_lowercase();
    (!host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')).then_some(host)
}

fn basename(cmd: &str) -> String {
    cmd.rsplit('/').next().unwrap_or(cmd).to_string()
}

// ---- MCP servers ----------------------------------------------------------------------

/// One MCP server entry → a safe summary. Works for the JSON shape every
/// agent uses (`command`/`args`, or `url` / `serverUrl` / `httpUrl`).
pub(crate) fn mcp_summary(name: &str, v: &Value, agent: &str, scope: &str) -> Option<Value> {
    if name.is_empty() || name.len() > 80 {
        return None;
    }
    let url = ["url", "serverUrl", "httpUrl"].iter().find_map(|k| v.get(*k).and_then(Value::as_str));
    let mut out = json!({ "name": name, "agent": agent, "scope": scope });
    if let Some(u) = url {
        out["transport"] = json!("http");
        if let Some(h) = url_host(u) {
            out["host"] = json!(h);
        }
    } else if let Some(cmd) = v.get("command").and_then(Value::as_str) {
        out["transport"] = json!("stdio");
        out["command"] = json!(basename(cmd));
        let args: Vec<String> = v.get("args").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).filter(|a| safe_arg(a)).map(str::to_owned).take(6).collect()).unwrap_or_default();
        if !args.is_empty() {
            out["packages"] = json!(args);
        }
    }
    Some(out)
}

fn mcp_map(map: Option<&Value>, agent: &str, scope: &str) -> Vec<Value> {
    map.and_then(Value::as_object).map(|m| m.iter().filter_map(|(n, v)| mcp_summary(n, v, agent, scope)).collect()).unwrap_or_default()
}

/// ~/.claude.json: user-level servers + the ones scoped to this project.
pub(crate) fn claude_json_mcp(v: &Value, project: Option<&str>) -> Vec<Value> {
    let mut out = mcp_map(v.get("mcpServers"), "claude", "user");
    if let Some(p) = project {
        out.extend(mcp_map(v.get("projects").and_then(|ps| ps.get(p)).and_then(|pr| pr.get("mcpServers")), "claude", "project"));
    }
    out
}

/// ~/.codex/config.toml: [mcp_servers.<name>] and [plugins."name@market"].
pub(crate) fn codex_toml(text: &str) -> (Vec<Value>, Vec<Value>) {
    let Ok(t) = text.parse::<toml::Table>() else { return (vec![], vec![]) };
    let to_json = |v: &toml::Value| serde_json::to_value(v).unwrap_or(Value::Null);
    let mcp = t.get("mcp_servers").and_then(|m| m.as_table()).map(|m| m.iter().filter_map(|(n, v)| mcp_summary(n, &to_json(v), "codex", "user")).collect()).unwrap_or_default();
    let plugins = t
        .get("plugins")
        .and_then(|p| p.as_table())
        .map(|p| p.keys().map(|k| plugin_summary(k, "codex")).collect())
        .unwrap_or_default();
    (mcp, plugins)
}

fn plugin_summary(key: &str, agent: &str) -> Value {
    let (name, market) = key.split_once('@').unwrap_or((key, ""));
    json!({ "name": name, "marketplace": market, "agent": agent })
}

/// ~/.claude/plugins/installed_plugins.json → {"plugins": {"name@market": [...]}}
pub(crate) fn claude_plugins(v: &Value) -> Vec<Value> {
    v.get("plugins").and_then(Value::as_object).map(|m| m.keys().map(|k| plugin_summary(k, "claude")).collect()).unwrap_or_default()
}

/// SKILL.md front matter → (name, description). Falls back to the dir name.
pub(crate) fn skill_front_matter(text: &str, dir: &str) -> (String, String) {
    let mut name = dir.to_string();
    let mut desc = String::new();
    if let Some(rest) = text.strip_prefix("---") {
        for line in rest.lines().take_while(|l| l.trim() != "---") {
            if let Some(v) = line.strip_prefix("name:") {
                name = v.trim().trim_matches('"').to_string();
            } else if let Some(v) = line.strip_prefix("description:") {
                desc = v.trim().trim_matches('"').chars().take(200).collect();
            }
        }
    }
    (name, desc)
}

// ---- instruction files -------------------------------------------------------------------

/// Markdown headings only (never the body), capped.
pub(crate) fn headings(text: &str) -> Vec<String> {
    text.lines()
        .filter(|l| l.starts_with('#'))
        .map(|l| l.trim_start_matches('#').trim().chars().take(80).collect::<String>())
        .filter(|h| !h.is_empty())
        .take(12)
        .collect()
}

// ---- tech stack ---------------------------------------------------------------------------

/// Dependency names we treat as "the stack" when present.
const FRAMEWORKS: &[&str] = &[
    "next", "react", "vue", "nuxt", "svelte", "@sveltejs/kit", "astro", "remix", "@remix-run/react", "solid-js", "angular", "@angular/core",
    "express", "fastify", "hono", "@nestjs/core", "vite", "tailwindcss", "prisma", "drizzle-orm", "@supabase/supabase-js", "convex", "firebase",
    "@tauri-apps/api", "electron", "react-native", "expo", "three", "ai", "@anthropic-ai/sdk", "openai", "stripe", "@clerk/nextjs", "zod",
    "vitest", "jest", "@playwright/test", "cypress", "mocha", "storybook",
    "django", "fastapi", "flask", "pytest", "pydantic", "langchain", "torch", "numpy", "pandas",
    "tokio", "axum", "actix-web", "serde", "tauri", "bevy", "rocket",
];

pub(crate) fn package_json_deps(v: &Value) -> Vec<String> {
    let mut deps: Vec<String> = ["dependencies", "devDependencies"]
        .iter()
        .filter_map(|k| v.get(*k).and_then(Value::as_object))
        .flat_map(|m| m.keys().cloned())
        .collect();
    deps.sort();
    deps.dedup();
    deps
}

pub(crate) fn cargo_deps(text: &str) -> Vec<String> {
    let Ok(t) = text.parse::<toml::Table>() else { return vec![] };
    ["dependencies", "dev-dependencies"].iter().filter_map(|k| t.get(*k).and_then(|d| d.as_table())).flat_map(|d| d.keys().cloned()).collect()
}

pub(crate) fn python_deps(pyproject: Option<&str>, requirements: Option<&str>) -> Vec<String> {
    let name_of = |s: &str| -> String { s.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')).next().unwrap_or("").to_ascii_lowercase() };
    let mut out = Vec::new();
    if let Some(Ok(t)) = pyproject.map(|p| p.parse::<toml::Table>()) {
        if let Some(a) = t.get("project").and_then(|p| p.get("dependencies")).and_then(|d| d.as_array()) {
            out.extend(a.iter().filter_map(|d| d.as_str()).map(name_of));
        }
    }
    if let Some(r) = requirements {
        out.extend(r.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with('-')).map(name_of));
    }
    out.retain(|n| !n.is_empty());
    out
}

// ---- git habits --------------------------------------------------------------------------

/// Counts and patterns from commit subjects + branch names. No text kept.
pub(crate) fn git_habits(subjects: &str, branches: &str) -> Value {
    let subs: Vec<&str> = subjects.lines().filter(|l| !l.trim().is_empty()).collect();
    let conventional = subs.iter().filter(|s| is_conventional(s)).count();
    let pr_merges = subs.iter().filter(|s| s.starts_with("Merge pull request") || pr_suffix(s)).count();
    let mut prefixes: HashMap<String, usize> = HashMap::new();
    for b in branches.lines().map(str::trim).filter(|b| !b.is_empty() && !b.contains("HEAD")) {
        let b = b.strip_prefix("origin/").unwrap_or(b);
        if let Some((p, _)) = b.split_once('/') {
            if p.len() <= 20 && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                *prefixes.entry(p.to_string()).or_default() += 1;
            }
        }
    }
    let mut top: Vec<(String, usize)> = prefixes.into_iter().collect();
    top.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let n = subs.len().max(1) as f64;
    json!({
        "commits30d": subs.len(),
        "conventionalCommits": ((conventional as f64 / n) * 100.0).round() / 100.0,
        "usesPullRequests": pr_merges > 0,
        "branchPrefixes": top.into_iter().take(5).map(|(p, _)| p).collect::<Vec<_>>(),
    })
}

fn is_conventional(s: &str) -> bool {
    let head = s.split(':').next().unwrap_or("");
    let kind = head.split('(').next().unwrap_or("").trim_end_matches('!');
    s.contains(':') && ["feat", "fix", "chore", "docs", "refactor", "test", "perf", "build", "ci", "style", "revert"].contains(&kind)
}

fn pr_suffix(s: &str) -> bool {
    // GitHub squash merges end with " (#123)"
    s.trim_end().ends_with(')') && s.rsplit_once("(#").is_some_and(|(_, n)| n.trim_end_matches(')').chars().all(|c| c.is_ascii_digit()))
}

// ---- shell history (opt-in) --------------------------------------------------------------

const SKIP_CMDS: &[&str] = &[
    "cd", "ls", "ll", "la", "pwd", "echo", "export", "source", ".", "clear", "exit", "history", "cat", "rm", "mv", "cp", "mkdir", "touch",
    "open", "which", "man", "sudo", "env", "unset", "alias", "set", "then", "fi", "do", "done", "for", "if", "while", "time", "noglob", "command",
    "grep", "head", "tail", "less", "more", "chmod", "chown", "kill", "ps", "top", "true", "false", "z", "j", "read", "printf", "test", "type",
];

/// First word of each command → counts. Keeps only program-like names seen
/// 3+ times, top 40. Everything after the first word is never stored.
pub(crate) fn history_counts(text: &str) -> Vec<(String, usize)> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let lines: Vec<&str> = text.lines().collect();
    for line in lines.iter().rev().take(20_000) {
        // zsh extended history ": 1700000000:0;cmd", fish "- cmd: cmd"
        let line = match line.split_once(';') {
            Some((pre, rest)) if pre.starts_with(": ") => rest,
            _ => line.strip_prefix("- cmd: ").unwrap_or(line),
        };
        let mut words = line.split_whitespace().skip_while(|w| w.contains('=') || *w == "sudo" || *w == "time" || *w == "noglob" || *w == "command");
        let Some(first) = words.next() else { continue };
        let first = basename(first);
        let ok = (1..=32).contains(&first.len())
            && first.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
            && first.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
            && !SKIP_CMDS.contains(&first.as_str())
            && looks_like_program(&first);
        if ok {
            *counts.entry(first.to_ascii_lowercase()).or_default() += 1;
        }
    }
    let mut v: Vec<(String, usize)> = counts.into_iter().filter(|(_, n)| *n >= 3).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.truncate(40);
    v
}

/// Secret-shaped words (a key pasted at the prompt) never count as programs.
fn looks_like_program(w: &str) -> bool {
    let l = w.to_ascii_lowercase();
    !SECRETISH.iter().any(|s| l.contains(s))
        && !["sk-", "sk_", "ghp_", "gho_", "xox", "pk_", "rk_", "akia", "eyj"].iter().any(|p| l.starts_with(p))
        && w.chars().filter(|c| c.is_ascii_digit()).count() <= 4
}

/// Keep only names that are real programs here (on PATH, an alias or a
/// shell function). Whatever slipped past the shape checks stops here: a
/// pasted secret isn't an executable.
pub(crate) fn keep_programs(counts: Vec<(String, usize)>, is_program: impl Fn(&str) -> bool) -> Vec<(String, usize)> {
    counts.into_iter().filter(|(c, _)| is_program(c)).collect()
}

/// One login-shell call answering "which of these are commands?" Names are
/// already restricted to [A-Za-z0-9._-], so they're safe to put in the script.
fn programs_on_path(names: &[String]) -> BTreeSet<String> {
    if names.is_empty() {
        return BTreeSet::new();
    }
    let script = names.iter().map(|n| format!("command -v {n} >/dev/null 2>&1 && echo {n}")).collect::<Vec<_>>().join("; ");
    run("/bin/zsh", &["-lic", &script], None, 10).lines().map(|l| l.trim().to_string()).collect()
}

/// "publisher.name-1.2.3" → "publisher.name"
pub(crate) fn extension_id(dir: &str) -> Option<String> {
    let (id, ver) = dir.rsplit_once('-')?;
    (ver.chars().next().is_some_and(|c| c.is_ascii_digit()) && id.contains('.')).then(|| id.to_ascii_lowercase())
}

// ---- the scan ------------------------------------------------------------------------------

fn scan_agents(s: &mut Scan) -> Value {
    let script = AGENT_BINS.iter().map(|b| format!("command -v {b} >/dev/null 2>&1 && echo {b}")).collect::<Vec<_>>().join("; ");
    let found = run("/bin/zsh", &["-lc", &script], None, 8);
    s.note("agents", format!("looked for {} on your PATH", AGENT_BINS.join(", ")));
    let bins: Vec<String> = found.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_owned).collect();
    let mut apps = Vec::new();
    for dir in [PathBuf::from("/Applications"), s.home.join("Applications")] {
        for a in APPS {
            if dir.join(a).exists() {
                apps.push(a.to_string());
            }
        }
    }
    s.note("agents", "looked for coding and AI apps in /Applications");
    apps.sort();
    apps.dedup();
    json!({ "bins": bins, "apps": apps })
}

fn scan_extensions(s: &mut Scan, project: Option<&Path>) -> Value {
    let h = s.home.clone();
    let mut mcp: Vec<Value> = Vec::new();
    let mut plugins: Vec<Value> = Vec::new();
    let mut skills: Vec<Value> = Vec::new();
    let proj_str = project.map(|p| p.display().to_string());

    let parse = |t: &str| serde_json::from_str::<Value>(t).unwrap_or(Value::Null);
    if let Some(t) = s.read("extensions", &h.join(".claude.json"), "Claude Code MCP server names") {
        mcp.extend(claude_json_mcp(&parse(&t), proj_str.as_deref()));
    }
    if let Some(t) = s.read("extensions", &h.join(".claude/plugins/installed_plugins.json"), "Claude Code plugin names") {
        plugins.extend(claude_plugins(&parse(&t)));
    }
    if let Some(t) = s.read("extensions", &h.join(".codex/config.toml"), "Codex MCP server and plugin names") {
        let (m, p) = codex_toml(&t);
        mcp.extend(m);
        plugins.extend(p);
    }
    for (path, agent, key, why) in [
        (h.join(".cursor/mcp.json"), "cursor", "mcpServers", "Cursor MCP server names"),
        (h.join(".gemini/settings.json"), "gemini", "mcpServers", "Gemini CLI MCP server names"),
        (h.join(".codeium/windsurf/mcp_config.json"), "windsurf", "mcpServers", "Windsurf MCP server names"),
        (h.join(".copilot/mcp-config.json"), "copilot", "mcpServers", "Copilot CLI MCP server names"),
    ] {
        if let Some(t) = s.read("extensions", &path, why) {
            mcp.extend(mcp_map(parse(&t).get(key), agent, "user"));
        }
    }
    if let Some(p) = project {
        for (rel, agent) in [(".mcp.json", "claude"), (".cursor/mcp.json", "cursor")] {
            if let Some(t) = s.read("extensions", &p.join(rel), "project MCP server names") {
                mcp.extend(mcp_map(parse(&t).get("mcpServers"), agent, "project"));
            }
        }
    }
    // skills: one folder each with a SKILL.md (front matter only)
    let mut skill_dirs = vec![(h.join(".claude/skills"), "claude"), (h.join(".codex/skills"), "codex"), (h.join(".agents/skills"), "any")];
    if let Some(p) = project {
        skill_dirs.push((p.join(".claude/skills"), "claude"));
    }
    for (dir, agent) in skill_dirs {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let shown = s.tilde(&dir);
        s.note("extensions", format!("{shown} (skill names and descriptions)"));
        for e in rd.flatten().take(200) {
            let dir_name = e.file_name().to_string_lossy().to_string();
            let md = e.path().join("SKILL.md");
            if dir_name.starts_with('.') || !md.exists() {
                continue;
            }
            let head: String = std::fs::read_to_string(&md).unwrap_or_default().chars().take(2000).collect();
            let (name, description) = skill_front_matter(&head, &dir_name);
            skills.push(json!({ "name": name, "description": description, "agent": agent }));
        }
    }
    json!({ "mcp": mcp, "plugins": plugins, "skills": skills })
}

fn scan_instructions(s: &mut Scan, project: Option<&Path>) -> Value {
    let h = s.home.clone();
    let mut files: Vec<(PathBuf, &str)> = vec![
        (h.join(".claude/CLAUDE.md"), "global"),
        (h.join(".codex/AGENTS.md"), "global"),
        (h.join(".gemini/GEMINI.md"), "global"),
    ];
    if let Some(p) = project {
        for rel in ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursorrules", ".github/copilot-instructions.md", "replit.md"] {
            files.push((p.join(rel), "project"));
        }
        for dir in [".cursor/rules", ".windsurf/rules", ".claude/rules"] {
            if let Ok(rd) = std::fs::read_dir(p.join(dir)) {
                for e in rd.flatten().take(30) {
                    files.push((e.path(), "project"));
                }
            }
        }
    }
    let mut out = Vec::new();
    for (path, scope) in files {
        if let Some(t) = s.read("instructions", &path, "size and headings only") {
            out.push(json!({ "file": s.tilde(&path), "scope": scope, "bytes": t.len(), "headings": headings(&t) }));
        }
    }
    Value::Array(out)
}

fn scan_stack(s: &mut Scan, project: Option<&Path>) -> Value {
    let Some(p) = project else { return json!({}) };
    let mut deps: Vec<String> = Vec::new();
    let mut languages: BTreeSet<&str> = BTreeSet::new();
    if let Some(t) = s.read("stack", &p.join("package.json"), "dependency names") {
        deps.extend(package_json_deps(&serde_json::from_str(&t).unwrap_or(Value::Null)));
        languages.insert(if p.join("tsconfig.json").exists() { "typescript" } else { "javascript" });
    }
    for rel in ["Cargo.toml", "src-tauri/Cargo.toml"] {
        if let Some(t) = s.read("stack", &p.join(rel), "dependency names") {
            deps.extend(cargo_deps(&t));
            languages.insert("rust");
        }
    }
    let py = s.read("stack", &p.join("pyproject.toml"), "dependency names");
    let req = s.read("stack", &p.join("requirements.txt"), "dependency names");
    if py.is_some() || req.is_some() {
        deps.extend(python_deps(py.as_deref(), req.as_deref()));
        languages.insert("python");
    }
    if s.read("stack", &p.join("go.mod"), "module names").is_some() {
        languages.insert("go");
    }
    deps.sort();
    deps.dedup();
    let frameworks: Vec<&str> = FRAMEWORKS.iter().copied().filter(|f| deps.iter().any(|d| d == f)).collect();
    json!({ "languages": languages, "frameworks": frameworks, "dependencies": deps.into_iter().take(80).collect::<Vec<_>>() })
}

fn scan_git(s: &mut Scan, project: Option<&Path>) -> Value {
    let Some(p) = project else { return json!({}) };
    let subjects = run("git", &["log", "--since=30.days.ago", "--pretty=%s", "-n", "500"], Some(p), 8);
    let branches = run("git", &["branch", "-a", "--format=%(refname:short)"], Some(p), 8);
    s.note("git", format!("{} (commit counts and branch name patterns — no code or messages kept)", s.tilde(p)));
    git_habits(&subjects, &branches)
}

fn scan_packages(s: &mut Scan) -> Value {
    let lines = |t: String| -> Vec<String> { t.lines().map(str::trim).filter(|l| !l.is_empty() && l.len() <= 60).map(str::to_owned).take(300).collect() };
    let brew_formulae = lines(run("/bin/zsh", &["-lc", "command -v brew >/dev/null && brew list --formula -1"], None, 20));
    let brew_casks = lines(run("/bin/zsh", &["-lc", "command -v brew >/dev/null && brew list --cask -1"], None, 20));
    s.note("packages", "Homebrew package names (brew list)");
    let npm_raw = run("/bin/zsh", &["-lc", "command -v npm >/dev/null && npm ls -g --depth=0 --json"], None, 20);
    let npm: Vec<String> = serde_json::from_str::<Value>(&npm_raw).ok().and_then(|v| v.get("dependencies").and_then(Value::as_object).map(|m| m.keys().cloned().collect())).unwrap_or_default();
    s.note("packages", "global npm package names (npm ls -g)");
    let mut ext: BTreeSet<String> = BTreeSet::new();
    for dir in [".vscode/extensions", ".cursor/extensions", ".windsurf/extensions"] {
        let d = s.home.join(dir);
        if let Ok(rd) = std::fs::read_dir(&d) {
            let shown = s.tilde(&d);
            s.note("packages", format!("{shown} (extension names)"));
            ext.extend(rd.flatten().filter_map(|e| extension_id(&e.file_name().to_string_lossy())));
        }
    }
    json!({ "brew": brew_formulae, "brewCasks": brew_casks, "npmGlobal": npm, "editorExtensions": ext })
}

fn scan_history(s: &mut Scan) -> Value {
    let mut all: BTreeMap<String, usize> = BTreeMap::new();
    for rel in [".zsh_history", ".bash_history", ".local/share/fish/fish_history"] {
        let p = s.home.join(rel);
        let Ok(bytes) = std::fs::read(&p) else { continue };
        let shown = s.tilde(&p);
        s.note("history", format!("{shown} (first word of each command only; the rest is never kept)"));
        for (cmd, n) in history_counts(&String::from_utf8_lossy(&bytes)) {
            *all.entry(cmd).or_default() += n;
        }
    }
    let names: Vec<String> = all.keys().cloned().collect();
    let real = programs_on_path(&names);
    s.note("history", "checked which of those words are installed programs");
    let mut v = keep_programs(all.into_iter().collect(), |c| real.contains(c));
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    Value::Array(v.into_iter().take(40).map(|(cmd, count)| json!({ "cmd": cmd, "count": count })).collect())
}

/// Scan the chosen sources. `project` is the repo the user picked (stack,
/// git, project-level files); without it those sections are skipped.
/// Saves the result to ~/.grillme/scan.json and returns it.
#[tauri::command(async)]
pub fn workflow_scan(project: Option<String>, sources: Vec<String>) -> Result<Value, String> {
    let mut s = Scan { home: home(), checked: Vec::new() };
    let project = project.map(PathBuf::from).filter(|p| p.is_dir());
    let p = project.as_deref();
    let on = |id: &str| sources.iter().any(|x| x == id);
    let mut out = Map::new();
    out.insert("ts".into(), json!(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)));
    out.insert("sources".into(), json!(sources.iter().filter(|x| SOURCES.contains(&x.as_str())).collect::<Vec<_>>()));
    if let Some(p) = p {
        out.insert("project".into(), json!(s.tilde(p)));
    }
    if on("agents") {
        out.insert("agents".into(), scan_agents(&mut s));
    }
    if on("extensions") {
        out.insert("extensions".into(), scan_extensions(&mut s, p));
    }
    if on("instructions") {
        out.insert("instructions".into(), scan_instructions(&mut s, p));
    }
    if on("stack") {
        out.insert("stack".into(), scan_stack(&mut s, p));
    }
    if on("git") {
        out.insert("git".into(), scan_git(&mut s, p));
    }
    if on("packages") {
        out.insert("packages".into(), scan_packages(&mut s));
    }
    if on("history") {
        out.insert("history".into(), scan_history(&mut s));
    }
    out.insert("checked".into(), Value::Array(std::mem::take(&mut s.checked)));
    let v = Value::Object(out);
    let dir = s.home.join(".grillme");
    let _ = std::fs::create_dir_all(&dir);
    let tmp = dir.join("scan.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("scan.json")).map_err(|e| e.to_string())?;
    Ok(v)
}

/// The last saved scan, if any (the workflow step reads it after a reload).
#[tauri::command]
pub fn workflow_scan_read() -> Option<Value> {
    let text = std::fs::read_to_string(home().join(".grillme/scan.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Forget the scan (the "Delete" button next to "What we looked at").
#[tauri::command]
pub fn workflow_scan_delete() -> Result<(), String> {
    match std::fs::remove_file(home().join(".grillme/scan.json")) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_summaries_never_carry_secrets() {
        let cfg = json!({
            "mcpServers": {
                "butterbase": { "type": "http", "url": "https://user:pw@api.butterbase.dev:443/mcp?token=abc", "headers": { "Authorization": "Bearer sk-live-123" } },
                "gbrain": { "command": "/Users/x/.bun/bin/gbrain", "args": ["serve", "--api-key=sk-123", "/Users/x/brain", "@scope/pkg", "sk_live_51HxYzAbCdEf1234567890qwer"], "env": { "OPENAI_API_KEY": "sk-abc" } },
            },
            "projects": { "/repo": { "mcpServers": { "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" } } } }
        });
        let out = claude_json_mcp(&cfg, Some("/repo"));
        let text = out.iter().map(|v| v.to_string()).collect::<String>();
        for secret in ["sk-", "Bearer", "pw", "token", "abc", "/Users", "OPENAI", "sk_live"] {
            assert!(!text.contains(secret), "leaked {secret}: {text}");
        }
        assert_eq!(out[0]["host"], "api.butterbase.dev");
        assert_eq!(out[1]["command"], "gbrain");
        assert_eq!(out[1]["packages"], json!(["serve", "@scope/pkg"]));
        assert_eq!(out[2], json!({ "name": "linear", "agent": "claude", "scope": "project", "transport": "http", "host": "mcp.linear.app" }));
    }

    #[test]
    fn reads_codex_config_names_only() {
        let toml = r#"
[mcp_servers.ccsquad]
command = "npx"
args = ["-y", "@ccsquad/mcp"]
env = { API_KEY = "secret-value" }

[mcp_servers.remote]
url = "https://mcp.example.com/sse"
bearer_token_env_var = "EXAMPLE_TOKEN"

[plugins."superpowers@claude-plugins-official"]
enabled = true
"#;
        let (mcp, plugins) = codex_toml(toml);
        let text = format!("{mcp:?}");
        assert!(!text.contains("secret-value") && !text.contains("EXAMPLE_TOKEN"), "{text}");
        assert_eq!(mcp[0]["packages"], json!(["@ccsquad/mcp"]));
        assert_eq!(mcp[1]["host"], "mcp.example.com");
        assert_eq!(plugins, vec![json!({ "name": "superpowers", "marketplace": "claude-plugins-official", "agent": "codex" })]);
        assert!(codex_toml("not = [valid").0.is_empty(), "bad TOML fails quietly");
    }

    #[test]
    fn reads_claude_plugins_and_skill_front_matter() {
        let v = json!({ "version": 2, "plugins": { "caveman@caveman": [{}], "vercel-plugin@vercel-vercel-plugin": [{}] } });
        assert_eq!(claude_plugins(&v)[0], json!({ "name": "caveman", "marketplace": "caveman", "agent": "claude" }));
        let md = "---\nname: grillme\ndescription: \"Personal coach\"\n---\n# body is never read";
        assert_eq!(skill_front_matter(md, "dir"), ("grillme".into(), "Personal coach".into()));
        assert_eq!(skill_front_matter("# no front matter", "dir").0, "dir");
    }

    #[test]
    fn instruction_files_give_headings_only() {
        assert_eq!(headings("# Rules\nsecret body line\n## Testing\n#not-a-heading-but-ok\n"), vec!["Rules", "Testing", "not-a-heading-but-ok"]);
    }

    #[test]
    fn history_keeps_only_program_names_seen_often() {
        let h = "\
: 1700000000:0;claude --dangerously-skip-permissions\n\
: 1700000001:0;claude\n\
: 1700000002:0;OPENAI_API_KEY=sk-abc123 claude -p hi\n\
: 1700000003:0;cd ~/code\n\
export TOKEN=sk-live-zzz\n\
sk-live-pasted-by-mistake\n\
sk-live-pasted-by-mistake\n\
sk-live-pasted-by-mistake\n\
a8f3k2j9x7q1w5e3r8t6\n\
a8f3k2j9x7q1w5e3r8t6\n\
a8f3k2j9x7q1w5e3r8t6\n\
sudo bun install\nbun dev\n/usr/local/bin/bun test\n\
vercel deploy\n";
        let counts = history_counts(h);
        // secret-shaped words are dropped by shape ("sk-…", digit-heavy)…
        assert_eq!(counts, vec![("bun".to_string(), 3), ("claude".to_string(), 3)]);
        // …and anything else must be a real program on this machine
        let kept = keep_programs(vec![("bun".into(), 3), ("mysterytoken".into(), 5)], |c| c == "bun");
        assert_eq!(kept, vec![("bun".to_string(), 3)]);
        // what we keep never includes anything after the first word
        assert!(!format!("{counts:?}").contains("sk-abc123") && !format!("{counts:?}").contains("--dangerously"));
    }

    #[test]
    fn git_habits_are_counts_not_text() {
        let subjects = "feat: login (#12)\nfix(api): null check\nwip\nMerge pull request #3 from x/y\n";
        let branches = "main\nfeat/login\nfeat/api\nfix/null\norigin/feat/x\norigin/HEAD\n";
        let g = git_habits(subjects, branches);
        assert_eq!(g["commits30d"], 4);
        assert_eq!(g["conventionalCommits"], 0.5);
        assert_eq!(g["usesPullRequests"], true);
        assert_eq!(g["branchPrefixes"], json!(["feat", "fix"]));
        assert!(!g.to_string().contains("login"));
    }

    #[test]
    fn stack_parsers_pick_dependency_names() {
        let pkg = json!({ "dependencies": { "next": "15", "react": "19" }, "devDependencies": { "vitest": "4" } });
        assert_eq!(package_json_deps(&pkg), vec!["next", "react", "vitest"]);
        assert_eq!(cargo_deps("[dependencies]\ntokio = \"1\"\nserde = { version = \"1\" }\n"), vec!["serde", "tokio"]);
        let py = python_deps(Some("[project]\ndependencies = [\"fastapi>=0.1\", \"pydantic\"]\n"), Some("# c\npytest==8\n-r other.txt\n"));
        assert_eq!(py, vec!["fastapi", "pydantic", "pytest"]);
    }

    #[test]
    fn helpers() {
        assert_eq!(url_host("https://a:b@Mcp.Linear.app:8443/mcp?x=1").as_deref(), Some("mcp.linear.app"));
        assert_eq!(url_host("ftp://x"), None);
        assert_eq!(extension_id("anthropic.claude-code-2.1.0").as_deref(), Some("anthropic.claude-code"));
        assert_eq!(extension_id(".obsolete"), None);
        assert!(safe_arg("@playwright/mcp") && safe_arg("serve") && !safe_arg("--token") && !safe_arg("/Users/me") && !safe_arg("API_KEY=1"));
    }

    /// Real scan of this machine → ~/.grillme/scan.json. Run:
    /// cargo test --lib scan::tests::live -- --ignored
    #[test]
    #[ignore]
    fn live_scan_this_machine() {
        let project = std::env::var("SCAN_PROJECT").ok();
        let v = workflow_scan(project, SOURCES.iter().map(|s| s.to_string()).collect()).unwrap();
        assert!(v["checked"].as_array().is_some_and(|a| !a.is_empty()));
    }
}
