// ---------------------------------------------------------------------------
// How close you are to your agents' plan limits, for the Overview bars.
//
//   Claude Code  the same numbers Claude Code's /usage shows: asked from
//                Anthropic with the login Claude Code already saved on this
//                Mac. Only after the user turns it on; the token is read,
//                sent to api.anthropic.com and nowhere else, and never
//                returned, logged or stored by Grill Me. Falls back to the
//                status-line cache when that exists.
//   Codex        what Codex writes in its own session logs (rate_limits).
//
// Each window: percent used, when it resets, and how long the window is (so
// the UI can draw a pace marker).
// ---------------------------------------------------------------------------

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Window {
    pub label: String,
    pub pct: f64,
    /// RFC 3339
    #[serde(rename = "resetsAt")]
    pub resets_at: Option<String>,
    #[serde(rename = "windowMins")]
    pub window_mins: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentUsage {
    pub agent: String,
    pub windows: Vec<Window>,
    /// "live" (asked just now), "cache" (status line / logs), with age
    pub source: String,
    #[serde(rename = "ageSecs")]
    pub age_secs: u64,
}

const FIVE_H: u64 = 300;
const WEEK: u64 = 7 * 24 * 60;

/// Anthropic's usage document → windows. Shape: { five_hour: { utilization,
/// resets_at }, seven_day: {...}, seven_day_opus: {...} }.
pub fn claude_windows(v: &Value) -> Vec<Window> {
    let mut out = vec![];
    for (key, label, mins) in [("five_hour", "5-hour", FIVE_H), ("seven_day", "Week", WEEK), ("seven_day_opus", "Week · Opus", WEEK)] {
        if let Some(pct) = v[key]["utilization"].as_f64() {
            out.push(Window { label: label.into(), pct, resets_at: v[key]["resets_at"].as_str().map(str::to_string), window_mins: mins });
        }
    }
    out
}

/// Codex's `rate_limits` object → windows.
pub fn codex_windows(v: &Value) -> Vec<Window> {
    let mut out = vec![];
    for key in ["primary", "secondary"] {
        let w = &v[key];
        let Some(pct) = w["used_percent"].as_f64() else { continue };
        let mins = w["window_minutes"].as_u64().unwrap_or(0);
        let label = match mins {
            0 => "Limit".to_string(),
            m if m <= 600 => format!("{}-hour", (m + 59) / 60),
            m if m <= WEEK + 60 => "Week".to_string(),
            _ => "Month".to_string(),
        };
        let resets_at = w["resets_at"].as_i64().and_then(|t| chrono_lite(t));
        out.push(Window { label, pct, resets_at, window_mins: mins });
    }
    out
}

/// unix seconds → RFC 3339 UTC, without a date crate.
fn chrono_lite(t: i64) -> Option<String> {
    if t <= 0 {
        return None;
    }
    let days = t.div_euclid(86_400);
    let secs = t.rem_euclid(86_400);
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    Some(format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", secs / 3600, secs % 3600 / 60, secs % 60))
}

// -- Claude ------------------------------------------------------------------

/// The OAuth access token Claude Code saved: macOS keychain, else the
/// credentials file other platforms use.
fn claude_token() -> Option<String> {
    let raw = if cfg!(target_os = "macos") {
        let out = std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
            .output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    };
    let raw = raw.or_else(|| {
        let home = std::env::var("HOME").ok()?;
        std::fs::read_to_string(Path::new(&home).join(".claude/.credentials.json")).ok()
    })?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    v["claudeAiOauth"]["accessToken"].as_str().map(str::to_string).filter(|t| !t.is_empty())
}

static CLAUDE_CACHE: Mutex<Option<(Instant, AgentUsage)>> = Mutex::new(None);

fn claude_live() -> Result<AgentUsage, String> {
    if let Some((at, u)) = CLAUDE_CACHE.lock().map_err(|e| e.to_string())?.clone() {
        if at.elapsed() < Duration::from_secs(60) {
            return Ok(AgentUsage { age_secs: at.elapsed().as_secs(), ..u });
        }
    }
    let token = claude_token().ok_or("Claude Code isn't signed in on this Mac")?;
    let resp = ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).build()
        .get("https://api.anthropic.com/api/oauth/usage")
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", "oauth-2025-04-20")
        .call();
    let v: Value = match resp {
        Ok(r) => serde_json::from_str(&r.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
        Err(ureq::Error::Status(401, _)) => return Err("Claude Code's sign-in expired. Open Claude Code once to refresh it.".into()),
        Err(ureq::Error::Status(c, _)) => return Err(format!("Anthropic answered {c}")),
        Err(e) => return Err(format!("Couldn't reach Anthropic: {}", e.kind())),
    };
    let windows = claude_windows(&v);
    if windows.is_empty() {
        return Err("No usage numbers in Anthropic's answer".into());
    }
    let u = AgentUsage { agent: "claude".into(), windows, source: "live".into(), age_secs: 0 };
    *CLAUDE_CACHE.lock().map_err(|e| e.to_string())? = Some((Instant::now(), u.clone()));
    Ok(u)
}

fn claude_cached() -> Option<AgentUsage> {
    let v = crate::automations::plan_usage()?;
    let age = v["ageSecs"].as_u64().unwrap_or(0);
    let mut windows = vec![];
    for (key, label, mins) in [("session", "5-hour", FIVE_H), ("week", "Week", WEEK)] {
        if let Some(pct) = v[key]["pct"].as_f64() {
            windows.push(Window { label: label.into(), pct, resets_at: v[key]["resetsAt"].as_str().map(str::to_string), window_mins: mins });
        }
    }
    (!windows.is_empty()).then(|| AgentUsage { agent: "claude".into(), windows, source: "cache".into(), age_secs: age })
}

// -- Codex -------------------------------------------------------------------

/// The newest Codex session log (~/.codex/sessions/YYYY/MM/DD/*.jsonl).
fn newest_codex_log() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let mut dir = Path::new(&home).join(".codex/sessions");
    // walk down the newest year / month / day
    for _ in 0..3 {
        let next = std::fs::read_dir(&dir).ok()?.flatten().filter(|e| e.path().is_dir()).map(|e| e.path()).max()?;
        dir = next;
    }
    std::fs::read_dir(&dir).ok()?.flatten().map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
}

/// The last `rate_limits` object in a Codex log's text.
pub fn last_rate_limits(text: &str) -> Option<Value> {
    text.lines().rev().filter(|l| l.contains("\"rate_limits\"")).find_map(|l| {
        let v: Value = serde_json::from_str(l).ok()?;
        find_key(&v, "rate_limits").filter(|r| r.is_object()).cloned()
    })
}

fn find_key<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    match v {
        Value::Object(m) => m.get(key).or_else(|| m.values().find_map(|x| find_key(x, key))),
        Value::Array(a) => a.iter().find_map(|x| find_key(x, key)),
        _ => None,
    }
}

