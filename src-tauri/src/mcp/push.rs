// ---------------------------------------------------------------------------
// Push updates over stdio (MCP notifications). The stdio server keeps a tiny
// per-connection state — which resources the client subscribed to, its log
// level, whether it finished initializing — and a watcher thread polls the
// project every 2 s:
//
//   notifications/resources/updated {uri}   a subscribed resource changed
//   notifications/resources/list_changed    sessions were added or removed
//   notifications/message (level "notice")  something new needs the user:
//       a drafted answer, a review that says FIX, a reply to a hand-off,
//       a requested action that finished
//
// Every line on stdout goes through one writer lock (mod.rs `send`), so a
// notification can never interleave with a response.
//
// Remote (HTTP) mode has none of this: it's stateless JSON, no SSE stream to
// push on. Subscribe is accepted there as a no-op (tools.rs).
// ---------------------------------------------------------------------------

use super::data::{eq_str, read_json_or, Ctx};
use super::js::{clip, get, nn, to_str, truthy};
use super::resources::{self, FileCache};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const POLL: Duration = Duration::from_secs(2);
const LEVELS: [&str; 8] = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];

pub fn level_rank(level: &str) -> Option<usize> {
    LEVELS.iter().position(|l| *l == level)
}

/// What this stdio connection asked for.
#[derive(Debug)]
pub struct Session {
    pub initialized: bool,
    pub subs: HashSet<String>,
    /// minimum level for notifications/message (default: info, so notices go out)
    pub min_level: usize,
}

impl Default for Session {
    fn default() -> Self {
        Session { initialized: false, subs: HashSet::new(), min_level: 1 }
    }
}

impl Session {
    /// Book-keeping after a request was answered successfully.
    pub fn note(&mut self, req: &Value, ok: bool) {
        let method = get(req, "method").and_then(Value::as_str).unwrap_or("");
        let p = |k: &str| get(req, "params").and_then(|p| get(p, k)).and_then(Value::as_str).unwrap_or("").to_string();
        match method {
            "notifications/initialized" => self.initialized = true,
            "resources/subscribe" if ok => {
                self.subs.insert(p("uri"));
            }
            "resources/unsubscribe" if ok => {
                self.subs.remove(&p("uri"));
            }
            "logging/setLevel" if ok => {
                if let Some(r) = level_rank(&p("level")) {
                    self.min_level = r;
                }
            }
            _ => {}
        }
    }

    /// The notifications to send for one poll's result.
    pub fn outgoing(&self, changed: &[String], list_changed: bool, notices: &[String]) -> Vec<Value> {
        if !self.initialized {
            return Vec::new();
        }
        let mut out: Vec<Value> = changed
            .iter()
            .filter(|u| self.subs.contains(*u))
            .map(|u| json!({ "jsonrpc": "2.0", "method": "notifications/resources/updated", "params": { "uri": u } }))
            .collect();
        if list_changed {
            out.push(json!({ "jsonrpc": "2.0", "method": "notifications/resources/list_changed" }));
        }
        if level_rank("notice").unwrap_or(2) >= self.min_level {
            for n in notices {
                out.push(json!({ "jsonrpc": "2.0", "method": "notifications/message", "params": { "level": "notice", "logger": "grill-me", "data": n } }));
            }
        }
        out
    }
}

/// Things that need the user, keyed so each is announced once: drafted
/// answers, FIX reviews, hand-off replies, finished actions.
pub fn notices(ctx: &Ctx) -> Vec<(String, String)> {
    let b = ctx.bridge_state();
    let list = |k: &str| get(&b, k).and_then(Value::as_array).cloned().unwrap_or_default();
    let title = |e: &Value| to_str(nn(get(e, "sessionTitle")).filter(|v| truthy(Some(v))).or(get(e, "session")));
    let mut out = Vec::new();
    for q in list("questions") {
        if truthy(get(&q, "draft")) && !truthy(get(&q, "answered")) {
            let from = to_str(nn(get(&q, "fromTitle")).filter(|v| truthy(Some(v))).or(get(&q, "from")));
            out.push((
                format!("draft:{}", to_str(get(&q, "id"))),
                format!("Grill Me drafted an answer to {from}'s question “{}” — send it from Flow.", clip(&to_str(get(&q, "question")), 100)),
            ));
        }
    }
    for h in list("handoffs") {
        if let Some(r) = get(&h, "result").filter(|r| r.is_object()) {
            let done = if truthy(get(r, "done")) { "done" } else { "not done yet" };
            out.push((format!("reply:{}", to_str(get(&h, "id"))), format!("{} replied to your hand-off ({done}): {}", title(&h), clip(&to_str(get(r, "summary")), 160))));
        }
    }
    for a in list("actions") {
        let st = get(&a, "status").and_then(Value::as_str).unwrap_or("");
        if matches!(st, "done" | "failed") {
            let summary = clip(&to_str(get(&a, "outcome").and_then(|o| get(o, "summary"))), 160);
            let verdict = if st == "done" { "done" } else { "failed" };
            out.push((format!("action:{}:{st}", to_str(get(&a, "id"))), format!("Action {verdict} — {}: {summary}", super::actions::describe(&a))));
        }
    }
    let reviews = read_json_or(&ctx.project_dir().dir.join("reviews.json"), json!({}));
    if let Value::Object(all) = &reviews {
        let members = ctx.members();
        for (id, r) in all {
            if eq_str(get(r, "verdict"), Some("fix")) {
                let label = members.iter().find(|m| eq_str(get(m, "id"), Some(id))).map(|m| ctx.label(m)).unwrap_or_else(|| id.clone());
                let why = if truthy(get(r, "reason")) { to_str(get(r, "reason")) } else { to_str(get(r, "summary")) };
                out.push((format!("fix:{id}:{}", to_str(get(r, "ts"))), format!("Review says FIX for {label}: {}", clip(&why, 160))));
            }
        }
    }
    out
}

