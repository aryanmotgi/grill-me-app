// ---------------------------------------------------------------------------
// MCP resources: the same pictures the read tools give, as documents a client
// can attach and subscribe to (MCP 2025-06-18).
//
//   grillme://project/brain    goal, deadline, decisions, open tasks, notes
//   grillme://sessions         every session (what whats_new says)
//   grillme://session/<id>     one session's card + its last turns
//   grillme://flow             everything waiting for the user's OK
//
// Reads are side-effect free (no cursors move). Remote (claude.ai) reads go
// through the same redact() as tool results, and --no-transcripts holds back
// conversations here too (Ctx::turns already returns none).
//
// `fingerprints` is what the stdio watcher (push.rs) polls: per URI, a hash
// over the files that resource is drawn from (mtime-cached content hashes for
// JSON, mtime + size for transcripts).
// ---------------------------------------------------------------------------

use super::data::{eq_str, read_list, Ctx};
use super::js::{self, clip, get, nn, to_str, truthy};
use super::redact::redact;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

pub const BRAIN: &str = "grillme://project/brain";
pub const SESSIONS: &str = "grillme://sessions";
pub const FLOW: &str = "grillme://flow";
pub const SESSION_PREFIX: &str = "grillme://session/";
const MIME: &str = "text/markdown";

/// JSON-RPC code for an unknown resource (MCP spec).
pub const NOT_FOUND: i64 = -32002;

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Res {
    Brain,
    Sessions,
    Flow,
    Session(String),
}

/// A URI → which resource (None = not one of ours). Session ids are the
/// config's member ids: [A-Za-z0-9._-], like validate_member_id in the app.
pub fn parse_uri(uri: &str) -> Option<Res> {
    match uri {
        BRAIN => Some(Res::Brain),
        SESSIONS => Some(Res::Sessions),
        FLOW => Some(Res::Flow),
        _ => {
            let id = uri.strip_prefix(SESSION_PREFIX)?;
            let ok = (1..=80).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
            ok.then(|| Res::Session(id.to_string()))
        }
    }
}

pub fn session_uri(id: &str) -> String {
    format!("{SESSION_PREFIX}{id}")
}

fn member_ids(ctx: &Ctx) -> Vec<String> {
    ctx.members().iter().filter_map(|m| get(m, "id").and_then(Value::as_str).map(str::to_owned)).filter(|id| parse_uri(&session_uri(id)).is_some()).collect()
}

/// resources/list: the three fixed documents, then one per session.
pub fn list(ctx: &Ctx) -> Vec<Value> {
    let mut out = vec![
        json!({ "uri": BRAIN, "name": "project-brain", "title": "Project brain", "description": "Goal, deadline, decisions, open tasks and shared notes of the project open in Grill Me.", "mimeType": MIME }),
        json!({ "uri": SESSIONS, "name": "sessions", "title": "Sessions", "description": "Every coding session: what it's doing, its tests and review, and what's waiting (the whats_new picture).", "mimeType": MIME }),
        json!({ "uri": FLOW, "name": "flow", "title": "Waiting for your OK", "description": "Everything in Grill Me's Flow view: hand-offs, plans, questions, requested actions and unread replies.", "mimeType": MIME }),
    ];
    for m in ctx.members() {
        let Some(id) = get(&m, "id").and_then(Value::as_str) else { continue };
        let uri = session_uri(id);
        if parse_uri(&uri).is_none() {
            continue;
        }
        out.push(json!({ "uri": uri, "name": format!("session-{id}"), "title": format!("Session: {}", ctx.label(&m)), "description": "This session's status card and its last few turns.", "mimeType": MIME }));
    }
    out
}

/// resources/templates/list
pub fn templates() -> Vec<Value> {
    vec![json!({
        "uriTemplate": "grillme://session/{id}",
        "name": "session",
        "title": "One session",
        "description": "A coding session's status card and last turns. `id` is a session id from grillme://sessions or whats_new.",
        "mimeType": MIME,
    })]
}

