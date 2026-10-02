// ---------------------------------------------------------------------------
// "Build my Coding DNA from my past": one-off, opt-in reads of what's already
// on this Mac. Each source is its own command, so each is its own checkbox.
//
//   claude    past Claude Code sessions (~/.claude/projects)    -> counts
//   codex     past Codex sessions (~/.codex/sessions)            -> counts
//   git       history of chosen repos: cadence, commit size,
//             conventional commits, AI co-authors, reverts, tests -> numbers
//   rules     the rules you already wrote (CLAUDE.md, AGENTS.md,
//             GEMINI.md, Cursor rules, Copilot instructions)      -> short lines
//   tools     installs / removals in your shell history          -> tool names
//   terminal  which commands you run most                        -> names + counts
//
// Patterns, never code or full prompts: prompts are only counted and
// classified; commit messages only flagged; history keeps first words and
// the names of installed tools. Nothing leaves this Mac.
// ---------------------------------------------------------------------------

use crate::learn::{count_command, count_prompt, has, moments_of, read_new, rx, take_line, Batch, Sess};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_BYTES: u64 = 300 * 1024 * 1024;

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
}
fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
fn modified(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}
/// "-Users-me-code-my-app" -> "my-app"-ish (the slug is lossy; good enough for a label).
fn project_of_slug(slug: &str) -> String {
    slug.rsplit('-').find(|p| !p.is_empty()).unwrap_or(slug).to_string()
}
fn jsonl_files(dir: &Path, cutoff: u64, out: &mut Vec<PathBuf>, depth: u32) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() && depth > 0 { jsonl_files(&p, cutoff, out, depth - 1); }
        else if p.extension().is_some_and(|x| x == "jsonl") && modified(&p) >= cutoff { out.push(p); }
    }
}

/// Every past Claude Code session from the last `months` months.
#[tauri::command(async)]
pub fn past_claude(months: u32) -> Batch {
    let root = home().join(".claude").join("projects");
    let cutoff = now_secs().saturating_sub(months.clamp(1, 24) as u64 * 30 * 86400);
    let mut b = Batch::default();
    let mut sessions: HashMap<String, Sess> = HashMap::new();
    let mut pending = HashMap::new();
    let mut budget = MAX_BYTES;
    let Ok(rd) = std::fs::read_dir(&root) else { return b };
    for d in rd.flatten() {
        let project = project_of_slug(&d.file_name().to_string_lossy());
        let mut files = vec![];
        jsonl_files(&d.path(), cutoff, &mut files, 0);
        for f in files {
            if let Some((text, _)) = read_new(&f, 0, &mut budget) {
                for line in text.lines() { take_line(line, &mut b, &mut sessions, &mut pending, &project); }
            }
        }
    }
    moments_of(&sessions, &mut b);
    b
}

