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
    /// SSH target ("user@host") — session attaches remotely instead of local spawn.
    #[serde(default)]
    pub remote: Option<String>,
    /// tmux session name to attach (remote via ssh -t, or local tmux new -A).
    #[serde(default, rename = "tmuxSession")]
    pub tmux_session: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TeamConfig {
    pub teammates: Vec<TeamMember>,
}

fn config_path() -> PathBuf {
    grillme_dir().join("config.json")
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
            remote: None,
            tmux_session: None,
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

/// Never let git (or credential helpers) block on an interactive prompt —
/// a hung subprocess would stall the 10s git poller thread indefinitely.
fn no_prompt(cmd: &mut Command) -> &mut Command {
    cmd.env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "never")
}

fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = no_prompt(Command::new("git").arg("-C").arg(repo).args(args))
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
    let mut map = lock_or_recover(activity());
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
                        let mut reg = lock_or_recover(activity());
                        reg.insert((id.clone(), rel.clone()), ts);
                    }
                    {
                        let mut ser = lock_or_recover(series());
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
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;

/// Lock a global mutex, tolerating poisoning. A panic on one thread must not
/// permanently brick every terminal — the guarded data is still consistent
/// enough for our use (plain maps/strings, no invariants held across panics).
fn lock_or_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    ring: VecDeque<u8>,
    lines: VecDeque<String>,
    partial: String,
    esc: u8, // 0 none, 1 saw ESC, 2 in CSI, 3 in OSC
    osc_buf: String,
    /// exact needs-input signal: OSC 9 / 99 / 777 notification received
    osc_notify: bool,
    last_output: Instant,
    bell: bool,
    alive: bool,
    recording: Option<std::fs::File>,
    recording_path: Option<String>,
    /// epoch seconds when this pty was spawned — scopes usage attribution
    started_at: u64,
    /// SIGSTOPped (manual or auto-idle) — resumes on view/type
    paused: bool,
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
                    // OSC terminator: check for standard notification codes
                    if s.osc_buf.starts_with("9;")
                        || s.osc_buf.starts_with("99;")
                        || s.osc_buf.starts_with("99:")
                        || s.osc_buf.starts_with("777;notify")
                    {
                        s.osc_notify = true;
                    }
                    s.osc_buf.clear();
                    s.esc = 0;
                } else if s.osc_buf.len() < 512 {
                    s.osc_buf.push(b as char);
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
fn pty_ensure(
    app: tauri::AppHandle,
    id: String,
    cwd: String,
    shell: Option<bool>,
    remote: Option<String>,
    tmux: Option<String>,
) -> Result<(), String> {
    pty_ensure_inner(app, id, cwd, shell.unwrap_or(false), remote, tmux)
}

/// Validate an ssh destination (e.g. "vm", "user@host") before it is passed to
/// ssh. Rejects anything outside [A-Za-z0-9@._-] and leading '-' so config
/// values can never smuggle shell metacharacters or ssh options (-oProxyCommand=...).
fn validate_ssh_host(host: &str) -> Result<(), String> {
    let ok = !host.is_empty()
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(format!(
            "invalid ssh host {host:?}: must match [A-Za-z0-9@._-]+ and not start with '-'"
        ))
    }
}

/// Validate a tmux session name before it is used in a command line.
fn validate_tmux_session(sess: &str) -> Result<(), String> {
    let ok = !sess.is_empty()
        && !sess.starts_with('-')
        && sess
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(format!(
            "invalid tmux session {sess:?}: must match [A-Za-z0-9._-]+ and not start with '-'"
        ))
    }
}

