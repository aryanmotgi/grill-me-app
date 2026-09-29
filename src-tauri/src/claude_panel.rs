// ---------------------------------------------------------------------------
// The Claude side panel, two tabs:
//
// * Grill Me Chat — a brainstorm partner that runs `claude -p` on the user's
//   own plan with ONLY the grill-me MCP tools (no Bash/Edit: it plans and
//   reviews, the coder sessions build). Each chat is a Claude Code session id
//   resumed per message; its transcript is read back for rendering. User
//   settings are skipped (--setting-sources "") so personal hooks don't leak
//   into it.
// * claude.ai — the real site in a child webview of the main window (the site
//   refuses iframes). Remote content gets no IPC capabilities.
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const MAX_PROMPT: usize = 100_000;

static CHATS: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();

fn chats() -> &'static Mutex<HashMap<String, Child>> {
    CHATS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Chat ids are UUIDs we generate; reject anything else before it reaches argv
/// or a file path.
fn valid_uuid(id: &str) -> bool {
    id.len() == 36
        && id.chars().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() }
        })
}

fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() <= 64 && m.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

fn role_prompt(project: &str) -> String {
    format!(
        "You are the brainstorm partner inside Grill Me, working on the Grill Me project \"{project}\". \
         Claude Code sessions are the coders; you plan, review, and teach. Use the grill-me tools: whats_new to \
         catch up, read_session / get_diff to understand work (explain code in plain, short words), save_plan when \
         a plan is agreed, send_to_coder to hand off. Grill the user before any handoff: make them explain the plan \
         back and push back on vague answers. You cannot edit files or run commands yourself. Keep replies short."
    )
}

