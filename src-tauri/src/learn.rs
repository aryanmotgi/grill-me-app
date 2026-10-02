// ---------------------------------------------------------------------------
// Workflow learning: reads the session logs Claude Code writes for the
// projects open in Grill Me (~/.claude/projects/<project>/*.jsonl), only
// what's new since last time, and returns COUNTS and short labels:
//   how you prompt     prompts, length, plan-first / question / file-ref share
//   what you use       skills, slash commands, MCP servers, subagents, models
//   where you struggle test runs and failures, retried builds/tests, undos,
//                      "still broken"-style messages, and a few "moments"
// It never keeps prompt text or code: a moment is a label like
// "`go test` failed 5 times in one session". The app folds these into the
// workflow memory (src/lib/memory.ts). Nothing leaves this Mac.
// ---------------------------------------------------------------------------

use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Per run: at most this much new log text is read (the rest waits).
const MAX_BYTES_PER_RUN: u64 = 40 * 1024 * 1024;
/// Only logs touched in the last 30 days.
const MAX_AGE_SECS: u64 = 30 * 86400;
const MAX_MOMENTS: usize = 20;

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub sessions: u32,
    pub prompts: u32,
    pub prompt_words: u32,
    pub short_prompts: u32,
    pub plan_prompts: u32,
    pub question_prompts: u32,
    pub file_ref_prompts: u32,
    pub frustrated_prompts: u32,
    pub slash: BTreeMap<String, u32>,
    pub skills: BTreeMap<String, u32>,
    pub mcp: BTreeMap<String, u32>,
    pub subagents: BTreeMap<String, u32>,
    pub models: BTreeMap<String, u32>,
    pub tools: BTreeMap<String, u32>,
    pub test_runs: u32,
    pub test_fails: u32,
    pub retries: u32,
    pub undos: u32,
    pub moments: Vec<Moment>,
    /// earliest / latest event seen (unix seconds)
    pub from: u64,
    pub to: u64,
}

#[derive(Serialize, Debug, Clone)]
pub struct Moment {
    pub kind: String,
    pub detail: String,
    pub at: u64,
    pub project: String,
}

/// Where each log file was read up to.
#[derive(Default, serde::Deserialize, Serialize)]
struct State {
    offsets: HashMap<String, u64>,
}

fn state_path() -> PathBuf {
    crate::grillme_root().join("learn-state.json")
}

/// The Claude Code log folders for a project: the folder itself and anything
/// inside it (worktrees, subfolders sessions were started in).
fn log_dirs(projects_root: &Path, repo: &str) -> Vec<PathBuf> {
    let slug = repo.trim_end_matches('/').replace(['/', '.'], "-");
    let Ok(rd) = std::fs::read_dir(projects_root) else { return vec![] };
    rd.flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n == slug || n.starts_with(&format!("{slug}-"))
        })
        .map(|e| e.path())
        .collect()
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Text of a message's content (a string, or the text parts of a list).
fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter_map(|x| x.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

pub(crate) fn has(re: &regex::Regex, s: &str) -> bool {
    re.is_match(s)
}

pub(crate) struct Rx {
    pub(crate) plan: regex::Regex,
    pub(crate) frustrated: regex::Regex,
    pub(crate) file_ref: regex::Regex,
    pub(crate) slash: regex::Regex,
    pub(crate) test: regex::Regex,
    pub(crate) build: regex::Regex,
    pub(crate) undo: regex::Regex,
    pub(crate) fail: regex::Regex,
}

pub(crate) fn rx() -> &'static Rx {
    static RX: std::sync::OnceLock<Rx> = std::sync::OnceLock::new();
    RX.get_or_init(|| Rx {
        plan: regex::Regex::new(r"(?i)\bplan\b|step[- ]by[- ]step|\bspec\b|design doc|outline|before (you|coding|writing)|don'?t (code|write|change) (anything )?yet|first,? .{0,80}\bthen\b").unwrap(),
        frustrated: regex::Regex::new(r"(?i)still (broken|failing|not working|wrong|the same)|(doesn'?t|didn'?t|does not|did not|isn'?t|not) work(ing)?|same (error|issue|problem|bug)|try again|that'?s (wrong|not right)|you broke|undo (that|this|it)|revert (that|this|it)|\bugh+\b|\bwtf\b|why (is|does|did) (it|this)").unwrap(),
        file_ref: regex::Regex::new(r"(^|\s)@[\w./-]+").unwrap(),
        slash: regex::Regex::new(r"<command-name>/?([\w:.-]+)</command-name>").unwrap(),
        test: regex::Regex::new(r"(?i)\b((npm|pnpm|yarn|bun)( run)? test\b|npx (vitest|jest|playwright)|\bvitest\b|\bjest\b|\bpytest\b|go test\b|cargo test\b|playwright test\b|\brspec\b|mix test\b|phpunit\b|dotnet test\b)").unwrap(),
        build: regex::Regex::new(r"(?i)\b((npm|pnpm|yarn|bun)( run)? build\b|\btsc\b|cargo (build|check)\b|go build\b|\bmake\b|gradle\b|mvn\b)").unwrap(),
        // undoing work: discarding changes, not inspecting them ("git stash list" is not an undo)
        undo: regex::Regex::new(r"(?i)\bgit (checkout -- |checkout \.(\s|$)|restore |reset --hard|revert |stash(\s+(push|save|-u|--include-untracked)\b|\s*$|\s*[;&|]))").unwrap(),
        // a real failure ("0 failed" in a passing run is not one)
        fail: regex::Regex::new(r"(?m)(\bFAIL(ED)?\b|\b[1-9]\d* (failed|failing)\b|^---\s*FAIL|panicked at|✗|✕|ERR!|exit code [1-9])").unwrap(),
    })
}

