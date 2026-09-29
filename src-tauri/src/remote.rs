// ---------------------------------------------------------------------------
// claude.ai connection: the grill-me MCP served over HTTPS so the claude.ai
// website (which can't reach local servers) sees your sessions.
//
//   claude.ai ──https──► Tailscale Funnel ──► 127.0.0.1:4519 (node, --http)
//
// Safety: the node server binds loopback only and Funnel is the single way
// in; the URL carries a 64-hex secret (everything else 404s); read-only
// unless the user allows proposals (which still need approval in the app);
// credentials are redacted and secret files never appear in diffs; rate
// limited; every request logged. Off by default, one switch to stop, and a
// new secret instantly invalidates the old URL.
// ---------------------------------------------------------------------------

use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) const REMOTE_PORT: u16 = 4519;

static SERVER: Mutex<Option<(Child, bool)>> = Mutex::new(None);

fn secret_path() -> PathBuf {
    crate::grillme_root().join("remote-secret")
}

/// The URL secret (created on first use, owner-only file).
fn secret(rotate: bool) -> Result<String, String> {
    let path = secret_path();
    if !rotate {
        if let Ok(s) = std::fs::read_to_string(&path) {
            let s = s.trim().to_string();
            if s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Ok(s);
            }
        }
    }
    let s = crate::generate_token();
    use std::io::Write as _;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&path)
        .and_then(|mut f| f.write_all(s.as_bytes()))
        .map_err(|e| e.to_string())?;
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    Ok(s)
}

fn server_running() -> Option<bool> {
    let mut g = crate::lock_or_recover(&SERVER);
    match g.as_mut() {
        Some((c, writes)) => match c.try_wait() {
            Ok(None) => Some(*writes),
            _ => {
                *g = None;
                None
            }
        },
        None => None,
    }
}

fn stop_server() {
    if let Some((mut c, _)) = crate::lock_or_recover(&SERVER).take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

fn start_server(allow_writes: bool) -> Result<(), String> {
    stop_server();
    crate::bridge::install();
    let node = crate::bridge::node_path().ok_or("Node.js not found (brew install node)")?;
    secret(false)?;
    let mut cmd = Command::new(node);
    cmd.arg(crate::grillme_root().join("bin/grillme-mcp.mjs"))
        .args(["--http", &REMOTE_PORT.to_string(), "--secret-file"])
        .arg(secret_path())
        .current_dir(crate::grillme_root())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if allow_writes {
        cmd.arg("--allow-writes");
    }
    let mut child = cmd.spawn().map_err(|e| format!("couldn't start the connection: {e}"))?;
    std::thread::sleep(Duration::from_millis(400));
    if let Ok(Some(status)) = child.try_wait() {
        return Err(format!("connection server exited ({status}) — is port {REMOTE_PORT} in use?"));
    }
    *crate::lock_or_recover(&SERVER) = Some((child, allow_writes));
    Ok(())
}

/// Run a tailscale command with a deadline (Funnel can wait for the user to
/// enable it in the admin console — we return its message instead of hanging).
fn tailscale_timed(args: &[&str], secs: u64) -> Result<(bool, String), String> {
    let bin = crate::tailscale::cli().ok_or("Tailscale isn't installed")?;
    let mut child = Command::new(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let mut out = String::new();
            if let Some(mut o) = child.stdout.take() {
                let _ = o.read_to_string(&mut out);
            }
            if let Some(mut e) = child.stderr.take() {
                let _ = e.read_to_string(&mut out);
            }
            return Ok((status.success(), out));
        }
        if started.elapsed() > Duration::from_secs(secs) {
            let _ = child.kill();
            let mut out = String::new();
            if let Some(mut o) = child.stdout.take() {
                let _ = o.read_to_string(&mut out);
            }
            if let Some(mut e) = child.stderr.take() {
                let _ = e.read_to_string(&mut out);
            }
            return Ok((false, out));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn first_url(text: &str) -> Option<String> {
    text.split_whitespace().find(|w| w.starts_with("https://login.tailscale.com")).map(|w| w.trim_end_matches(['.', ',']).to_string())
}

fn funnel_on() -> bool {
    tailscale_timed(&["funnel", "status"], 8)
        .map(|(_, out)| out.contains(&format!("127.0.0.1:{REMOTE_PORT}")) || out.contains(&format!("localhost:{REMOTE_PORT}")))
        .unwrap_or(false)
}

fn public_host() -> Option<String> {
    let st = crate::tailscale::tailscale_status();
    st["dnsName"].as_str().filter(|s| !s.is_empty()).map(str::to_owned)
}

#[tauri::command(async)]
pub(crate) fn remote_status() -> Value {
    let writes = server_running();
    let funnel = writes.is_some() && funnel_on();
    let url = if funnel {
        match (public_host(), secret(false)) {
            (Some(h), Ok(s)) => Some(format!("https://{h}/mcp/{s}")),
            _ => None,
        }
    } else {
        None
    };
    json!({ "server": writes.is_some(), "allowWrites": writes.unwrap_or(false), "funnel": funnel, "url": url })
}

/// Go online: start the loopback server, then publish it with Funnel.
#[tauri::command(async)]
pub(crate) fn remote_start(allow_writes: bool) -> Result<Value, String> {
    let ts = crate::tailscale::tailscale_status();
    if ts["installed"] != true {
        return Err("Install Tailscale first (tailscale.com/download/mac).".into());
    }
    if ts["running"] != true {
        return Err("Turn Tailscale on first.".into());
    }
    start_server(allow_writes)?;
    let (ok, out) = tailscale_timed(&["funnel", "--bg", &REMOTE_PORT.to_string()], 25)?;
    if !ok || out.to_lowercase().contains("not enabled") {
        stop_server();
        return Ok(json!({ "needsEnable": true, "link": first_url(&out), "message": out.trim().chars().take(400).collect::<String>() }));
    }
    Ok(remote_status())
}

/// Go offline: take the Funnel down and stop the server.
#[tauri::command(async)]
pub(crate) fn remote_stop() -> Result<(), String> {
    let _ = tailscale_timed(&["funnel", "--https=443", "off"], 10);
    stop_server();
    Ok(())
}

/// New secret: the old URL stops working immediately.
#[tauri::command(async)]
pub(crate) fn remote_rotate() -> Result<Value, String> {
    let running = server_running();
    secret(true)?;
    if let Some(writes) = running {
        start_server(writes)?;
    }
    Ok(remote_status())
}

/// Last access-log entries, newest first.
#[tauri::command]
pub(crate) fn remote_log(limit: usize) -> Vec<Value> {
    let text = std::fs::read_to_string(crate::grillme_root().join("remote-access.jsonl")).unwrap_or_default();
    text.lines().rev().take(limit.min(200)).filter_map(|l| serde_json::from_str(l).ok()).collect()
}

/// App exit: never leave the door open with nothing behind it.
pub(crate) fn shutdown() {
    if server_running().is_some() {
        let _ = tailscale_timed(&["funnel", "--https=443", "off"], 5);
    }
    stop_server();
}

#[cfg(test)]
mod tests {
    #[test]
    fn finds_enable_link() {
        let msg = "Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/funnel?node=abc123\n";
        assert_eq!(super::first_url(msg).as_deref(), Some("https://login.tailscale.com/f/funnel?node=abc123"));
        assert!(super::first_url("all good").is_none());
    }
}
