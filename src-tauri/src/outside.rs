// ---------------------------------------------------------------------------
// Reading Claude Code's own session logs (~/.claude/projects/*/*.jsonl), for
// the pill:
//
//   outside_sessions   Claude Code sessions started outside Grill Me (your
//                      own terminal, an editor), active in the last half
//                      hour: folder, last ask, and whether it's working,
//                      waiting on you, or done. Read-only.
//   spend_since        every Claude Code session's token use since a time
//                      (start of today), by model, so the app can price it
//
// Only the tail of recently changed logs is read. Nothing is written.
// ---------------------------------------------------------------------------

use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const RECENT: Duration = Duration::from_secs(30 * 60);
const TAIL: u64 = 256 * 1024;

#[derive(Serialize, Debug, PartialEq)]
pub struct Outside {
    pub id: String,
    pub cwd: String,
    /// the last thing you asked, one line
    pub ask: String,
    /// "working" | "needs" | "done"
    pub status: String,
    /// unix ms of the last entry
    pub at: u64,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

fn projects_dir() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".claude/projects"))
}

fn ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// RFC 3339 "2026-10-03T21:11:45.667Z" → unix ms (UTC only, as Claude writes).
pub fn parse_ts(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[10] != b'T' { return None }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    let frac = s.get(19..).and_then(|r| r.strip_prefix('.')).map(|r| r.trim_end_matches('Z')).unwrap_or("");
    let milli = format!("{:0<3}", frac.chars().take(3).collect::<String>()).parse::<i64>().unwrap_or(0);
    // days from civil (Howard Hinnant)
    let (yy, mm) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * mm + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let t = ((days * 24 + h) * 60 + mi) * 60 + se;
    u64::try_from(t * 1000 + milli).ok()
}

/// The last `TAIL` bytes of a file, from the first full line.
fn tail(path: &Path) -> String {
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(TAIL);
    if f.seek(SeekFrom::Start(start)).is_err() { return String::new() }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let s = String::from_utf8_lossy(&buf).to_string();
    if start > 0 { s.split_once('\n').map(|(_, r)| r.to_string()).unwrap_or_default() } else { s }
}

fn user_text(v: &Value) -> Option<String> {
    let c = &v["message"]["content"];
    let t = match c {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter(|x| x["type"] == "text").filter_map(|x| x["text"].as_str()).collect::<Vec<_>>().join(" "),
        _ => return None,
    };
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    // tool results and Claude Code's own wrappers aren't asks
    (!t.is_empty() && !t.starts_with('<') && !t.starts_with("Caveat:")).then(|| t.chars().take(80).collect())
}

/// One session's state from its log tail. `modified` is the file's mtime.
pub fn read_session(raw: &str, modified: u64, now: u64) -> Option<(String, String, String, u64)> {
    let mut cwd = String::new();
    let mut ask = String::new();
    let mut last: Option<(String, bool, u64)> = None; // kind, ends with tool use, at
    for line in raw.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let kind = v["type"].as_str().unwrap_or("");
        if kind != "user" && kind != "assistant" { continue }
        if let Some(c) = v["cwd"].as_str() { cwd = c.to_string(); }
        let at = v["timestamp"].as_str().and_then(parse_ts).unwrap_or(modified);
        if kind == "user" {
            if let Some(t) = user_text(&v) { ask = t; }
        }
        let tool = kind == "assistant" && v["message"]["content"].as_array().is_some_and(|a| a.iter().any(|x| x["type"] == "tool_use"));
        last = Some((kind.to_string(), tool, at));
    }
    let (kind, tool, at) = last?;
    if cwd.is_empty() { return None }
    let quiet = now.saturating_sub(modified);
    let status = if quiet < 20_000 {
        "working"
    } else if kind == "assistant" && tool {
        // asked to run a tool and nothing came back: waiting on a permission
        "needs"
    } else if kind == "user" && quiet < 120_000 {
        "working"
    } else {
        "done"
    };
    Some((cwd, ask, status.to_string(), at))
}

/// Grill Me's own background runs live in folders like these: never "yours".
fn ours(cwd: &str) -> bool {
    cwd.contains("/.archify/") || cwd.contains("grillme-explain") || cwd.contains("/.grillme")
}

fn recent_logs(within: Duration) -> Vec<(PathBuf, u64)> {
    let Some(dir) = projects_dir() else { return vec![] };
    let now = SystemTime::now();
    let mut out = vec![];
    for d in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        for f in std::fs::read_dir(d.path()).into_iter().flatten().flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") { continue }
            let Ok(m) = f.metadata().and_then(|m| m.modified()) else { continue };
            if now.duration_since(m).unwrap_or_default() <= within {
                out.push((p, ms(m)));
            }
        }
    }
    out
}