/// "npx vitest run src/x.test.ts" -> "vitest"; "go test ./..." -> "go test".
pub(crate) fn runner(cmd: &str) -> String {
    let m = rx().test.find(cmd).map(|m| m.as_str().to_lowercase()).unwrap_or_default();
    m.replace("npx ", "").replace(" run", "").trim().to_string()
}

/// One session's running tallies (for moments).
#[derive(Default)]
pub(crate) struct Sess {
    pub(crate) first: u64,
    pub(crate) last: u64,
    pub(crate) fails_by_runner: HashMap<String, u32>,
    pub(crate) cmd_seen: HashMap<String, u32>,
    pub(crate) undos: u32,
    pub(crate) frustrated: u32,
    pub(crate) project: String,
}

fn ts(v: &Value) -> u64 {
    v.get("timestamp").and_then(Value::as_str).and_then(|t| crate::chrono_lite_parse(t).ok()).unwrap_or(0)
}

/// Fold one log line into the batch.
pub(crate) fn take_line(line: &str, b: &mut Batch, sessions: &mut HashMap<String, Sess>, pending: &mut HashMap<String, String>, project: &str) {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return };
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
    if kind != "user" && kind != "assistant" {
        return;
    }
    let sid = v.get("sessionId").and_then(Value::as_str).unwrap_or("?").to_string();
    let t = ts(&v);
    let s = sessions.entry(sid).or_insert_with(|| Sess { project: project.to_string(), ..Default::default() });
    if t > 0 {
        if s.first == 0 || t < s.first { s.first = t; }
        s.last = s.last.max(t);
        if b.from == 0 || t < b.from { b.from = t; }
        b.to = b.to.max(t);
    }
    let msg = v.get("message").cloned().unwrap_or(Value::Null);
    let content = msg.get("content").cloned().unwrap_or(Value::Null);
    let r = rx();

    if kind == "assistant" {
        if let Some(model) = msg.get("model").and_then(Value::as_str) {
            if !model.starts_with('<') { *b.models.entry(model.to_string()).or_default() += 1; }
        }
        for part in content.as_array().into_iter().flatten() {
            if part.get("type").and_then(Value::as_str) != Some("tool_use") { continue; }
            let name = part.get("name").and_then(Value::as_str).unwrap_or("");
            let input = part.get("input").cloned().unwrap_or(Value::Null);
            if let Some(server) = name.strip_prefix("mcp__").and_then(|r| r.split("__").next()) {
                *b.mcp.entry(server.to_string()).or_default() += 1;
            } else if name == "Skill" {
                if let Some(sk) = input.get("skill").and_then(Value::as_str) { *b.skills.entry(sk.to_string()).or_default() += 1; }
            } else if name == "Task" || name == "Agent" {
                let st = input.get("subagent_type").and_then(Value::as_str).unwrap_or("general");
                *b.subagents.entry(st.to_string()).or_default() += 1;
            } else if !name.is_empty() {
                *b.tools.entry(name.to_string()).or_default() += 1;
            }
            if name == "Bash" {
                let cmd = input.get("command").and_then(Value::as_str).unwrap_or("");
                let id = part.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                if let Some(run) = count_command(cmd, b, s) { if !id.is_empty() { pending.insert(id, run); } }
            }
        }
        return;
    }

    // user lines: a typed prompt, a slash command, or tool results
    if let Some(parts) = content.as_array() {
        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("tool_result") { continue; }
            let id = part.get("tool_use_id").and_then(Value::as_str).unwrap_or("");
            if let Some(run) = pending.remove(id) {
                let out = text_of(part.get("content").unwrap_or(&Value::Null));
                let failed = part.get("is_error").and_then(Value::as_bool).unwrap_or(false) || has(&r.fail, &out);
                if failed {
                    b.test_fails += 1;
                    *s.fails_by_runner.entry(run).or_default() += 1;
                }
            }
        }
        if parts.iter().any(|p| p.get("type").and_then(Value::as_str) == Some("tool_result")) { return; }
    }
    if v.get("isMeta").and_then(Value::as_bool) == Some(true) { return; }
    let text = text_of(&content);
    if let Some(c) = r.slash.captures(&text) {
        *b.slash.entry(c[1].to_string()).or_default() += 1;
        return;
    }
    count_prompt(&text, b, s);
}