fn codex_usage() -> Option<AgentUsage> {
    use std::io::{Read as _, Seek as _};
    let path = newest_codex_log()?;
    let mut f = std::fs::File::open(&path).ok()?;
    let len = f.metadata().ok()?.len();
    let _ = f.seek(std::io::SeekFrom::Start(len.saturating_sub(400_000)));
    let mut raw = Vec::new();
    f.take(400_000).read_to_end(&mut raw).ok()?;
    let rl = last_rate_limits(&String::from_utf8_lossy(&raw))?;
    let windows = codex_windows(&rl);
    let age = path.metadata().ok()?.modified().ok()?.elapsed().ok()?.as_secs();
    (!windows.is_empty()).then(|| AgentUsage { agent: "codex".into(), windows, source: "cache".into(), age_secs: age })
}

/// Every agent we can read limits for. `claude_live` only when the user
/// turned it on; otherwise (or if that fails) the status-line cache.
#[tauri::command(async)]
pub fn agent_usage(claude_live_ok: bool) -> (Vec<AgentUsage>, Option<String>) {
    let mut out = vec![];
    let mut note = None;
    let claude = if claude_live_ok {
        match claude_live() {
            Ok(u) => Some(u),
            Err(e) => { note = Some(e); claude_cached() }
        }
    } else {
        claude_cached()
    };
    out.extend(claude);
    out.extend(codex_usage());
    (out, note)
}

// -- recent conversation -------------------------------------------------------

/// The last part of a folder's newest Claude Code transcript: enough for the
/// latest few turns, cheap enough to do for every session on the Overview.
#[tauri::command(async)]
pub fn transcript_recent(repo_path: String) -> Vec<String> {
    use std::io::{Read as _, Seek as _};
    let Some(path) = crate::newest_transcript_exact(&repo_path) else { return vec![] };
    let Ok(mut f) = std::fs::File::open(path) else { return vec![] };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(300_000);
    let _ = f.seek(std::io::SeekFrom::Start(start));
    let mut raw = Vec::new();
    let _ = f.take(300_000).read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw);
    let mut lines: Vec<String> = text.lines().filter(|l| !l.trim().is_empty()).map(str::to_owned).collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0); // landed mid-line
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_claude_windows() {
        let v = json!({ "five_hour": { "utilization": 38.0, "resets_at": "2026-10-03T22:00:00Z" }, "seven_day": { "utilization": 12.5, "resets_at": null }, "seven_day_opus": null });
        let w = claude_windows(&v);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0], Window { label: "5-hour".into(), pct: 38.0, resets_at: Some("2026-10-03T22:00:00Z".into()), window_mins: 300 });
        assert_eq!(w[1].resets_at, None);
    }

    #[test]
    fn reads_codex_rate_limits_from_a_log() {
        let log = [
            r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":10.0,"window_minutes":300,"resets_at":1792350925}}}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"hi"}}"#,
            r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","primary":{"used_percent":24.0,"window_minutes":43200,"resets_at":1792350925},"secondary":null}}}"#,
        ].join("\n");
        let rl = last_rate_limits(&log).unwrap();
        let w = codex_windows(&rl);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].pct, 24.0);
        assert_eq!(w[0].label, "Month");
        assert_eq!(w[0].resets_at.as_deref(), Some("2026-10-18T19:15:25Z"));
        assert_eq!(codex_windows(&json!({"primary":{"used_percent":5.0,"window_minutes":300}}))[0].label, "5-hour");
    }

    #[test]
    fn formats_unix_time() {
        assert_eq!(chrono_lite(0), None);
        assert_eq!(chrono_lite(1_700_000_000).as_deref(), Some("2023-11-14T22:13:20Z"));
    }
}
