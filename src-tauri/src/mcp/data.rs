// ---------------------------------------------------------------------------
// Reads: Grill Me's project files, Claude Code transcripts, git. Everything
// here is a straight port of the Node server's helpers; the comments name
// the JS function each one mirrors.
// ---------------------------------------------------------------------------

use super::js::{self, get, nn, to_str, truthy};
use super::redact::{redact, safe_name, secret_file};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// Remote (claude.ai) mode switches (`REMOTE` in the JS).
#[derive(Clone, Copy, Default, Debug)]
pub struct Remote {
    pub on: bool,
    pub allow_writes: bool,
    pub no_transcripts: bool,
}

/// A project's state dir.
#[derive(Clone, Debug, PartialEq)]
pub struct Proj {
    pub id: String,
    pub dir: PathBuf,
}

/// Everything a call needs: where ~/.grillme is, the remote switches, and
/// the per-call project scope (the JS used AsyncLocalStorage for that).
#[derive(Clone, Debug)]
pub struct Ctx {
    pub home: String,
    /// `join(homedir(), ".grillme")`, normalized like node:path.
    pub root: String,
    pub remote: Remote,
    /// Project pinned by a tool call's `project` argument.
    pub scope: Option<Proj>,
    /// GRILLME_PROJECT_DIR (or --project).
    pub forced: Option<String>,
}

/// One conversation turn.
#[derive(Clone, Debug, Default)]
pub struct Turn {
    pub ask: String,
    pub at: Option<Value>,
    pub tools: Vec<String>,
    pub reply: String,
}

pub struct Diff {
    pub base: String,
    pub branch: String,
    pub log: String,
    pub stat: String,
    pub diff: String,
}

/// JS strict equality of a JSON value with a string-or-undefined.
pub fn eq_str(v: Option<&Value>, s: Option<&str>) -> bool {
    match (v, s) {
        (None, None) => true,
        (Some(Value::String(a)), Some(b)) => a == b,
        _ => false,
    }
}

/// `x.slice(-n).map(d => d.text)` style: a list of optional values → JSON
/// array (undefined becomes null, as JSON.stringify does).
pub fn arr_of<'a>(items: impl Iterator<Item = Option<&'a Value>>) -> Value {
    Value::Array(items.map(|v| v.cloned().unwrap_or(Value::Null)).collect())
}

/// `tsOf`: numbers as-is, anything else through Date.parse (0 when invalid).
pub fn ts_of(x: Option<&Value>) -> f64 {
    match x {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        other => {
            let s = match nn(other) {
                None => String::new(),
                v => to_str(v),
            };
            let t = js::date_parse(&s);
            if t.is_nan() || t == 0.0 { 0.0 } else { t }
        }
    }
}

/// `x ?? 0` used in arithmetic
pub fn num_or0(v: Option<&Value>) -> f64 {
    match nn(v) {
        None => 0.0,
        v => js::to_num(v),
    }
}

fn arr(v: Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a,
        _ => Vec::new(),
    }
}

pub fn read_json(path: &Path) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    js::parse(&String::from_utf8_lossy(&bytes))
}

pub fn read_json_or(path: &Path, fallback: Value) -> Value {
    read_json(path).unwrap_or(fallback)
}

/// A JSON array file's items (anything else reads as empty).
pub fn read_list(path: &Path) -> Vec<Value> {
    arr(read_json_or(path, json!([])))
}

pub fn read_text(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// `git -C repo …` → trimmed stdout, "" on failure, timeout (8 s), or
/// output over execFileSync's 1 MB maxBuffer.
pub fn git(repo: &str, args: &[&str]) -> String {
    use std::io::Read as _;
    use std::process::{Command, Stdio};
    let Ok(mut child) = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return String::new();
    };
    let mut stdout = child.stdout.take();
    let child = std::sync::Arc::new(std::sync::Mutex::new(child));
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let watchdog = {
        let child = child.clone();
        std::thread::spawn(move || {
            if rx.recv_timeout(std::time::Duration::from_secs(8)).is_err() {
                if let Ok(mut c) = child.lock() {
                    let _ = c.kill();
                }
                return true;
            }
            false
        })
    };
    let mut out = Vec::new();
    let read_ok = stdout.as_mut().map(|s| s.read_to_end(&mut out).is_ok()).unwrap_or(false);
    let _ = tx.send(());
    let timed_out = watchdog.join().unwrap_or(true);
    let status = child.lock().ok().and_then(|mut c| c.wait().ok());
    if timed_out || !read_ok || !status.is_some_and(|s| s.success()) || out.len() > 1024 * 1024 {
        return String::new();
    }
    js::trim(&String::from_utf8_lossy(&out)).to_string()
}

// Files Grill Me itself installs into every worktree (hooks, /ship,
// delegation playbook) — never count them as the session's work.
const MANAGED: [&str; 3] = [".claude/", "CLAUDE.md", "DELEGATION.md"];

fn is_managed(f: &str) -> bool {
    MANAGED.iter().any(|m| f == *m || f.starts_with(m))
}