/// One Codex log line (a different format from Claude Code's).
fn take_codex(line: &str, b: &mut Batch, sessions: &mut HashMap<String, Sess>, pending: &mut HashMap<String, String>, sid: &str, project: &mut String) {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return };
    let p = v.get("payload").cloned().unwrap_or(Value::Null);
    let t = v.get("timestamp").and_then(Value::as_str).and_then(|t| crate::chrono_lite_parse(t).ok()).unwrap_or(0);
    let s = sessions.entry(sid.to_string()).or_insert_with(|| Sess { project: project.clone(), ..Default::default() });
    if t > 0 {
        if s.first == 0 || t < s.first { s.first = t; }
        s.last = s.last.max(t);
        if b.from == 0 || t < b.from { b.from = t; }
        b.to = b.to.max(t);
    }
    match (v.get("type").and_then(Value::as_str), p.get("type").and_then(Value::as_str)) {
        (Some("session_meta"), _) => {
            if let Some(cwd) = p.get("cwd").and_then(Value::as_str) {
                *project = Path::new(cwd).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                s.project = project.clone();
            }
        }
        (Some("turn_context"), _) => {
            if let Some(m) = p.get("model").and_then(Value::as_str) { *b.models.entry(m.to_string()).or_default() += 1; }
        }
        (Some("response_item"), Some("message")) if p.get("role").and_then(Value::as_str) == Some("user") => {
            let text: String = p.get("content").and_then(Value::as_array).into_iter().flatten()
                .filter_map(|c| c.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n");
            count_prompt(&text, b, s);
        }
        (Some("response_item"), Some("function_call")) => {
            let name = p.get("name").and_then(Value::as_str).unwrap_or("");
            if let Some(server) = name.strip_prefix("mcp__").and_then(|r| r.split("__").next()) { *b.mcp.entry(server.to_string()).or_default() += 1; }
            else if !name.is_empty() { *b.tools.entry(name.to_string()).or_default() += 1; }
            if name == "exec_command" || name == "shell" {
                let args: Value = p.get("arguments").and_then(Value::as_str).and_then(|a| serde_json::from_str(a).ok()).unwrap_or(Value::Null);
                let cmd = match args.get("cmd").or_else(|| args.get("command")) {
                    Some(Value::String(c)) => c.clone(),
                    Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "),
                    _ => String::new(),
                };
                let id = p.get("call_id").and_then(Value::as_str).unwrap_or("").to_string();
                if let Some(run) = count_command(&cmd, b, s) { if !id.is_empty() { pending.insert(id, run); } }
            }
        }
        (Some("response_item"), Some("function_call_output")) => {
            let id = p.get("call_id").and_then(Value::as_str).unwrap_or("");
            if let Some(run) = pending.remove(id) {
                let out = p.get("output").and_then(Value::as_str).unwrap_or("");
                let code = out.find("Process exited with code ").and_then(|i| out[i + 25..].split(|c: char| !c.is_ascii_digit()).next()).and_then(|n| n.parse::<i32>().ok());
                if code.is_some_and(|c| c != 0) || (code.is_none() && has(&rx().fail, out)) {
                    b.test_fails += 1;
                    *s.fails_by_runner.entry(run).or_default() += 1;
                }
            }
        }
        _ => {}
    }
}

/// Every past Codex session from the last `months` months.
#[tauri::command(async)]
pub fn past_codex(months: u32) -> Batch {
    let root = home().join(".codex").join("sessions");
    let cutoff = now_secs().saturating_sub(months.clamp(1, 24) as u64 * 30 * 86400);
    let mut files = vec![];
    jsonl_files(&root, cutoff, &mut files, 4);
    let mut b = Batch::default();
    let mut sessions: HashMap<String, Sess> = HashMap::new();
    let mut pending = HashMap::new();
    let mut budget = MAX_BYTES;
    for f in files {
        let sid = f.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let mut project = String::new();
        if let Some((text, _)) = read_new(&f, 0, &mut budget) {
            for line in text.lines() { take_codex(line, &mut b, &mut sessions, &mut pending, &sid, &mut project); }
        }
    }
    moments_of(&sessions, &mut b);
    b
}

// -- git ---------------------------------------------------------------------------

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStats {
    pub repo: String,
    pub commits: u32,
    pub weeks_active: u32,
    pub conventional: u32,
    pub ai_coauthored: u32,
    pub reverts: u32,
    pub median_lines: u32,
    pub big_commits: u32,
    pub test_file_share: u32,
    pub branch_prefixes: Vec<String>,
    pub merges: u32,
}