/// The poller's memory between ticks.
#[derive(Default)]
pub struct Watcher {
    cache: FileCache,
    prev: Option<HashMap<String, u64>>,
    seen: HashSet<String>,
}

impl Watcher {
    /// One poll → (changed URIs, sessions added/removed, new notices). The
    /// first poll only takes a baseline.
    pub fn tick(&mut self, ctx: &Ctx) -> (Vec<String>, bool, Vec<String>) {
        let next = resources::fingerprints(ctx, &mut self.cache);
        let fresh: Vec<(String, String)> = notices(ctx);
        let Some(prev) = self.prev.replace(next.clone()) else {
            self.seen = fresh.into_iter().map(|(k, _)| k).collect();
            return (Vec::new(), false, Vec::new());
        };
        let (changed, listed) = resources::diff(&prev, &next);
        let mut new_notices = Vec::new();
        for (k, text) in fresh {
            if self.seen.insert(k) {
                new_notices.push(text);
            }
        }
        (changed, listed, new_notices)
    }
}

/// The stdio watcher thread: poll, then hand each notification to `send`
/// (which holds the stdout writer lock).
pub fn spawn_watcher(ctx: Ctx, sess: Arc<Mutex<Session>>, send: fn(&Value)) {
    std::thread::spawn(move || {
        let mut w = Watcher::default();
        loop {
            let (changed, listed, notices) = w.tick(&ctx);
            let msgs = sess.lock().unwrap_or_else(|e| e.into_inner()).outgoing(&changed, listed, &notices);
            for m in msgs {
                send(&m);
            }
            std::thread::sleep(POLL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::super::data::Remote;
    use super::*;

    #[test]
    fn subscriptions_and_levels_are_booked() {
        let mut s = Session::default();
        let sub = |uri: &str| json!({ "jsonrpc": "2.0", "id": 1, "method": "resources/subscribe", "params": { "uri": uri } });
        s.note(&sub("grillme://flow"), true);
        s.note(&sub("grillme://nope"), false); // refused → not booked
        assert_eq!(s.subs.len(), 1);
        // nothing goes out before notifications/initialized
        assert!(s.outgoing(&["grillme://flow".into()], true, &["x".into()]).is_empty());
        s.note(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), true);
        let out = s.outgoing(&["grillme://flow".into(), "grillme://sessions".into()], true, &["drafted".into()]);
        assert_eq!(out.len(), 3, "{out:?}");
        assert_eq!(out[0]["method"], "notifications/resources/updated");
        assert_eq!(out[0]["params"]["uri"], "grillme://flow");
        assert_eq!(out[1]["method"], "notifications/resources/list_changed");
        assert_eq!(out[2]["params"]["level"], "notice");
        // warning+ only: notices are filtered
        s.note(&json!({ "method": "logging/setLevel", "params": { "level": "warning" } }), true);
        assert_eq!(s.outgoing(&[], false, &["x".into()]).len(), 0);
        s.note(&json!({ "method": "resources/unsubscribe", "params": { "uri": "grillme://flow" } }), true);
        assert!(s.outgoing(&["grillme://flow".into()], false, &[]).is_empty());
        assert_eq!(level_rank("notice"), Some(2));
        assert_eq!(level_rank("loud"), None);
    }

    #[test]
    fn watcher_baselines_then_reports_new_items_once() {
        let home = std::env::temp_dir().join(format!("grillme-push-w-{}-{}", std::process::id(), super::super::js::now_ms()));
        let g = home.join(".grillme");
        std::fs::create_dir_all(&g).unwrap();
        let h = home.to_string_lossy().into_owned();
        let ctx = Ctx { root: format!("{h}/.grillme"), home: h, remote: Remote::default(), scope: None, forced: None };
        std::fs::write(g.join("bridge.json"), r#"{"handoffs":[{"id":"h0","session":"s1","result":{"done":true,"summary":"old"}}],"questions":[],"plans":[],"notes":[]}"#).unwrap();
        let mut w = Watcher::default();
        assert_eq!(w.tick(&ctx), (vec![], false, vec![]), "baseline: the old reply isn't news");
        std::fs::write(
            g.join("bridge.json"),
            r#"{"handoffs":[{"id":"h0","session":"s1","result":{"done":true,"summary":"old"}}],"questions":[{"id":"q1","from":"s1","fromTitle":"Auth","question":"Email?","draft":"Google.","answered":false}],"plans":[],"notes":[],
               "actions":[{"id":"a1","kind":"run_tests","session":"s1","sessionTitle":"Auth","status":"done","outcome":{"ok":true,"summary":"Tests passed"}}]}"#,
        )
        .unwrap();
        std::fs::write(g.join("reviews.json"), r#"{"s1":{"verdict":"fix","reason":"tests fail","ts":5}}"#).unwrap();
        let (changed, _, notes) = w.tick(&ctx);
        assert!(changed.contains(&"grillme://flow".to_string()));
        assert_eq!(notes.len(), 3, "{notes:?}");
        assert!(notes.iter().any(|n| n.starts_with("Grill Me drafted an answer to Auth's question")));
        assert!(notes.iter().any(|n| n == "Action done — run tests in Auth: Tests passed"));
        assert!(notes.iter().any(|n| n == "Review says FIX for s1: tests fail"));
        assert_eq!(w.tick(&ctx), (vec![], false, vec![]), "announced once");
        let _ = std::fs::remove_dir_all(home);
    }
}
