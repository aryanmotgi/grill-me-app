// ---------------------------------------------------------------------------
// Doctor: one screen that says what this Mac is missing. New users otherwise
// hit silent failures (no claude → no sessions, no gh → no PRs). The MCP
// bridge is built into the app binary, so Node is no longer needed.
// Each check runs in a login shell — the same PATH sessions get.
// ---------------------------------------------------------------------------

use serde_json::{json, Value};
use std::process::Command;

fn login(cmd: &str) -> Option<String> {
    let out = Command::new("/bin/zsh").args(["-lc", cmd]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

fn first_line(s: String) -> String {
    s.lines().next().unwrap_or("").chars().take(80).collect()
}

fn check(id: &str, label: &str, required: bool, found: Option<String>, why: &str, fix: &str) -> Value {
    json!({ "id": id, "label": label, "required": required, "ok": found.is_some(),
            "detail": found.map(first_line).unwrap_or_default(), "why": why, "fix": fix })
}

/// `claude auth status` prints JSON with `loggedIn`; anything else (not
/// installed, older CLI, error) counts as not signed in.
fn claude_signed_in() -> Option<String> {
    let out = login("claude auth status")?;
    let v: Value = serde_json::from_str(&out).ok()?;
    (v["loggedIn"] == true).then(|| v["authMethod"].as_str().unwrap_or("signed in").to_string())
}

/// What "Install for me" runs for each check. The id picks from this fixed
/// list, so the webview can never ask for an arbitrary command.
fn install_cmd(id: &str) -> Option<&'static str> {
    match id {
        "claude" => Some("curl -fsSL https://claude.ai/install.sh | bash"),
        // opens the browser sign-in and waits for it to finish
        "claude-login" => Some("claude auth login"),
        // macOS: Apple's own installer dialog for git + python3
        "git" | "python3" => Some("xcode-select --install"),
        _ => None,
    }
}

/// Run the fix for one check (onboarding's "Install for me"). Blocks until it
/// finishes or 10 minutes pass; returns the last lines of output.
#[tauri::command(async)]
pub(crate) fn doctor_install(id: String) -> Result<String, String> {
    let cmd = install_cmd(&id).ok_or_else(|| "Install this one yourself — copy the command".to_string())?;
    let mut child = Command::new("/bin/zsh")
        .args(["-lc", cmd])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    // drain both pipes on their own threads so a chatty installer never
    // blocks on a full pipe while we wait for it
    let drain = |r: Option<Box<dyn std::io::Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            if let Some(mut r) = r { let _ = std::io::Read::read_to_string(&mut r, &mut buf); }
            buf
        })
    };
    let out_t = drain(child.stdout.take().map(|r| Box::new(r) as Box<dyn std::io::Read + Send>));
    let err_t = drain(child.stderr.take().map(|r| Box::new(r) as Box<dyn std::io::Read + Send>));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            return Err("Took longer than 10 minutes — try the command in Terminal".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    };
    let text = format!("{}{}", out_t.join().unwrap_or_default(), err_t.join().unwrap_or_default());
    let tail = last_lines(&text, 4);
    if status.success() {
        Ok(tail)
    } else {
        Err(if tail.is_empty() { format!("exited with {status}") } else { tail })
    }
}

fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::{install_cmd, last_lines};

    #[test]
    fn install_only_runs_known_fixes() {
        assert!(install_cmd("claude").unwrap().contains("claude.ai/install.sh"));
        assert_eq!(install_cmd("claude-login"), Some("claude auth login"));
        assert!(install_cmd("gh").is_none());
        assert!(install_cmd("rm -rf /").is_none());
    }

    #[test]
    fn keeps_the_last_non_empty_lines() {
        assert_eq!(last_lines("a\n\nb\nc\n", 2), "b\nc");
        assert_eq!(last_lines("", 3), "");
    }
}

#[tauri::command(async)]
pub(crate) fn system_doctor() -> Vec<Value> {
    let api_up = std::net::TcpStream::connect_timeout(
        &([127, 0, 0, 1], 4517).into(),
        std::time::Duration::from_millis(300),
    )
    .is_ok();
    let ts = crate::tailscale::tailscale_status();
    let ts_detail = (ts["installed"] == true && ts["running"] == true)
        .then(|| ts["dnsName"].as_str().unwrap_or("connected").to_string());
    vec![
        check("claude", "Claude Code", true, login("claude --version"),
            "Every session is a Claude Code process.", "curl -fsSL https://claude.ai/install.sh | bash"),
        check("claude-login", "Signed in to Claude", true, claude_signed_in(),
            "Sessions run on your own Claude plan.", "claude auth login"),
        check("git", "Git", true, login("git --version"),
            "Worktrees, diffs, checkpoints and shipping.", "xcode-select --install"),
        check("python3", "Python 3", true, login("python3 --version"),
            "Runs the safety hook that blocks dangerous commands.", "xcode-select --install"),
        check("gh", "GitHub CLI", false, login("gh --version"),
            "Opens and merges PRs from the Ship queue.", "brew install gh && gh auth login"),
        check("tailscale", "Tailscale", false, ts_detail,
            "Team rooms across Wi-Fis and the claude.ai connection.", "Install from tailscale.com/download/mac, then sign in"),
        check("api", "Control API", true, api_up.then(|| "127.0.0.1:4517".to_string()),
            "The bridge and CLI talk to the app here.", "Quit anything else on port 4517 and relaunch Grill Me"),
    ]
}

/// Plain-text report for bug reports: versions, the doctor results and
/// on/off switches. Never transcripts, paths inside projects, tokens, the
/// remote secret or anything from the access log.
#[tauri::command(async)]
pub(crate) fn diagnostics(app: tauri::AppHandle) -> String {
    let mut out = String::from("Grill Me diagnostics\n");
    out += &format!("app: {}\n", app.package_info().version);
    out += &format!("macOS: {}\n", login("sw_vers -productVersion").unwrap_or_default());
    out += &format!("arch: {}\n", std::env::consts::ARCH);
    for c in system_doctor() {
        let mark = if c["ok"] == true { "ok " } else if c["required"] == true { "MISSING" } else { "off" };
        out += &format!("{mark:<7} {}: {}\n", c["label"].as_str().unwrap_or(""), c["detail"].as_str().unwrap_or(""));
    }
    let root = crate::grillme_root();
    let projects: Vec<serde_json::Value> = std::fs::read_to_string(root.join("projects.json"))
        .ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    out += &format!("projects: {}\n", projects.len());
    let settings: Value = std::fs::read_to_string(root.join("settings.json"))
        .ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    for key in ["appMode", "remoteOn", "remoteWrites", "remoteShareChats"] {
        out += &format!("{key}: {}\n", settings.get(key).map(|v| v.to_string()).unwrap_or_else(|| "-".into()));
    }
    out += &format!("room hosted: {}\n", root.join("room.json").exists());
    out
}