fn git(repo: &str, args: &[&str]) -> String {
    Command::new("git").arg("-C").arg(repo).args(args).output().ok().filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

/// History patterns for one repo over the last year (no messages kept).
pub fn git_stats(repo: &str) -> Option<GitStats> {
    let log = git(repo, &["log", "--since=12.months", "--no-merges", "--pretty=format:%at%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,separator=;)%x1e"]);
    if log.trim().is_empty() { return None; }
    let conv = regex::Regex::new(r"^(feat|fix|chore|docs|refactor|test|perf|ci|build|style|revert)(\(.+?\))?!?:").unwrap();
    let ai = regex::Regex::new(r"(?i)claude|anthropic|codex|openai|copilot|cursor|gemini|aider|devin").unwrap();
    let mut s = GitStats { repo: Path::new(repo).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), ..Default::default() };
    let mut weeks = std::collections::BTreeSet::new();
    for rec in log.split('\u{1e}') {
        let f: Vec<&str> = rec.trim().split('\u{1f}').collect();
        if f.len() < 2 { continue; }
        s.commits += 1;
        if let Ok(t) = f[0].parse::<u64>() { weeks.insert(t / (7 * 86400)); }
        if conv.is_match(f[1]) { s.conventional += 1; }
        if f[1].starts_with("Revert") || f[1].starts_with("revert") { s.reverts += 1; }
        if f.get(2).is_some_and(|t| ai.is_match(t)) { s.ai_coauthored += 1; }
    }
    s.weeks_active = weeks.len() as u32;
    // commit sizes (lines changed), and how often tests are touched
    let stat = git(repo, &["log", "--since=12.months", "--no-merges", "--numstat", "--pretty=format:%x1e"]);
    let test = regex::Regex::new(r"(?i)(^|/)(tests?|__tests__|spec)/|[._-](test|spec)\.[a-z]+$|_test\.go$").unwrap();
    let mut sizes = vec![];
    let (mut files, mut test_files) = (0u32, 0u32);
    for rec in stat.split('\u{1e}') {
        let mut lines = 0u32;
        for l in rec.lines() {
            let p: Vec<&str> = l.split('\t').collect();
            if p.len() != 3 { continue; }
            lines += p[0].parse::<u32>().unwrap_or(0) + p[1].parse::<u32>().unwrap_or(0);
            files += 1;
            if test.is_match(p[2]) { test_files += 1; }
        }
        if lines > 0 { sizes.push(lines); }
    }
    sizes.sort_unstable();
    s.median_lines = sizes.get(sizes.len() / 2).copied().unwrap_or(0);
    s.big_commits = sizes.iter().filter(|&&n| n > 500).count() as u32;
    s.test_file_share = if files > 0 { test_files * 100 / files } else { 0 };
    // branch naming
    let mut prefixes: BTreeMap<String, u32> = BTreeMap::new();
    for b in git(repo, &["for-each-ref", "--format=%(refname:short)", "refs/heads"]).lines() {
        if let Some((p, _)) = b.split_once('/') { *prefixes.entry(format!("{p}/")).or_default() += 1; }
    }
    let mut pv: Vec<_> = prefixes.into_iter().collect();
    pv.sort_by(|a, b| b.1.cmp(&a.1));
    s.branch_prefixes = pv.into_iter().take(4).map(|(p, _)| p).collect();
    s.merges = git(repo, &["log", "--since=12.months", "--merges", "--oneline"]).lines().count() as u32;
    Some(s)
}

/// Git repos to offer: the given ones, plus any found two levels under the
/// usual code folders.
#[tauri::command(async)]
pub fn past_find_repos() -> Vec<String> {
    let h = home();
    let mut out = vec![];
    for base in ["Terminal", "code", "Code", "dev", "Developer", "Projects", "projects", "src", "repos", "work", "Documents/GitHub", "GitHub"] {
        let root = h.join(base);
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.join(".git").exists() { out.push(p.to_string_lossy().into_owned()); continue; }
            if let Ok(sub) = std::fs::read_dir(&p) {
                for s in sub.flatten() { if s.path().join(".git").exists() { out.push(s.path().to_string_lossy().into_owned()); } }
            }
            if out.len() >= 60 { break; }
        }
    }
    out.sort();
    out.dedup();
    out
}

#[tauri::command(async)]
pub fn past_git(repos: Vec<String>) -> Vec<GitStats> {
    repos.iter().filter(|r| r.starts_with('/') && !r.contains("..")).take(60).filter_map(|r| git_stats(r)).collect()
}

// -- rules you already wrote ----------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
pub struct RuleLine {
    pub text: String,
    pub file: String,
    /// "personal" (a global file) or "project"
    pub scope: String,
    pub project: String,
}