/// resources/read → `contents`, or (code, message).
pub fn read(ctx: &Ctx, uri: &str) -> Result<Vec<Value>, (i64, String)> {
    let res = parse_uri(uri).ok_or_else(|| (NOT_FOUND, format!("Resource not found: {uri}")))?;
    let text = match res {
        Res::Brain => brain_text(ctx),
        Res::Sessions => super::tools::whats_new(ctx, false),
        Res::Flow => Ok(flow_text(ctx)),
        Res::Session(id) => {
            let Some(m) = ctx.members().into_iter().find(|m| eq_str(get(m, "id"), Some(&id))) else {
                return Err((NOT_FOUND, format!("Resource not found: {uri}")));
            };
            session_text(ctx, &m)
        }
    }
    .map_err(|_| (-32603, "Internal error".to_string()))?;
    let text = if ctx.remote.on { redact(&text) } else { text };
    Ok(vec![json!({ "uri": uri, "mimeType": MIME, "text": text })])
}

fn brain_text(ctx: &Ctx) -> Result<String, String> {
    let proj = ctx.project_dir();
    let b = ctx.bridge_state();
    let mut out = vec![format!("*Project: {}*", proj.id)];
    out.push(if truthy(get(&b, "goal")) { format!("**Goal:** {}", to_str(get(&b, "goal"))) } else { "No goal set yet.".into() });
    let dl = ctx.deadline_line(0.0, true);
    if !dl.is_empty() {
        out.push(dl);
    }
    let decisions = read_list(&proj.dir.join("decisions.json"));
    if !decisions.is_empty() {
        out.push(format!("## Decisions\n{}", js::tail(&decisions, 15).iter().map(|d| format!("- {}", to_str(get(d, "text")))).collect::<Vec<_>>().join("\n")));
    }
    let tasks: Vec<Value> = read_list(&proj.dir.join("tasks.json")).into_iter().filter(|t| !eq_str(get(t, "status"), Some("done"))).collect();
    if !tasks.is_empty() {
        out.push(format!("## Open tasks\n{}", js::head(&tasks, 25).iter().map(|t| format!("- [{}] {}{}", to_str(get(t, "status")), to_str(get(t, "title")), if get(t, "mvp").and_then(|v| v.as_bool()) == Some(true) { " (MVP must-have)" } else { "" })).collect::<Vec<_>>().join("\n")));
    }
    let notes = get(&b, "notes").and_then(Value::as_array).cloned().unwrap_or_default();
    if !notes.is_empty() {
        let lines: Vec<String> = js::tail(&notes, 20)
            .iter()
            .map(|n| {
                let by = if truthy(get(n, "by")) { format!(" ({})", to_str(get(n, "by"))) } else { String::new() };
                format!("- {}{by}", to_str(get(n, "text")))
            })
            .collect();
        out.push(format!("## Notes\n{}", lines.join("\n")));
    }
    Ok(out.join("\n\n"))
}

fn session_text(ctx: &Ctx, m: &Value) -> Result<String, String> {
    let card = super::tools::session_card(ctx, m)?;
    let turns = super::tools::turns_text(ctx, m, 3.0)?;
    Ok(format!("{card}\n\n{turns}"))
}

