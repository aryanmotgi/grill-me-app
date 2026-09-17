use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

mod room;

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

/// Watched (teammate id, repo path) pairs. Keyed per-member so start_watching
/// is idempotent AND re-callable: a repeat call diffs the current team config
/// against this set and only spawns watchers for members added since the last
/// call (Spawner, HTTP /new, fan-out). Watchers are never torn down — threads
/// block on their notify channel for the app's lifetime, and a stale watcher
/// on a still-existing path is harmless (events for removed members are
/// filtered by TTL in watch_state and by the frontend's member list).
static WATCHED: std::sync::OnceLock<Mutex<std::collections::HashSet<(String, String)>>> =
    std::sync::OnceLock::new();

fn watched() -> &'static Mutex<std::collections::HashSet<(String, String)>> {
    WATCHED.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

#[tauri::command]
fn start_watching(app: tauri::AppHandle) {
    use notify::{RecursiveMode, Watcher};
    use tauri::Emitter;

    for member in team_config().teammates {
        let root = PathBuf::from(&member.repo_path);
        if !root.exists() {
            continue; // not inserted — picked up on a later call once it exists
        }
        let key = (member.id.clone(), member.repo_path.clone());
        {
            let mut set = lock_or_recover(watched());
            if !set.insert(key.clone()) {
                continue; // already watching — hot reloads must not stack watchers
            }
        }
        eprintln!("[watch] watching {} at {}", member.id, member.repo_path);
        let app = app.clone();
        let id = member.id.clone();
        std::thread::spawn(move || {
            // on setup failure, un-register so a later call can retry
            let fail = |e: &dyn std::fmt::Display| {
                eprintln!("[watch:{}] {e}", key.0);
                lock_or_recover(watched()).remove(&key);
            };
            let (tx, rx) = std::sync::mpsc::channel();
            let mut watcher = match notify::recommended_watcher(tx) {
                Ok(w) => w,
                Err(e) => return fail(&e),
            };
            if let Err(e) = watcher.watch(&root, RecursiveMode::Recursive) {
                return fail(&e);
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
    strip: LineStripper,
    last_output: Instant,
    alive: bool,
    recording: Option<std::fs::File>,
    recording_path: Option<String>,
    /// epoch seconds when this pty was spawned — scopes usage attribution
    started_at: u64,
    /// SIGSTOPped (manual or auto-idle) — resumes on view/type
    paused: bool,
    /// Spawn generation, from PTY_GENERATION. Guards against a session-identity
    /// race: when a dead session is respawned under the same id, the OLD reader
    /// thread may still be draining the dead pty. Without this tag, its exit
    /// path would mark the NEW session dead (and emit a spurious pty-exit), and
    /// its data path would corrupt the new session's ring buffer, line tail,
    /// and output channel. Every reader-thread action first checks that the
    /// current entry's generation still matches the one captured at spawn; on
    /// mismatch the stale thread exits silently without touching state.
    generation: u64,
}

/// Monotonic counter stamping each spawn — see PtySession::generation.
static PTY_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

static PTYS: OnceLock<Mutex<HashMap<String, PtySession>>> = OnceLock::new();

fn ptys() -> &'static Mutex<HashMap<String, PtySession>> {
    PTYS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Stateful ANSI stripper feeding the plain-text line tail (search, status).
/// Pure (no pty handles) so it is unit-testable. Also owns the two attention
/// signals derived from the byte stream: `bell` (BEL outside any escape
/// sequence — BEL as an OSC terminator does NOT count) and `osc_notify`
/// (OSC 9 / 99 / 777 notification, terminated by BEL or ST).
#[derive(Default)]
struct LineStripper {
    esc: u8, // 0 none, 1 saw ESC, 2 in CSI, 3 in OSC, 4 in OSC saw ESC (ST pending)
    osc_buf: String,
    /// raw bytes of the current line — decoded lossily at line commit so
    /// multi-byte UTF-8 survives byte-wise parsing
    partial: Vec<u8>,
    lines: VecDeque<String>,
    /// exact needs-input signal: OSC 9 / 99 / 777 notification received
    osc_notify: bool,
    /// attention bell: BEL received outside any escape sequence
    bell: bool,
}

impl LineStripper {
    fn feed(&mut self, chunk: &[u8]) {
        for &b in chunk {
            match self.esc {
                1 => {
                    self.esc = match b {
                        b'[' => 2,
                        b']' => 3,
                        _ => 0,
                    };
                }
                2 => {
                    if (0x40..=0x7e).contains(&b) {
                        self.esc = 0;
                    }
                }
                3 => {
                    if b == 0x07 {
                        // BEL here terminates the OSC — not an attention bell
                        self.finish_osc();
                    } else if b == 0x1b {
                        // possible ST terminator (ESC \)
                        self.esc = 4;
                    } else if self.osc_buf.len() < 512 {
                        self.osc_buf.push(b as char);
                    }
                }
                4 => {
                    if b == b'\\' {
                        // ST terminator completed
                        self.finish_osc();
                    } else {
                        // ESC without '\' aborts the OSC and starts a fresh
                        // escape sequence
                        self.osc_buf.clear();
                        self.esc = match b {
                            0x1b => 1,
                            b'[' => 2,
                            b']' => 3,
                            _ => 0,
                        };
                    }
                }
                _ => match b {
                    0x1b => self.esc = 1,
                    0x07 => self.bell = true,
                    b'\n' => {
                        let line =
                            String::from_utf8_lossy(&self.partial).trim_end().to_string();
                        if !line.trim().is_empty() {
                            self.lines.push_back(line);
                            while self.lines.len() > 300 {
                                self.lines.pop_front();
                            }
                        }
                        self.partial.clear();
                    }
                    b'\r' => self.partial.clear(),
                    0x00..=0x1f => {}
                    _ => {
                        if self.partial.len() < 4000 {
                            self.partial.push(b);
                        }
                    }
                },
            }
        }
    }

    /// OSC sequence terminated (BEL or ST): check for standard notification
    /// codes, then reset.
    fn finish_osc(&mut self) {
        if self.osc_buf.starts_with("9;")
            || self.osc_buf.starts_with("99;")
            || self.osc_buf.starts_with("99:")
            || self.osc_buf.starts_with("777;notify")
        {
            self.osc_notify = true;
        }
        self.osc_buf.clear();
        self.esc = 0;
    }
}

/// Resolved path of the claude CLI, cached after the first successful lookup.
/// Only success is cached: if the CLI is missing, every preflight re-checks so
/// installing it (plus an app restart-free retry) can recover without state.
static CLAUDE_PATH: OnceLock<Option<String>> = OnceLock::new();

/// Check that the `claude` CLI is reachable from a login shell (the same
/// environment pty_ensure spawns it in). Returns its resolved path, or an
/// actionable error the frontend can surface instead of letting the pane
/// enter a spawn/die/respawn loop.
#[tauri::command]
fn preflight_claude() -> Result<String, String> {
    if let Some(Some(path)) = CLAUDE_PATH.get() {
        return Ok(path.clone());
    }
    let out = Command::new("/bin/zsh")
        .args(["-lc", "command -v claude"])
        .output()
        .map_err(|e| format!("preflight failed to run zsh: {e}"))?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() && !path.is_empty() {
        let _ = CLAUDE_PATH.set(Some(path.clone()));
        Ok(path)
    } else {
        Err("claude CLI not found on PATH".to_string())
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
    let generation = PTY_GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    lock_or_recover(ptys()).insert(
        id.clone(),
        PtySession {
            writer,
            master: pair.master,
            child,
            ring: VecDeque::new(),
            strip: LineStripper::default(),
            last_output: Instant::now(),
            alive: true,
            recording: None,
            recording_path: None,
            started_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            paused: false,
            generation,
        },
    );

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    if let Some(s) = lock_or_recover(ptys()).get_mut(&id) {
                        if s.generation != generation {
                            // stale reader from a previous spawn of this id:
                            // a new session owns the entry now — don't mark it
                            // dead or emit its exit event.
                            return;
                        }
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
                            if s.generation != generation {
                                // stale reader: don't corrupt the new
                                // session's buffers or output channel.
                                return;
                            }
                            s.ring.extend(chunk);
                            truncate_ring_front(&mut s.ring, 400_000);
                            s.last_output = Instant::now();
                            // bell/notify detection lives in the stateful
                            // stripper: a BEL that terminates an OSC title
                            // sequence is not an attention bell.
                            s.strip.feed(chunk);
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

/// Resolve which team member (if any) a pty id belongs to, returning its
/// index in the teammates list. Pty ids are "<member>" or "<project>:<member>"
/// (mirroring ptyIdFor in src/store.ts). The project prefix is stripped by
/// splitting on the FIRST ':' exactly — never by substring matching — so
/// "project:Bob" can never resolve to a member "ob".
fn member_for_pty<'a>(
    pty_id: &str,
    teammates: &'a [TeamMember],
) -> Option<(usize, &'a TeamMember)> {
    let bare = pty_id.split_once(':').map(|(_, rest)| rest);
    teammates
        .iter()
        .enumerate()
        .find(|(_, m)| pty_id == m.id || bare == Some(m.id.as_str()))
}

/// Backend enforcement of view-only teammates: may keystrokes be written
/// into `pty_id`? Pure over its inputs so it's unit-testable.
///   - The local operator (first teammate in config) is always allowed —
///     it's their own machine.
///   - Any other teammate's session requires permission == "edit"; "view",
///     unset, or unrecognized values deny.
///   - Ids that resolve to no teammate are ALLOWED by design: those are
///     local tool panes driven by the operator — shell tabs ("<id>:shell",
///     whose ":shell" suffix makes them not match any member) and the
///     "merge-pilot" pane — not teammate sessions, so view-only does not
///     apply to them.
fn can_write_session_with(pty_id: &str, teammates: &[TeamMember]) -> Result<(), String> {
    match member_for_pty(pty_id, teammates) {
        None => Ok(()),      // unknown id: local tool pane (shell/merge-pilot)
        Some((0, _)) => Ok(()), // local operator: always their own session
        Some((_, m)) => {
            if m.permission.as_deref() == Some("edit") {
                Ok(())
            } else {
                Err(format!(
                    "{} is view-only — input blocked (set permission to \"edit\" in team settings)",
                    m.name
                ))
            }
        }
    }
}

fn can_write_session(pty_id: &str) -> Result<(), String> {
    can_write_session_with(pty_id, &team_config().teammates)
}

#[tauri::command]
fn pty_write(id: String, data: String) -> Result<(), String> {
    // View-only is enforced HERE, not just in the UI: every input path
    // (Tauri invoke and the HTTP /send route used by `grillme send/type`)
    // funnels through this command.
    can_write_session(&id)?;
    let mut map = lock_or_recover(ptys());
    let s = map.get_mut(&id).ok_or("no session")?;
    if s.paused {
        if let Some(pid) = s.child.process_id() {
            let _ = Command::new("kill").args(["-CONT", &format!("-{pid}")]).output();
            let _ = Command::new("kill").args(["-CONT", &pid.to_string()]).output();
        }
        s.paused = false;
    }
    s.strip.bell = false;
    s.strip.osc_notify = false;
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
                bell: s.strip.bell,
                osc_notify: s.strip.osc_notify,
                tail: {
                    // TUIs repaint without newlines — read the live screen,
                    // not the (often empty) newline-committed history
                    let bytes: Vec<u8> = s.ring.iter().copied().collect();
                    let start = tail_slice_start(&bytes, bytes.len().saturating_sub(24_000));
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

// ---------------------------------------------------------------------------
// Merge-safe shared writes. tasks.json / messages.json are arrays of
// {"id": …} objects written by multiple writers (frontend store, second app
// instance, HTTP thread). Whole-file read-modify-write from a stale snapshot
// silently destroys the other writer's data, so mutations go through a
// read+merge+atomic-rename critical section instead:
//   - a global in-process Mutex serializes same-app writers;
//   - a sidecar lockfile (create_new + bounded retry + stale cleanup)
//     serializes cross-process writers.
// team.json is an object; it gets a shallow field-level merge.
// ---------------------------------------------------------------------------

static SHARED_MERGE_LOCK: Mutex<()> = Mutex::new(());

const SHARED_LOCK_RETRY_MS: u64 = 25;
const SHARED_LOCK_TIMEOUT_MS: u64 = 2_000;
const SHARED_LOCK_STALE_S: u64 = 10;

/// Holds the sidecar lockfile; removing it on Drop releases the lock even on
/// early-return error paths.
#[derive(Debug)]
struct SidecarLock {
    path: PathBuf,
}

impl Drop for SidecarLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Cross-process lock on `<target>.lock` via O_EXCL create. Bounded retry
/// (~2s); a lockfile older than SHARED_LOCK_STALE_S is a crashed holder and
/// gets cleaned up.
fn acquire_sidecar_lock(target: &std::path::Path) -> Result<SidecarLock, String> {
    let mut os = target.as_os_str().to_owned();
    os.push(".lock");
    let path = PathBuf::from(os);
    let deadline = Instant::now() + std::time::Duration::from_millis(SHARED_LOCK_TIMEOUT_MS);
    loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(SidecarLock { path }),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = std::fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|m| m.elapsed().ok())
                    .is_some_and(|age| age.as_secs() > SHARED_LOCK_STALE_S);
                if stale {
                    let _ = std::fs::remove_file(&path);
                    // fall through to the deadline check, then retry create
                }
                if Instant::now() >= deadline {
                    return Err(format!(
                        "timed out waiting for shared-state lock {}",
                        path.display()
                    ));
                }
                if !stale {
                    std::thread::sleep(std::time::Duration::from_millis(SHARED_LOCK_RETRY_MS));
                }
            }
            Err(e) => return Err(format!("cannot create lock {}: {e}", path.display())),
        }
    }
}

/// Pure merge of an id-keyed JSON array. Incoming items overwrite existing
/// entries with the same "id" in place; ids in `removed` are deleted; every
/// other existing entry is preserved untouched. Genuinely new items go to the
/// front (`prepend_new`, messages.json shows newest-first) or the back
/// (tasks.json appends). Incoming items without a string "id" are dropped —
/// there is nothing to merge them by.
fn merge_by_id(
    current: &str,
    incoming: Vec<serde_json::Value>,
    removed: &[String],
    prepend_new: bool,
) -> Vec<serde_json::Value> {
    let existing: Vec<serde_json::Value> = serde_json::from_str::<serde_json::Value>(current)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    let removed: std::collections::HashSet<&str> = removed.iter().map(String::as_str).collect();
    let id_of = |v: &serde_json::Value| v.get("id").and_then(|i| i.as_str()).map(str::to_string);

    let mut by_id: HashMap<String, serde_json::Value> = HashMap::new();
    let mut incoming_order: Vec<String> = vec![];
    for item in incoming {
        if let Some(id) = id_of(&item) {
            if !by_id.contains_key(&id) {
                incoming_order.push(id.clone());
            }
            by_id.insert(id, item);
        }
    }

    let mut out: Vec<serde_json::Value> = vec![];
    let mut replaced: std::collections::HashSet<String> = std::collections::HashSet::new();
    for item in existing {
        match id_of(&item) {
            Some(id) if removed.contains(id.as_str()) => {}
            Some(id) => match by_id.get(&id) {
                Some(replacement) => {
                    out.push(replacement.clone());
                    replaced.insert(id);
                }
                None => out.push(item),
            },
            None => out.push(item), // preserve id-less legacy entries
        }
    }
    let fresh: Vec<serde_json::Value> = incoming_order
        .iter()
        .filter(|id| !replaced.contains(*id) && !removed.contains(id.as_str()))
        .map(|id| by_id[id.as_str()].clone())
        .collect();
    if prepend_new {
        let mut v = fresh;
        v.extend(out);
        v
    } else {
        out.extend(fresh);
        out
    }
}

/// Read-merge-write one array file under both locks, with an atomic
/// temp+rename publish. Path-parameterized so tests can exercise the full
/// critical section against a temp dir.
fn upsert_at(
    target: &std::path::Path,
    incoming: Vec<serde_json::Value>,
    removed_ids: &[String],
    prepend_new: bool,
) -> Result<(), String> {
    let _in_process = lock_or_recover(&SHARED_MERGE_LOCK);
    let _cross_process = acquire_sidecar_lock(target)?;
    let current = std::fs::read_to_string(target).unwrap_or_default();
    let merged = merge_by_id(&current, incoming, removed_ids, prepend_new);
    let content =
        serde_json::to_string_pretty(&serde_json::Value::Array(merged)).map_err(|e| e.to_string())?;
    let tmp = target.with_extension("tmp-merge");
    std::fs::write(&tmp, &content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, target).map_err(|e| e.to_string())
}

#[tauri::command]
fn shared_upsert(name: String, items_json: String, removed_ids: Vec<String>) -> Result<(), String> {
    if name != "tasks.json" && name != "messages.json" {
        return Err("shared_upsert only supports tasks.json / messages.json".into());
    }
    let incoming: Vec<serde_json::Value> = serde_json::from_str(&items_json)
        .map_err(|e| format!("items must be a JSON array of objects: {e}"))?;
    upsert_at(
        &shared_path(&name),
        incoming,
        &removed_ids,
        name == "messages.json",
    )
}

/// Shallow field-level merge for team.json: only fields the caller provides
/// overwrite; everything else on disk is preserved. Path-parameterized for
/// the same testability reason as upsert_at.
fn merge_team_at(
    target: &std::path::Path,
    merge_queue: Option<Vec<String>>,
    sponsor: Option<serde_json::Value>,
) -> Result<(), String> {
    let _in_process = lock_or_recover(&SHARED_MERGE_LOCK);
    let _cross_process = acquire_sidecar_lock(target)?;
    let mut root: serde_json::Map<String, serde_json::Value> = std::fs::read_to_string(target)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    if let Some(q) = merge_queue {
        root.insert("mergeQueue".into(), serde_json::json!(q));
    }
    if let Some(sp) = sponsor {
        root.insert("sponsor".into(), sp);
    }
    let content = serde_json::to_string_pretty(&serde_json::Value::Object(root))
        .map_err(|e| e.to_string())?;
    let tmp = target.with_extension("tmp-merge");
    std::fs::write(&tmp, &content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, target).map_err(|e| e.to_string())
}

#[tauri::command]
fn shared_merge_team(
    merge_queue: Option<Vec<String>>,
    sponsor: Option<serde_json::Value>,
) -> Result<(), String> {
    merge_team_at(&shared_path("team.json"), merge_queue, sponsor)
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

/// Append-only logs are written by external hook processes that may be
/// mid-append when we read. Every line a writer completes ends in '\n', so a
/// file not ending in '\n' has a torn final line — return only the prefix up
/// to (and including) the last newline.
fn complete_lines(s: &str) -> &str {
    match s.rfind('\n') {
        Some(i) => &s[..=i],
        None => "",
    }
}

/// Rotation thresholds for append-only logs (events.jsonl, audit.jsonl):
/// they grow unbounded and are re-read every 2s. Above MAX bytes, keep the
/// last ~KEEP bytes, trimmed forward to a line boundary.
const LOG_ROTATE_MAX: u64 = 2_000_000;
const LOG_ROTATE_KEEP: usize = 1_000_000;

/// Byte offset to keep from when trimming an oversized log: the start of the
/// first complete line inside the trailing `keep` bytes. If the trailing
/// window contains no newline (one giant line), everything is dropped.
fn rotate_keep_from(data: &[u8], keep: usize) -> usize {
    if data.len() <= keep {
        return 0;
    }
    let start = data.len() - keep;
    match data[start..].iter().position(|&b| b == b'\n') {
        Some(i) => start + i + 1,
        None => data.len(),
    }
}

/// Truncate an oversized append-only log from the front, atomically
/// (temp file + rename) so concurrent readers never see a partial file.
/// A hook writer appending exactly during the rename can lose its line to
/// the replaced inode — acceptable for activity/audit tails.
fn rotate_log_if_large(path: &std::path::Path) {
    let Ok(meta) = std::fs::metadata(path) else { return };
    if meta.len() <= LOG_ROTATE_MAX {
        return;
    }
    let Ok(data) = std::fs::read(path) else { return };
    let from = rotate_keep_from(&data, LOG_ROTATE_KEEP);
    let tmp = path.with_extension("tmp-rotate");
    if std::fs::write(&tmp, &data[from..]).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

#[tauri::command]
fn standup_tail() -> Vec<String> {
    std::fs::read_to_string(grillme_dir().join("standup.log"))
        .map(|s| {
            let lines: Vec<String> = complete_lines(&s).lines().map(str::to_string).collect();
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
    const USAGE_READ_WINDOW: u64 = 8_000_000;
    let _ = f.seek(std::io::SeekFrom::Start(entry.offset));
    let mut raw = String::new();
    let _ = (&mut f).take(USAGE_READ_WINDOW).read_to_string(&mut raw);
    let consumed = raw.rfind('\n').map(|i| i + 1).unwrap_or(0);
    if consumed == 0 && raw.len() as u64 >= USAGE_READ_WINDOW {
        // A single line larger than the read window: it can never be parsed,
        // and without advancing the offset would stall here forever. Skip
        // past the window to the next newline (dropping the oversized line)
        // so subsequent calls make progress.
        entry.offset += raw.len() as u64;
        let mut buf = [0u8; 64 * 1024];
        loop {
            match f.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Some(pos) = buf[..n].iter().position(|&b| b == b'\n') {
                        entry.offset += (pos + 1) as u64;
                        break;
                    }
                    entry.offset += n as u64;
                }
            }
        }
    }
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

/// Validate a member id before it is embedded in hook command lines written
/// to .claude/settings.json. Rejects anything outside [A-Za-z0-9_-] so an id
/// can never smuggle shell metacharacters into every teammate's session.
fn validate_member_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(format!("invalid member id {id:?}: must match [A-Za-z0-9_-]+"))
    }
}

/// Single-quote a string for POSIX sh: wrap in ' and escape embedded ' as '\''.
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Claude Code hooks that report exact session state into events.jsonl.
#[tauri::command]
fn install_hooks(repo_path: String, member_id: String) -> Result<String, String> {
    validate_member_id(&member_id)?;
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
        // events path is sh_quoted so a HOME with spaces/quotes cannot break
        // (or inject into) the script; member_id is validated above.
        let script = format!(
            "IN=$(cat); printf \"%s\\n\" \"{{\\\"ts\\\":$(date +%s),\\\"id\\\":\\\"{member_id}\\\",\\\"event\\\":\\\"{event}\\\"}}\" >> {}",
            sh_quote(&events)
        );
        format!("sh -c {}", sh_quote(&script))
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
            "command": format!("python3 {} {mode} {member_id} {}", sh_quote(&helper_s), sh_quote(&proj_s)) }] }])
    };
    obj.insert("PreToolUse".into(), helper_hook("pre", "Bash"));
    obj.insert("PostToolUse".into(), helper_hook("post", "Bash|Read|Edit|Write"));
    let next = serde_json::to_string_pretty(&root).unwrap();
    // the /ship slash command the review-approve flow injects must actually
    // exist in the member repo — install it alongside the hooks
    install_ship_command(&PathBuf::from(&repo_path))?;
    // idempotent: rewriting identical content still bumps mtime and can
    // trigger watcher/vite reload storms — skip when unchanged
    if std::fs::read_to_string(&path).map(|cur| cur == next).unwrap_or(false) {
        return Ok(path.to_string_lossy().into_owned());
    }
    std::fs::write(&path, next).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// /ship slash command: the review modal's "approve & ship" injects "/ship\n"