/// Short rule-like lines from an instructions file: bullets and imperative
/// sentences, outside code blocks, minus Grill Me's own Coding DNA block.
pub fn rule_lines(text: &str) -> Vec<String> {
    let imperative = regex::Regex::new(r"(?i)^(always|never|don'?t|do not|must|should|prefer|avoid|use|keep|run|write|make sure|only|no |ask|commit|test|check|follow|before|after|pull|push|merge|open|create|add|name|branch|squash|rebase|document|update|read|explain|show|stop|wait|ship|deploy|review|start|end|put|leave|let|treat)\b").unwrap();
    let mut out = vec![];
    let (mut fence, mut ours) = (false, false);
    for raw in text.lines() {
        let l = raw.trim();
        if l.starts_with("```") { fence = !fence; continue; }
        if l.contains("<!-- Coding DNA") { ours = true; continue; }
        if l.contains("<!-- /Coding DNA") { ours = false; continue; }
        if fence || ours || l.is_empty() || l.starts_with('#') || l.starts_with('|') { continue; }
        let body = l.trim_start_matches(['-', '*', '+', ' ']).trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ')').trim();
        let body = body.replace("**", "").replace('`', "");
        let bullet = l.starts_with('-') || l.starts_with('*') || l.chars().next().is_some_and(|c| c.is_ascii_digit());
        // several rules on one line ("Every feature gets a branch. Never push to main.")
        let sentences: Vec<String> = body.split_inclusive(['.', '!']).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
        let parts = if sentences.len() > 1 && !bullet { sentences } else { vec![body.trim().to_string()] };
        for part in parts {
            if part.len() < 12 || part.len() > 180 { continue; }
            if bullet || imperative.is_match(&part) || part.split_whitespace().next().is_some_and(|w| ["every", "each", "all", "no"].contains(&w.to_lowercase().as_str())) {
                out.push(part);
            }
        }
        if out.len() >= 25 { out.truncate(25); break; }
    }
    out
}

#[tauri::command(async)]
pub fn past_rules(repos: Vec<String>) -> Vec<RuleLine> {
    let h = home();
    let mut out = vec![];
    let mut take = |path: PathBuf, label: String, scope: &str, project: &str| {
        if let Ok(t) = std::fs::read_to_string(&path) {
            for text in rule_lines(&t) { out.push(RuleLine { text, file: label.clone(), scope: scope.into(), project: project.into() }); }
        }
    };
    for (rel, label) in [(".claude/CLAUDE.md", "~/.claude/CLAUDE.md"), (".codex/AGENTS.md", "~/.codex/AGENTS.md"), (".gemini/GEMINI.md", "~/.gemini/GEMINI.md")] {
        take(h.join(rel), label.into(), "personal", "");
    }
    for repo in repos.iter().filter(|r| r.starts_with('/') && !r.contains("..")).take(60) {
        let name = Path::new(repo).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        for rel in ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".github/copilot-instructions.md"] {
            take(Path::new(repo).join(rel), format!("{name}/{rel}"), "project", &name);
        }
        if let Ok(rd) = std::fs::read_dir(Path::new(repo).join(".cursor/rules")) {
            for e in rd.flatten().take(10) {
                take(e.path(), format!("{name}/.cursor/rules/{}", e.file_name().to_string_lossy()), "project", &name);
            }
        }
    }
    out.truncate(150);
    out
}

// -- your shell history: tools added and removed, commands you run ---------------------

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolEvent { pub tool: String, pub action: String, pub via: String, pub at: u64 }

fn history_lines() -> Vec<(u64, String)> {
    let h = home();
    let mut out = vec![];
    for f in [".zsh_history", ".bash_history"] {
        let Ok(bytes) = std::fs::read(h.join(f)) else { continue };
        for l in String::from_utf8_lossy(&bytes).lines() {
            // zsh extended history: ": 1712345678:0;cmd"
            if let Some(rest) = l.strip_prefix(": ") {
                if let Some((meta, cmd)) = rest.split_once(';') {
                    let at = meta.split(':').next().and_then(|t| t.parse().ok()).unwrap_or(0);
                    out.push((at, cmd.to_string()));
                    continue;
                }
            }
            out.push((0, l.to_string()));
        }
    }
    out
}

/// A plain tool name (no paths, flags, versions or secrets).
fn clean_tool(s: &str) -> Option<String> {
    let t = s.trim_matches(|c| c == '"' || c == '\'');
    // drop a version: "pkg@1.2" -> "pkg", "@scope/pkg@latest" -> "@scope/pkg"
    let t = match t.strip_prefix('@') {
        Some(rest) => format!("@{}", rest.split('@').next().unwrap_or(rest)),
        None => t.split('@').next().unwrap_or(t).to_string(),
    };
    let ok = !t.is_empty() && t.len() <= 60 && !t.starts_with('-') && !t.contains('=') && !t.contains("..") && !t.starts_with('/') && !t.starts_with('.')
        && t.chars().all(|c| c.is_ascii_alphanumeric() || "-_./@:".contains(c));
    ok.then(|| t.to_lowercase())
}

