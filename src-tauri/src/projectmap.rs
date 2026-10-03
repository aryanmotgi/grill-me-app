// ---------------------------------------------------------------------------
// Project map: an interactive map of everything in the repo, drawn by the
// Archify skill (MIT, tt-a1i/archify) and shown on the Overview.
//
//   archify_installed   is the skill there (~/.claude/skills, ~/.agents/skills)
//   archify_install     npx skills add tt-a1i/archify -g -y   (after a confirm)
//   map_generate        runs Claude Code headless in the project with one
//                       prompt; it writes .archify/grillme-map/project-map.html
//   map_status          the map (self-contained HTML), when it was made, how
//                       many files changed since, and whether a run is going
//
// The map only ever writes inside .archify/, which is added to the repo's
// local ignore (.git/info/exclude, never a tracked file). Generating costs
// tokens, so it only runs when the user clicks.
// ---------------------------------------------------------------------------

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DIR: &str = ".archify/grillme-map";
const FILE: &str = "project-map.html";
const MAX_RUN: Duration = Duration::from_secs(15 * 60);
const MAX_HTML: u64 = 8_000_000;

static RUNS: Mutex<Option<HashMap<String, (Child, Instant)>>> = Mutex::new(None);

pub const PROMPT: &str = "Use the archify skill to draw an interactive architecture diagram of this repository as it is right now: \
its main parts (screens or pages, APIs, services, background jobs, data stores, external services) and how they connect, backed by the real source code. \
Use plain names someone new to the code understands. \
Write the candidate JSON and the HTML in .archify/grillme-map/, with the final HTML at .archify/grillme-map/project-map.html, replacing any previous one. \
Run archify's finalize step and repair until it passes. Do not create, change or delete any file outside .archify/.";

fn home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

/// Where `npx skills add -g` puts skills, for the agents we run.
pub fn skill_paths(home: &Path) -> [PathBuf; 2] {
    [home.join(".claude/skills/archify/SKILL.md"), home.join(".agents/skills/archify/SKILL.md")]
}

#[tauri::command]
pub fn archify_installed() -> bool {
    home().is_some_and(|h| skill_paths(&h).iter().any(|p| p.exists()))
}