/// Sessions active in the last half hour whose folder isn't one of Grill
/// Me's (`known`: the project and worktree folders it runs sessions in).
#[tauri::command(async)]
pub fn outside_sessions(known: Vec<String>) -> Vec<Outside> {
    let known: HashSet<String> = known.into_iter().map(|k| k.trim_end_matches('/').to_string()).collect();
    let now = ms(SystemTime::now());
    let mut out: Vec<Outside> = recent_logs(RECENT).into_iter().filter_map(|(p, modified)| {
        let (cwd, ask, status, at) = read_session(&tail(&p), modified, now)?;
        if known.contains(cwd.trim_end_matches('/')) || ours(&cwd) { return None }
        let id = p.file_stem()?.to_string_lossy().to_string();
        Some(Outside { id, cwd, ask, status, at })
    }).collect();
    out.sort_by(|a, b| b.at.cmp(&a.at));
    out.truncate(8);
    out
}

/// Add up token use per model since `since` (unix ms). Claude Code writes an
/// assistant message once per content block with the same id and usage, so
/// each message id counts once.
pub fn add_spend(raw: &str, since: u64, seen: &mut HashSet<String>, by_model: &mut BTreeMap<String, Tokens>) {
    for line in raw.lines() {
        if !line.contains("\"usage\"") { continue }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"] != "assistant" { continue }
        let at = v["timestamp"].as_str().and_then(parse_ts).unwrap_or(0);
        if at < since { continue }
        let m = &v["message"];
        let id = m["id"].as_str().unwrap_or("").to_string();
        if id.is_empty() || !seen.insert(id) { continue }
        let u = &m["usage"];
        let t = by_model.entry(m["model"].as_str().unwrap_or("unknown").to_string()).or_default();
        t.input += u["input_tokens"].as_u64().unwrap_or(0);
        t.output += u["output_tokens"].as_u64().unwrap_or(0);
        t.cache_read += u["cache_read_input_tokens"].as_u64().unwrap_or(0);
        t.cache_write += u["cache_creation_input_tokens"].as_u64().unwrap_or(0);
    }
}

#[tauri::command(async)]
pub fn spend_since(since: u64) -> BTreeMap<String, Tokens> {
    let now = ms(SystemTime::now());
    let window = Duration::from_millis(now.saturating_sub(since).min(2 * 86_400_000) + 60_000);
    let mut seen = HashSet::new();
    let mut by_model = BTreeMap::new();
    for (p, _) in recent_logs(window) {
        // whole file: today's lines can sit anywhere in a long session
        let raw = std::fs::read_to_string(&p).unwrap_or_default();
        add_spend(&raw, since, &mut seen, &mut by_model);
    }
    by_model
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(kind: &str, ts: &str, content: &str) -> String {
        format!(r#"{{"type":"{kind}","cwd":"/code/app","timestamp":"{ts}","message":{{"content":{content}}}}}"#)
    }

    #[test]
    fn parses_claude_timestamps() {
        assert_eq!(parse_ts("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(parse_ts("2026-10-03T21:11:45.667Z"), Some(1_791_061_905_667));
        assert_eq!(parse_ts("nope"), None);
    }

    #[test]
    fn reads_a_sessions_state() {
        let t0 = parse_ts("2026-10-03T21:00:00.000Z").unwrap();
        let ask = line("user", "2026-10-03T21:00:00.000Z", r#""add a market""#);
        let tool = line("assistant", "2026-10-03T21:00:05.000Z", r#"[{"type":"tool_use","name":"Bash"}]"#);
        let done = line("assistant", "2026-10-03T21:00:09.000Z", r#"[{"type":"text","text":"Done."}]"#);
        // still writing
        let s = read_session(&[ask.clone(), tool.clone()].join("\n"), t0 + 5_000, t0 + 10_000).unwrap();
        assert_eq!((s.0.as_str(), s.1.as_str(), s.2.as_str()), ("/code/app", "add a market", "working"));
        // a tool call with nothing after it for a while: waiting on you
        assert_eq!(read_session(&[ask.clone(), tool.clone()].join("\n"), t0 + 5_000, t0 + 60_000).unwrap().2, "needs");
        // answered
        assert_eq!(read_session(&[ask, tool, done].join("\n"), t0 + 9_000, t0 + 60_000).unwrap().2, "done");
        assert!(read_session("", 0, 0).is_none());
        assert!(ours("/code/app/.archify/grillme-map") && !ours("/code/app"));
    }

    #[test]
    fn counts_each_message_once_and_only_since() {
        let a = r#"{"type":"assistant","timestamp":"2026-10-03T21:00:00.000Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":2,"output_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":5}}}"#;
        let old = r#"{"type":"assistant","timestamp":"2026-10-02T21:00:00.000Z","message":{"id":"m0","model":"claude-opus-5-5","usage":{"input_tokens":999,"output_tokens":999}}}"#;
        let raw = [old, a, a].join("\n");
        let mut seen = HashSet::new();
        let mut by = BTreeMap::new();
        add_spend(&raw, parse_ts("2026-10-03T00:00:00.000Z").unwrap(), &mut seen, &mut by);
        assert_eq!(by["claude-opus-5-5"], Tokens { input: 2, output: 10, cache_read: 100, cache_write: 5 });
    }

    /// Live, read-only: cargo test outside_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn outside_live() {
        let day = std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 - 12 * 3_600_000;
        println!("spend: {:?}", spend_since(day));
        for o in outside_sessions(vec![]) { println!("{} · {} · {}", o.status, o.cwd, o.ask); }
    }
}