/** One typed prompt: counted and classified, never kept. */
pub(crate) fn count_prompt(text: &str, b: &mut Batch, s: &mut Sess) {
    let r = rx();
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.starts_with('<') || trimmed.starts_with("[Request interrupted") || trimmed.starts_with("Caveat:") { return; }
    let words = trimmed.split_whitespace().count() as u32;
    b.prompts += 1;
    b.prompt_words += words.min(2000);
    if words < 8 { b.short_prompts += 1; }
    if has(&r.plan, trimmed) { b.plan_prompts += 1; }
    if trimmed.ends_with('?') { b.question_prompts += 1; }
    if has(&r.file_ref, trimmed) { b.file_ref_prompts += 1; }
    if has(&r.frustrated, trimmed) { b.frustrated_prompts += 1; s.frustrated += 1; }
}

/** A shell command an agent ran: tests, builds, retries, undos. Returns the
 *  test runner's name when it's a test run (to match its result later). */
pub(crate) fn count_command(cmd: &str, b: &mut Batch, s: &mut Sess) -> Option<String> {
    let r = rx();
    if has(&r.undo, cmd) && !cmd.contains("restore --staged") { b.undos += 1; s.undos += 1; }
    let is_test = has(&r.test, cmd);
    if is_test || has(&r.build, cmd) {
        let norm = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
        let n = s.cmd_seen.entry(norm).or_default();
        if *n > 0 { b.retries += 1; }
        *n += 1;
    }
    if is_test { b.test_runs += 1; Some(runner(cmd)) } else { None }
}

/// Turn finished sessions' tallies into a few labelled moments.
pub(crate) fn moments_of(sessions: &HashMap<String, Sess>, b: &mut Batch) {
    for s in sessions.values() {
        for (run, n) in &s.fails_by_runner {
            if *n >= 3 {
                b.moments.push(Moment { kind: "test-loop".into(), detail: format!("`{run}` failed {n} times in one session"), at: s.last, project: s.project.clone() });
            }
        }
        if s.undos >= 2 {
            b.moments.push(Moment { kind: "undo".into(), detail: format!("Undid work {} times in one session", s.undos), at: s.last, project: s.project.clone() });
        }
        let mins = s.last.saturating_sub(s.first) / 60;
        if mins >= 90 && s.frustrated >= 3 {
            b.moments.push(Moment { kind: "struggle".into(), detail: format!("A {}h session with {} \"still not working\" moments", (mins + 30) / 60, s.frustrated), at: s.last, project: s.project.clone() });
        }
        if let Some((cmd, n)) = s.cmd_seen.iter().max_by_key(|(_, n)| **n) {
            if *n >= 5 {
                let short: String = cmd.split_whitespace().take(3).collect::<Vec<_>>().join(" ");
                b.moments.push(Moment { kind: "retry-loop".into(), detail: format!("Ran `{short}` {n} times in one session"), at: s.last, project: s.project.clone() });
            }
        }
    }
    b.sessions = sessions.len() as u32;
    b.moments.sort_by(|a, z| z.at.cmp(&a.at));
    b.moments.truncate(MAX_MOMENTS);
}