/// Run a command in a login shell (the PATH sessions get), with a deadline.
fn login(args: &[&str], cwd: Option<&Path>, deadline: Duration) -> Result<(bool, String), String> {
    let mut cmd = Command::new("/bin/zsh");
    cmd.arg("-lc").arg("exec \"$@\"").arg("grillme-map").args(args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > deadline {
            let _ = child.kill();
            return Err("It took too long".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let mut out = String::new();
    if let Some(mut o) = child.stdout.take() { let _ = o.read_to_string(&mut out); }
    if let Some(mut e) = child.stderr.take() { let _ = e.read_to_string(&mut out); }
    Ok((status.success(), out))
}

#[tauri::command(async)]
pub fn archify_install() -> Result<String, String> {
    let (ok, out) = login(&["npx", "-y", "skills", "add", "tt-a1i/archify", "-g", "-y"], None, Duration::from_secs(240))?;
    if ok && archify_installed() {
        Ok("Archify is installed".into())
    } else {
        let tail: String = out.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        Err(if tail.is_empty() { "The install didn't finish".into() } else { tail })
    }
}

/// Make sure `.archify/` never shows up as changes: the repo's local ignore,
/// not a tracked .gitignore.
pub fn exclude_line(existing: &str) -> Option<String> {
    let has = existing.lines().any(|l| matches!(l.trim(), ".archify" | ".archify/" | "/.archify" | "/.archify/"));
    (!has).then(|| format!("{}{}.archify/\n", existing, if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" }))
}

fn ignore_map_dir(repo: &Path) {
    let out = Command::new("git").arg("-C").arg(repo).args(["rev-parse", "--git-path", "info/exclude"]).output();
    let Ok(out) = out else { return };
    let rel = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if rel.is_empty() { return; }
    let path = if Path::new(&rel).is_absolute() { PathBuf::from(rel) } else { repo.join(rel) };
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if let Some(next) = exclude_line(&existing) {
        if let Some(p) = path.parent() { let _ = std::fs::create_dir_all(p); }
        let _ = std::fs::write(&path, next);
    }
}

fn repo_ok(repo: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(repo);
    if repo.trim().is_empty() || !p.is_dir() {
        return Err("No project folder".into());
    }
    Ok(p)
}

#[tauri::command]
pub fn map_generate(repo_path: String) -> Result<(), String> {
    let repo = repo_ok(&repo_path)?;
    if !archify_installed() {
        return Err("Archify isn't installed yet".into());
    }
    let mut guard = RUNS.lock().map_err(|e| e.to_string())?;
    let runs = guard.get_or_insert_with(HashMap::new);
    if let Some((c, _)) = runs.get_mut(&repo_path) {
        if c.try_wait().ok().flatten().is_none() {
            return Err("A map is already being drawn".into());
        }
    }
    ignore_map_dir(&repo);
    let dir = repo.join(DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let log = std::fs::File::create(dir.join("run.log")).map_err(|e| e.to_string())?;
    let child = Command::new("/bin/zsh")
        .arg("-lc").arg("exec \"$@\"").arg("grillme-map")
        .args(["claude", "-p", PROMPT, "--dangerously-skip-permissions"])
        .current_dir(&repo)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .spawn().map_err(|e| format!("Couldn't start Claude Code: {e}"))?;
    runs.insert(repo_path, (child, Instant::now()));
    Ok(())
}

#[derive(Serialize, Default)]
pub struct MapStatus {
    pub installed: bool,
    pub running: bool,
    /// seconds since the run started, while running
    #[serde(rename = "runSecs")]
    pub run_secs: u64,
    /// the map's self-contained HTML
    pub html: Option<String>,
    /// unix seconds the map was written
    pub at: Option<u64>,
    /// files changed since then (commits + uncommitted)
    #[serde(rename = "changedSince")]
    pub changed_since: usize,
    /// the end of the last run's log when it finished without a map
    pub error: Option<String>,
}

fn changed_since(repo: &Path, at: u64) -> usize {
    let mut files = std::collections::HashSet::new();
    if let Ok(o) = Command::new("git").arg("-C").arg(repo).args(["log", &format!("--since=@{at}"), "--name-only", "--pretty=format:"]).output() {
        for l in String::from_utf8_lossy(&o.stdout).lines().filter(|l| !l.trim().is_empty()) { files.insert(l.to_string()); }
    }
    if let Ok(o) = Command::new("git").arg("-C").arg(repo).args(["status", "--porcelain"]).output() {
        for l in String::from_utf8_lossy(&o.stdout).lines() {
            let f = l.get(3..).unwrap_or("").trim();
            if !f.is_empty() && !f.starts_with(".archify") { files.insert(f.to_string()); }
        }
    }
    files.len()
}

#[tauri::command(async)]
pub fn map_status(repo_path: String) -> MapStatus {
    let mut st = MapStatus { installed: archify_installed(), ..Default::default() };
    let Ok(repo) = repo_ok(&repo_path) else { return st };
    let mut finished_now = false;
    if let Ok(mut guard) = RUNS.lock() {
        let runs = guard.get_or_insert_with(HashMap::new);
        if let Some((c, started)) = runs.get_mut(&repo_path) {
            match c.try_wait() {
                Ok(None) if started.elapsed() > MAX_RUN => { let _ = c.kill(); runs.remove(&repo_path); finished_now = true; }
                Ok(None) => { st.running = true; st.run_secs = started.elapsed().as_secs(); }
                _ => { runs.remove(&repo_path); finished_now = true; }
            }
        }
    }
    let file = repo.join(DIR).join(FILE);
    if let Ok(meta) = file.metadata() {
        if meta.len() <= MAX_HTML {
            st.html = std::fs::read_to_string(&file).ok();
            st.at = meta.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs());
        }
    }
    if let Some(at) = st.at {
        st.changed_since = changed_since(&repo, at);
    }
    // a run that just ended without writing a (newer) map: say why
    if finished_now && !st.running {
        let fresh = st.at.is_some_and(|at| SystemTime::now().duration_since(UNIX_EPOCH).map(|n| n.as_secs().saturating_sub(at) < 120).unwrap_or(false));
        if !fresh {
            let log = std::fs::read_to_string(repo.join(DIR).join("run.log")).unwrap_or_default();
            let tail: Vec<&str> = log.lines().rev().filter(|l| !l.trim().is_empty()).take(4).collect();
            st.error = Some(if tail.is_empty() { "The map run ended without a map".into() } else { tail.into_iter().rev().collect::<Vec<_>>().join("\n") });
        }
    }
    st
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_the_map_folder_to_the_local_ignore_once() {
        assert_eq!(exclude_line("").as_deref(), Some(".archify/\n"));
        assert_eq!(exclude_line("# git ls-files\n*.log").as_deref(), Some("# git ls-files\n*.log\n.archify/\n"));
        assert_eq!(exclude_line("node_modules\n.archify/\n"), None);
        assert_eq!(exclude_line("/.archify\n"), None);
    }

    #[test]
    fn knows_where_skills_live() {
        let [a, b] = skill_paths(Path::new("/Users/me"));
        assert_eq!(a, PathBuf::from("/Users/me/.claude/skills/archify/SKILL.md"));
        assert_eq!(b, PathBuf::from("/Users/me/.agents/skills/archify/SKILL.md"));
    }

    #[test]
    fn the_prompt_keeps_the_agent_inside_the_map_folder() {
        assert!(PROMPT.contains(".archify/grillme-map/project-map.html"));
        assert!(PROMPT.contains("Do not create, change or delete any file outside .archify/"));
    }
}