// into the member's claude pty. Claude Code resolves project slash commands
// from <repo>/.claude/commands/<name>.md, so /ship is only real if that file
// exists — install it alongside the hooks.
// ---------------------------------------------------------------------------

/// Marker identifying a Grill Me-managed ship.md. A ship.md without this
/// marker was authored by the user and must never be overwritten.
const SHIP_COMMAND_MARKER: &str = "<!-- grillme:ship-command -->";

const SHIP_COMMAND_MD: &str = r#"---
description: Verify, commit, push the current branch, and open a PR (installed by Grill Me)
---
<!-- grillme:ship-command -->

Ship the work on the current branch. Follow these steps exactly, in order:

1. Run `git branch --show-current`. If the current branch is `main` or `master`,
   STOP immediately and report that shipping from the default branch is not
   allowed — do not commit, push, or open a PR.
2. Detect and run the project's checks:
   - If `package.json` exists and has a `test` script, run `npm test`.
   - Otherwise, if `package.json` has a `build` script, run `npm run build`.
   - If a `Cargo.toml` exists (check the repo root and `src-tauri/`), also run
     `cargo test` in that directory.
   If a check fails for a trivial reason (formatting, lint, an import or type
   error introduced by the current changes), fix it and re-run the check. If
   the failures are non-trivial, STOP and report them instead of shipping
   broken code.