/// Read what's new in one log file (complete lines only), from `offset`.
pub(crate) fn read_new(path: &Path, offset: u64, budget: &mut u64) -> Option<(String, u64)> {
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = if offset > len { 0 } else { offset }; // rewritten: start over
    if start >= len || *budget == 0 { return None; }
    let take = (len - start).min(*budget);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity(take as usize);
    f.by_ref().take(take).read_to_end(&mut buf).ok()?;
    let end = buf.iter().rposition(|&c| c == b'\n')? + 1; // stop at the last full line
    buf.truncate(end);
    *budget = budget.saturating_sub(end as u64);
    Some((String::from_utf8_lossy(&buf).into_owned(), start + end as u64))
}

/// Learn from what's new in these projects' sessions since the last run.
pub fn learn(projects_root: &Path, repos: &[String], state: &mut HashMap<String, u64>) -> Batch {
    let mut b = Batch::default();
    let mut sessions: HashMap<String, Sess> = HashMap::new();
    let mut pending: HashMap<String, String> = HashMap::new();
    let mut budget = MAX_BYTES_PER_RUN;
    let cutoff = now_secs().saturating_sub(MAX_AGE_SECS);
    for repo in repos {
        let project = Path::new(repo).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        for dir in log_dirs(projects_root, repo) {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().is_none_or(|x| x != "jsonl") { continue; }
                let modified = e.metadata().and_then(|m| m.modified()).ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                if modified < cutoff { continue; }
                let key = p.to_string_lossy().into_owned();
                let off = state.get(&key).copied().unwrap_or(0);
                if let Some((text, next)) = read_new(&p, off, &mut budget) {
                    for line in text.lines() { take_line(line, &mut b, &mut sessions, &mut pending, &project); }
                    state.insert(key, next);
                }
            }
        }
    }
    moments_of(&sessions, &mut b);
    b
}

/// Learn from the sessions of these projects (only new log lines).
#[tauri::command(async)]
pub fn learn_sessions(repos: Vec<String>) -> Result<Batch, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let root = PathBuf::from(home).join(".claude").join("projects");
    let mut st: State = std::fs::read_to_string(state_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let repos: Vec<String> = repos.into_iter().filter(|r| r.starts_with('/') && !r.contains("..")).take(50).collect();
    let b = learn(&root, &repos, &mut st.offsets);
    let tmp = state_path().with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(&st).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, state_path()).map_err(|e| e.to_string())?;
    Ok(b)
}

// -- the Coding DNA file ---------------------------------------------------------

fn dna_path() -> PathBuf {
    crate::grillme_root().join("coding-dna.json")
}

/// Your Coding DNA (JSON), or null when there's none yet.
#[tauri::command]
pub fn dna_load() -> Option<Value> {
    std::fs::read_to_string(dna_path()).ok().and_then(|t| serde_json::from_str(&t).ok())
}

/// Save it (JSON, the source of truth) and its readable Markdown copy.
#[tauri::command]
pub fn dna_save(json: String, markdown: String) -> Result<(), String> {
    if json.len() > 3_000_000 || markdown.len() > 3_000_000 { return Err("Coding DNA is too large".into()); }
    serde_json::from_str::<Value>(&json).map_err(|_| "not JSON".to_string())?;
    let p = dna_path();
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    std::fs::write(p.with_extension("md"), markdown).map_err(|e| e.to_string())
}