pub fn tool_events(lines: &[(u64, String)]) -> Vec<ToolEvent> {
    let pats: Vec<(regex::Regex, &str, &str)> = vec![
        (regex::Regex::new(r"^brew (install|reinstall)(\s+--cask)?\s+(.+)$").unwrap(), "added", "brew"),
        (regex::Regex::new(r"^brew (uninstall|remove|rm)(\s+--cask)?\s+(.+)$").unwrap(), "removed", "brew"),
        (regex::Regex::new(r"^(?:npm|pnpm) (?:i|install|add) (?:-g|--global) (.+)$").unwrap(), "added", "npm"),
        (regex::Regex::new(r"^(?:npm|pnpm) (?:uninstall|remove|rm) (?:-g|--global) (.+)$").unwrap(), "removed", "npm"),
        (regex::Regex::new(r"^(?:pipx|uv tool) install (.+)$").unwrap(), "added", "pip"),
        (regex::Regex::new(r"^(?:pipx|uv tool) uninstall (.+)$").unwrap(), "removed", "pip"),
        (regex::Regex::new(r"^claude mcp remove\s+([A-Za-z0-9_.-]+)").unwrap(), "removed", "mcp"),
        (regex::Regex::new(r"^claude plugin install\s+(\S+)").unwrap(), "added", "plugin"),
        (regex::Regex::new(r"^claude plugin (?:uninstall|remove)\s+(\S+)").unwrap(), "removed", "plugin"),
    ];
    let mut out = vec![];
    for (at, cmd) in lines {
        let cmd = cmd.trim();
        // "claude mcp add [--flag value]... NAME ...": the first word that isn't a flag or its value
        if let Some(rest) = cmd.strip_prefix("claude mcp add ") {
            let mut it = rest.split_whitespace();
            while let Some(w) = it.next() {
                if ["--transport", "-t", "--scope", "-s", "--env", "-e", "--header", "-H"].contains(&w) { it.next(); continue; }
                if w.starts_with('-') { continue; }
                if let Some(tool) = clean_tool(w) { out.push(ToolEvent { tool, action: "added".into(), via: "mcp".into(), at: *at }); }
                break;
            }
            continue;
        }
        for (re, action, via) in &pats {
            let Some(c) = re.captures(cmd) else { continue };
            let names = c.get(c.len() - 1).map(|m| m.as_str()).unwrap_or("");
            for n in names.split_whitespace().take(6) {
                if let Some(tool) = clean_tool(n) {
                    out.push(ToolEvent { tool, action: (*action).into(), via: (*via).into(), at: *at });
                }
            }
            break;
        }
    }
    out
}

#[tauri::command(async)]
pub fn past_tools() -> Vec<ToolEvent> {
    let mut ev = tool_events(&history_lines());
    if ev.len() > 300 { ev.drain(..ev.len() - 300); }
    ev
}

