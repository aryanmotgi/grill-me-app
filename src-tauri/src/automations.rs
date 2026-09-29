// ---------------------------------------------------------------------------
// Automations backend: auto-test runner and phone pings.
//
// * detect_test_cmd / run_tests — find a repo's test command (npm, cargo,
//   pytest, go) and run it in a session's worktree after a turn, with a hard
//   timeout. Skips when nothing changed since the last run (status + HEAD
//   signature), so an idle session never re-runs its suite.
// * phone_ping — push a short notification through ntfy.sh to a private,
//   random topic the user subscribes to in the ntfy app. Only short
//   summaries (session names, counts) are ever sent — never code.
// ---------------------------------------------------------------------------

use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TEST_TIMEOUT: Duration = Duration::from_secs(300);
const TAIL_BYTES: usize = 4000;

fn is_repo(path: &Path) -> bool {
    path.is_dir() && path.join(".git").exists()
}

fn git_out(repo: &Path, args: &[&str]) -> String {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

/// A cheap fingerprint of the working tree: HEAD + porcelain status.
fn tree_signature(repo: &Path) -> String {
    let mut h = DefaultHasher::new();
    git_out(repo, &["rev-parse", "HEAD"]).hash(&mut h);
    git_out(repo, &["status", "--porcelain"]).hash(&mut h);
    format!("{:x}", h.finish())
}

pub(crate) fn detect(repo: &Path) -> Option<String> {
    if let Ok(pkg) = std::fs::read_to_string(repo.join("package.json")) {
        let v: Value = serde_json::from_str(&pkg).unwrap_or_default();
        if let Some(t) = v["scripts"]["test"].as_str() {
            // npm init's placeholder isn't a test suite
            if !t.contains("no test specified") {
                return Some("npm test --silent".into());
            }
        }
    }
    if repo.join("Cargo.toml").exists() {
        return Some("cargo test --quiet".into());
    }
    if repo.join("src-tauri/Cargo.toml").exists() {
        return Some("cd src-tauri && cargo test --quiet".into());
    }
    if repo.join("pytest.ini").exists() || repo.join("pyproject.toml").exists() && repo.join("tests").is_dir() {
        return Some("python3 -m pytest -q".into());
    }
    if repo.join("go.mod").exists() {
        return Some("go test ./...".into());
    }
    None
}

#[tauri::command]
pub(crate) fn detect_test_cmd(repo_path: String) -> Option<String> {
    let repo = PathBuf::from(&repo_path);
    is_repo(&repo).then(|| detect(&repo)).flatten()
}

fn tail(bytes: &[u8]) -> String {
    let start = bytes.len().saturating_sub(TAIL_BYTES);
    crate::strip_ansi_stateless(&bytes[start..]).join("\n")
}

/// Run the session's tests. `command` overrides detection; `last_sig` skips
/// the run when the tree hasn't changed since then.
#[tauri::command(async)]
pub(crate) fn run_tests(repo_path: String, command: Option<String>, last_sig: Option<String>) -> Result<Value, String> {
    let repo = PathBuf::from(&repo_path);
    if !is_repo(&repo) {
        return Err("not a git worktree".into());
    }
    let sig = tree_signature(&repo);
    if last_sig.as_deref() == Some(sig.as_str()) {
        return Ok(json!({ "skipped": true, "sig": sig }));
    }
    let cmd = match command.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()) {
        Some(c) if c.len() <= 300 && !c.contains('\n') => c,
        Some(_) => return Err("test command must be one line, under 300 chars".into()),
        None => detect(&repo).ok_or("no test command found — set one in Automations")?,
    };
    let started = Instant::now();
    let mut child = Command::new("/bin/zsh")
        .arg("-lc")
        .arg(format!("({cmd}) 2>&1"))
        .current_dir(&repo)
        .env("CI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("couldn't start tests: {e}"))?;
    let mut out = child.stdout.take().ok_or("no stdout")?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(s);
        }
        if started.elapsed() > TEST_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(250));
    };
    let bytes = reader.join().unwrap_or_default();
    let ms = started.elapsed().as_millis() as u64;
    Ok(match status {
        Some(s) => json!({ "skipped": false, "sig": sig, "ok": s.success(), "code": s.code(), "ms": ms, "tail": tail(&bytes), "cmd": cmd }),
        None => json!({ "skipped": false, "sig": sig, "ok": false, "code": null, "ms": ms, "tail": format!("Timed out after {}s.\n{}", TEST_TIMEOUT.as_secs(), tail(&bytes)), "cmd": cmd }),
    })
}

fn valid_topic(t: &str) -> bool {
    (8..=64).contains(&t.len()) && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// One-line header value: no CR/LF (header injection), bounded length.
fn header_safe(s: &str, max: usize) -> String {
    s.chars().filter(|c| *c != '\r' && *c != '\n').take(max).collect()
}

/// Push a short notification to the user's phone via ntfy.sh.
#[tauri::command(async)]
pub(crate) fn phone_ping(topic: String, title: String, body: String) -> Result<(), String> {
    if !valid_topic(&topic) {
        return Err("bad topic".into());
    }
    let out = Command::new("/usr/bin/curl")
        .args(["-sS", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}"])
        .arg("-H")
        .arg(format!("Title: {}", header_safe(&title, 120)))
        .arg("-H")
        .arg("Tags: fire")
        .arg("--data-binary")
        .arg(header_safe(&body, 300))
        .arg(format!("https://ntfy.sh/{topic}"))
        .output()
        .map_err(|e| e.to_string())?;
    let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if code == "200" {
        Ok(())
    } else {
        Err(format!("ntfy.sh returned {code}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topic_and_header_rules() {
        assert!(valid_topic("grillme-3f9a1c2b7d4e5f60"));
        assert!(!valid_topic("short"));
        assert!(!valid_topic("../etc/passwd-xxxx"));
        assert_eq!(header_safe("a\r\nX-Evil: 1", 50), "aX-Evil: 1");
    }

    #[test]
    fn detects_npm_but_not_placeholder() {
        let dir = std::env::temp_dir().join(format!("gm-detect-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"test":"echo \"Error: no test specified\" && exit 1"}}"#).unwrap();
        assert_eq!(detect(&dir), None);
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"test":"vitest run"}}"#).unwrap();
        assert_eq!(detect(&dir).as_deref(), Some("npm test --silent"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod live_tests {
    // run manually: cargo test live_ -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_run_tests_and_ping() {
        let repo = std::env::var("GM_REPO").unwrap();
        let r = super::run_tests(repo.clone(), Some("npx vitest run src/lib/automations.test.ts".into()), None).unwrap();
        println!("run: ok={} ms={} cmd={}", r["ok"], r["ms"], r["cmd"]);
        let again = super::run_tests(repo, None, r["sig"].as_str().map(str::to_owned)).unwrap();
        println!("rerun skipped={}", again["skipped"]);
        println!("ping: {:?}", super::phone_ping("grillme-selftest-0000000000".into(), "Grill Me".into(), "self-test".into()));
    }
}
