// ---------------------------------------------------------------------------
// "Connect your AI" (onboarding): which coding AIs are installed, whether
// each is signed in, and a Sign in button that runs that AI's own login.
// Grill Me never sees a password or token: every login is the tool's normal
// browser flow, and status comes from the tool's own status command (or, for
// Gemini, whether its credentials file exists — never what's inside).
// ---------------------------------------------------------------------------

use serde_json::{json, Value};
use std::process::Command;

/// The AIs we know how to check, in the order we prefer them for the interview.
pub const AIS: &[(&str, &str, &str)] = &[
    // (id, name, executable)
    ("claude", "Claude Code", "claude"),
    ("codex", "Codex", "codex"),
    ("cursor", "Cursor", "cursor-agent"),
    ("gemini", "Gemini CLI", "gemini"),
];

/// Runs in a login shell (the PATH sessions get). Returns (exit ok, stdout + stderr).
fn shell(cmd: &str) -> Option<(bool, String)> {
    let out = Command::new("/bin/zsh").args(["-lc", cmd]).stdin(std::process::Stdio::null()).output().ok()?;
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Some((out.status.success(), strip_ansi(&text).trim().to_string()))
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() { break; }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// "Logged in using ChatGPT" → signed in; "Not logged in" → not.
pub fn says_logged_in(text: &str) -> bool {
    let t = text.to_lowercase();
    !(t.contains("not logged in") || t.contains("not signed in") || t.contains("logged out"))
        && (t.contains("logged in") || t.contains("signed in"))
}

fn installed(bin: &str) -> bool {
    shell(&format!("command -v {bin}")).map(|(ok, _)| ok).unwrap_or(false)
}

/// Some(true/false) when we can tell, None when we can't.
fn signed_in(id: &str) -> (Option<bool>, String) {
    match id {
        "claude" => match shell("claude auth status") {
            Some((_, out)) => {
                // prints JSON with `loggedIn`; read only the first JSON object line(s)
                let json_part = out.find('{').map(|i| &out[i..]).unwrap_or("");
                let end = json_part.rfind('}').map(|i| i + 1).unwrap_or(0);
                match serde_json::from_str::<Value>(&json_part[..end]) {
                    Ok(v) => (Some(v["loggedIn"] == true), v["authMethod"].as_str().unwrap_or("").to_string()),
                    Err(_) => (Some(false), String::new()),
                }
            }
            None => (None, String::new()),
        },
        "codex" => match shell("codex login status") {
            Some((ok, out)) => (Some(ok && says_logged_in(&out)), out.lines().next().unwrap_or("").to_string()),
            None => (None, String::new()),
        },
        "cursor" => match shell("cursor-agent status") {
            Some((_, out)) => (Some(says_logged_in(&out)), String::new()),
            None => (None, String::new()),
        },
        "gemini" => {
            // no status command: signed in with Google leaves this file; an
            // API key in the shell works too. We only check they exist.
            let home = std::env::var("HOME").unwrap_or_default();
            let creds = std::path::Path::new(&home).join(".gemini/oauth_creds.json").exists();
            let key = shell("[ -n \"$GEMINI_API_KEY\" ]").map(|(ok, _)| ok).unwrap_or(false);
            (Some(creds || key), String::new())
        }
        _ => (None, String::new()),
    }
}

fn status_of(id: &str, name: &str, bin: &str) -> Value {
    if !installed(bin) {
        return json!({ "id": id, "name": name, "installed": false, "signedIn": false, "detail": "" });
    }
    let (signed, detail) = signed_in(id);
    json!({ "id": id, "name": name, "installed": true, "signedIn": signed, "detail": detail })
}

/// Status of each AI (or just `ids`), checked in parallel.
#[tauri::command(async)]
pub fn ai_status(ids: Option<Vec<String>>) -> Vec<Value> {
    let want = |id: &str| ids.as_ref().map(|v| v.iter().any(|x| x == id)).unwrap_or(true);
    let handles: Vec<_> = AIS
        .iter()
        .filter(|(id, _, _)| want(id))
        .map(|&(id, name, bin)| std::thread::spawn(move || status_of(id, name, bin)))
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

/// What Sign in runs for each AI. The id picks from this fixed list, so the
/// webview can never ask for an arbitrary command.
pub fn login_cmd(id: &str) -> Option<&'static str> {
    match id {
        "claude" => Some("claude auth login"),
        "codex" => Some("codex login"),
        "cursor" => Some("cursor-agent login"),
        // Gemini signs in inside its own app: open it in Terminal
        "gemini" => Some(r#"osascript -e 'tell application "Terminal" to do script "gemini"' -e 'tell application "Terminal" to activate'"#),
        _ => None,
    }
}

/// Run that AI's normal sign-in (opens the browser). Blocks until it finishes
/// or 10 minutes pass. The app also polls `ai_status` meanwhile, so the row
/// turns green as soon as the login lands.
#[tauri::command(async)]
pub fn ai_login(id: String) -> Result<String, String> {
    let cmd = login_cmd(&id).ok_or_else(|| "Unknown AI".to_string())?;
    crate::doctor::run_fixed(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_only_runs_known_commands() {
        assert_eq!(login_cmd("claude"), Some("claude auth login"));
        assert_eq!(login_cmd("codex"), Some("codex login"));
        assert!(login_cmd("rm -rf /").is_none());
        assert!(login_cmd("").is_none());
    }

    #[test]
    fn reads_login_status_text() {
        assert!(says_logged_in("Logged in using ChatGPT"));
        assert!(says_logged_in("✓ Logged in as a@b.com"));
        assert!(!says_logged_in("Not logged in"));
        assert!(!says_logged_in("You are not signed in. Run login."));
        assert!(!says_logged_in("error: unknown command"));
    }

    #[test]
    fn strips_colors() {
        assert_eq!(strip_ansi("\x1b[32mLogged in\x1b[0m"), "Logged in");
    }

    #[test]
    #[ignore] // runs the real CLIs on this Mac
    fn live_status() {
        for row in ai_status(None) {
            println!("{row}");
        }
    }
}