/// New files the session created that git doesn't track yet.
fn untracked(repo: &str) -> Vec<String> {
    git(repo, &["ls-files", "--others", "--exclude-standard"])
        .split('\n')
        .filter(|f| !f.is_empty() && !is_managed(f) && !secret_file(f))
        .map(str::to_owned)
        .collect()
}

/// Changed + new files, minus Grill Me's own.
pub fn changed_files(repo: &str) -> Vec<String> {
    git(repo, &["status", "--porcelain"])
        .split('\n')
        .filter(|l| !l.is_empty())
        .filter(|l| !(l.starts_with("??") && is_managed(js::trim(slice_from(l, 3)))))
        .map(str::to_owned)
        .collect()
}

/// `s.slice(n)` for an ASCII-prefixed line (UTF-16 safe for n ≤ 3 ASCII).
fn slice_from(s: &str, n: usize) -> &str {
    let mut idx = 0;
    let mut used = 0;
    for (i, c) in s.char_indices() {
        if used >= n {
            idx = i;
            break;
        }
        used += c.len_utf16();
        idx = i + c.len_utf8();
    }
    if used < n { "" } else { &s[idx..] }
}

impl Ctx {
    /// Context for this process: HOME, ~/.grillme, GRILLME_PROJECT_DIR.
    pub fn from_env() -> Ctx {
        let home = std::env::var("HOME")
            .ok()
            .filter(|h| !h.is_empty())
            .or_else(|| std::env::home_dir().map(|p| p.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "/".into());
        let root = js::normalize(&format!("{home}/.grillme"));
        Ctx { home, root, remote: Remote::default(), scope: None, forced: std::env::var("GRILLME_PROJECT_DIR").ok() }
    }

    pub fn root_path(&self) -> PathBuf {
        PathBuf::from(&self.root)
    }

    pub fn r(&self, text: String) -> String {
        if self.remote.on { redact(&text) } else { text }
    }

    // ---- projects ----------------------------------------------------------

    /// Projects registered in Grill Me: [(id, name)] (paths never leave here).
    pub fn project_list(&self) -> Vec<(String, String)> {
        read_list(&self.root_path().join("projects.json"))
            .iter()
            .filter_map(|p| {
                let id = get(p, "id")?.as_str()?.to_string();
                let name = to_str(nn(get(p, "name")).or(get(p, "id")));
                Some((id, name))
            })
            .collect()
    }

    /// A tool call's `project` argument (id or name, any case) → its state dir.
    pub fn resolve_project(&self, arg: &str) -> Option<Proj> {
        let want = js::trim(arg).to_lowercase();
        let list = self.project_list();
        let hit = list.iter().find(|(id, name)| id.to_lowercase() == want || name.to_lowercase() == want);
        let id = match hit {
            Some((id, _)) => id.clone(),
            None if want == "default" => "default".into(),
            None => return None,
        };
        if id.is_empty() {
            return None;
        }
        if id == "default" {
            return Some(Proj { id, dir: self.root_path() });
        }
        let dir = self.root_path().join("projects").join(&id);
        let valid = id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) && id != "." && id != "..";
        (valid && dir.exists()).then_some(Proj { id, dir })
    }

    pub fn project_dir(&self) -> Proj {
        if let Some(s) = &self.scope {
            return s.clone();
        }
        if let Some(f) = self.forced.as_deref().filter(|f| !f.is_empty() && Path::new(f).exists()) {
            let id = if f == self.root { "default".to_string() } else { js::basename(f) };
            return Proj { id, dir: PathBuf::from(f) };
        }
        let settings = read_json_or(&self.root_path().join("settings.json"), json!({}));
        let id = get(&settings, "activeProject").and_then(Value::as_str).unwrap_or("");
        if !id.is_empty()
            && id != "default"
            && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && self.root_path().join("projects").join(id).exists()
        {
            return Proj { id: id.into(), dir: self.root_path().join("projects").join(id) };
        }
        Proj { id: "default".into(), dir: self.root_path() }
    }

    pub fn members(&self) -> Vec<Value> {
        let dir = self.project_dir().dir;
        let fallback = read_json_or(&self.root_path().join("config.json"), json!({}));
        let cfg = read_json_or(&dir.join("config.json"), fallback);
        arr(get(&cfg, "teammates").cloned().unwrap_or(Value::Null))
    }

    fn titles(&self) -> Map<String, Value> {
        let dir = self.project_dir().dir;
        let pick = |p: PathBuf| match nn(get(&read_json_or(&p, json!({})), "sessionTitles")) {
            Some(Value::Object(o)) => o.clone(),
            _ => Map::new(),
        };
        let a = pick(dir.join("settings.json"));
        let mut out = pick(self.root_path().join("settings.json"));
        for (k, v) in a {
            out.insert(k, v);
        }
        out
    }

    /// `titles()[m.id] || m.name || m.id` as text.
    pub fn label(&self, m: &Value) -> String {
        match self.label_v(m) {
            Value::Null if get(m, "id").is_none() => "undefined".into(),
            v => to_str(Some(&v)),
        }
    }