/// Everything the Flow view would ask the user about, as text.
pub fn flow_text(ctx: &Ctx) -> String {
    let b = ctx.bridge_state();
    let list = |k: &str| get(&b, k).and_then(Value::as_array).cloned().unwrap_or_default();
    let title = |e: &Value| to_str(nn(get(e, "sessionTitle")).filter(|v| truthy(Some(v))).or(get(e, "session")));
    let mut parts: Vec<String> = Vec::new();

    let handoffs: Vec<String> = list("handoffs")
        .iter()
        .filter(|h| eq_str(get(h, "status"), Some("pending")))
        .map(|h| {
            let what = if eq_str(get(h, "kind"), Some("answer")) { "answer" } else { "task" };
            format!("- [{}] {what} for {}: {}", to_str(get(h, "id")), title(h), clip(&js::collapse_ws(&to_str(get(h, "message"))), 300))
        })
        .collect();
    if !handoffs.is_empty() {
        parts.push(format!("## Hand-offs to send\n{}", handoffs.join("\n")));
    }
    let plans: Vec<String> = list("plans")
        .iter()
        .filter(|p| eq_str(get(p, "status"), Some("pending")))
        .map(|p| {
            let n = get(p, "tasks").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
            let decision = if truthy(get(p, "decision")) { format!(" — {}", clip(&to_str(get(p, "decision")), 200)) } else { String::new() };
            format!("- [{}] \"{}\" · {n} task{}{decision}", to_str(get(p, "id")), to_str(get(p, "title")), if n == 1 { "" } else { "s" })
        })
        .collect();
    if !plans.is_empty() {
        parts.push(format!("## Plans to approve\n{}", plans.join("\n")));
    }
    let open_q: Vec<Value> = list("questions").into_iter().filter(|q| !truthy(get(q, "answered")) && !truthy(get(q, "dismissed"))).collect();
    let mut questions: Vec<String> = open_q
        .iter()
        .map(|q| {
            let draft = if truthy(get(q, "draft")) { format!("\n  drafted answer: {}", clip(&to_str(get(q, "draft")), 400)) } else { String::new() };
            format!("- [{}] from {}: {}{draft}", to_str(get(q, "id")), to_str(nn(get(q, "fromTitle")).filter(|v| truthy(Some(v))).or(get(q, "from"))), to_str(get(q, "question")))
        })
        .collect();
    let mine: Vec<Value> = open_q.iter().map(|q| get(q, "id").cloned().unwrap_or(Value::Null)).collect();
    let team_local = get(&b, "teamLocal").cloned().unwrap_or(Value::Null);
    for t in ctx.team_questions(&mine) {
        let id = to_str(get(&t, "id"));
        if truthy(get(&team_local, &id).and_then(|l| get(l, "dismissed"))) {
            continue;
        }
        questions.push(format!("- [{id}] from {}'s \"{}\" (teammate): {}", to_str(get(&t, "fromName")), title(&t), to_str(get(&t, "message"))));
    }
    if !questions.is_empty() {
        parts.push(format!("## Questions for the brainstorm side\n{}", questions.join("\n")));
    }
    let actions: Vec<String> = list("actions")
        .iter()
        .filter(|a| matches!(get(a, "status").and_then(Value::as_str), Some("pending" | "running")))
        .map(|a| {
            let reason = if truthy(get(a, "reason")) { format!(" — {}", clip(&to_str(get(a, "reason")), 200)) } else { String::new() };
            let running = if eq_str(get(a, "status"), Some("running")) { " (running)" } else { "" };
            format!("- [{}] {}{running}{reason}", to_str(get(a, "id")), super::actions::describe(a))
        })
        .collect();
    if !actions.is_empty() {
        parts.push(format!("## Actions Claude asked to run\n{}", actions.join("\n")));
    }
    let replies: Vec<String> = list("handoffs")
        .iter()
        .filter(|h| get(h, "result").is_some_and(Value::is_object) && !truthy(get(h, "resultAck")))
        .map(|h| {
            let r = get(h, "result").cloned().unwrap_or(Value::Null);
            let done = if truthy(get(&r, "done")) { "done" } else { "not done yet" };
            format!("- {} ({done}): {}", title(h), clip(&to_str(get(&r, "summary")), 300))
        })
        .collect();
    if !replies.is_empty() {
        parts.push(format!("## Unread replies to hand-offs\n{}", replies.join("\n")));
    }
    let head = format!("*Project: {}* — waiting for the user's OK in Grill Me (Flow).", ctx.project_dir().id);
    if parts.is_empty() {
        format!("{head}\n\nNothing waiting.")
    } else {
        format!("{head}\n\n{}", parts.join("\n\n"))
    }
}