/// Which commands you run most (first word only), top 40.
#[tauri::command(async)]
pub fn past_terminal() -> Vec<(String, u32)> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for (_, cmd) in history_lines() {
        let first = cmd.split_whitespace().find(|w| !w.contains('=')).unwrap_or("");
        let name = first.rsplit('/').next().unwrap_or("");
        if !name.is_empty() && name.len() <= 30 && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
            *counts.entry(name.to_string()).or_default() += 1;
        }
    }
    let mut v: Vec<_> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.truncate(40);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_lines_keeps_rules_not_code_or_our_block() {
        let md = "# Rules\n- Always run the tests before committing\n- Short\n```\nnever do this inside code\n```\nNever push directly to main.\n<!-- Coding DNA -->\n- Our own synced rule\n<!-- /Coding DNA -->\nSome prose paragraph that is not a rule at all really.\nEvery feature gets its own branch. Merge into main when ready. Pull from main before every session\n";
        assert_eq!(rule_lines(md), vec!["Always run the tests before committing", "Never push directly to main.", "Every feature gets its own branch.", "Merge into main when ready.", "Pull from main before every session"]);
    }

    #[test]
    fn tool_events_name_tools_only() {
        let h = vec![
            (1, "brew install gitleaks act".to_string()),
            (2, "npm i -g @anthropic-ai/claude-code@latest".to_string()),
            (3, "brew uninstall --cask warp".to_string()),
            (4, "claude mcp add --transport http linear https://mcp.linear.app/mcp".to_string()),
            (5, "claude mcp remove context7".to_string()),
            (6, "export SECRET=abc && brew install x".to_string()),
            (7, "claude plugin install superpowers@superpowers-marketplace".to_string()),
        ];
        let ev = tool_events(&h);
        let pairs: Vec<(String, String)> = ev.iter().map(|e| (e.tool.clone(), e.action.clone())).collect();
        assert!(pairs.contains(&("gitleaks".into(), "added".into())));
        assert!(pairs.contains(&("act".into(), "added".into())));
        assert!(pairs.contains(&("@anthropic-ai/claude-code".into(), "added".into())));
        assert!(pairs.contains(&("warp".into(), "removed".into())));
        assert!(pairs.contains(&("linear".into(), "added".into())));
        assert!(pairs.contains(&("context7".into(), "removed".into())));
        assert!(pairs.contains(&("superpowers".into(), "added".into())));
        assert!(!ev.iter().any(|e| e.tool.contains("secret")));
    }

    #[test]
    fn codex_lines_count_prompts_models_and_failed_tests() {
        let mut b = Batch::default();
        let mut s = HashMap::new();
        let mut p = HashMap::new();
        let mut project = String::new();
        let lines = [
            r#"{"type":"session_meta","timestamp":"2026-09-01T10:00:00Z","payload":{"cwd":"/Users/me/shop"}}"#,
            r#"{"type":"turn_context","timestamp":"2026-09-01T10:00:00Z","payload":{"model":"gpt-5.4"}}"#,
            r#"{"type":"response_item","timestamp":"2026-09-01T10:00:01Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Plan first, then fix the cart total bug"}]}}"#,
            r#"{"type":"response_item","timestamp":"2026-09-01T10:00:02Z","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"npm test\"}"}}"#,
            r#"{"type":"response_item","timestamp":"2026-09-01T10:00:03Z","payload":{"type":"function_call_output","call_id":"c1","output":"Process exited with code 1"}}"#,
        ];
        for l in lines { take_codex(l, &mut b, &mut s, &mut p, "x", &mut project); }
        assert_eq!((b.prompts, b.plan_prompts, b.test_runs, b.test_fails), (1, 1, 1, 1));
        assert_eq!(b.models.get("gpt-5.4"), Some(&1));
        assert_eq!(project, "shop");
        assert!(!serde_json::to_string(&b).unwrap().contains("cart total"));
    }

    #[test]
    fn git_stats_on_this_repo() {
        let repo = env!("CARGO_MANIFEST_DIR").trim_end_matches("/src-tauri");
        if let Some(s) = git_stats(repo) {
            assert!(s.commits > 0);
            assert!(s.test_file_share <= 100);
        }
    }
}

#[cfg(test)]
mod live {
    #[test]
    #[ignore] // reads this Mac's real history; prints counts only
    fn live_past() {
        let t = std::time::Instant::now();
        let c = super::past_claude(6);
        println!("claude: {} sessions, {} prompts, {} test runs ({} failed), {} undos, {} moments  [{:?}]", c.sessions, c.prompts, c.test_runs, c.test_fails, c.undos, c.moments.len(), t.elapsed());
        let t = std::time::Instant::now();
        let x = super::past_codex(6);
        println!("codex: {} sessions, {} prompts, models {:?}, {} test runs ({} failed) [{:?}]", x.sessions, x.prompts, x.models.keys().collect::<Vec<_>>(), x.test_runs, x.test_fails, t.elapsed());
        let repos = super::past_find_repos();
        println!("repos found: {}", repos.len());
        let t = std::time::Instant::now();
        let g = super::past_git(repos.clone());
        println!("git: {} repos with history; commits {}; ai-coauthored {}; median lines {:?} [{:?}]", g.len(), g.iter().map(|s| s.commits).sum::<u32>(), g.iter().map(|s| s.ai_coauthored).sum::<u32>(), g.iter().map(|s| s.median_lines).collect::<Vec<_>>(), t.elapsed());
        let r = super::past_rules(repos);
        println!("rules: {} lines from {} files", r.len(), r.iter().map(|x| x.file.clone()).collect::<std::collections::BTreeSet<_>>().len());
        let tools = super::past_tools();
        println!("tool events: {} ({} added, {} removed)", tools.len(), tools.iter().filter(|e| e.action == "added").count(), tools.iter().filter(|e| e.action == "removed").count());
        println!("terminal: top {:?}", super::past_terminal().iter().take(8).map(|(n, _)| n.clone()).collect::<Vec<_>>());
    }
}
