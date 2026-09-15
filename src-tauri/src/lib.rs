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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![team_config, git_state])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