// ---- change detection (stdio watcher) ------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
struct Stamp {
    mtime_ns: u128,
    len: u64,
}

fn stamp(p: &Path) -> Option<Stamp> {
    let md = std::fs::metadata(p).ok()?;
    let mtime_ns = md.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    Some(Stamp { mtime_ns, len: md.len() })
}

/// Remembers content hashes by (path, mtime, size), so a poll re-reads a
/// file only when it was touched — and a rewrite with the same bytes (the
/// app re-saving bridge.json unchanged) doesn't count as a change.
#[derive(Default)]
pub struct FileCache {
    seen: HashMap<PathBuf, (Stamp, u64)>,
}

impl FileCache {
    /// Content hash of a JSON file (0 = missing).
    pub fn content(&mut self, p: &Path) -> u64 {
        let Some(st) = stamp(p) else {
            self.seen.remove(p);
            return 0;
        };
        if let Some((s, h)) = self.seen.get(p) {
            if *s == st {
                return *h;
            }
        }
        let mut hs = DefaultHasher::new();
        std::fs::read(p).unwrap_or_default().hash(&mut hs);
        let h = hs.finish() | 1;
        self.seen.insert(p.to_path_buf(), (st, h));
        h
    }
}

/// A session's newest transcript: mtime + size (transcripts are big and
/// append-only, so they're never hashed).
fn transcript_sig(ctx: &Ctx, m: &Value) -> u64 {
    let repo = to_str(get(m, "repoPath"));
    let mut hs = DefaultHasher::new();
    if let Some((p, _)) = ctx.transcript_file(&repo) {
        p.hash(&mut hs);
        stamp(&p).unwrap_or_default().hash(&mut hs);
    }
    hs.finish()
}

impl Hash for Stamp {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.mtime_ns.hash(state);
        self.len.hash(state);
    }
}

/// One poll: URI → fingerprint for every resource in `list` right now.
pub fn fingerprints(ctx: &Ctx, cache: &mut FileCache) -> HashMap<String, u64> {
    let dir = ctx.project_dir().dir;
    let mut f = |name: &str| cache.content(&dir.join(name));
    let (bridge, brain, decisions, tasks, reviews, tests, config) =
        (f("bridge.json"), f("brain.json"), f("decisions.json"), f("tasks.json"), f("reviews.json"), f("tests.json"), f("config.json"));
    let team_bridge = f("team-bridge.json");
    // every team-*.json (sessions, bridge, chat) the room syncs in
    let mut team_names: Vec<String> = std::fs::read_dir(&dir)
        .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with("team-") && n.ends_with(".json")).collect())
        .unwrap_or_default();
    team_names.sort();
    let team_all: Vec<u64> = team_names.iter().map(|n| f(n)).collect();
    // root config/settings: titles live in settings.json, and a project
    // switch moves everything (the dir itself goes into each hash)
    let titles = cache.content(&ctx.root_path().join("settings.json"));
    let root_cfg = cache.content(&ctx.root_path().join("config.json"));

    let hash_of = |x: &dyn Fn(&mut DefaultHasher)| {
        let mut hs = DefaultHasher::new();
        x(&mut hs);
        hs.finish()
    };
    let team_h = hash_of(&|s| team_all.hash(s));
    let members = ctx.members();
    let transcripts: Vec<(String, u64)> = members.iter().map(|m| (to_str(get(m, "id")), transcript_sig(ctx, m))).collect();
    let all_t = hash_of(&|s| transcripts.hash(s));
    let mix = |items: &[u64]| {
        let mut hs = DefaultHasher::new();
        dir.hash(&mut hs);
        items.hash(&mut hs);
        hs.finish()
    };

    let mut out = HashMap::new();
    out.insert(BRAIN.to_string(), mix(&[bridge, brain, decisions, tasks]));
    out.insert(FLOW.to_string(), mix(&[bridge, team_bridge, titles, config, root_cfg]));
    out.insert(SESSIONS.to_string(), mix(&[bridge, brain, reviews, tests, config, root_cfg, titles, team_h, all_t]));
    for (id, t) in &transcripts {
        let uri = session_uri(id);
        if parse_uri(&uri).is_some() {
            out.insert(uri, mix(&[*t, reviews, tests, titles, config, root_cfg]));
        }
    }
    out
}

