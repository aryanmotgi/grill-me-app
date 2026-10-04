// ---------------------------------------------------------------------------
// "What Grill Me did for you": a local log of things that actually happened
// (~/.grillme/impact.jsonl), counted for the last 7 days. Every line is written
// at the moment it happens, by the code that did it:
//   blocked       the safety hook stopped a risky command (grillme-hook)
//   undo          a save point was restored (savepoint.rs)
//   tests-failed  a test run after a change failed, so you heard about it
//   merge         a session's work was merged in
//   compact       a heavy session was compacted
// No estimates: counts only.
// ---------------------------------------------------------------------------

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const KINDS: [&str; 5] = ["blocked", "undo", "tests-failed", "merge", "compact"];

fn path() -> std::path::PathBuf {
    crate::grillme_root().join("impact.jsonl")
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Append one event (unknown kinds are ignored).
pub fn log(kind: &str, detail: &str) {
    use std::io::Write as _;
    if !KINDS.contains(&kind) {
        return;
    }
    let line = json!({ "ts": now(), "kind": kind, "detail": detail.chars().take(120).collect::<String>() });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path()) {
        let _ = writeln!(f, "{line}");
    }
}

/// From the app: the events the frontend sees happen.
#[tauri::command]
pub fn impact_log(kind: String, detail: String) {
    if ["tests-failed", "merge", "compact"].contains(&kind.as_str()) {
        log(&kind, &detail);
    }
}

#[derive(Serialize, Debug, PartialEq, Default)]
pub struct Week {
    pub counts: BTreeMap<String, u32>,
    /// the oldest event counted (unix seconds), so the card can say "since"
    pub since: Option<i64>,
}

/// Count each kind over the window ending at `now`.
pub fn count(raw: &str, now: i64, window_secs: i64) -> Week {
    let mut w = Week::default();
    for l in raw.lines() {
        let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
        let (Some(ts), Some(kind)) = (v["ts"].as_i64(), v["kind"].as_str()) else { continue };
        if now - ts > window_secs || !KINDS.contains(&kind) {
            continue;
        }
        *w.counts.entry(kind.to_string()).or_default() += 1;
        w.since = Some(w.since.map_or(ts, |s| s.min(ts)));
    }
    w
}

#[tauri::command]
pub fn impact_week() -> Week {
    count(&std::fs::read_to_string(path()).unwrap_or_default(), now(), 7 * 86_400)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_the_last_seven_days_only() {
        let now = 1_000_000;
        let raw = [
            r#"{"ts":999000,"kind":"blocked","detail":"rm -rf /"}"#,
            r#"{"ts":999500,"kind":"undo"}"#,
            r#"{"ts":999600,"kind":"undo"}"#,
            r#"{"ts":100,"kind":"undo"}"#,
            r#"{"ts":999700,"kind":"made-up"}"#,
            "not json",
        ].join("\n");
        let w = count(&raw, now, 7 * 86_400);
        assert_eq!(w.counts.get("undo"), Some(&2));
        assert_eq!(w.counts.get("blocked"), Some(&1));
        assert_eq!(w.counts.get("made-up"), None);
        assert_eq!(w.since, Some(999000));
        assert_eq!(count("", now, 10), Week::default());
    }
}