    /// The same, as the raw value (what JSON.stringify sees; undefined → null).
    pub fn label_v(&self, m: &Value) -> Value {
        let t = self.titles();
        let key = to_str(get(m, "id"));
        let title = t.get(&key);
        if truthy(title) {
            return title.cloned().unwrap_or(Value::Null);
        }
        if truthy(get(m, "name")) {
            return get(m, "name").cloned().unwrap_or(Value::Null);
        }
        get(m, "id").cloned().unwrap_or(Value::Null)
    }

    /// Which session is calling? A Claude Code session runs inside its worktree.
    pub fn self_member(&self) -> Option<Value> {
        let cwd_raw = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let cwd = js::resolve(&cwd_raw, ".");
        let mut hits: Vec<Value> = self
            .members()
            .into_iter()
            .filter(|m| {
                if !truthy(get(m, "repoPath")) {
                    return false;
                }
                let rp = js::resolve(&cwd, &to_str(get(m, "repoPath")));
                cwd == rp || cwd.starts_with(&format!("{rp}/"))
            })
            .collect();
        hits.sort_by_key(|m| std::cmp::Reverse(repo_len(m)));
        hits.into_iter().next()
    }

    /// A session by id, title, name, or part of its title/name. Err = the
    /// TypeError JS throws when a member lacks the field being compared.
    pub fn find_session(&self, key: Option<&Value>) -> Result<Option<Value>, String> {
        let all = self.members();
        if !truthy(key) {
            return Ok(self.self_member().or_else(|| all.first().cloned()));
        }
        let k = to_str(key).to_lowercase();
        let t = self.titles();
        let title_of = |m: &Value| t.get(&to_str(get(m, "id"))).cloned();
        for m in &all {
            if lower(get(m, "id"), "m.id")? == k {
                return Ok(Some(m.clone()));
            }
        }
        for m in &all {
            let tt = title_of(m);
            if lower(Some(nn(tt.as_ref()).unwrap_or(&json!(""))), "(t[m.id] ?? \"\")")? == k {
                return Ok(Some(m.clone()));
            }
        }
        for m in &all {
            if lower(get(m, "name"), "m.name")? == k {
                return Ok(Some(m.clone()));
            }
        }
        for m in &all {
            let tt = title_of(m);
            if lower(nn(tt.as_ref()).or(get(m, "name")), "(t[m.id] ?? m.name)")?.contains(&k) {
                return Ok(Some(m.clone()));
            }
        }
        Ok(None)
    }

    // ---- diffs -----------------------------------------------------------------