/// What moved between two polls: (URIs whose fingerprint changed, did the
/// set of sessions change).
pub fn diff(prev: &HashMap<String, u64>, next: &HashMap<String, u64>) -> (Vec<String>, bool) {
    let mut changed: Vec<String> = next.iter().filter(|(k, v)| prev.get(*k).is_some_and(|p| p != *v)).map(|(k, _)| k.clone()).collect();
    changed.sort();
    let sessions = |m: &HashMap<String, u64>| {
        let mut s: Vec<&String> = m.keys().filter(|k| k.starts_with(SESSION_PREFIX)).collect();
        s.sort();
        s.into_iter().cloned().collect::<Vec<_>>()
    };
    (changed, sessions(prev) != sessions(next))
}

/// Kept for callers that want just the ids (tests, list_changed bookkeeping).
pub fn session_ids(ctx: &Ctx) -> Vec<String> {
    member_ids(ctx)
}

#[cfg(test)]
mod tests {
    use super::super::data::Remote;
    use super::*;

    fn tmp(tag: &str) -> (Ctx, PathBuf) {
        let home = std::env::temp_dir().join(format!("grillme-res-{tag}-{}-{}", std::process::id(), js::now_ms()));
        std::fs::create_dir_all(home.join(".grillme")).unwrap();
        let h = home.to_string_lossy().into_owned();
        (Ctx { root: format!("{h}/.grillme"), home: h, remote: Remote::default(), scope: None, forced: None }, home)
    }

    #[test]
    fn routes_uris() {
        assert_eq!(parse_uri("grillme://project/brain"), Some(Res::Brain));
        assert_eq!(parse_uri("grillme://sessions"), Some(Res::Sessions));
        assert_eq!(parse_uri("grillme://flow"), Some(Res::Flow));
        assert_eq!(parse_uri("grillme://session/auth-1"), Some(Res::Session("auth-1".into())));
        for bad in ["grillme://session/", "grillme://session/../x", "grillme://session/a/b", "grillme://nope", "file:///etc/passwd", "grillme://session/a b"] {
            assert_eq!(parse_uri(bad), None, "{bad}");
        }
    }

