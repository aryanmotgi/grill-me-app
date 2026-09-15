use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

// ---------------------------------------------------------------------------
// Team config — ~/.grillme/config.json maps teammates to their worktrees.
// Created with a default on first launch so there's always something to edit.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct TeamMember {
    pub id: String,
    pub name: String,
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    /// "edit" = others may type into this session; "view" = watch only.
    #[serde(default)]
    pub permission: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TeamConfig {
    pub teammates: Vec<TeamMember>,
}

fn config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".grillme").join("config.json")
}

fn default_config() -> TeamConfig {
    // Best guess for a fresh install: this repo is the first member's worktree.
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".into());
    TeamConfig {
        teammates: vec![TeamMember {
            id: "me".into(),
            name: "Me".into(),
            repo_path: cwd,
            permission: Some("edit".into()),
        }],
    }
}

#[tauri::command]
fn team_config() -> TeamConfig {
    let path = config_path();
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<TeamConfig>(&raw) {
            return cfg;
        }
    }
    let cfg = default_config();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, serde_json::to_string_pretty(&cfg).unwrap());
    cfg
}

// ---------------------------------------------------------------------------
// Git state — branch, dirty files, recent commits for one worktree.
// Shells out to the git CLI so behavior matches what the team sees.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct GitChange {
    pub file: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

#[derive(Serialize)]
pub struct GitState {
    pub ok: bool,
    pub error: Option<String>,
    pub branch: String,
    pub changes: Vec<GitChange>,
    pub commits: Vec<GitCommit>,
}

fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
fn git_state(repo_path: String) -> GitState {
    let branch = match git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(b) => b.trim().to_string(),
        Err(e) => {
            return GitState {
                ok: false,
                error: Some(e),
                branch: String::new(),
                changes: vec![],
                commits: vec![],
            }
        }
    };

    let changes = git(&repo_path, &["status", "--porcelain"])
        .map(|out| {
            out.lines()
                .filter(|l| l.len() > 3)
                .map(|l| GitChange {
                    status: l[..2].trim().to_string(),
                    file: l[3..].trim().to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    // %x1f = unit separator — safe against commit messages containing pipes etc.
    let commits = git(
        &repo_path,
        &["log", "-n", "20", "--pretty=format:%h%x1f%s%x1f%an%x1f%ct"],
    )
    .map(|out| {
        out.lines()
            .filter_map(|l| {
                let parts: Vec<&str> = l.split('\u{1f}').collect();
                if parts.len() != 4 {
                    return None;
                }
                Some(GitCommit {
                    hash: parts[0].into(),
                    message: parts[1].into(),
                    author: parts[2].into(),
                    timestamp: parts[3].parse().unwrap_or(0),
                })
            })
            .collect()
    })
    .unwrap_or_default();

    GitState {
        ok: true,
        error: None,
        branch,
        changes,
        commits,
    }
}

// ---------------------------------------------------------------------------
// File watching — one notify watcher thread per existing worktree, emitting
// "file-activity" events to the frontend. Drives live presence + file locks.
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct FileEvent {
    #[serde(rename = "teammateId")]
    teammate_id: String,
    file: String,
    ts: u64,
}

/// Activity registry: (teammate, file) → last-touch epoch seconds.
/// Lives in Rust so webview reloads (dev HMR, crashes) never lose state.
static ACTIVITY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<(String, String), u64>>> =
    std::sync::OnceLock::new();

fn activity() -> &'static std::sync::Mutex<std::collections::HashMap<(String, String), u64>> {
    ACTIVITY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

const LOCK_TTL_S: u64 = 30 * 60;

#[derive(Serialize)]
struct LockEntry {
    owner: String,
    file: String,
    ts: u64,
}

#[derive(Serialize)]
struct WatchState {
    locks: Vec<LockEntry>,
    #[serde(rename = "lastSeen")]
    last_seen: std::collections::HashMap<String, u64>,
}

#[tauri::command]
fn watch_state() -> WatchState {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut map = activity().lock().unwrap();
    map.retain(|_, ts| now.saturating_sub(*ts) < LOCK_TTL_S);

    let mut last_seen: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let locks = map
        .iter()
        .map(|((owner, file), ts)| {
            let e = last_seen.entry(owner.clone()).or_insert(0);
            if *ts > *e {
                *e = *ts;
            }
            LockEntry { owner: owner.clone(), file: file.clone(), ts: *ts }
        })
        .collect();
    WatchState { locks, last_seen }
}

const IGNORED: &[&str] = &[
    ".git", "node_modules", "target", "dist", ".DS_Store", ".vite",
];

fn is_ignored(rel: &str) -> bool {
    if rel.split('/').any(|seg| IGNORED.contains(&seg)) {
        return true;
    }
    // Editor/build write artifacts: vite's atomic-write tmp files
    // ("store.ts.tmp.86597.<hash>"), vim swaps, backup tildes.
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name.contains(".tmp.")
        || name.ends_with(".tmp")
        || name.ends_with(".swp")
        || name.ends_with("~")
        || name.ends_with(".crswap")
}

static WATCHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn start_watching(app: tauri::AppHandle) {
    use notify::{RecursiveMode, Watcher};
    use tauri::Emitter;

    if WATCHING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        eprintln!("[watch] start_watching called again — already running");
        return; // already running — frontend hot reloads must not stack watchers
    }
    eprintln!("[watch] starting watchers");

    for member in team_config().teammates {
        let root = PathBuf::from(&member.repo_path);
        if !root.exists() {
            continue;
        }
        let app = app.clone();
        let id = member.id.clone();
        std::thread::spawn(move || {
            let (tx, rx) = std::sync::mpsc::channel();
            let mut watcher = match notify::recommended_watcher(tx) {
                Ok(w) => w,
                Err(e) => return eprintln!("[watch:{id}] {e}"),
            };
            if let Err(e) = watcher.watch(&root, RecursiveMode::Recursive) {
                return eprintln!("[watch:{id}] {e}");
            }
            for event in rx.into_iter().flatten() {
                for path in event.paths {
                    let rel = match path.strip_prefix(&root) {
                        Ok(r) => r.to_string_lossy().into_owned(),
                        Err(_) => continue,
                    };
                    if rel.is_empty() || is_ignored(&rel) {
                        continue;
                    }
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    {
                        let mut reg = activity().lock().unwrap();
                        reg.insert((id.clone(), rel.clone()), ts);
                    }
                    {
                        let mut ser = series().lock().unwrap();
                        let q = ser.entry(id.clone()).or_default();
                        q.push_back(ts);
                        while q.len() > 600 {
                            q.pop_front();
                        }
                    }
                    let _ = app.emit(
                        "file-activity",
                        FileEvent { teammate_id: id.clone(), file: rel, ts },
                    );
                }
            }
        });
    }
}


// ---------------------------------------------------------------------------
// Embedded terminals — one real Claude Code process per session, pty-backed.
// Output ring + stripped line tail live in Rust so webview reloads replay
// scrollback. Status derives from live process state: child alive, output
// flow, and BEL (Claude Code rings the terminal bell when it needs input).
// ---------------------------------------------------------------------------

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    ring: VecDeque<u8>,
    lines: VecDeque<String>,
    partial: String,
    esc: u8, // 0 none, 1 saw ESC, 2 in CSI, 3 in OSC
    last_output: Instant,
    bell: bool,
    alive: bool,
    recording: Option<std::fs::File>,
    recording_path: Option<String>,
}

static PTYS: OnceLock<Mutex<HashMap<String, PtySession>>> = OnceLock::new();

fn ptys() -> &'static Mutex<HashMap<String, PtySession>> {
    PTYS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Stateful ANSI stripper feeding the plain-text line tail (search, status).
fn append_stripped(s: &mut PtySession, chunk: &[u8]) {
    for &b in chunk {
        match s.esc {
            1 => {
                s.esc = match b {
                    b'[' => 2,
                    b']' => 3,
                    _ => 0,
                };
            }
            2 => {
                if (0x40..=0x7e).contains(&b) {
                    s.esc = 0;
                }
            }
            3 => {
                if b == 0x07 {
                    s.esc = 0;
                }
            }
            _ => match b {
                0x1b => s.esc = 1,
                b'\n' => {
                    let line = s.partial.trim_end().to_string();
                    if !line.trim().is_empty() {
                        s.lines.push_back(line);
                        while s.lines.len() > 300 {
                            s.lines.pop_front();
                        }
                    }
                    s.partial.clear();
                }
                b'\r' => s.partial.clear(),
                0x00..=0x1f => {}
                _ => {
                    if s.partial.len() < 4000 {
                        s.partial.push(b as char);
                    }
                }
            },
        }
    }
}

#[tauri::command]
fn pty_ensure(app: tauri::AppHandle, id: String, cwd: String, shell: Option<bool>) -> Result<(), String> {
    use tauri::Emitter;
    {
        let mut map = ptys().lock().unwrap();
        if let Some(s) = map.get_mut(&id) {
            if s.alive {
                return Ok(());
            }
            map.remove(&id);
        }
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows: 32, cols: 110, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new("/bin/zsh");
    if shell.unwrap_or(false) {
        cmd.args(["-l"]);
    } else {
        cmd.args(["-lc", "exec claude"]);
    }
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    ptys().lock().unwrap().insert(
        id.clone(),
        PtySession {
            writer,
            master: pair.master,
            child,
            ring: VecDeque::new(),
            lines: VecDeque::new(),
            partial: String::new(),
            esc: 0,
            last_output: Instant::now(),
            bell: false,
            alive: true,
            recording: None,
            recording_path: None,
        },
    );

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    if let Some(s) = ptys().lock().unwrap().get_mut(&id) {
                        s.alive = false;
                    }
                    let _ = app.emit("pty-exit", &id);
                    break;
                }
                Ok(n) => {
                    let chunk = &buf[..n];
                    {
                        let mut map = ptys().lock().unwrap();
                        if let Some(s) = map.get_mut(&id) {
                            s.ring.extend(chunk);
                            while s.ring.len() > 400_000 {
                                s.ring.pop_front();
                            }
                            if chunk.contains(&0x07) {
                                s.bell = true;
                            }
                            s.last_output = Instant::now();
                            append_stripped(s, chunk);
                            if let Some(f) = s.recording.as_mut() {
                                let _ = f.write_all(chunk);
                            }
                        }
                    }
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(chunk);
                    let _ = app.emit(
                        "pty-output",
                        serde_json::json!({ "id": id, "data": b64 }),
                    );
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn pty_write(id: String, data: String) -> Result<(), String> {
    let mut map = ptys().lock().unwrap();
    let s = map.get_mut(&id).ok_or("no session")?;
    s.bell = false;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(id: String, rows: u16, cols: u16) -> Result<(), String> {
    let map = ptys().lock().unwrap();
    let s = map.get(&id).ok_or("no session")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_scrollback(id: String) -> String {
    use base64::Engine;
    let map = ptys().lock().unwrap();
    match map.get(&id) {
        Some(s) => {
            let bytes: Vec<u8> = s.ring.iter().copied().collect();
            base64::engine::general_purpose::STANDARD.encode(bytes)
        }
        None => String::new(),
    }
}

#[derive(Serialize)]
struct PtyStatus {
    id: String,
    alive: bool,
    #[serde(rename = "quietMs")]
    quiet_ms: u128,
    bell: bool,
    tail: Vec<String>,
    recording: Option<String>,
}

#[tauri::command]
fn pty_status() -> Vec<PtyStatus> {
    let mut map = ptys().lock().unwrap();
    map.iter_mut()
        .map(|(id, s)| {
            if s.alive {
                if let Ok(Some(_)) = s.child.try_wait() {
                    s.alive = false;
                }
            }
            PtyStatus {
                id: id.clone(),
                alive: s.alive,
                quiet_ms: s.last_output.elapsed().as_millis(),
                bell: s.bell,
                tail: s.lines.iter().rev().take(40).rev().cloned().collect(),
                recording: s.recording_path.clone(),
            }
        })
        .collect()
}

#[tauri::command]
fn pty_record(id: String, on: bool) -> Result<Option<String>, String> {
    let mut map = ptys().lock().unwrap();
    let s = map.get_mut(&id).ok_or("no session")?;
    if on {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        let dir = PathBuf::from(home).join(".grillme").join("recordings");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let path = dir.join(format!("{id}-{ts}.log"));
        s.recording = Some(std::fs::File::create(&path).map_err(|e| e.to_string())?);
        let p = path.to_string_lossy().into_owned();
        s.recording_path = Some(p.clone());
        Ok(Some(p))
    } else {
        s.recording = None;
        s.recording_path = None;
        Ok(None)
    }
}


// ---------------------------------------------------------------------------
// Shared team state — plain JSON files under ~/.grillme. On the shared VM
// every session reads/writes the same files; that IS the transport.
// Writes are atomic (tmp + rename). Names are allow-listed.
// ---------------------------------------------------------------------------

fn grillme_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let dir = PathBuf::from(home).join(".grillme");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

const SHARED_FILES: &[&str] = &["tasks.json", "messages.json", "team.json", "settings.json"];

#[tauri::command]
fn shared_read(name: String) -> Result<String, String> {
    if !SHARED_FILES.contains(&name.as_str()) {
        return Err("unknown shared file".into());
    }
    Ok(std::fs::read_to_string(grillme_dir().join(&name)).unwrap_or_default())
}

#[tauri::command]
fn shared_write(name: String, content: String) -> Result<(), String> {
    if !SHARED_FILES.contains(&name.as_str()) {
        return Err("unknown shared file".into());
    }
    let dir = grillme_dir();
    let tmp = dir.join(format!("{name}.tmp-write"));
    std::fs::write(&tmp, &content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(&name)).map_err(|e| e.to_string())
}

#[tauri::command]
fn standup_append(id: String, note: String) -> Result<(), String> {
    use std::io::Write as _;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(grillme_dir().join("standup.log"))
        .map_err(|e| e.to_string())?;
    writeln!(f, "{ts}\t{id}\t{}", note.replace(['\n', '\t'], " "))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn standup_tail() -> Vec<String> {
    std::fs::read_to_string(grillme_dir().join("standup.log"))
        .map(|s| {
            let lines: Vec<String> = s.lines().map(str::to_string).collect();
            let skip = lines.len().saturating_sub(20);
            lines.into_iter().skip(skip).collect()
        })
        .unwrap_or_default()
}


#[tauri::command]
fn git_commit_push(repo_path: String, message: String) -> Result<String, String> {
    git(&repo_path, &["add", "-A"])?;
    let staged = git(&repo_path, &["diff", "--cached", "--name-only"])?;
    if staged.trim().is_empty() {
        return Err("nothing to commit".into());
    }
    git(&repo_path, &["commit", "-m", &message])?;
    let branch = git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    match git(&repo_path, &["push", "-u", "origin", branch.trim()]) {
        Ok(_) => Ok(format!("committed + pushed {} files", staged.lines().count())),
        Err(e) => Ok(format!("committed {} files, push failed: {e}", staged.lines().count())),
    }
}

#[tauri::command]
fn git_revert_file(repo_path: String, file: String) -> Result<(), String> {
    // untracked files need clean, tracked need checkout
    let status = git(&repo_path, &["status", "--porcelain", "--", &file])?;
    if status.starts_with("??") {
        git(&repo_path, &["clean", "-f", "--", &file]).map(|_| ())
    } else {
        git(&repo_path, &["checkout", "--", &file]).map(|_| ())
    }
}


// ---------------------------------------------------------------------------
// Real Claude usage — token tallies parsed from the session transcripts
// Claude Code itself writes under ~/.claude/projects. Plan-limit
// percentages are NOT knowable locally; we only report real counts.
// ---------------------------------------------------------------------------

#[derive(Serialize, Default)]
struct UsageStats {
    ok: bool,
    model: String,
    #[serde(rename = "inputTokens")]
    input_tokens: u64,
    #[serde(rename = "outputTokens")]
    output_tokens: u64,
    #[serde(rename = "cacheReadTokens")]
    cache_read_tokens: u64,
    turns: u64,
}

fn project_slug(path: &str) -> String {
    path.replace(['/', '.'], "-")
}

fn newest_transcript(repo_path: &str) -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let projects = PathBuf::from(home).join(".claude").join("projects");
    // exact slug, then parent dirs (sessions often run from a parent of the worktree)
    let mut candidates = vec![repo_path.to_string()];
    let mut cur = PathBuf::from(repo_path);
    while let Some(parent) = cur.parent() {
        if parent.as_os_str().is_empty() {
            break;
        }
        candidates.push(parent.to_string_lossy().into_owned());
        cur = parent.to_path_buf();
    }
    for cand in candidates {
        let dir = projects.join(project_slug(&cand));
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let newest = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
            .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
        if let Some(e) = newest {
            return Some(e.path());
        }
    }
    None
}

#[tauri::command]
fn usage_stats(repo_path: String) -> UsageStats {
    let Some(path) = newest_transcript(&repo_path) else {
        return UsageStats::default();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return UsageStats::default();
    };
    let mut st = UsageStats { ok: true, ..Default::default() };
    for line in raw.lines() {
        if !line.contains("\"usage\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let msg = &v["message"];
        if let Some(u) = msg.get("usage") {
            st.turns += 1;
            st.input_tokens += u["input_tokens"].as_u64().unwrap_or(0);
            st.output_tokens += u["output_tokens"].as_u64().unwrap_or(0);
            st.cache_read_tokens += u["cache_read_input_tokens"].as_u64().unwrap_or(0);
        }
        if let Some(m) = msg.get("model").and_then(|m| m.as_str()) {
            st.model = m.to_string();
        }
    }
    st
}

#[tauri::command]
fn ci_state(repo_path: String) -> Result<String, String> {
    let out = Command::new("gh")
        .args(["run", "list", "--limit", "5", "--json", "name,displayTitle,status,conclusion,headBranch"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}


#[tauri::command]
fn team_config_write(cfg: TeamConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&path, serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}


// ---------------------------------------------------------------------------
// Activity series (sparklines), hooks install, events tail, worktree
// spawner, diff peek, PR drafting.
// ---------------------------------------------------------------------------

static SERIES: OnceLock<Mutex<HashMap<String, VecDeque<u64>>>> = OnceLock::new();
fn series() -> &'static Mutex<HashMap<String, VecDeque<u64>>> {
    SERIES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 30 one-minute buckets of file activity, oldest first.
#[tauri::command]
fn activity_series(id: String) -> Vec<u32> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut buckets = vec![0u32; 30];
    if let Some(q) = series().lock().unwrap().get(&id) {
        for &ts in q {
            let age_min = now.saturating_sub(ts) / 60;
            if age_min < 30 {
                buckets[29 - age_min as usize] += 1;
            }
        }
    }
    buckets
}

/// Claude Code hooks that report exact session state into events.jsonl.
#[tauri::command]
fn install_hooks(repo_path: String, member_id: String) -> Result<String, String> {
    if !PathBuf::from(&repo_path).join(".git").exists() {
        return Err("not a git worktree — skipping hook install".into());
    }
    let dir = PathBuf::from(&repo_path).join(".claude");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("settings.json");
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let hook_cmd = |event: &str| {
        format!(
            "sh -c 'IN=$(cat); printf \"%s\\n\" \"{{\\\"ts\\\":$(date +%s),\\\"id\\\":\\\"{member_id}\\\",\\\"event\\\":\\\"{event}\\\"}}\" >> ~/.grillme/events.jsonl'"
        )
    };
    let mk = |event: &str| {
        serde_json::json!([{ "hooks": [{ "type": "command", "command": hook_cmd(event) }] }])
    };
    let hooks = root
        .as_object_mut()
        .ok_or("bad settings.json")?
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let obj = hooks.as_object_mut().ok_or("bad hooks")?;
    obj.insert("Notification".into(), mk("notification"));
    obj.insert("Stop".into(), mk("stop"));
    obj.insert("UserPromptSubmit".into(), mk("prompt"));
    std::fs::write(&path, serde_json::to_string_pretty(&root).unwrap()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn events_tail() -> Vec<String> {
    std::fs::read_to_string(grillme_dir().join("events.jsonl"))
        .map(|s| {
            let lines: Vec<String> = s.lines().map(str::to_string).collect();
            let skip = lines.len().saturating_sub(100);
            lines.into_iter().skip(skip).collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
fn worktree_add(base_repo: String, branch: String, path: String) -> Result<(), String> {
    git(&base_repo, &["worktree", "add", "-b", &branch, &path, "main"]).map(|_| ())
}

#[tauri::command]
fn git_diff_file(repo_path: String, file: String) -> Result<String, String> {
    let diff = git(&repo_path, &["diff", "--", &file])?;
    if diff.trim().is_empty() {
        git(&repo_path, &["diff", "--cached", "--", &file])
    } else {
        Ok(diff)
    }
}

/// One-shot claude -p over the working diff — returns a drafted PR body.
#[tauri::command]
fn pr_draft(repo_path: String) -> Result<String, String> {
    let out = Command::new("/bin/zsh")
        .args(["-lc", "git diff main 2>/dev/null | head -c 60000 | claude -p 'Write a concise PR title and body (markdown) for this diff. No preamble.'"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            team_config,
            git_state,
            start_watching,
            watch_state,
            pty_ensure,
            pty_write,
            pty_resize,
            pty_scrollback,
            pty_status,
            pty_record,
            shared_read,
            shared_write,
            standup_append,
            standup_tail,
            git_commit_push,
            git_revert_file,
            usage_stats,
            ci_state,
            team_config_write,
            activity_series,
            install_hooks,
            events_tail,
            worktree_add,
            git_diff_file,
            pr_draft
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