    /// Small text contents of new files, so reviews and quizzes see them too.
    /// Symlinks are skipped (a link to ~/.grillme/… must not print its
    /// target) and anything resolving outside the repo or to a secret-named
    /// file too.
    fn new_file_text(repo: &str, files: &[String]) -> Result<String, String> {
        let root = realpath(repo)?;
        Ok(js::head(files, 10)
            .iter()
            .map(|f| {
                let full = Path::new(repo).join(f);
                let Ok(meta) = std::fs::symlink_metadata(&full) else { return String::new() };
                if meta.file_type().is_symlink() {
                    return format!("+++ new file {f} (symlink, not shown)");
                }
                let Ok(real) = std::fs::canonicalize(&full) else { return String::new() };
                let real_s = real.to_string_lossy().into_owned();
                if !real_s.starts_with(&format!("{root}/")) || !safe_name(&real_s) {
                    return String::new();
                }
                let Ok(buf) = std::fs::read(&real) else { return String::new() };
                if buf.len() > 4000 || buf.contains(&0) {
                    return format!("+++ new file {f} ({} bytes, not shown)", buf.len());
                }
                format!("+++ new file {f}\n{}", String::from_utf8_lossy(&buf))
            })
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"))
    }

    pub fn base_branch(repo: &str) -> String {
        for b in ["main", "master"] {
            if !git(repo, &["rev-parse", "--verify", "--quiet", b]).is_empty() {
                return b.into();
            }
        }
        String::new()
    }

    /// Commits beyond the base branch (the `log` part of diffOf).
    pub fn commit_log(repo: &str) -> (String, String, String) {
        let base = Self::base_branch(repo);
        let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
        let range = if !base.is_empty() && base != branch { format!("{base}...HEAD") } else { String::new() };
        let log = if !range.is_empty() {
            git(repo, &["log", "--oneline", "-20", &format!("{base}..HEAD")])
        } else {
            git(repo, &["log", "--oneline", "-20"])
        };
        (base, branch, log)
    }

    /// Branch, commits beyond the base branch, file summary, and full diff
    /// (including brand-new files).
    pub fn diff_of(&self, m: &Value) -> Result<Diff, String> {
        let repo = to_str(get(m, "repoPath"));
        let repo = repo.as_str();
        let (base, branch, log) = Self::commit_log(repo);
        let range = if !base.is_empty() && base != branch { format!("{base}...HEAD") } else { String::new() };
        let fresh = untracked(repo);
        // list changed files first, drop secret-named ones, then diff only the rest
        let names = |args: &[&str]| -> Vec<String> {
            let mut a = vec!["diff", "--name-only"];
            a.extend_from_slice(args);
            let out = git(repo, &a);
            js::head(&out.split('\n').filter(|f| safe_name(f)).map(str::to_owned).collect::<Vec<_>>(), 200).to_vec()
        };
        let part = |args: &[&str], mode: &[&str]| -> String {
            let files = names(args);
            if files.is_empty() {
                return String::new();
            }
            let mut a = vec!["diff"];
            a.extend_from_slice(mode);
            a.extend_from_slice(args);
            a.push("--");
            a.extend(files.iter().map(String::as_str));
            git(repo, &a)
        };
        let join_parts = |parts: Vec<String>| parts.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n");
        let stat = join_parts(vec![
            if range.is_empty() { String::new() } else { part(&[&range], &["--stat"]) },
            part(&["HEAD"], &["--stat"]),
            if fresh.is_empty() { String::new() } else { format!("new files: {}", fresh.join(", ")) },
        ]);
        let diff = join_parts(vec![
            if range.is_empty() { String::new() } else { part(&[&range], &[]) },
            part(&["HEAD"], &[]),
            Self::new_file_text(repo, &fresh)?,
        ]);
        Ok(Diff { base, branch, log, stat: self.r(stat), diff: self.r(diff) })
    }

    // ---- past hackathons -------------------------------------------------------

    /// Lessons from wrapped-up projects, newest first, skipping `except`
    /// (None = JS null). Err = the RangeError JS throws for a bad date.
    pub fn lessons_text(&self, except: Option<&str>, n: usize) -> Result<String, String> {
        let all: Vec<Value> = read_list(&self.root_path().join("lessons.json"))
            .into_iter()
            .filter(|l| {
                let p = get(l, "project");
                let same = match (p, except) {
                    (Some(Value::Null), None) => true,
                    (Some(Value::String(a)), Some(b)) => a == b,
                    _ => false,
                };
                !same
            })
            .collect();
        let picked: Vec<&Value> = js::tail(&all, n).iter().rev().collect();
        let mut out = Vec::new();
        for l in picked {
            let date = if truthy(get(l, "date")) {
                let iso = js::iso_string(js::to_num(get(l, "date")) * 1000.0).ok_or("Invalid time value")?;
                iso.chars().take(10).collect()
            } else {
                "?".to_string()
            };
            let list = |k: &str, sep: &str, label: &str| -> Option<String> {
                match get(l, k) {
                    Some(Value::Array(a)) if !a.is_empty() => Some(format!("  - {label}: {}", js::join(a.iter().map(Some), sep))),
                    _ => None,
                }
            };
            let lines: Vec<String> = [
                Some(format!(
                    "- **{}** ({date}): {}",
                    to_str(nn(get(l, "name")).or(get(l, "project"))),
                    match nn(get(l, "summary")) {
                        None => String::new(),
                        v => to_str(v),
                    }
                )),
                list("stack", ", ", "stack"),
                list("worked", "; ", "worked"),
                list("mistakes", "; ", "avoid"),
                list("reuse", "; ", "reuse"),
            ]
            .into_iter()
            .flatten()
            .collect();
            out.push(lines.join("\n"));
        }
        Ok(out.join("\n"))
    }

    // ---- transcripts -------------------------------------------------------------

    fn transcript_file(&self, repo: &str) -> Option<(PathBuf, f64)> {
        let key: String = repo.trim_end_matches('/').chars().map(|c| if c == '/' || c == '.' { '-' } else { c }).collect();
        let dir = Path::new(&self.home).join(".claude").join("projects").join(key);
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .ok()?
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|f| f.ends_with(".jsonl"))
            .collect();
        names.sort(); // readdirSync order
        let mut files = Vec::new();
        for f in names {
            let p = dir.join(&f);
            // statSync throws on a dangling entry → the whole lookup is null
            let meta = std::fs::metadata(&p).ok()?;
            let t = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as f64 * 1000.0 + f64::from(d.subsec_nanos()) / 1e6)
                .unwrap_or(0.0);
            files.push((p, t));
        }
        files.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        files.into_iter().next()
    }

    /// A member's turns oldest first (+ the transcript's mtime). Remote mode
    /// can withhold conversations entirely (--no-transcripts). Err = the
    /// TypeError JS throws for a member without a string repoPath.
    pub fn turns(&self, m: &Value) -> Result<(Vec<Turn>, Option<f64>), String> {
        if self.remote.on && self.remote.no_transcripts {
            return Ok((Vec::new(), None));
        }
        let repo = match get(m, "repoPath") {
            Some(Value::String(r)) => r.clone(),
            None => return Err("Cannot read properties of undefined (reading 'replace')".into()),
            Some(Value::Null) => return Err("Cannot read properties of null (reading 'replace')".into()),
            Some(_) => return Err("repo.replace is not a function".into()),
        };
        Ok(self.turns_at(&repo))
    }

    fn turns_at(&self, repo: &str) -> (Vec<Turn>, Option<f64>) {
        let Some((f, t)) = self.transcript_file(repo) else { return (Vec::new(), None) };
        let mut out: Vec<Turn> = Vec::new();
        let mut have_cur = false;
        for line in tail_lines(&f, 1_500_000) {
            let Some(o) = js::parse(&line) else { continue };
            if truthy(get(&o, "isSidechain")) || truthy(get(&o, "isMeta")) {
                continue;
            }
            let c = get(&o, "message").and_then(|m| get(m, "content"));
            let ty = get(&o, "type").and_then(Value::as_str);
            if ty == Some("user") {
                let text = match c {
                    Some(Value::String(s)) => user_text(s),
                    Some(Value::Array(a)) => {
                        let t: Vec<String> = a
                            .iter()
                            .filter(|x| get(x, "type").and_then(Value::as_str) == Some("text"))
                            .filter_map(|x| match nn(get(x, "text")) {
                                None => user_text(""),
                                Some(Value::String(s)) => user_text(s),
                                Some(_) => None,
                            })
                            .filter(|s| !s.is_empty())
                            .collect();
                        (!t.is_empty()).then(|| t.join("\n"))
                    }
                    _ => None,
                };
                if let Some(text) = text.filter(|t| !t.is_empty()) {
                    out.push(Turn { ask: self.r(text), at: get(&o, "timestamp").cloned(), tools: Vec::new(), reply: String::new() });
                    have_cur = true;
                }
            } else if ty == Some("assistant") && have_cur {
                if let Some(Value::Array(items)) = c {
                    let cur = out.last_mut().expect("current turn");
                    for x in items {
                        let xt = get(x, "type").and_then(Value::as_str);
                        if xt == Some("text") {
                            if let Some(Value::String(s)) = get(x, "text") {
                                let tr = js::trim(s);
                                if !tr.is_empty() {
                                    cur.reply = if self.remote.on { redact(tr) } else { tr.to_string() };
                                }
                            }
                        }
                        if xt == Some("tool_use") {
                            let s = tool_summary(get(x, "name"), get(x, "input"));
                            cur.tools.push(if self.remote.on { redact(&s) } else { s });
                        }
                    }
                }
            }
        }
        (out, Some(t))
    }

    // ---- team + tests ------------------------------------------------------------

    /// Teammates' shared sessions (team-sessions.json over the room), fresh ones only.
    pub fn team_sessions(&self) -> Vec<Value> {
        let now = js::now_ms();
        read_list(&self.project_dir().dir.join("team-sessions.json"))
            .into_iter()
            .filter(|d| truthy(get(d, "member")) && truthy(get(d, "session")) && now - num_or0(get(d, "ts")) < 90_000.0)
            .collect()
    }

    /// Team chat (team-chat.json over the room), oldest first by ts.
    pub fn team_chat(&self) -> Vec<Value> {
        let mut all: Vec<Value> = read_list(&self.project_dir().dir.join("team-chat.json"))
            .into_iter()
            .filter(|m| get(m, "id").is_some_and(Value::is_string) && get(m, "text").is_some_and(Value::is_string))
            .collect();
        all.sort_by(|a, b| num_or0(get(a, "ts")).total_cmp(&num_or0(get(b, "ts"))));
        all
    }

    /// Teammates' open questions (team-bridge.json). `mine` = local ids to skip.
    pub fn team_questions(&self, mine: &[Value]) -> Vec<Value> {
        read_list(&self.project_dir().dir.join("team-bridge.json"))
            .into_iter()
            .filter(|e| {
                eq_str(get(e, "kind"), Some("question"))
                    && eq_str(get(e, "status"), Some("pending"))
                    && !get(e, "id").is_some_and(|id| mine.iter().any(|m| same_value_zero(m, id)))
            })
            .collect()
    }

    /// Last auto-test result for a worktree (tests.json, written by Grill Me).
    pub fn test_result(&self, repo: &str) -> Option<Value> {
        let all = read_json_or(&self.project_dir().dir.join("tests.json"), json!({}));
        match &all {
            // a falsy entry reads as "no result" everywhere it's used
            Value::Object(o) => o.get(repo).filter(|v| truthy(Some(v))).cloned(),
            _ => None,
        }
    }

    pub fn test_line(&self, repo: &str) -> Option<String> {
        let t = self.test_result(repo)?;
        let secs = js::round(num_or0(get(&t, "ms")) / 1000.0);
        Some(format!(
            "tests: {} ({}, {}s, {})",
            if truthy(get(&t, "ok")) { "passing" } else { "FAILING" },
            to_str(get(&t, "cmd")),
            js::num_str(secs),
            ago(get(&t, "at"))
        ))
    }

    /// Team half of the brain merged in (bridgeState).
    pub fn bridge_state(&self) -> Value {
        let dir = self.project_dir().dir;
        let b = read_json_or(&dir.join("bridge.json"), json!({ "handoffs": [], "questions": [], "plans": [], "notes": [] }));
        let team = read_list(&dir.join("brain.json"));
        with_team(&b, &team)
    }
}