/// Send one message in a brainstorm chat. `resume` = the chat already exists.
/// Output is read back from the transcript; events only signal progress/done.
#[tauri::command]
pub(crate) fn brainstorm_send(
    app: AppHandle,
    chat_id: String,
    message: String,
    resume: bool,
    model: Option<String>,
    project: Option<String>,
) -> Result<(), String> {
    if !valid_uuid(&chat_id) {
        return Err("bad chat id".into());
    }
    let message = message.trim();
    if message.is_empty() || message.len() > MAX_PROMPT {
        return Err("message is empty or too long".into());
    }
    if lock(chats()).contains_key(&chat_id) {
        return Err("Still answering — wait for it or press stop.".into());
    }
    crate::preflight_claude()?;
    // shared brain: prepend what changed since this chat's last message (the
    // whole picture on a chat's first message)
    let sync = crate::bridge::run_script(&["--catchup-chat", &chat_id]).unwrap_or_default();
    let message = if sync.trim().is_empty() {
        message.to_string()
    } else {
        format!("<grill-me-sync>\nWhat's new in the project since my last message (from Grill Me):\n\n{}\n</grill-me-sync>\n\n{message}", sync.trim())
    };
    let node = crate::bridge::node_path().ok_or("Node.js not found (brew install node)")?;
    let script = crate::grillme_root().join("bin/grillme-mcp.mjs");
    let mcp = serde_json::json!({
        "mcpServers": { "grill-me": { "command": node, "args": [script.to_string_lossy()] } }
    })
    .to_string();

    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
        "--mcp-config".into(), mcp,
        "--strict-mcp-config".into(),
        "--tools".into(), "".into(),
        "--allowedTools".into(), "mcp__grill-me".into(),
        "--setting-sources".into(), "".into(),
        "--append-system-prompt".into(), role_prompt(project.as_deref().unwrap_or("default")),
    ];
    if resume {
        args.extend(["--resume".into(), chat_id.clone()]);
    } else {
        args.extend(["--session-id".into(), chat_id.clone()]);
    }
    if let Some(m) = model.filter(|m| valid_model(m)) {
        args.extend(["--model".into(), m]);
    }

    // login shell for the user's PATH (claude is a node script); args pass via
    // "$@" so nothing is shell-interpreted. The prompt goes in on stdin.
    let mut child = Command::new("/bin/zsh")
        .arg("-lc")
        .arg("exec claude \"$@\"")
        .arg("zsh")
        .args(&args)
        .current_dir(crate::grillme_root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't start claude: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(message.as_bytes());
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    lock(chats()).insert(chat_id.clone(), child);

    std::thread::spawn(move || {
        let mut result: Option<serde_json::Value> = None;
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                match v["type"].as_str() {
                    Some("assistant") | Some("user") => {
                        let _ = app.emit("brainstorm-progress", &chat_id);
                    }
                    Some("result") => result = Some(v),
                    _ => {}
                }
            }
        }
        let mut err = String::new();
        if let Some(mut e) = stderr {
            use std::io::Read as _;
            let _ = e.read_to_string(&mut err);
        }
        let status = lock(chats()).remove(&chat_id).and_then(|mut c| c.wait().ok());
        let payload = match result {
            Some(r) => serde_json::json!({
                "chatId": chat_id,
                "isError": r["is_error"].as_bool().unwrap_or(false),
                "text": r["result"].as_str().unwrap_or(""),
            }),
            None => serde_json::json!({
                "chatId": chat_id,
                "isError": true,
                "text": if status.is_some_and(|s| !s.success()) && err.trim().is_empty() { "Stopped.".to_string() } else { err.trim().chars().take(500).collect() },
            }),
        };
        let _ = app.emit("brainstorm-done", payload);
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn brainstorm_stop(chat_id: String) {
    if let Some(c) = lock(chats()).get_mut(&chat_id) {
        let _ = c.kill();
    }
}

/// Transcript lines of a brainstorm chat (last ~3MB), for rendering.
#[tauri::command]
pub(crate) fn brainstorm_history(chat_id: String) -> Result<Vec<String>, String> {
    if !valid_uuid(&chat_id) {
        return Err("bad chat id".into());
    }
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let slug = crate::grillme_root().to_string_lossy().replace(['/', '.'], "-");
    let path = PathBuf::from(home).join(".claude/projects").join(slug).join(format!("{chat_id}.jsonl"));
    let Ok(bytes) = std::fs::read(&path) else { return Ok(vec![]) };
    let start = bytes.len().saturating_sub(3_000_000);
    let text = String::from_utf8_lossy(&bytes[start..]);
    let mut lines: Vec<String> = text.lines().filter(|l| !l.trim().is_empty()).map(str::to_owned).collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0); // partial first line
    }
    Ok(lines)
}

// ---- claude.ai child webview -------------------------------------------------

const CLAUDEAI: &str = "claudeai";

/// Show (creating on first use) the claude.ai view at the given rect, in
/// logical px relative to the main window's content.
#[tauri::command]
pub(crate) async fn claudeai_show(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let (w, h) = (w.max(1.0), h.max(1.0));
    if let Some(wv) = app.get_webview(CLAUDEAI) {
        wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
        wv.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let window = app.get_window("main").ok_or("main window not found")?;
    let url = "https://claude.ai/".parse().map_err(|e| format!("{e}"))?;
    window
        .add_child(WebviewBuilder::new(CLAUDEAI, WebviewUrl::External(url)), LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn claudeai_hide(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(CLAUDEAI) {
        wv.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_validation() {
        assert!(valid_uuid("fcb94d04-bd5b-40c4-a78d-1b09141dab02"));
        assert!(!valid_uuid("../../etc/passwd"));
        assert!(!valid_uuid("fcb94d04-bd5b-40c4-a78d-1b09141dab0z"));
        assert!(!valid_uuid("--resume"));
    }

    #[test]
    fn model_validation() {
        assert!(valid_model("sonnet"));
        assert!(valid_model("claude-opus-5-5"));
        assert!(!valid_model("sonnet; rm -rf"));
        assert!(!valid_model(""));
    }
}