    #[test]
    fn lists_fixed_docs_and_one_per_session_and_reads_them() {
        let (ctx, home) = tmp("list");
        let g = home.join(".grillme");
        std::fs::create_dir_all(home.join("a")).unwrap();
        std::fs::write(g.join("config.json"), format!(r#"{{"teammates":[{{"id":"s1","name":"Auth","repoPath":"{}"}}]}}"#, home.join("a").display())).unwrap();
        std::fs::write(
            g.join("bridge.json"),
            r#"{"goal":"Ship it","handoffs":[{"id":"h1","status":"pending","kind":"handoff","session":"s1","sessionTitle":"Auth","message":"add login"}],"plans":[],"questions":[{"id":"q1","answered":false,"from":"s1","fromTitle":"Auth","question":"Email or Google?","draft":"Google."}],"notes":[{"id":"n1","ts":1,"text":"demo first"}],"actions":[{"id":"a1","kind":"run_tests","session":"s1","sessionTitle":"Auth","status":"pending","reason":"before merge","ts":1}]}"#,
        )
        .unwrap();
        let uris: Vec<String> = list(&ctx).iter().map(|r| r["uri"].as_str().unwrap().to_string()).collect();
        assert_eq!(uris, vec![BRAIN, SESSIONS, FLOW, "grillme://session/s1"]);
        let flow = read(&ctx, FLOW).unwrap()[0]["text"].as_str().unwrap().to_string();
        assert!(flow.contains("[h1] task for Auth: add login"), "{flow}");
        assert!(flow.contains("drafted answer: Google."), "{flow}");
        assert!(flow.contains("[a1] run tests in Auth — before merge"), "{flow}");
        let brain = read(&ctx, BRAIN).unwrap()[0]["text"].as_str().unwrap().to_string();
        assert!(brain.contains("**Goal:** Ship it") && brain.contains("- demo first"), "{brain}");
        let s = read(&ctx, "grillme://session/s1").unwrap()[0]["text"].as_str().unwrap().to_string();
        assert!(s.contains("### Auth  (id: s1)") && s.contains("no conversation yet"), "{s}");
        assert_eq!(read(&ctx, "grillme://session/zzz").unwrap_err().0, NOT_FOUND);
        assert_eq!(read(&ctx, "grillme://bogus").unwrap_err().0, NOT_FOUND);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn remote_reads_are_redacted() {
        let (mut ctx, home) = tmp("redact");
        ctx.remote = Remote { on: true, allow_writes: false, no_transcripts: true };
        let key = format!("sk-ant-api03-{}", "a".repeat(40));
        std::fs::write(home.join(".grillme/bridge.json"), format!(r#"{{"goal":"use {key}","handoffs":[],"plans":[],"questions":[],"notes":[]}}"#)).unwrap();
        let text = read(&ctx, BRAIN).unwrap()[0]["text"].as_str().unwrap().to_string();
        assert!(!text.contains(&key), "{text}");
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn detects_changes_by_content_not_touch() {
        let (ctx, home) = tmp("fp");
        let g = home.join(".grillme");
        std::fs::create_dir_all(home.join("a")).unwrap();
        std::fs::write(g.join("config.json"), format!(r#"{{"teammates":[{{"id":"s1","repoPath":"{}"}}]}}"#, home.join("a").display())).unwrap();
        let mut cache = FileCache::default();
        let a = fingerprints(&ctx, &mut cache);
        assert_eq!(diff(&a, &fingerprints(&ctx, &mut cache)), (vec![], false), "nothing moved");

        // same bytes rewritten: not a change
        std::fs::write(g.join("decisions.json"), "[]").unwrap();
        let b = fingerprints(&ctx, &mut cache);
        std::thread::sleep(std::time::Duration::from_millis(5));
        std::fs::write(g.join("decisions.json"), "[]").unwrap();
        assert_eq!(diff(&b, &fingerprints(&ctx, &mut cache)).0, Vec::<String>::new());

        // a pending action lands: flow, brain and sessions move, the session doc doesn't
        std::fs::write(g.join("bridge.json"), r#"{"actions":[{"id":"a1","status":"pending"}]}"#).unwrap();
        let c = fingerprints(&ctx, &mut cache);
        let (changed, listed) = diff(&b, &c);
        assert_eq!(changed, vec![FLOW.to_string(), BRAIN.to_string(), SESSIONS.to_string()]);
        assert!(!listed);

        // a review for s1 moves its doc + sessions
        std::fs::write(g.join("reviews.json"), r#"{"s1":{"verdict":"fix"}}"#).unwrap();
        let d = fingerprints(&ctx, &mut cache);
        assert_eq!(diff(&c, &d).0, vec!["grillme://session/s1".to_string(), SESSIONS.to_string()]);

        // a new session: list_changed
        std::fs::write(g.join("config.json"), format!(r#"{{"teammates":[{{"id":"s1","repoPath":"{0}"}},{{"id":"s2","repoPath":"{0}"}}]}}"#, home.join("a").display())).unwrap();
        let e = fingerprints(&ctx, &mut cache);
        assert!(diff(&d, &e).1);
        assert_eq!(session_ids(&ctx), vec!["s1", "s2"]);
        let _ = std::fs::remove_dir_all(home);
    }
}