fn pty_ensure_inner(
    app: tauri::AppHandle,
    id: String,
    cwd: String,
    shell: bool,
    remote: Option<String>,
    tmux: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;
    {
        let mut map = lock_or_recover(ptys());
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
    let mut cmd = match (&remote, &tmux) {
        (Some(host), Some(sess)) => {
            // remote VM: attach the already-running tmux session over ssh.
            // argv is passed directly (no shell interpolation); "--" stops
            // ssh from treating the host as an option.
            validate_ssh_host(host)?;
            validate_tmux_session(sess)?;
            let mut c = CommandBuilder::new("ssh");
            c.args(["-t", "--", host.as_str(), "tmux", "new", "-A", "-s", sess.as_str()]);
            c
        }
        (Some(host), None) => {
            validate_ssh_host(host)?;
            let mut c = CommandBuilder::new("ssh");
            c.args(["-t", "--", host.as_str()]);
            c
        }
        (None, Some(sess)) => {
            // local tmux attach-or-create; zsh -lc keeps the login-shell PATH
            // (tmux may live in /opt/homebrew/bin). The session name is
            // validated first, so no shell metacharacters can be interpolated.
            validate_tmux_session(sess)?;
            let mut c = CommandBuilder::new("/bin/zsh");
            c.args(["-lc", &format!("exec tmux new -A -s {sess}")]);
            c
        }
        (None, None) => {
            let mut c = CommandBuilder::new("/bin/zsh");
            if shell {
                c.args(["-l"]);
            } else {
                c.args(["-lc", "exec claude --dangerously-skip-permissions"]);
            }
            c
        }
    };
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    lock_or_recover(ptys()).insert(
        id.clone(),
        PtySession {
            writer,
            master: pair.master,
            child,
            ring: VecDeque::new(),
            lines: VecDeque::new(),
            partial: String::new(),
            esc: 0,
            osc_buf: String::new(),
            osc_notify: false,
            last_output: Instant::now(),
            bell: false,
            alive: true,
            recording: None,
            recording_path: None,
            started_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            paused: false,
        },
    );

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    if let Some(s) = lock_or_recover(ptys()).get_mut(&id) {
                        s.alive = false;
                    }
                    let _ = app.emit("pty-exit", &id);
                    break;
                }
                Ok(n) => {
                    let chunk = &buf[..n];
                    {
                        let mut map = lock_or_recover(ptys());
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
                    // per-session channel: panes subscribe only to their own stream
                    let _ = app.emit(&format!("pty-output/{id}"), b64);
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn pty_write(id: String, data: String) -> Result<(), String> {
    let mut map = lock_or_recover(ptys());
    let s = map.get_mut(&id).ok_or("no session")?;
    if s.paused {
        if let Some(pid) = s.child.process_id() {
            let _ = Command::new("kill").args(["-CONT", &format!("-{pid}")]).output();
            let _ = Command::new("kill").args(["-CONT", &pid.to_string()]).output();
        }
        s.paused = false;
    }
    s.bell = false;
    s.osc_notify = false;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(id: String, rows: u16, cols: u16) -> Result<(), String> {
    let map = lock_or_recover(ptys());
    let s = map.get(&id).ok_or("no session")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_scrollback(id: String) -> String {
    use base64::Engine;
    let map = lock_or_recover(ptys());
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
    #[serde(rename = "oscNotify")]
    osc_notify: bool,
    tail: Vec<String>,
    recording: Option<String>,
    #[serde(rename = "startedAt")]
    started_at: u64,
    paused: bool,
}

#[tauri::command]
fn pty_status() -> Vec<PtyStatus> {
    let mut map = lock_or_recover(ptys());
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
                osc_notify: s.osc_notify,
                tail: {
                    // TUIs repaint without newlines — read the live screen,
                    // not the (often empty) newline-committed history
                    let bytes: Vec<u8> = s.ring.iter().copied().collect();
                    let start = bytes.len().saturating_sub(24_000);
                    let mut lines = strip_ansi_stateless(&bytes[start..]);
                    let skip = lines.len().saturating_sub(40);
                    lines.drain(..skip);
                    lines
                },
                recording: s.recording_path.clone(),
                started_at: s.started_at,
                paused: s.paused,
            }
        })
        .collect()
}

#[tauri::command]
fn pty_record(id: String, on: bool) -> Result<Option<String>, String> {
    let mut map = lock_or_recover(ptys());
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


// ---------------------------------------------------------------------------
// Multi-project workspaces. Each project gets its own state dir under
// ~/.grillme/projects/<id>; the legacy root files serve project "default".
// settings.json stays global (UI preferences follow the user, not a project).
// ---------------------------------------------------------------------------

static ACTIVE_PROJECT: Mutex<String> = Mutex::new(String::new());

/// Project ids become path components under ~/.grillme/projects; only allow
/// safe filename characters and reject "." / ".." to block path traversal.
fn valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn grillme_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let dir = PathBuf::from(home).join(".grillme");
    if !dir.exists() {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::create_dir_all(&dir).is_ok() {
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    dir
}

#[tauri::command]
fn projects_list() -> String {
    std::fs::read_to_string(grillme_root().join("projects.json")).unwrap_or_else(|_| "[]".into())
}

#[tauri::command]
fn projects_write(content: String) -> Result<(), String> {
    std::fs::write(grillme_root().join("projects.json"), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_active_project(id: String) -> Result<(), String> {
    if !valid_project_id(&id) {
        return Err("invalid project id".into());
    }
    let dir = grillme_root().join("projects").join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    *lock_or_recover(&ACTIVE_PROJECT) = id;
    Ok(())
}

fn grillme_dir() -> PathBuf {
    let active = lock_or_recover(&ACTIVE_PROJECT).clone();
    if active.is_empty() || active == "default" || !valid_project_id(&active) {
        return grillme_root();
    }
    let dir = grillme_root().join("projects").join(active);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

const SHARED_FILES: &[&str] = &["tasks.json", "messages.json", "team.json", "settings.json"];

fn shared_path(name: &str) -> PathBuf {
    if name == "settings.json" {
        grillme_root().join(name)
    } else {
        grillme_dir().join(name)
    }
}

#[tauri::command]
fn shared_read(name: String) -> Result<String, String> {
    if !SHARED_FILES.contains(&name.as_str()) {
        return Err("unknown shared file".into());
    }
    Ok(std::fs::read_to_string(shared_path(&name)).unwrap_or_default())
}

#[tauri::command]
fn shared_write(name: String, content: String) -> Result<(), String> {
    if !SHARED_FILES.contains(&name.as_str()) {
        return Err("unknown shared file".into());
    }
    let target = shared_path(&name);
    let tmp = target.with_extension("tmp-write");
    std::fs::write(&tmp, &content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())
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

/// Minimal ISO8601 UTC parse — good enough for transcript timestamps.
fn chrono_lite_parse(ts: &str) -> Result<u64, ()> {
    let b = ts.as_bytes();
    if b.len() < 19 {
        return Err(());
    }
    let num = |r: std::ops::Range<usize>| -> Result<u64, ()> {
        ts.get(r).and_then(|x| x.parse().ok()).ok_or(())
    };
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let days_from_civil = {
        let y = y as i64 - if mo <= 2 { 1 } else { 0 };
        let era = y.div_euclid(400);
        let yoe = (y - era * 400) as u64;
        let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe as i64 - 719468
    };
    Ok((days_from_civil as u64) * 86400 + h * 3600 + mi * 60 + sec)
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

#[derive(Default, Clone)]
struct UsageCacheEntry {
    offset: u64,
    stats: UsageStatsInner,
}

#[derive(Default, Clone)]
struct UsageStatsInner {
    model: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    turns: u64,
}

static USAGE_CACHE: OnceLock<Mutex<HashMap<String, UsageCacheEntry>>> = OnceLock::new();

#[tauri::command]
fn usage_stats(repo_path: String, since: Option<u64>) -> UsageStats {
    use std::io::{Read as _, Seek as _};
    let Some(path) = newest_transcript(&repo_path) else {
        return UsageStats::default();
    };
    let key = format!("{}|{}", path.to_string_lossy(), since.unwrap_or(0));
    let cache = USAGE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut entry = lock_or_recover(cache).get(&key).cloned().unwrap_or_default();
    let Ok(mut f) = std::fs::File::open(&path) else {
        return UsageStats::default();
    };
    let flen = f.metadata().map(|m| m.len()).unwrap_or(0);
    if flen < entry.offset {
        entry = UsageCacheEntry::default(); // rotated/truncated
    }
    // parse only bytes appended since last call — transcripts grow to tens of MB
    let _ = f.seek(std::io::SeekFrom::Start(entry.offset));
    let mut raw = String::new();
    let _ = f.take(8_000_000).read_to_string(&mut raw);
    let consumed = raw.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let complete = &raw[..consumed];
    entry.offset += consumed as u64;
    {
        let st = &mut entry.stats;
        for line in complete.lines() {
            if !line.contains("\"usage\"") {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            if let Some(cut) = since {
                if let Some(ts) = v["timestamp"].as_str() {
                    if let Ok(t) = chrono_lite_parse(ts) {
                        if t < cut {
                            continue;
                        }
                    }
                }
            }
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
    }
    lock_or_recover(cache).insert(key, entry.clone());
    let s2 = entry.stats;
    UsageStats {
        ok: true,
        model: s2.model,
        input_tokens: s2.input_tokens,
        output_tokens: s2.output_tokens,
        cache_read_tokens: s2.cache_read_tokens,
        turns: s2.turns,
    }
}

#[tauri::command]
fn ci_state(repo_path: String) -> Result<String, String> {
    let out = no_prompt(
        Command::new("gh")
            .args(["run", "list", "--limit", "5", "--json", "name,displayTitle,status,conclusion,headBranch"])
            .current_dir(&repo_path),
    )
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
    if let Some(q) = lock_or_recover(series()).get(&id) {
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

    let helper = ensure_safety_files()?;
    let helper_s = helper.to_string_lossy().into_owned();
    let proj_s = grillme_dir().to_string_lossy().into_owned();
    let events = grillme_dir().join("events.jsonl").to_string_lossy().into_owned();
    let hook_cmd = |event: &str| {
        format!(
            "sh -c 'IN=$(cat); printf \"%s\\n\" \"{{\\\"ts\\\":$(date +%s),\\\"id\\\":\\\"{member_id}\\\",\\\"event\\\":\\\"{event}\\\"}}\" >> {events}'"
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
    let helper_hook = |mode: &str, matcher: &str| {
        serde_json::json!([{ "matcher": matcher, "hooks": [{ "type": "command",
            "command": format!("python3 {helper_s} {mode} {member_id} {proj_s}") }] }])
    };
    obj.insert("PreToolUse".into(), helper_hook("pre", "Bash"));
    obj.insert("PostToolUse".into(), helper_hook("post", "Bash|Read|Edit|Write"));
    let next = serde_json::to_string_pretty(&root).unwrap();
    // idempotent: rewriting identical content still bumps mtime and can
    // trigger watcher/vite reload storms — skip when unchanged
    if std::fs::read_to_string(&path).map(|cur| cur == next).unwrap_or(false) {
        return Ok(path.to_string_lossy().into_owned());
    }
    std::fs::write(&path, next).map_err(|e| e.to_string())?;
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
    let out = no_prompt(
        Command::new("/bin/zsh")
            .args(["-lc", "git diff main 2>/dev/null | head -c 60000 | claude -p 'Write a concise PR title and body (markdown) for this diff. No preamble.'"])
            .current_dir(&repo_path),
    )
    .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}


#[derive(Serialize, Default)]
struct ProjectCardStats {
    #[serde(rename = "tasksInProgress")]
    tasks_in_progress: u32,
    unanswered: u32,
    #[serde(rename = "lastCommitAgeMin")]
    last_commit_age_min: Option<u64>,
    #[serde(rename = "sessionsAlive")]
    sessions_alive: u32,
    #[serde(rename = "needsInput")]
    needs_input: bool,
}

/// Card stats for the launch screen — read without opening the project.
#[tauri::command]
fn project_card_stats(id: String, path: String) -> ProjectCardStats {
    let mut st = ProjectCardStats::default();
    if !valid_project_id(&id) {
        return st;
    }
    let dir = if id == "default" {
        grillme_root()
    } else {
        grillme_root().join("projects").join(&id)
    };
    if let Ok(raw) = std::fs::read_to_string(dir.join("tasks.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(arr) = v.as_array() {
                st.tasks_in_progress = arr
                    .iter()
                    .filter(|t| t["status"] == "in-progress")
                    .count() as u32;
            }
        }
    }
    if let Ok(raw) = std::fs::read_to_string(dir.join("messages.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(arr) = v.as_array() {
                st.unanswered = arr
                    .iter()
                    .filter(|m| m["answered"] == false)
                    .count() as u32;
            }
        }
    }
    if !path.is_empty() {
        if let Ok(out) = git(&path, &["log", "-1", "--pretty=format:%ct"]) {
            if let Ok(ts) = out.trim().parse::<u64>() {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                st.last_commit_age_min = Some(now.saturating_sub(ts) / 60);
            }
        }
    }
    let prefix = format!("{id}:");
    for (pid, sess) in lock_or_recover(ptys()).iter() {
        let matches = if id == "default" {
            !pid.contains(':') || pid.starts_with("default:")
        } else {
            pid.starts_with(&prefix)
        };
        if matches && sess.alive {
            st.sessions_alive += 1;
            if sess.bell {
                st.needs_input = true;
            }
        }
    }
    st
}

/// Git repos on disk that aren't registered projects yet.
#[tauri::command]
fn discover_repos(known: Vec<String>) -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let roots = ["Terminal", "worktrees", "Projects", "Developer", "code", "dev"];
    let mut found = vec![];
    for root in roots {
        let base = PathBuf::from(&home).join(root);
        let Ok(entries) = std::fs::read_dir(&base) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if p.join(".git").exists() {
                let ps = p.to_string_lossy().into_owned();
                if !known.contains(&ps) {
                    found.push(ps);
                }
            }
        }
    }
    found.sort();
    found.truncate(8);
    found
}

#[tauri::command]
fn git_clone(url: String, dest: String) -> Result<(), String> {
    let out = no_prompt(Command::new("git").args(["clone", "--depth", "50", &url, &dest]))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}


// ---------------------------------------------------------------------------
// Safety: blocklist enforcement + audit trail via Claude Code hooks.
// The helper script runs on PreToolUse (exit 2 = deny -> Claude must ask
// the user explicitly, even with --dangerously-skip-permissions) and on
// PostToolUse (appends an audit line per executed tool call).
// ---------------------------------------------------------------------------

const HOOK_HELPER: &str = r#"#!/usr/bin/env python3
import json, sys, time, os, re

mode, member, proj_dir = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

if mode == "pre":
    cmd = (data.get("tool_input") or {}).get("command", "") or ""
    bl_path = os.path.expanduser("~/.grillme/blocklist.json")
    try:
        patterns = json.load(open(bl_path))
    except Exception:
        patterns = []
    for pat in patterns:
        try:
            if re.search(pat, cmd):
                print(f"BLOCKED by Grill Me safety blocklist (pattern: {pat}). "
                      "This command is flagged destructive - ask the user for explicit confirmation first.",
                      file=sys.stderr)
                sys.exit(2)
        except re.error:
            continue
elif mode == "post":
    ti = data.get("tool_input") or {}
    line = {
        "ts": int(time.time()),
        "id": member,
        "tool": data.get("tool_name", ""),
        "detail": ti.get("command") or ti.get("file_path") or "",
    }
    try:
        with open(os.path.join(proj_dir, "audit.jsonl"), "a") as f:
            f.write(json.dumps(line) + "\n")
    except Exception:
        pass
sys.exit(0)
"#;

const DEFAULT_BLOCKLIST: &str = r#"[
  "rm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\\s+(/|~|\\*|\\$HOME)",
  "git\\s+push\\s+[^|;]*(--force|-f)\\b[^|;]*\\b(main|master)",
  "git\\s+push\\s+[^|;]*\\b(main|master)\\b[^|;]*(--force|-f)",
  "git\\s+reset\\s+--hard\\s+origin",
  "git\\s+clean\\s+-[a-z]*f[a-z]*d",
  "DROP\\s+(TABLE|DATABASE)",
  "mkfs",
  ">\\s*/dev/(sd|disk)",
  "chmod\\s+-R\\s+777\\s+/",
  "shutdown|reboot\\b"
]"#;

fn ensure_safety_files() -> Result<PathBuf, String> {
    let bin = grillme_root().join("bin");
    std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    let helper = bin.join("grillme-hook");
    let cur = std::fs::read_to_string(&helper).unwrap_or_default();
    if cur != HOOK_HELPER {
        std::fs::write(&helper, HOOK_HELPER).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    let bl = grillme_root().join("blocklist.json");
    if !bl.exists() {
        std::fs::write(&bl, DEFAULT_BLOCKLIST).map_err(|e| e.to_string())?;
    }
    Ok(helper)
}

#[tauri::command]
fn blocklist_read() -> String {
    std::fs::read_to_string(grillme_root().join("blocklist.json"))
        .unwrap_or_else(|_| DEFAULT_BLOCKLIST.into())
}

#[tauri::command]
fn blocklist_write(content: String) -> Result<(), String> {
    serde_json::from_str::<Vec<String>>(&content).map_err(|e| format!("invalid JSON list: {e}"))?;
    std::fs::write(grillme_root().join("blocklist.json"), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn audit_tail(member: Option<String>) -> Vec<String> {
    std::fs::read_to_string(grillme_dir().join("audit.jsonl"))
        .map(|s| {
            let lines: Vec<String> = s
                .lines()
                .filter(|l| match &member {
                    Some(m) => l.contains(&format!("\"id\": \"{m}\"")) || l.contains(&format!("\"id\":\"{m}\"")),
                    None => true,
                })
                .map(str::to_string)
                .collect();
            let skip = lines.len().saturating_sub(200);
            lines.into_iter().skip(skip).collect()
        })
        .unwrap_or_default()
}

// Reliability: pause/resume a session's process tree (SIGSTOP preserves
// full in-memory state; SIGCONT resumes exactly where it left off).
#[tauri::command]
fn pty_pause(id: String, pause: bool) -> Result<(), String> {
    let mut map = lock_or_recover(ptys());
    let sess = map.get_mut(&id).ok_or("no session")?;
    sess.paused = pause;
    let pid = sess.child.process_id().ok_or("no pid")?;
    let sig = if pause { "-STOP" } else { "-CONT" };
    // negative pid = whole process group (claude + its children)
    let out = Command::new("kill")
        .args([sig, &format!("-{pid}")])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        // fall back to the single pid if it isn't a group leader
        Command::new("kill")
            .args([sig, &pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Full project state bundle for backup / machine moves.
#[tauri::command]
fn project_export() -> Result<String, String> {
    let dir = grillme_dir();
    let mut bundle = serde_json::Map::new();
    for name in ["config.json", "tasks.json", "messages.json", "team.json"] {
        if let Ok(raw) = std::fs::read_to_string(dir.join(name)) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                bundle.insert(name.to_string(), v);
            }
        }
    }
    for name in ["standup.log", "events.jsonl", "audit.jsonl"] {
        if let Ok(raw) = std::fs::read_to_string(dir.join(name)) {
            bundle.insert(name.to_string(), serde_json::Value::String(raw));
        }
    }
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}


// ---------------------------------------------------------------------------
// Scriptable session-control API (cmux-style): a localhost HTTP endpoint +
// `grillme` CLI so one agent session can orchestrate others — spawn panes,
// send prompts, read screens. Token-protected; loopback only.
// ---------------------------------------------------------------------------

const API_PORT: u16 = 4517;

const CLI_SCRIPT: &str = r#"#!/bin/bash
# grillme — control Grill Me sessions from any terminal or Claude Code agent.
#   grillme sessions                  list sessions (id, alive, status)
#   grillme send <id> <text...>       send a prompt + Enter into a session
#   grillme type <id> <text...>       type text without pressing Enter
#   grillme read <id> [lines]         read a session's recent screen text
#   grillme new <id> <branch>         create worktree + spawn a live session
T=$(cat "$HOME/.grillme/api-token" 2>/dev/null)
B="http://127.0.0.1:4517"
A="Authorization: Bearer $T"
jsonstr() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
case "$1" in
  sessions) curl -sf -H "$A" "$B/sessions" ;;
  send) id="$2"; shift 2; curl -sf -H "$A" -X POST "$B/send" --data "{\"id\":$(jsonstr "$id"),\"data\":$(jsonstr "$*
")}" ;;
  type) id="$2"; shift 2; curl -sf -H "$A" -X POST "$B/send" --data "{\"id\":$(jsonstr "$id"),\"data\":$(jsonstr "$*")}" ;;
  read) curl -sf -H "$A" "$B/read?id=$2&lines=${3:-40}" ;;
  new)  curl -sf -H "$A" -X POST "$B/new" --data "{\"id\":$(jsonstr "$2"),\"branch\":$(jsonstr "$3")}" ;;
  *) grep '^#   ' "$0" | sed 's/^#   //' ;;
esac
"#;

fn api_token() -> String {
    let path = grillme_root().join("api-token");
    if let Ok(t) = std::fs::read_to_string(&path) {
        let t = t.trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }
    let tok = generate_token();
    // Owner-only perms: create with 0o600 and re-assert in case the file existed.
    {
        use std::io::Write as _;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .and_then(|mut f| f.write_all(tok.as_bytes()));
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    tok
}

fn generate_token() -> String {
    // 32 random bytes from the OS CSPRNG, hex-encoded.
    use std::io::Read as _;
    let mut buf = [0u8; 32];
    if std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .is_ok()
    {
        return buf.iter().map(|b| format!("{b:02x}")).collect();
    }
    // Last-resort fallback if /dev/urandom is unavailable.
    (0..32)
        .map(|i| {
            let seed = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos() as u64 + d.as_secs())
                .unwrap_or(0);
            let c = (seed.wrapping_mul(6364136223846793005).wrapping_add(i as u64 * 31)) % 36;
            char::from_digit((c % 36) as u32, 36).unwrap_or('x')
        })
        .collect()
}

fn start_api_server(app: tauri::AppHandle) {
    use std::io::{BufRead, BufReader, Write as _};
    let token = api_token();
    // install the CLI next to the hook helper
    let bin = grillme_root().join("bin");
    let _ = std::fs::create_dir_all(&bin);
    let cli = bin.join("grillme");
    if std::fs::read_to_string(&cli).map(|c| c != CLI_SCRIPT).unwrap_or(true) {
        if std::fs::write(&cli, CLI_SCRIPT).is_ok() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755));
        }
    }

    std::thread::spawn(move || {
        let listener = match std::net::TcpListener::bind(("127.0.0.1", API_PORT)) {
            Ok(l) => l,
            Err(e) => return eprintln!("[api] bind failed: {e}"),
        };
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(match stream.try_clone() {
                Ok(s) => s,
                Err(_) => continue,
            });
            let mut stream = stream;
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();
            let mut authed = false;
            let mut content_len = 0usize;
            loop {
                let mut h = String::new();
                if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
                    break;
                }
                let hl = h.to_lowercase();
                if hl.starts_with("authorization:") {
                    let value = h["authorization:".len()..].trim();
                    let bearer = value
                        .split_once(' ')
                        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
                        .map(|(_, t)| t.trim());
                    if bearer == Some(token.as_str()) {
                        authed = true;
                    }
                }
                if let Some(v) = hl.strip_prefix("content-length:") {
                    content_len = v.trim().parse().unwrap_or(0);
                }
            }
            let mut body = vec![0u8; content_len.min(65536)];
            if content_len > 0 {
                use std::io::Read as _;
                let _ = reader.read_exact(&mut body);
            }
            let respond = |stream: &mut std::net::TcpStream, code: u16, body: &str| {
                let _ = write!(
                    stream,
                    "HTTP/1.1 {code} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            };
            if !authed {
                respond(&mut stream, 401, "{\"error\":\"bad token\"}");
                continue;
            }
            let route = path.split('?').next().unwrap_or("");
            match (method.as_str(), route) {
                ("GET", "/sessions") => {
                    let out = serde_json::to_string(&pty_status()).unwrap_or_else(|_| "[]".into());
                    respond(&mut stream, 200, &out);
                }
                ("GET", "/read") => {
                    let q: std::collections::HashMap<_, _> = path
                        .split('?')
                        .nth(1)
                        .unwrap_or("")
                        .split('&')
                        .filter_map(|kv| kv.split_once('='))
                        .collect();
                    let id = q.get("id").copied().unwrap_or("").to_string();
                    let n: usize = q.get("lines").and_then(|v| v.parse().ok()).unwrap_or(40);
                    match pty_screen(id, Some(n)) {
                        Ok(lines) => {
                            let out = serde_json::to_string(&lines).unwrap_or_else(|_| "[]".into());
                            respond(&mut stream, 200, &out);
                        }
                        Err(e) => respond(&mut stream, 404, &format!("{{\"error\":\"{e}\"}}")),
                    }
                }
                ("POST", "/send") => {
                    let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
                    let id = v["id"].as_str().unwrap_or("").to_string();
                    let data = v["data"].as_str().unwrap_or("").to_string();
                    match pty_write(id, data) {
                        Ok(_) => respond(&mut stream, 200, "{\"ok\":true}"),
                        Err(e) => respond(&mut stream, 400, &format!("{{\"error\":\"{e}\"}}")),
                    }
                }
                ("POST", "/new") => {
                    let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
                    let id = v["id"].as_str().unwrap_or("").to_string();
                    let branch = v["branch"].as_str().unwrap_or("").to_string();
                    if id.is_empty() || branch.is_empty() {
                        respond(&mut stream, 400, "{\"error\":\"need id and branch\"}");
                        continue;
                    }
                    if !valid_project_id(&id) {
                        respond(&mut stream, 400, "{\"error\":\"invalid id\"}");
                        continue;
                    }
                    let mut cfg = team_config();
                    let base = match cfg.teammates.first() {
                        Some(m) => m.repo_path.clone(),
                        None => {
                            respond(&mut stream, 400, "{\"error\":\"no base repo configured\"}");
                            continue;
                        }
                    };
                    let parent = std::path::Path::new(&base)
                        .parent()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_else(|| ".".into());
                    let path_new = format!("{parent}/worktrees-{id}");
                    if let Err(e) = worktree_add(base, branch, path_new.clone()) {
                        respond(&mut stream, 400, &format!("{{\"error\":\"{e}\"}}"));
                        continue;
                    }
                    cfg.teammates.push(TeamMember {
                        id: id.clone(),
                        name: id.clone(),
                        repo_path: path_new.clone(),
                        permission: Some("edit".into()),
                        remote: None,
                        tmux_session: None,
                    });
                    let _ = team_config_write(cfg);
                    match pty_ensure_inner(app.clone(), id, path_new, false, None, None) {
                        Ok(_) => respond(&mut stream, 200, "{\"ok\":true}"),
                        Err(e) => respond(&mut stream, 400, &format!("{{\"error\":\"{e}\"}}")),
                    }
                }
                _ => respond(&mut stream, 404, "{\"error\":\"unknown route\"}"),
            }
        }
    });
}


// ---------------------------------------------------------------------------
// Self-healing + resource monitoring + session-scoped usage + review data.
// ---------------------------------------------------------------------------

#[tauri::command]
fn pty_kill(id: String) -> Result<(), String> {
    let mut map = lock_or_recover(ptys());
    if let Some(mut sess) = map.remove(&id) {
        let _ = sess.child.kill();
    }
    Ok(())
}

#[derive(Serialize)]
struct SessionResources {
    id: String,
    cpu: f32,
    #[serde(rename = "memMb")]
    mem_mb: f32,
}

/// CPU% + RSS summed over each session's process tree.
#[tauri::command]
fn pty_resources() -> Vec<SessionResources> {
    let roots: Vec<(String, u32)> = lock_or_recover(ptys())
        .iter()
        .filter(|(_, s)| s.alive)
        .filter_map(|(id, s)| s.child.process_id().map(|p| (id.clone(), p)))
        .collect();
    if roots.is_empty() {
        return vec![];
    }
    let Ok(out) = Command::new("ps").args(["-axo", "pid=,ppid=,%cpu=,rss="]).output() else {
        return vec![];
    };
    let mut procs: Vec<(u32, u32, f32, u64)> = vec![];
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() == 4 {
            if let (Ok(pid), Ok(ppid), Ok(cpu), Ok(rss)) =
                (f[0].parse(), f[1].parse(), f[2].parse::<f32>(), f[3].parse::<u64>())
            {
                procs.push((pid, ppid, cpu, rss));
            }
        }
    }
    roots
        .into_iter()
        .map(|(id, root)| {
            // walk descendants
            let mut set = vec![root];
            loop {
                let before = set.len();
                for (pid, ppid, ..) in &procs {
                    if set.contains(ppid) && !set.contains(pid) {
                        set.push(*pid);
                    }
                }
                if set.len() == before {
                    break;
                }
            }
            let (cpu, rss) = procs
                .iter()
                .filter(|(pid, ..)| set.contains(pid))
                .fold((0f32, 0u64), |(c, r), (_, _, cpu, rss)| (c + cpu, r + rss));
            SessionResources { id, cpu, mem_mb: rss as f32 / 1024.0 }
        })
        .collect()
}

#[derive(Serialize)]
struct ReviewData {
    branch: String,
    log: String,
    diffstat: String,
    diff: String,
}

/// Everything the pre-merge review modal needs, in one call.
#[tauri::command]
fn git_review(repo_path: String) -> Result<ReviewData, String> {
    let branch = git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string();
    let log = git(&repo_path, &["log", "--oneline", "main..HEAD"]).unwrap_or_default();
    let diffstat = git(&repo_path, &["diff", "--stat", "main"]).unwrap_or_default();
    let mut diff = git(&repo_path, &["diff", "main"]).unwrap_or_default();
    if diff.len() > 120_000 {
        diff.truncate(120_000);
        diff.push_str("\n… diff truncated at 120KB …");
    }
    Ok(ReviewData { branch, log, diffstat, diff })
}


/// Approximate current screen text: strip ANSI from the raw ring tail.
/// TUIs repaint with cursor moves (no newlines), so the line-history
/// buffer misses them — this reads what's actually on screen.
fn strip_ansi_stateless(bytes: &[u8]) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut cur: Vec<u8> = vec![];
    let mut esc = 0u8;
    let mut flush = |cur: &mut Vec<u8>, out: &mut Vec<String>| {
        let line = String::from_utf8_lossy(cur).trim_end().to_string();
        if !line.trim().is_empty() {
            out.push(line);
        }
        cur.clear();
    };
    for &b in bytes {
        match esc {
            1 => esc = match b { b'[' => 2, b']' => 3, _ => 0 },
            2 => { if (0x40..=0x7e).contains(&b) { esc = 0; } }
            3 => { if b == 0x07 { esc = 0; } }
            _ => match b {
                0x1b => esc = 1,
                b'\n' | b'\r' => flush(&mut cur, &mut out),
                0x00..=0x1f => {}
                _ => { if cur.len() < 8000 { cur.push(b); } }
            },
        }
    }
    flush(&mut cur, &mut out);
    out
}

#[tauri::command]
fn pty_screen(id: String, lines: Option<usize>) -> Result<Vec<String>, String> {
    let map = lock_or_recover(ptys());
    let sess = map.get(&id).ok_or("no such session")?;
    let bytes: Vec<u8> = sess.ring.iter().copied().collect();
    let start = bytes.len().saturating_sub(48_000);
    let mut all = strip_ansi_stateless(&bytes[start..]);
    let n = lines.unwrap_or(40);
    let skip = all.len().saturating_sub(n);
    all.drain(..skip);
    Ok(all)
}


// ---------------------------------------------------------------------------
// Git state cache: one background thread polls every worktree every 10s.
// The frontend reads the cache — no subprocess storm from the UI tick loop.
// ---------------------------------------------------------------------------

static GIT_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static GIT_POLLER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn git_state_cached(repo_path: String) -> String {
    if !GIT_POLLER.swap(true, std::sync::atomic::Ordering::SeqCst) {
        std::thread::spawn(|| loop {
            let paths: Vec<String> = team_config()
                .teammates
                .iter()
                .map(|m| m.repo_path.clone())
                .collect();
            for p in paths {
                let state = git_state(p.clone());
                if let Ok(json) = serde_json::to_string(&state) {
                    lock_or_recover(GIT_CACHE.get_or_init(|| Mutex::new(HashMap::new())))
                        .insert(p, json);
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(10));
        });
    }
    lock_or_recover(GIT_CACHE.get_or_init(|| Mutex::new(HashMap::new())))
        .get(&repo_path)
        .cloned()
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            start_api_server(app.handle().clone());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            team_config,
            git_state,
            git_state_cached,
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
            projects_list,
            projects_write,
            set_active_project,
            project_card_stats,
            discover_repos,
            git_clone,
            blocklist_read,
            blocklist_write,
            audit_tail,
            pty_pause,
            pty_kill,
            pty_screen,
            pty_resources,
            git_review,
            project_export,
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