3. Stage all changes (`git add -A`) and commit on the current branch with a
   conventional commit message (`feat: ...`, `fix: ...`, `chore: ...`)
   describing what was done. If there is nothing to commit but the branch has
   unpushed or un-PR'd commits, continue to the next step.
4. Push the branch: `git push -u origin <current-branch>`. Never push to
   `main` or `master`.
5. Open a pull request with `gh pr create`, with a clear title and a body
   summarizing the changes. If a PR already exists for this branch, use it
   instead of creating a new one.
6. Report the PR URL on the final line of your response.
"#;

/// Outcome of a ship.md install attempt — lets callers (and tests) observe
/// whether the file was actually written.
#[derive(Debug, PartialEq, Eq)]
enum ShipInstall {
    /// ship.md was written (fresh install, or upgrade of a marker-bearing file).
    Installed,
    /// ship.md already has the current content — nothing written.
    Unchanged,
    /// A user-authored ship.md (no grillme marker) exists — left untouched.
    SkippedUserFile,
}

/// Idempotently install .claude/commands/ship.md into a member repo.
/// Content-compared before writing (no mtime churn), and a pre-existing
/// ship.md without the grillme marker is preserved as user-authored.
fn install_ship_command(repo_path: &Path) -> Result<ShipInstall, String> {
    let dir = repo_path.join(".claude").join("commands");
    let path = dir.join("ship.md");
    match std::fs::read_to_string(&path) {
        Ok(cur) if cur == SHIP_COMMAND_MD => return Ok(ShipInstall::Unchanged),
        Ok(cur) if !cur.contains(SHIP_COMMAND_MARKER) => return Ok(ShipInstall::SkippedUserFile),
        _ => {} // missing, unreadable, or a stale grillme-managed copy → (re)install
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(&path, SHIP_COMMAND_MD).map_err(|e| e.to_string())?;
    Ok(ShipInstall::Installed)
}

#[tauri::command]
fn events_tail() -> Vec<String> {
    let path = grillme_dir().join("events.jsonl");
    rotate_log_if_large(&path);
    std::fs::read_to_string(&path)
        .map(|s| {
            let lines: Vec<String> = complete_lines(&s).lines().map(str::to_string).collect();
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

// ---------------------------------------------------------------------------
// Auto-standup — gather each teammate's recent git log + task/event signals,
// then pipe a compact brief to `claude -p` for a per-teammate Done/Doing/
// Blocked summary. Mirrors pr_draft's claude-shelling (zsh -lc for login PATH,
// no_prompt env) but feeds the brief over stdin — like room::claude_pipe — so
// member data never touches a command line.
// ---------------------------------------------------------------------------

const STANDUP_PROMPT: &str = "The input is JSON describing a small dev team. Each member has: \
recent git commits (last 24h), current branch, uncommitted file count, tasks that are done / \
in-progress / blocked, and whether their session is waiting on input. \
Write a concise daily standup in GitHub-flavored markdown, one section per member as \
'## <name> (<branch>)' followed by exactly three lines — 'Done:', 'Doing:', 'Blocked:'. \
Ground every line ONLY in the provided data; never invent activity. If a member has no signal \
in any source, write 'no recorded activity'. If a member's repo was unavailable, say so. \
Keep it terse, no filler, no preamble. Output only the markdown.";

/// Map each member id → whether their most recent hook event is a bare
/// `notification` (session waiting on a decision, per the standup skill).
fn standup_waiting_map(dir: &std::path::Path) -> std::collections::HashMap<String, bool> {
    let mut last: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Ok(s) = std::fs::read_to_string(dir.join("events.jsonl")) {
        for line in complete_lines(&s).lines() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let (Some(id), Some(ev)) = (v["id"].as_str(), v["event"].as_str()) {
                    last.insert(id.to_string(), ev.to_string());
                }
            }
        }
    }
    last.into_iter().map(|(k, v)| (k, v == "notification")).collect()
}

/// Assemble the grounded per-member brief as JSON for the model. Reads real
/// data only (git per repo + tasks.json + events.jsonl); missing files are
/// treated as empty and a broken worktree is flagged, never skipped silently.
fn standup_brief_json() -> String {
    let cfg = team_config();
    let dir = grillme_dir();

    let tasks: Vec<serde_json::Value> = std::fs::read_to_string(dir.join("tasks.json"))
        .ok()
        .and_then(|r| serde_json::from_str::<serde_json::Value>(&r).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    // task id → status, so blockedBy chains can be resolved to "still blocked".
    let mut status_by_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for t in &tasks {
        if let (Some(id), Some(st)) = (t["id"].as_str(), t["status"].as_str()) {
            status_by_id.insert(id.to_string(), st.to_string());
        }
    }

    let waiting = standup_waiting_map(&dir);

    let mut members = Vec::new();
    for m in &cfg.teammates {
        let branch = git(&m.repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let repo_available = !branch.is_empty();
        let commits: Vec<String> = git(
            &m.repo_path,
            &["log", "--since=24 hours ago", "--pretty=format:%h %s (%cr)", "-n", "15"],
        )
        .map(|s| s.lines().map(str::to_string).collect())
        .unwrap_or_default();
        let uncommitted = git(&m.repo_path, &["status", "--porcelain"])
            .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0);

        let owned = |t: &&serde_json::Value| t["owner"].as_str() == Some(m.id.as_str());
        let done: Vec<String> = tasks
            .iter()
            .filter(|t| owned(t) && t["status"] == "done")
            .filter_map(|t| t["title"].as_str().map(str::to_string))
            .collect();
        let doing: Vec<String> = tasks
            .iter()
            .filter(|t| owned(t) && t["status"] == "in-progress")
            .filter_map(|t| t["title"].as_str().map(str::to_string))
            .collect();
        let blocked: Vec<String> = tasks
            .iter()
            .filter(owned)
            .filter_map(|t| {
                let dep = t["blockedBy"].as_str()?;
                let dep_done =
                    status_by_id.get(dep).map(|s| s == "done").unwrap_or(false);
                if dep_done {
                    return None;
                }
                Some(format!(
                    "{} (blocked by {})",
                    t["title"].as_str().unwrap_or("task"),
                    dep
                ))
            })
            .collect();

        members.push(serde_json::json!({
            "name": m.name,
            "branch": branch,
            "repoAvailable": repo_available,
            "commits": commits,
            "uncommittedFiles": uncommitted,
            "tasksDone": done,
            "tasksInProgress": doing,
            "tasksBlocked": blocked,
            "waitingOnInput": waiting.get(&m.id).copied().unwrap_or(false),
        }));
    }

    serde_json::json!({ "members": members }).to_string()
}

/// Strip a single outer ```lang … ``` fence if the model wrapped the whole
/// reply in one — inner fences (real code blocks) are preserved.
fn strip_outer_fence(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("```") {
        if let Some((_, body)) = rest.split_once('\n') {
            if let Some(inner) = body.trim_end().strip_suffix("```") {
                return inner.trim().to_string();
            }
        }
    }
    t.to_string()
}

/// Pipe `input` to `claude -p <prompt>` over stdin (see module comment above).
fn standup_claude_pipe(input: &str, prompt: &str) -> Result<String, String> {
    use std::io::Write as _;
    let script = format!("claude -p {}", sh_quote(prompt));
    let mut child = no_prompt(Command::new("/bin/zsh").args(["-lc", &script]))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn claude: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
        // dropping stdin closes the pipe so claude sees EOF
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Auto-standup: real git + task/event signals → `claude -p` → per-teammate
/// Done/Doing/Blocked markdown. Uses the active project's data dir + team
/// roster, so it takes no arguments.
#[tauri::command]
fn generate_standup() -> Result<String, String> {
    // Surface an honest "claude not installed" error before doing any work.
    preflight_claude()?;
    let mut brief = standup_brief_json();
    // Cap input size like pr_draft (60k), trimmed to a char boundary.
    if brief.len() > 60_000 {
        let mut end = 60_000;
        while !brief.is_char_boundary(end) {
            end -= 1;
        }
        brief.truncate(end);
    }
    let raw = standup_claude_pipe(&brief, STANDUP_PROMPT)?;
    let cleaned = strip_outer_fence(&raw);
    if cleaned.is_empty() {
        return Err("claude returned an empty standup".into());
    }
    Ok(cleaned)
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
            if sess.strip.bell {
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
# grillme-hook v2 — per-line, case-insensitive, quote-stripping, fails closed.
import json, sys, time, os, re

mode, member, proj_dir = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)


def unquote(line):
    # Strip simple matching single/double quotes around whitespace-separated
    # tokens so `rm -rf "/"` matches the same patterns as `rm -rf /`.
    toks = []
    for tok in line.split():
        if len(tok) >= 2 and tok[0] == tok[-1] and tok[0] in "'\"":
            tok = tok[1:-1]
        toks.append(tok)
    return " ".join(toks)


if mode == "pre":
    cmd = (data.get("tool_input") or {}).get("command", "") or ""
    bl_path = os.path.expanduser("~/.grillme/blocklist.json")
    patterns = []
    if os.path.exists(bl_path):
        try:
            patterns = json.load(open(bl_path))
            if not isinstance(patterns, list):
                raise ValueError("blocklist must be a JSON list of patterns")
        except Exception as e:
            print(f"BLOCKED by Grill Me safety: cannot parse {bl_path} ({e}). "
                  "Failing closed - fix the blocklist in Settings > Safety.",
                  file=sys.stderr)
            sys.exit(2)
    lines = [v for raw in cmd.splitlines() for v in (raw, unquote(raw))]
    for pat in patterns:
        try:
            rx = re.compile(pat, re.IGNORECASE)
        except re.error as e:
            print(f"BLOCKED by Grill Me safety: invalid blocklist pattern {pat!r} ({e}). "
                  "Failing closed - fix the blocklist in Settings > Safety.",
                  file=sys.stderr)
            sys.exit(2)
        for line in lines:
            if rx.search(line):
                print(f"BLOCKED by Grill Me safety blocklist (pattern: {pat}). "
                      "This command is flagged destructive - ask the user for explicit confirmation first.",
                      file=sys.stderr)
                sys.exit(2)
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
  "(/usr/bin/|/bin/)?rm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\\s+(/|~|\\*|\\$HOME)",
  "(/usr/bin/|/bin/)?rm\\s+(-[a-z]*r[a-z]*\\s+-[a-z]*f[a-z]*|-[a-z]*f[a-z]*\\s+-[a-z]*r[a-z]*)\\s+(/|~|\\*|\\$HOME)",
  "git\\s+push\\s+[^|;]*(--force(-with-lease)?|-f)\\b[^|;]*\\b(main|master)",
  "git\\s+push\\s+[^|;]*\\b(main|master)\\b[^|;]*(--force(-with-lease)?|-f)",
  "git\\s+reset\\s+--hard\\s+origin",
  "git\\s+clean\\s+-[a-z]*f[a-z]*d",
  "DROP\\s+(TABLE|DATABASE)",
  "mkfs",
  ">\\s*/dev/(sd|disk)",
  "chmod\\s+-R\\s+777\\s+/",
  "shutdown|reboot\\b"
]"#;

/// Prior shipped defaults — an on-disk blocklist identical to one of these was
/// never edited by the user, so it is safe to upgrade in place.
const PREVIOUS_DEFAULT_BLOCKLISTS: &[&str] = &[r#"[
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
]"#];

fn ensure_safety_files() -> Result<PathBuf, String> {
    let bin = grillme_root().join("bin");
    std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    let helper = bin.join("grillme-hook");
    // Content-addressed versioning: any change to HOOK_HELPER makes existing
    // installs rewrite the helper on the next install_hooks call.
    let cur = std::fs::read_to_string(&helper).unwrap_or_default();
    if cur != HOOK_HELPER {
        std::fs::write(&helper, HOOK_HELPER).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    let bl = grillme_root().join("blocklist.json");
    let cur_bl = std::fs::read_to_string(&bl).ok();
    let upgradeable = match &cur_bl {
        None => true,
        // untouched shipped defaults get the new defaults; user edits are kept
        Some(s) => PREVIOUS_DEFAULT_BLOCKLISTS.contains(&s.as_str()),
    };
    if upgradeable && cur_bl.as_deref() != Some(DEFAULT_BLOCKLIST) {
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
    let path = grillme_dir().join("audit.jsonl");
    rotate_log_if_large(&path);
    std::fs::read_to_string(&path)
        .map(|s| {
            let lines: Vec<String> = complete_lines(&s)
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
        if is_strong_token(&t) {
            // Pre-hardening installs wrote the file 0o644 — always re-assert 0o600.
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            return t;
        }
        // Legacy weak token (32 base36, clock-seeded) or garbage: fall through and
        // regenerate. Safe — the grillme CLI re-reads the file on every invocation.
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

/// New-format tokens are 64 lowercase hex chars (32 CSPRNG bytes).
fn is_strong_token(t: &str) -> bool {
    t.len() == 64 && t.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
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
    // Remove first, then kill+wait outside the lock so a slow reap can never
    // stall other sessions' pty calls.
    let sess = lock_or_recover(ptys()).remove(&id);
    if let Some(mut sess) = sess {
        let _ = sess.child.kill();
        // Reap the killed child — without wait() it lingers as a zombie
        // until the app exits. It was just SIGKILLed, so this returns fast.
        let _ = sess.child.wait();
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

/// Truncate `s` to at most `max` bytes without panicking mid-character:
/// walk back from `max` to the nearest UTF-8 char boundary before cutting.
/// `String::truncate` panics if the cut lands inside a multibyte character.
fn truncate_at_char_boundary(s: &mut String, max: usize) {
    if s.len() <= max {
        return;
    }
    let mut n = max;
    while !s.is_char_boundary(n) {
        n -= 1;
    }
    s.truncate(n);
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
        truncate_at_char_boundary(&mut diff, 120_000);
        diff.push_str("\n… diff truncated at 120KB …");
    }
    Ok(ReviewData { branch, log, diffstat, diff })
}

#[cfg(test)]
mod truncate_boundary_tests {
    use super::truncate_at_char_boundary;

    #[test]
    fn multibyte_char_straddling_limit_does_not_panic() {
        // "aé" = [0x61, 0xC3, 0xA9]; cutting at byte 2 lands inside 'é'.
        // String::truncate(2) would panic here on the old code.
        let mut s = String::from("aé");
        truncate_at_char_boundary(&mut s, 2);
        assert_eq!(s, "a");

        // U+FFFD replacement char (3 bytes), as produced by from_utf8_lossy
        // on binary hunks; cut lands mid-char.
        let mut s = String::from("ab\u{FFFD}cd");
        truncate_at_char_boundary(&mut s, 4);
        assert_eq!(s, "ab");

        // Box-drawing char (3 bytes) straddling the limit.
        let mut s = String::from("─────");
        truncate_at_char_boundary(&mut s, 7);
        assert_eq!(s, "──");
    }

    #[test]
    fn ascii_passthrough_truncates_exactly() {
        let mut s = String::from("hello world");
        truncate_at_char_boundary(&mut s, 5);
        assert_eq!(s, "hello");
    }

    #[test]
    fn cut_exactly_on_char_boundary_keeps_whole_chars() {
        // "aé" is 3 bytes; max 3 is exactly on a boundary — keep everything.
        let mut s = String::from("aé");
        truncate_at_char_boundary(&mut s, 3);
        assert_eq!(s, "aé");

        // max 1 is also a boundary (after 'a').
        let mut s = String::from("aé");
        truncate_at_char_boundary(&mut s, 1);
        assert_eq!(s, "a");
    }

    #[test]
    fn max_greater_than_len_is_noop() {
        let mut s = String::from("héllo");
        truncate_at_char_boundary(&mut s, 1_000);
        assert_eq!(s, "héllo");

        let mut empty = String::new();
        truncate_at_char_boundary(&mut empty, 10);
        assert_eq!(empty, "");
    }
}


/// Drop bytes from the ring front until it holds at most `max` bytes,
/// then keep dropping while the front byte is a UTF-8 continuation byte
/// (0b10xxxxxx) so truncation never leaves a partial character at the front.
fn truncate_ring_front(ring: &mut VecDeque<u8>, max: usize) {
    if ring.len() <= max {
        return;
    }
    while ring.len() > max {
        ring.pop_front();
    }
    while ring.front().is_some_and(|&b| b & 0xC0 == 0x80) {
        ring.pop_front();
    }
}

/// Clamp a tail-slice start offset so the slice begins cleanly: skip forward
/// past UTF-8 continuation bytes (never start mid-character), then — since a
/// nonzero start lands mid-stream — drop the partial first line by advancing
/// past the first `\n`, if one exists in the remaining slice. A start of 0 is
/// a full read and is returned untouched.
fn tail_slice_start(bytes: &[u8], mut start: usize) -> usize {
    if start == 0 {
        return 0;
    }
    while start < bytes.len() && bytes[start] & 0xC0 == 0x80 {
        start += 1;
    }
    match bytes[start..].iter().position(|&b| b == b'\n') {
        Some(nl) => start + nl + 1,
        None => start,
    }
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
            // OSC ends with BEL or ST (ESC \); state 4 = in OSC, saw ESC
            3 => { if b == 0x07 { esc = 0; } else if b == 0x1b { esc = 4; } }
            4 => esc = match b { b'\\' => 0, 0x1b => 1, b'[' => 2, b']' => 3, _ => 0 },
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
    let start = tail_slice_start(&bytes, bytes.len().saturating_sub(48_000));
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

// ---------------------------------------------------------------------------
// Conflict radar: pre-merge overlap detection between members' branches.
// Name-level only — intersects `git diff --name-only main...HEAD` file lists
// pairwise across worktrees. Never runs merges. Cached 30s (subprocess-cheap,
// same spirit as GIT_CACHE).
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ConflictPair {
    pub a: String,
    pub b: String,
    pub files: Vec<String>,
}

/// Pure pairwise intersection over (member name, branch, changed files).
/// Same-branch pairs are skipped — identical branches merge trivially.
fn overlap_pairs(members: &[(String, String, Vec<String>)]) -> Vec<ConflictPair> {
    let mut out = Vec::new();
    for i in 0..members.len() {
        for j in (i + 1)..members.len() {
            let (name_a, branch_a, files_a) = &members[i];
            let (name_b, branch_b, files_b) = &members[j];
            if branch_a == branch_b {
                continue;
            }
            let set_b: std::collections::HashSet<&str> =
                files_b.iter().map(String::as_str).collect();
            let mut files: Vec<String> = files_a
                .iter()
                .filter(|f| set_b.contains(f.as_str()))
                .cloned()
                .collect();
            if !files.is_empty() {
                files.sort();
                files.dedup();
                out.push(ConflictPair {
                    a: name_a.clone(),
                    b: name_b.clone(),
                    files,
                });
            }
        }
    }
    out
}

static CONFLICT_CACHE: OnceLock<Mutex<Option<(Instant, Vec<ConflictPair>)>>> = OnceLock::new();

#[tauri::command]
fn git_conflict_radar() -> Vec<ConflictPair> {
    let cache = CONFLICT_CACHE.get_or_init(|| Mutex::new(None));
    if let Some((at, pairs)) = lock_or_recover(cache).as_ref() {
        if at.elapsed() < std::time::Duration::from_secs(30) {
            return pairs.clone();
        }
    }
    let members: Vec<(String, String, Vec<String>)> = team_config()
        .teammates
        .iter()
        .filter_map(|m| {
            let branch = git(&m.repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])
                .ok()?
                .trim()
                .to_string();
            let files: Vec<String> = git(&m.repo_path, &["diff", "--name-only", "main...HEAD"])
                .ok()?
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(String::from)
                .collect();
            Some((m.name.clone(), branch, files))
        })
        .collect();
    let pairs = overlap_pairs(&members);
    *lock_or_recover(cache) = Some((Instant::now(), pairs.clone()));
    pairs
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
            preflight_claude,
            pty_ensure,
            pty_write,
            pty_resize,
            pty_scrollback,
            pty_status,
            pty_record,
            shared_read,
            shared_write,
            shared_upsert,
            shared_merge_team,
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
            pr_draft,
            generate_standup,
            git_conflict_radar,
            room::room_host_start,
            room::room_host_stop,
            room::room_client,
            room::room_brainstorm_reply,
            room::room_make_plan,
            room::room_make_tasks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        can_write_session_with, is_strong_token, member_for_pty, overlap_pairs, sh_quote,
        strip_outer_fence, validate_member_id, TeamMember,
    };

    #[test]
    fn strip_outer_fence_removes_wrapping_markdown_fence() {
        let out = strip_outer_fence("```markdown\n## Mei\nDone: x\n```");
        assert_eq!(out, "## Mei\nDone: x");
    }

    #[test]
    fn strip_outer_fence_leaves_unfenced_and_inner_fences_intact() {
        assert_eq!(strip_outer_fence("## Mei\nDone: x"), "## Mei\nDone: x");
        // an inner code block must survive untouched (no outer fence)
        let s = "## Mei\nDone:\n```sh\nls\n```\nmore";
        assert_eq!(strip_outer_fence(s), s);
    }

    fn m(name: &str, branch: &str, files: &[&str]) -> (String, String, Vec<String>) {
        (name.into(), branch.into(), files.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn overlap_pairs_finds_shared_files() {
        let pairs = overlap_pairs(&[
            m("Mei", "feat/a", &["src/app.ts", "src/store.ts", "README.md"]),
            m("Sam", "feat/b", &["src/store.ts", "README.md", "other.rs"]),
            m("Ana", "feat/c", &["docs/x.md"]),
        ]);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].a, "Mei");
        assert_eq!(pairs[0].b, "Sam");
        assert_eq!(pairs[0].files, vec!["README.md", "src/store.ts"]);
    }

    #[test]
    fn overlap_pairs_empty_when_disjoint() {
        let pairs = overlap_pairs(&[
            m("Mei", "feat/a", &["a.ts"]),
            m("Sam", "feat/b", &["b.ts"]),
        ]);
        assert!(pairs.is_empty());
    }

    #[test]
    fn overlap_pairs_skips_same_branch() {
        // two worktrees on the same branch share every file — not a conflict
        let pairs = overlap_pairs(&[
            m("Mei", "feat/a", &["a.ts"]),
            m("Sam", "feat/a", &["a.ts"]),
        ]);
        assert!(pairs.is_empty());
    }

    #[test]
    fn member_id_accepts_safe_chars() {
        assert!(validate_member_id("alice").is_ok());
        assert!(validate_member_id("bob_2-dev").is_ok());
    }

    #[test]
    fn member_id_rejects_metacharacters() {
        assert!(validate_member_id("").is_err());
        assert!(validate_member_id("a;rm -rf /").is_err());
        assert!(validate_member_id("x$(whoami)").is_err());
        assert!(validate_member_id("a b").is_err());
        assert!(validate_member_id("a'b").is_err());
    }

    #[test]
    fn sh_quote_wraps_and_escapes() {
        assert_eq!(sh_quote("/plain/path"), "'/plain/path'");
        assert_eq!(sh_quote("/has space/x"), "'/has space/x'");
        assert_eq!(sh_quote("a'b"), "'a'\\''b'");
    }

    fn tm(id: &str, permission: Option<&str>) -> TeamMember {
        TeamMember {
            id: id.into(),
            name: id.into(),
            repo_path: "/tmp".into(),
            permission: permission.map(|p| p.into()),
            remote: None,
            tmux_session: None,
        }
    }

    /// operator first, then an edit member, a view member, and one with no
    /// permission set — the shape backend enforcement has to reason about.
    fn team() -> Vec<TeamMember> {
        vec![
            tm("me", Some("view")), // operator: permission must NOT matter
            tm("ed", Some("edit")),
            tm("vi", Some("view")),
            tm("ob", None),
        ]
    }

    #[test]
    fn pty_member_resolution_is_exact_prefix_not_substring() {
        let t = team();
        // "project:Bob" must NOT resolve to member "ob" (old endsWith bug)
        assert!(member_for_pty("project:Bob", &t).is_none());
        // exact bare id and exact "<project>:<member>" both resolve
        assert_eq!(member_for_pty("ob", &t).map(|(i, _)| i), Some(3));
        assert_eq!(member_for_pty("project:ob", &t).map(|(i, _)| i), Some(3));
        // only the FIRST ':' splits — a ":shell" suffix breaks the match
        assert!(member_for_pty("project:ob:shell", &t).is_none());
        assert!(member_for_pty("ob:shell", &t).is_none());
    }

    #[test]
    fn view_member_denied_write() {
        let t = team();
        assert!(can_write_session_with("vi", &t).is_err());
        assert!(can_write_session_with("project:vi", &t).is_err());
        // unset permission is view-only too, matching the UI gate
        assert!(can_write_session_with("ob", &t).is_err());
    }

    #[test]
    fn edit_member_allowed_write() {
        let t = team();
        assert!(can_write_session_with("ed", &t).is_ok());
        assert!(can_write_session_with("project:ed", &t).is_ok());
    }

    #[test]
    fn operator_always_allowed_even_if_marked_view() {
        let t = team();
        assert!(can_write_session_with("me", &t).is_ok());
        assert!(can_write_session_with("project:me", &t).is_ok());
    }

    #[test]
    fn unknown_ids_allowed_local_tool_panes() {
        let t = team();
        // shell tabs and merge-pilot aren't teammate sessions: allowed
        assert!(can_write_session_with("merge-pilot", &t).is_ok());
        assert!(can_write_session_with("vi:shell", &t).is_ok());
        assert!(can_write_session_with("project:vi:shell", &t).is_ok());
    }

    #[test]
    fn strong_token_accepts_new_format() {
        assert!(is_strong_token(&"a1".repeat(32))); // 64 lowercase hex chars
    }

    #[test]
    fn strong_token_rejects_legacy_and_malformed() {
        assert!(!is_strong_token("")); // empty
        assert!(!is_strong_token(&"z9".repeat(16))); // legacy 32-char base36
        assert!(!is_strong_token(&"g1".repeat(32))); // right length, non-hex
        assert!(!is_strong_token(&"A1".repeat(32))); // uppercase hex
        assert!(!is_strong_token(&"a1".repeat(31))); // too short
    }
}

#[cfg(test)]
mod safety_tests {
    use super::{DEFAULT_BLOCKLIST, HOOK_HELPER};
    use std::io::Write;
    use std::process::{Command, Stdio};

    /// Run the real PreToolUse helper against `cmd` with `blocklist` on disk
    /// (in a throwaway $HOME) and report whether it denied (exit code 2).
    fn hook_denies(blocklist: &str, cmd: &str) -> bool {
        let home = std::env::temp_dir().join(format!(
            "grillme-hook-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let gm = home.join(".grillme");
        std::fs::create_dir_all(&gm).unwrap();
        std::fs::write(gm.join("blocklist.json"), blocklist).unwrap();
        let helper = home.join("grillme-hook");
        std::fs::write(&helper, HOOK_HELPER).unwrap();
        let mut child = Command::new("python3")
            .arg(&helper)
            .args(["pre", "tester", gm.to_str().unwrap()])
            .env("HOME", &home)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("python3 must be available");
        let payload = serde_json::json!({ "tool_input": { "command": cmd } });
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(payload.to_string().as_bytes())
            .unwrap();
        child.wait().unwrap().code() == Some(2)
    }

    #[test]
    fn default_blocklist_is_valid_json_list() {
        let patterns: Vec<String> = serde_json::from_str(DEFAULT_BLOCKLIST).unwrap();
        assert!(!patterns.is_empty());
    }

    #[test]
    fn blocks_split_flag_rm() {
        assert!(hook_denies(DEFAULT_BLOCKLIST, "rm -r -f /"));
        assert!(hook_denies(DEFAULT_BLOCKLIST, "rm -f -r ~/"));
    }

    #[test]
    fn blocks_absolute_binary_and_quoted_rm() {
        assert!(hook_denies(DEFAULT_BLOCKLIST, "/bin/rm -rf ~"));
        assert!(hook_denies(DEFAULT_BLOCKLIST, "/usr/bin/rm -rf /"));
        assert!(hook_denies(DEFAULT_BLOCKLIST, "rm -rf \"/\""));
        assert!(hook_denies(DEFAULT_BLOCKLIST, "RM -RF /"));
    }

    #[test]
    fn blocks_force_push_variants_on_protected_branches() {
        assert!(hook_denies(DEFAULT_BLOCKLIST, "git push --force-with-lease origin main"));
        assert!(hook_denies(DEFAULT_BLOCKLIST, "git push origin master --force"));
        assert!(hook_denies(DEFAULT_BLOCKLIST, "echo ok\ngit push -f origin main"));
    }

    #[test]
    fn allows_safe_commands() {
        assert!(!hook_denies(DEFAULT_BLOCKLIST, "rm -rf node_modules"));
        assert!(!hook_denies(DEFAULT_BLOCKLIST, "git push -u origin harden-blocklist"));
        assert!(!hook_denies(DEFAULT_BLOCKLIST, "git push --force-with-lease origin feature/x"));
        assert!(!hook_denies(DEFAULT_BLOCKLIST, "ls -la"));
    }

    #[test]
    fn denies_when_blocklist_is_corrupt() {
        assert!(hook_denies("not valid json [", "ls -la"));
        assert!(hook_denies("{\"not\": \"a list\"}", "ls -la"));
    }
}

#[cfg(test)]
mod ship_command_tests {
    use super::{install_ship_command, ShipInstall, SHIP_COMMAND_MARKER, SHIP_COMMAND_MD};
    use std::path::PathBuf;

    /// Fresh throwaway "repo" dir per test (unique per pid + thread).
    fn tmp_repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "grillme-ship-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn ship_path(repo: &PathBuf) -> PathBuf {
        repo.join(".claude").join("commands").join("ship.md")
    }

    #[test]
    fn installs_ship_md_with_marker_and_real_prompt() {
        let repo = tmp_repo("install");
        assert_eq!(install_ship_command(&repo).unwrap(), ShipInstall::Installed);
        let body = std::fs::read_to_string(ship_path(&repo)).unwrap();
        assert!(body.contains(SHIP_COMMAND_MARKER), "managed file must carry the grillme marker");
        // the prompt must actually do the job "approve & ship" promises
        assert!(body.contains("gh pr create"));
        assert!(body.contains("git push -u origin"));
        assert!(body.contains("cargo test") && body.contains("npm test"));
        assert!(body.to_lowercase().contains("never push to"));
    }

    #[test]
    fn second_install_is_idempotent_no_rewrite() {
        let repo = tmp_repo("idempotent");
        assert_eq!(install_ship_command(&repo).unwrap(), ShipInstall::Installed);
        let mtime_before = std::fs::metadata(ship_path(&repo)).unwrap().modified().unwrap();
        // ensure a rewrite would be observable even on coarse-mtime filesystems
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert_eq!(
            install_ship_command(&repo).unwrap(),
            ShipInstall::Unchanged,
            "second install must not write"
        );
        let mtime_after = std::fs::metadata(ship_path(&repo)).unwrap().modified().unwrap();
        assert_eq!(mtime_before, mtime_after, "idempotent install must not bump mtime");
    }

    #[test]
    fn preserves_user_authored_ship_md() {
        let repo = tmp_repo("userfile");
        let path = ship_path(&repo);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let user_content = "My own ship command — deploy to my staging box.\n";
        std::fs::write(&path, user_content).unwrap();
        assert_eq!(install_ship_command(&repo).unwrap(), ShipInstall::SkippedUserFile);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            user_content,
            "user-authored ship.md must never be clobbered"
        );
    }

    #[test]
    fn upgrades_stale_grillme_managed_ship_md() {
        let repo = tmp_repo("upgrade");
        let path = ship_path(&repo);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("{SHIP_COMMAND_MARKER}\nold v0 prompt\n")).unwrap();
        assert_eq!(install_ship_command(&repo).unwrap(), ShipInstall::Installed);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), SHIP_COMMAND_MD);
    }
}

#[cfg(test)]
mod shared_merge_tests {
    use super::{acquire_sidecar_lock, merge_by_id, merge_team_at, upsert_at};
    use std::path::PathBuf;

    fn tmp_target(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "grillme-merge-test-{}-{tag}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("tasks.json")
    }

    fn item(id: &str, title: &str) -> serde_json::Value {
        serde_json::json!({ "id": id, "title": title })
    }

    fn read_ids(path: &std::path::Path) -> Vec<String> {
        let raw = std::fs::read_to_string(path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).expect("file must stay valid JSON");
        v.as_array()
            .expect("file must stay a JSON array")
            .iter()
            .map(|t| t["id"].as_str().unwrap().to_string())
            .collect()
    }

    /// THE regression test for the lost-update bug: two writers who both
    /// started from the same snapshot each write their own new item as a
    /// delta. Under the old whole-file shared_write flow the second write
    /// (snapshot + t3) clobbers the first (snapshot + t2) and t2 vanishes;
    /// the merge path must keep t1, t2, AND t3.
    #[test]
    fn sequential_upserts_from_stale_snapshots_both_survive() {
        let target = tmp_target("stale-snapshots");
        let _ = std::fs::remove_file(&target);
        upsert_at(&target, vec![item("t1", "seed")], &[], false).unwrap();
        // writer A and writer B both saw only [t1]; each sends its delta
        upsert_at(&target, vec![item("t2", "from A")], &[], false).unwrap();
        upsert_at(&target, vec![item("t3", "from B")], &[], false).unwrap();
        assert_eq!(read_ids(&target), vec!["t1", "t2", "t3"]);
    }

    #[test]
    fn concurrent_upserts_of_distinct_ids_all_survive() {
        let target = tmp_target("concurrent");
        let _ = std::fs::remove_file(&target);
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let target = target.clone();
                std::thread::spawn(move || {
                    upsert_at(
                        &target,
                        vec![item(&format!("c{i}"), &format!("thread {i}"))],
                        &[],
                        false,
                    )
                    .unwrap();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let mut ids = read_ids(&target);
        ids.sort();
        let expected: Vec<String> = (0..8).map(|i| format!("c{i}")).collect();
        assert_eq!(ids, expected);
    }

    #[test]
    fn removed_ids_delete_only_targets() {
        let target = tmp_target("removals");
        let _ = std::fs::remove_file(&target);
        upsert_at(
            &target,
            vec![item("a", "keep"), item("b", "drop"), item("c", "keep")],
            &[],
            false,
        )
        .unwrap();
        upsert_at(&target, vec![], &["b".to_string()], false).unwrap();
        assert_eq!(read_ids(&target), vec!["a", "c"]);
    }

    #[test]
    fn upsert_overwrites_in_place_and_prepends_new_when_asked() {
        // in-place overwrite by id keeps position; prepend_new puts genuinely
        // new items first (messages.json is newest-first)
        let merged = merge_by_id(
            r#"[{"id":"m1","text":"old"},{"id":"m2","text":"two"}]"#,
            vec![
                serde_json::json!({ "id": "m1", "text": "edited" }),
                serde_json::json!({ "id": "m3", "text": "new" }),
            ],
            &[],
            true,
        );
        let ids: Vec<&str> = merged.iter().map(|m| m["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["m3", "m1", "m2"]);
        assert_eq!(merged[1]["text"], "edited");
    }

    #[test]
    fn merge_survives_corrupt_or_missing_current_file() {
        assert_eq!(merge_by_id("", vec![item("x", "t")], &[], false).len(), 1);
        assert_eq!(
            merge_by_id("{not json", vec![item("x", "t")], &[], false).len(),
            1
        );
    }

    #[test]
    fn team_merge_only_overwrites_provided_fields() {
        let target = tmp_target("team").with_file_name("team.json");
        let _ = std::fs::remove_file(&target);
        merge_team_at(
            &target,
            Some(vec!["a".into(), "b".into()]),
            Some(serde_json::json!([{ "sponsor": "x", "done": false }])),
        )
        .unwrap();
        // second writer updates only the queue — sponsor must be preserved
        merge_team_at(&target, Some(vec!["b".into(), "a".into()]), None).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(v["mergeQueue"], serde_json::json!(["b", "a"]));
        assert_eq!(v["sponsor"][0]["sponsor"], "x");
        // and the mirror: sponsor-only write preserves the queue
        merge_team_at(&target, None, Some(serde_json::json!([]))).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(v["mergeQueue"], serde_json::json!(["b", "a"]));
        assert_eq!(v["sponsor"], serde_json::json!([]));
    }

    #[test]
    fn stale_lockfile_is_cleaned_up_and_write_proceeds() {
        let target = tmp_target("stale-lock");
        let _ = std::fs::remove_file(&target);
        let lock_path = PathBuf::from({
            let mut os = target.as_os_str().to_owned();
            os.push(".lock");
            os
        });
        // a crashed holder left the lockfile behind >10s ago
        let f = std::fs::File::create(&lock_path).unwrap();
        f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(11))
            .unwrap();
        drop(f);
        upsert_at(&target, vec![item("s1", "after crash")], &[], false).unwrap();
        assert_eq!(read_ids(&target), vec!["s1"]);
        // the lock is released after the write
        assert!(!lock_path.exists());
    }

    #[test]
    fn held_fresh_lock_times_out_instead_of_clobbering() {
        let target = tmp_target("held-lock");
        let _ = std::fs::remove_file(&target);
        let held = acquire_sidecar_lock(&target).unwrap();
        let started = std::time::Instant::now();
        let err = acquire_sidecar_lock(&target).unwrap_err();
        assert!(err.contains("timed out"));
        // bounded retry: ~2s, not forever
        assert!(started.elapsed() >= std::time::Duration::from_millis(1_500));
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        drop(held);
        // once released, the next writer gets through immediately
        upsert_at(&target, vec![item("h1", "ok")], &[], false).unwrap();
        assert_eq!(read_ids(&target), vec!["h1"]);
    }
}

#[cfg(test)]
mod pure_fn_tests {
    use super::*;

    // -- strip_ansi_stateless ------------------------------------------------

    #[test]
    fn strip_ansi_plain_text_passes_through() {
        assert_eq!(
            strip_ansi_stateless(b"hello world\nsecond line"),
            vec!["hello world".to_string(), "second line".to_string()]
        );
    }

    #[test]
    fn strip_ansi_removes_csi_sequences() {
        // color on/off around "red", cursor-move sequence mid-line
        assert_eq!(
            strip_ansi_stateless(b"\x1b[31mred\x1b[0m and \x1b[2;5Hplain"),
            vec!["red and plain".to_string()]
        );
    }

    #[test]
    fn strip_ansi_removes_osc_sequences() {
        // OSC 0 (set title) terminated by BEL must vanish entirely
        assert_eq!(
            strip_ansi_stateless(b"\x1b]0;window title\x07visible"),
            vec!["visible".to_string()]
        );
    }

    #[test]
    fn strip_ansi_preserves_multibyte_utf8() {
        // multi-byte chars (é = 2 bytes, ✓ = 3 bytes) survive byte-wise processing
        assert_eq!(
            strip_ansi_stateless("caf\u{e9} \u{2713}\n".as_bytes()),
            vec!["caf\u{e9} \u{2713}".to_string()]
        );
    }

    #[test]
    fn strip_ansi_carriage_return_starts_new_line() {
        // TUIs repaint with \r — both segments should be kept as lines
        assert_eq!(
            strip_ansi_stateless(b"first\rsecond"),
            vec!["first".to_string(), "second".to_string()]
        );
    }

    #[test]
    fn strip_ansi_removes_st_terminated_osc() {
        // OSC 0 (set title) terminated by ST (ESC \) must vanish entirely
        assert_eq!(
            strip_ansi_stateless(b"\x1b]0;window title\x1b\\visible"),
            vec!["visible".to_string()]
        );
    }

    // -- UTF-8 ring safety ---------------------------------------------------

    #[test]
    fn truncate_ring_never_splits_utf8_char() {
        // fill with 3-byte chars (✓) so the byte cap lands mid-character
        let mut ring: VecDeque<u8> = "\u{2713}".repeat(100).bytes().collect(); // 300 bytes
        truncate_ring_front(&mut ring, 200); // 200 % 3 != 0 → cap lands mid-char
        assert!(ring.len() <= 200);
        let bytes: Vec<u8> = ring.iter().copied().collect();
        // the surviving tail must be valid UTF-8 — no dangling partial char
        let s = std::str::from_utf8(&bytes).expect("ring front split a UTF-8 char");
        assert!(s.chars().all(|c| c == '\u{2713}'));
        // under the cap: nothing dropped
        let mut small: VecDeque<u8> = "caf\u{e9}".bytes().collect();
        truncate_ring_front(&mut small, 400_000);
        assert_eq!(small.len(), 5);
    }

    #[test]
    fn tail_slice_start_lands_on_char_boundary_and_full_line() {
        let bytes = "caf\u{e9}\nsecond\nthird".as_bytes();
        // offset 4 is the continuation byte of é: must skip past it, then
        // drop the partial first line up to and including the '\n'
        let start = tail_slice_start(bytes, 4);
        assert_eq!(&bytes[start..], "second\nthird".as_bytes());
        assert!(std::str::from_utf8(&bytes[start..]).is_ok());
        // start 0 is a full read: untouched, no line dropped
        assert_eq!(tail_slice_start(bytes, 0), 0);
    }

    #[test]
    fn tail_slice_start_without_newline_keeps_char_boundary() {
        // one long line with a 3-byte char: no '\n' to resync on — keep the
        // char-boundary-adjusted start rather than dropping everything
        let bytes = "ab\u{2713}cdef".as_bytes(); // ✓ occupies bytes 2..5
        let start = tail_slice_start(bytes, 3); // mid-✓
        assert_eq!(start, 5);
        assert_eq!(&bytes[start..], b"cdef");
    }

    // -- LineStripper (stateful pty line history + bell/notify signals) ------

    #[test]
    fn stripper_bel_terminating_osc_is_not_a_bell() {
        // ESC ] 0 ; title BEL — the BEL ends the title sequence; it must not
        // register as a needs-input attention bell
        let mut s = LineStripper::default();
        s.feed(b"\x1b]0;window title\x07prompt\n");
        assert!(!s.bell);
        assert_eq!(s.lines.back().unwrap(), "prompt");
    }

    #[test]
    fn stripper_bare_bel_sets_bell() {
        let mut s = LineStripper::default();
        s.feed(b"needs input\x07\n");
        assert!(s.bell);
        assert_eq!(s.lines.back().unwrap(), "needs input");
    }

    #[test]
    fn stripper_st_terminated_osc_does_not_swallow_output() {
        // OSC ended by ST (ESC \) — text after it must survive
        let mut s = LineStripper::default();
        s.feed(b"\x1b]0;title\x1b\\visible text\n");
        assert!(!s.bell);
        assert_eq!(s.lines.back().unwrap(), "visible text");
    }

    #[test]
    fn stripper_osc_notify_detected_with_either_terminator() {
        let mut s = LineStripper::default();
        s.feed(b"\x1b]9;done\x07");
        assert!(s.osc_notify);

        let mut s = LineStripper::default();
        s.feed(b"\x1b]777;notify;title;body\x1b\\");
        assert!(s.osc_notify);
    }

    #[test]
    fn stripper_preserves_multibyte_utf8_in_history() {
        // é (2 bytes), ✓ (3 bytes), 日本 (3 bytes each) must not be mangled
        let mut s = LineStripper::default();
        s.feed("caf\u{e9} \u{2713} \u{65e5}\u{672c}\n".as_bytes());
        assert_eq!(s.lines.back().unwrap(), "caf\u{e9} \u{2713} \u{65e5}\u{672c}");
    }

    #[test]
    fn stripper_state_persists_across_chunks() {
        // OSC split across reads, ST terminator split across reads
        let mut s = LineStripper::default();
        s.feed(b"\x1b]0;spl");
        s.feed(b"it\x1b");
        s.feed(b"\\after\n");
        assert!(!s.bell);
        assert_eq!(s.lines.back().unwrap(), "after");
    }

    // -- valid_project_id ----------------------------------------------------

    #[test]
    fn project_id_accepts_safe_names() {
        assert!(valid_project_id("default"));
        assert!(valid_project_id("a-b_c.1"));
    }

    #[test]
    fn project_id_rejects_traversal_and_slashes() {
        assert!(!valid_project_id(""));
        assert!(!valid_project_id("."));
        assert!(!valid_project_id(".."));
        assert!(!valid_project_id("../etc"));
        assert!(!valid_project_id("a/b"));
    }

    // -- ssh host / tmux session validators ----------------------------------

    #[test]
    fn ssh_host_accepts_normal_targets() {
        assert!(validate_ssh_host("vm").is_ok());
        assert!(validate_ssh_host("user@host.tld").is_ok());
    }

    #[test]
    fn ssh_host_rejects_injection_attempts() {
        assert!(validate_ssh_host("x; rm -rf /").is_err()); // shell metacharacters
        assert!(validate_ssh_host("-oProxyCommand=evil").is_err()); // option smuggling
        assert!(validate_ssh_host("").is_err());
    }

    #[test]
    fn tmux_session_accepts_normal_names() {
        assert!(validate_tmux_session("main").is_ok());
        assert!(validate_tmux_session("grill_me.1-dev").is_ok());
    }

    #[test]
    fn tmux_session_rejects_unsafe_names() {
        assert!(validate_tmux_session("x; rm").is_err());
        assert!(validate_tmux_session("-t0").is_err());
        assert!(validate_tmux_session("has space").is_err());
        assert!(validate_tmux_session("").is_err());
    }

    // -- project_slug (transcript dir helper) --------------------------------

    #[test]
    fn project_slug_replaces_separators() {
        assert_eq!(project_slug("/Users/me/grill.me"), "-Users-me-grill-me");
    }

    // -- complete_lines (torn-tail guard) ------------------------------------

    #[test]
    fn complete_lines_keeps_terminated_content() {
        assert_eq!(complete_lines("a\nb\n"), "a\nb\n");
    }

    #[test]
    fn complete_lines_drops_torn_final_line() {
        assert_eq!(complete_lines("a\nb\npart"), "a\nb\n");
        assert_eq!(complete_lines("no newline yet"), "");
        assert_eq!(complete_lines(""), "");
    }

    // -- rotate_keep_from (log rotation trim point) --------------------------

    #[test]
    fn rotate_keep_from_small_file_keeps_everything() {
        assert_eq!(rotate_keep_from(b"a\nb\n", 100), 0);
    }

    #[test]
    fn rotate_keep_from_trims_to_line_boundary() {
        // keep window of 6 over "aa\nbb\ncc\n" (9 bytes) starts at byte 3;
        // trim runs to just past the first '\n' inside the window (index 5),
        // so the kept tail is "cc\n" — always whole lines, never a torn head.
        let data = b"aa\nbb\ncc\n";
        let from = rotate_keep_from(data, 6);
        assert_eq!(&data[from..], b"cc\n");
    }

    #[test]
    fn rotate_keep_from_giant_single_line_drops_all() {
        let data = b"one enormous line without any newline at all";
        assert_eq!(rotate_keep_from(data, 8), data.len());
    }
}