/// `x.toLowerCase()` on a JSON value, with V8's TypeError text.
fn lower(v: Option<&Value>, expr: &str) -> Result<String, String> {
    match v {
        Some(Value::String(s)) => Ok(s.to_lowercase()),
        None => Err("Cannot read properties of undefined (reading 'toLowerCase')".into()),
        Some(Value::Null) => Err("Cannot read properties of null (reading 'toLowerCase')".into()),
        Some(_) => Err(format!("{expr}.toLowerCase is not a function")),
    }
}

/// realpathSync, with Node's error text when it throws. Node's JS
/// implementation lstat()s one component at a time on the resolved prefix,
/// so the error names that path (e.g. `lstat '/private/var/…/gone'`).
pub fn realpath(p: &str) -> Result<String, String> {
    if let Ok(r) = std::fs::canonicalize(p) {
        return Ok(r.to_string_lossy().into_owned());
    }
    let cwd = std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    let abs = js::resolve(&cwd, p);
    let mut cur = String::new();
    for comp in abs.split('/').filter(|c| !c.is_empty()) {
        let next = format!("{cur}/{comp}");
        match std::fs::symlink_metadata(&next) {
            Err(e) => {
                let code = match e.kind() {
                    std::io::ErrorKind::NotFound => "ENOENT: no such file or directory",
                    std::io::ErrorKind::PermissionDenied => "EACCES: permission denied",
                    std::io::ErrorKind::NotADirectory => "ENOTDIR: not a directory",
                    _ => "EIO: i/o error",
                };
                return Err(format!("{code}, lstat '{next}'"));
            }
            Ok(m) if m.file_type().is_symlink() => {
                cur = std::fs::canonicalize(&next).map(|r| r.to_string_lossy().into_owned()).unwrap_or(next);
            }
            Ok(_) => cur = next,
        }
    }
    Err(format!("ENOENT: no such file or directory, lstat '{abs}'"))
}

