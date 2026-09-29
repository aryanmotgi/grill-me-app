// ---------------------------------------------------------------------------
// Tailscale integration.
//
// * Team mode anywhere: teammates on the same tailnet reach the room host
//   (0.0.0.0:4518) at its MagicDNS name — a private, invite-only network,
//   so rooms work across Wi-Fis without exposing anything publicly.
// * claude.ai connection: Tailscale Funnel publishes ONE local port (the
//   remote grill-me MCP) at the machine's https://<name>.ts.net address.
//
// Uses the CLI inside the Tailscale app when present (the Homebrew CLI can
// lag the running daemon's version).
// ---------------------------------------------------------------------------

use serde_json::{json, Value};
use std::process::Command;

const APP_CLI: &str = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

pub(crate) fn cli() -> Option<String> {
    if std::path::Path::new(APP_CLI).exists() {
        return Some(APP_CLI.into());
    }
    for c in ["/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"] {
        if std::path::Path::new(c).exists() {
            return Some(c.into());
        }
    }
    None
}

pub(crate) fn run(args: &[&str]) -> Result<String, String> {
    let bin = cli().ok_or("Tailscale isn't installed")?;
    let out = Command::new(bin).args(args).output().map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if out.status.success() {
        Ok(text)
    } else {
        Err(text.trim().chars().take(400).collect())
    }
}

fn trim_dot(s: &str) -> String {
    s.trim_end_matches('.').to_string()
}

/// Installed? Running? This machine's name + tailnet peers (for "join a
/// teammate" picking) and whether Funnel is allowed for this node.
#[tauri::command(async)]
pub(crate) fn tailscale_status() -> Value {
    if cli().is_none() {
        return json!({ "installed": false });
    }
    let raw = run(&["status", "--json"]).unwrap_or_default();
    let v: Value = serde_json::from_str(raw.trim_start_matches(|c| c != '{')).unwrap_or_default();
    let me = &v["Self"];
    let caps: Vec<String> = me["CapMap"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
    let peers: Vec<Value> = v["Peer"]
        .as_object()
        .map(|m| {
            m.values()
                .map(|p| json!({
                    "name": p["HostName"],
                    "dnsName": trim_dot(p["DNSName"].as_str().unwrap_or("")),
                    "ip": p["TailscaleIPs"][0],
                    "online": p["Online"].as_bool().unwrap_or(false),
                    "os": p["OS"],
                }))
                .collect()
        })
        .unwrap_or_default();
    json!({
        "installed": true,
        "running": v["BackendState"] == "Running",
        "state": v["BackendState"],
        "dnsName": trim_dot(me["DNSName"].as_str().unwrap_or("")),
        "ip": me["TailscaleIPs"][0],
        "tailnet": v["CurrentTailnet"]["Name"],
        "funnelAllowed": caps.iter().any(|c| c.contains("funnel")),
        "peers": peers,
    })
}

/// Connect this Mac to the tailnet (same as the menu-bar "Connect").
#[tauri::command(async)]
pub(crate) fn tailscale_up() -> Result<(), String> {
    run(&["up"]).map(|_| ())
}

#[cfg(test)]
mod tests {
    #[test]
    fn trims_magicdns_dot() {
        assert_eq!(super::trim_dot("mac.tail1.ts.net."), "mac.tail1.ts.net");
    }
}