/// Forget everything: the DNA, its Markdown copy, and where learning was up to.
#[tauri::command]
pub fn dna_forget() -> Result<(), String> {
    for p in [dna_path(), dna_path().with_extension("md"), state_path()] {
        match std::fs::remove_file(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

/// Show the readable copy in Finder.
#[tauri::command]
pub fn dna_reveal() -> Result<(), String> {
    std::process::Command::new("open").arg("-R").arg(dna_path().with_extension("md")).status().map_err(|e| e.to_string())?;
    Ok(())
}

/// Export: write the DNA to a file you picked (a .json).
#[tauri::command]
pub fn dna_export(path: String, json: String) -> Result<(), String> {
    if !path.ends_with(".json") || path.contains("..") { return Err("Choose a .json file".into()); }
    serde_json::from_str::<Value>(&json).map_err(|_| "not JSON".to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Import: read a DNA file you picked (validated by the app before use).
#[tauri::command]
pub fn dna_import_read(path: String) -> Result<Value, String> {
    if !path.ends_with(".json") || path.contains("..") { return Err("Choose a .json file".into()); }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 3_000_000 { return Err("That file is too large to be Coding DNA".into()); }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|_| "That file isn't valid JSON".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(v: Value) -> String { v.to_string() }

    #[test]
    fn a_passing_run_is_not_a_failure_and_inspecting_is_not_undoing() {
        let r = rx();
        assert!(!has(&r.fail, "test result: ok. 250 passed; 0 failed; 8 ignored"));
        assert!(has(&r.fail, "test result: FAILED. 1 passed; 2 failed"));
        assert!(has(&r.fail, "Tests  2 failed | 10 passed"));
        assert!(!has(&r.undo, "git stash list"));
        assert!(has(&r.undo, "git stash"));
        assert!(has(&r.undo, "git checkout -- src/a.ts"));
        assert!(!has(&r.undo, "git checkout -q -b feat/x"));
    }

    #[test]
    fn counts_patterns_not_text() {
        let dir = std::env::temp_dir().join(format!("grillme-learn-{}", std::process::id()));
        let logs = dir.join("-Users-me-app");
        std::fs::create_dir_all(&logs).unwrap();
        let ts = "2026-10-01T10:00:00Z";
        let late = "2026-10-01T12:00:00Z";
        let mut lines = vec![
            line(serde_json::json!({"type":"user","sessionId":"s1","timestamp":ts,"message":{"content":"First make a plan, then implement the login page"}})),
            line(serde_json::json!({"type":"user","sessionId":"s1","timestamp":ts,"message":{"content":"<command-name>/review</command-name>"}})),
            line(serde_json::json!({"type":"user","sessionId":"s1","timestamp":ts,"message":{"content":"why does it still not work?"}})),
            line(serde_json::json!({"type":"assistant","sessionId":"s1","timestamp":ts,"message":{"model":"claude-opus-4-8","content":[
                {"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"superpowers:brainstorming"}},
                {"type":"tool_use","id":"t2","name":"mcp__context7__get-docs","input":{}},
                {"type":"tool_use","id":"t3","name":"Bash","input":{"command":"git restore src/a.ts"}}]}})),
        ];
        for i in 0..3 {
            lines.push(line(serde_json::json!({"type":"assistant","sessionId":"s1","timestamp":late,"message":{"model":"claude-opus-4-8","content":[{"type":"tool_use","id":format!("b{i}"),"name":"Bash","input":{"command":"npx vitest run"}}]}})));
            lines.push(line(serde_json::json!({"type":"user","sessionId":"s1","timestamp":late,"message":{"content":[{"type":"tool_result","tool_use_id":format!("b{i}"),"content":"Tests  2 failed | 10 passed"}]}})));
        }
        std::fs::write(logs.join("s1.jsonl"), lines.join("\n") + "\n").unwrap();
        let mut st = HashMap::new();
        let b = learn(&dir, &["/Users/me/app".to_string()], &mut st);
        assert_eq!(b.prompts, 2);
        assert_eq!(b.plan_prompts, 1);
        assert_eq!(b.question_prompts, 1);
        assert_eq!(b.frustrated_prompts, 1);
        assert_eq!(b.slash.get("review"), Some(&1));
        assert_eq!(b.skills.get("superpowers:brainstorming"), Some(&1));
        assert_eq!(b.mcp.get("context7"), Some(&1));
        assert_eq!(b.models.get("claude-opus-4-8"), Some(&4));
        assert_eq!((b.test_runs, b.test_fails, b.retries, b.undos), (3, 3, 2, 1));
        assert!(b.moments.iter().any(|m| m.kind == "test-loop" && m.detail.contains("vitest") && m.detail.contains("3 times")));
        // nothing of what was typed is kept
        let json = serde_json::to_string(&b).unwrap();
        assert!(!json.contains("login page"));
        // a second run sees nothing new
        let again = learn(&dir, &["/Users/me/app".to_string()], &mut st);
        assert_eq!(again.prompts, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod live {
    #[test]
    #[ignore] // reads this Mac's real Claude Code logs; prints counts only
    fn live_counts() {
        let home = std::env::var("HOME").unwrap();
        let root = std::path::PathBuf::from(&home).join(".claude/projects");
        let repo = std::env::var("LEARN_REPO").unwrap_or_else(|_| format!("{home}/Terminal"));
        let mut st = std::collections::HashMap::new();
        let t = std::time::Instant::now();
        let b = super::learn(&root, &[repo], &mut st);
        println!("took {:?}\n{}", t.elapsed(), serde_json::to_string_pretty(&b).unwrap());
    }
}