fn repo_len(m: &Value) -> usize {
    match get(m, "repoPath") {
        Some(Value::String(s)) => js::len16(s),
        _ => 0,
    }
}

/// Set membership (SameValueZero) for JSON scalars.
pub fn same_value_zero(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::String(x), Value::String(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Null, Value::Null) => true,
        _ => false,
    }
}

/// Team half of the brain (brain.json, synced by the room): the newest goal
/// from anyone wins; teammates' notes join ours. Mirrors bridge.rs with_team.
pub fn with_team(b: &Value, team: &[Value]) -> Value {
    let mut out = match b {
        Value::Object(o) => o.clone(),
        _ => Map::new(),
    };
    let mut notes: Vec<Value> = match nn(get(b, "notes")) {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    // `{ ...b, notes }`: the key keeps its place, or goes last
    out.insert("notes".into(), Value::Null);
    let mut goals: Vec<&Value> = team.iter().filter(|e| eq_str(get(e, "kind"), Some("goal"))).collect();
    goals.sort_by(|x, y| {
        let d = num_or0(get(y, "ts")) - num_or0(get(x, "ts"));
        d.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
    if let Some(goal) = goals.first() {
        if num_or0(get(goal, "ts")) > num_or0(get(b, "goalTs")) {
            out.insert("goal".into(), get(goal, "text").cloned().unwrap_or(Value::Null));
            out.insert("goalTs".into(), get(goal, "ts").cloned().unwrap_or(Value::Null));
            // JS assigns undefined, which JSON.stringify drops
            if get(goal, "text").is_none() {
                out.shift_remove("goal");
            }
            if get(goal, "ts").is_none() {
                out.shift_remove("goalTs");
            }
        }
    }
    let mine: Vec<Value> = notes.iter().map(|n| get(n, "id").cloned().unwrap_or(Value::Null)).collect();
    for e in team {
        if eq_str(get(e, "kind"), Some("note")) && truthy(get(e, "id")) {
            let id = get(e, "id").expect("id");
            if !mine.iter().any(|m| same_value_zero(m, id)) {
                let mut n = Map::new();
                for k in ["id", "ts", "text", "by"] {
                    if let Some(v) = get(e, k) {
                        n.insert(k.into(), v.clone());
                    }
                }
                notes.push(Value::Object(n));
            }
        }
    }
    notes.sort_by(|x, y| {
        let d = num_or0(get(x, "ts")) - num_or0(get(y, "ts"));
        d.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
    out.insert("notes".into(), Value::Array(notes));
    Value::Object(out)
}

/// A teammate's session by `member:session` id, title, or "Name / title".
pub fn find_team_session(key: Option<&Value>, list: &[Value]) -> Option<Value> {
    let k = js::trim(&match nn(key) {
        None => String::new(),
        v => to_str(v),
    })
    .to_lowercase();
    if k.is_empty() {
        return None;
    }
    let f = |d: &Value, k2: &str| to_str(get(d, k2));
    list.iter()
        .find(|d| f(d, "id").to_lowercase() == k)
        .or_else(|| list.iter().find(|d| format!("{} / {}", f(d, "memberName"), f(d, "title")).to_lowercase() == k))
        .or_else(|| list.iter().find(|d| format!("{}'s {}", f(d, "memberName"), f(d, "title")).to_lowercase() == k))
        .or_else(|| list.iter().find(|d| f(d, "title").to_lowercase() == k))
        .cloned()
}

/// Can this session ship? Branch vs main, uncommitted work, last tests.
pub fn ship_verdict(branch: &str, base: &str, ahead: f64, dirty: usize, tests: Option<&Value>) -> String {
    if base.is_empty() {
        return "no main/master branch".into();
    }
    if branch == base {
        return "on the default branch — work needs its own branch".into();
    }
    if let Some(t) = tests {
        if !truthy(get(t, "ok")) {
            return "blocked: tests failing".into();
        }
    }
    if dirty > 0 {
        return format!("not ready: {dirty} uncommitted file{}", if dirty == 1 { "" } else { "s" });
    }
    if ahead == 0.0 || ahead.is_nan() {
        return "nothing to ship yet".into();
    }
    if tests.is_some() { "ready to ship".into() } else { "ready to ship (no test run yet)".into() }
}

/// `ago(ms)`: "never" / "just now" / "5m ago" / "2h ago".
pub fn ago(ms: Option<&Value>) -> String {
    if !truthy(ms) {
        return "never".into();
    }
    ago_f(js::to_num(ms))
}

pub fn ago_f(ms: f64) -> String {
    if ms == 0.0 || ms.is_nan() {
        return "never".into();
    }
    let m = js::round((js::now_ms() - ms) / 60000.0);
    if m < 1.0 {
        "just now".into()
    } else if m < 60.0 {
        format!("{}m ago", js::num_str(m))
    } else {
        format!("{}h ago", js::num_str(js::round(m / 60.0)))
    }
}

/// Read only the tail — transcripts grow to hundreds of MB.
fn tail_lines(path: &Path, bytes: u64) -> Vec<String> {
    use std::io::{Read as _, Seek as _, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return Vec::new() };
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = size.saturating_sub(bytes);
    let mut buf = Vec::with_capacity((size - start) as usize);
    if f.seek(SeekFrom::Start(start)).is_err() || f.take(size - start).read_to_end(&mut buf).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.split('\n').collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    lines.into_iter().filter(|l| !l.is_empty()).map(str::to_owned).collect()
}

fn tool_summary(name: Option<&Value>, input: Option<&Value>) -> String {
    let empty = json!({});
    let input = input.unwrap_or(&empty);
    let s = |k: &str| get(input, k).and_then(Value::as_str).unwrap_or("").to_string();
    let b = |k: &str| js::basename(&s(k));
    match name.and_then(Value::as_str) {
        Some("Read") => format!("read {}", b("file_path")),
        Some("Edit") | Some("MultiEdit") => format!("edited {}", b("file_path")),
        Some("Write") => format!("wrote {}", b("file_path")),
        Some("Bash") => {
            let d = s("description");
            if !d.is_empty() {
                d
            } else {
                let cmd = s("command");
                format!("ran {}", js::head16(cmd.split('\n').next().unwrap_or(""), 80))
            }
        }
        Some("Grep") => format!("searched \"{}\"", s("pattern")),
        _ => strip_mcp_prefix(&to_str(name)),
    }
}

/// `name.replace(/^mcp__[^_]+__/, "")`
fn strip_mcp_prefix(name: &str) -> String {
    if let Some(rest) = name.strip_prefix("mcp__") {
        let run = rest.find('_').unwrap_or(rest.len());
        if run > 0 && rest[run..].starts_with("__") {
            return rest[run + 2..].to_string();
        }
    }
    name.to_string()
}

fn user_text(raw: &str) -> Option<String> {
    if ["<local-command-stdout>", "<local-command-stderr>", "<local-command-caveat>", "<task-notification>"]
        .iter()
        .any(|t| raw.contains(t))
    {
        return None;
    }
    if let Some(open) = raw.find("<command-name>") {
        let rest = &raw[open + "<command-name>".len()..];
        if let Some(close) = rest.find("</command-name>") {
            return Some(js::trim(&rest[..close]).to_string());
        }
    }
    // strip <system-reminder>…</system-reminder> blocks (lazy, global)
    let mut t = String::with_capacity(raw.len());
    let mut rest = raw;
    loop {
        match rest.find("<system-reminder>") {
            Some(i) => match rest[i..].find("</system-reminder>") {
                Some(j) => {
                    t.push_str(&rest[..i]);
                    rest = &rest[i + j + "</system-reminder>".len()..];
                }
                None => {
                    t.push_str(rest);
                    break;
                }
            },
            None => {
                t.push_str(rest);
                break;
            }
        }
    }
    let t = js::trim(&t);
    (!t.is_empty()).then(|| t.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_at(home: &Path) -> Ctx {
        let home = home.to_string_lossy().into_owned();
        Ctx { root: js::normalize(&format!("{home}/.grillme")), home, remote: Remote::default(), scope: None, forced: None }
    }

    fn tmp_home(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("grillme-mcp-{tag}-{}-{}", std::process::id(), js::now_ms()));
        std::fs::create_dir_all(d.join(".grillme")).unwrap();
        d
    }

    #[test]
    fn ship_verdicts() {
        let pass = json!({ "ok": true });
        let fail = json!({ "ok": false });
        assert_eq!(ship_verdict("f", "", 1.0, 0, None), "no main/master branch");
        assert_eq!(ship_verdict("main", "main", 0.0, 0, None), "on the default branch — work needs its own branch");
        assert_eq!(ship_verdict("f", "main", 3.0, 0, Some(&fail)), "blocked: tests failing");
        assert_eq!(ship_verdict("f", "main", 3.0, 1, Some(&pass)), "not ready: 1 uncommitted file");
        assert_eq!(ship_verdict("f", "main", 3.0, 2, None), "not ready: 2 uncommitted files");
        assert_eq!(ship_verdict("f", "main", 0.0, 0, None), "nothing to ship yet");
        assert_eq!(ship_verdict("f", "main", 2.0, 0, Some(&pass)), "ready to ship");
        assert_eq!(ship_verdict("f", "main", 2.0, 0, None), "ready to ship (no test run yet)");
    }

    #[test]
    fn with_team_merges_goal_and_notes() {
        let local = json!({ "goal": "mine", "goalTs": 100, "notes": [{ "id": "n-1", "ts": 50, "text": "a" }] });
        let team = vec![
            json!({ "id": "g-1", "kind": "goal", "ts": 90, "text": "older" }),
            json!({ "id": "g-2", "kind": "goal", "ts": 200, "text": "team goal" }),
            json!({ "id": "n-1", "kind": "note", "ts": 50, "text": "a" }),
            json!({ "id": "n-2", "kind": "note", "ts": 10, "text": "from Maya", "by": "Maya" }),
        ];
        let v = with_team(&local, &team);
        assert_eq!(v["goal"], "team goal");
        assert_eq!(v["goalTs"], 200);
        let notes = v["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0], json!({ "id": "n-2", "ts": 10, "text": "from Maya", "by": "Maya" }));
        // an older team goal never beats a newer local one
        let v = with_team(&json!({ "goal": "mine", "goalTs": 300 }), &[json!({ "kind": "goal", "ts": 200, "text": "old" })]);
        assert_eq!(v["goal"], "mine");
        assert_eq!(v["notes"], json!([]));
    }

    #[test]
    fn finds_team_sessions() {
        let list = vec![
            json!({ "id": "m1:api", "memberName": "Maya", "title": "API" }),
            json!({ "id": "m2:ui", "memberName": "Devon", "title": "UI" }),
        ];
        let id = |k: &str| find_team_session(Some(&json!(k)), &list).map(|d| d["id"].as_str().unwrap().to_string());
        assert_eq!(id("M1:API").as_deref(), Some("m1:api"));
        assert_eq!(id("devon / ui").as_deref(), Some("m2:ui"));
        assert_eq!(id("Maya's API").as_deref(), Some("m1:api"));
        assert_eq!(id(" ui ").as_deref(), Some("m2:ui"));
        assert_eq!(id("nope"), None);
        assert_eq!(find_team_session(None, &list), None);
        assert_eq!(find_team_session(Some(&json!("")), &list), None);
    }

    #[test]
    fn resolves_projects_by_id_or_name() {
        let home = tmp_home("resolve");
        let g = home.join(".grillme");
        std::fs::create_dir_all(g.join("projects/rouge")).unwrap();
        std::fs::write(
            g.join("projects.json"),
            r#"[{"id":"rouge","name":"Rouge Hack"},{"id":"gone","name":"Gone"},{"id":"../x","name":"Evil"},{"name":"no id"}]"#,
        )
        .unwrap();
        let c = ctx_at(&home);
        assert_eq!(c.resolve_project("rouge hack").map(|p| p.id).as_deref(), Some("rouge"));
        assert_eq!(c.resolve_project(" ROUGE ").map(|p| p.dir), Some(g.join("projects/rouge")));
        assert_eq!(c.resolve_project("default").map(|p| p.dir), Some(PathBuf::from(&c.root)));
        assert!(c.resolve_project("gone").is_none(), "state dir missing");
        assert!(c.resolve_project("evil").is_none(), "path-like id");
        assert!(c.resolve_project("nope").is_none());
        assert_eq!(c.project_list().len(), 3);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn user_text_filters_meta() {
        assert_eq!(user_text("<command-name> /ship </command-name> x").as_deref(), Some("/ship"));
        assert_eq!(user_text("<local-command-stdout>x</local-command-stdout>"), None);
        assert_eq!(user_text("hi <system-reminder>a</system-reminder> there <system-reminder>b</system-reminder>").as_deref(), Some("hi  there"));
        assert_eq!(user_text("  "), None);
        assert_eq!(strip_mcp_prefix("mcp__grill-me__whats_new"), "whats_new");
        assert_eq!(strip_mcp_prefix("mcp___x"), "mcp___x");
    }
}
