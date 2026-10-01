// ---------------------------------------------------------------------------
// Actions Claude can REQUEST (run tests, restart a session, open the preview,
// start a new session). Each one lands as a pending `action` in bridge.json
// through Grill Me's loopback API and only runs after the user clicks Run in
// Flow (bridge::actions::bridge_run_action). Local connections only — the
// remote (claude.ai) server never lists these tools.
// ---------------------------------------------------------------------------

use super::data::{eq_str, ts_of, Ctx};
use super::js::{self, clip, get, nn, to_str, truthy};
use serde_json::{json, Map, Value};

pub const TOOLS: [&str; 4] = ["run_tests", "restart_session", "open_preview", "create_session"];
/// Reason length the grill gate asks for (restart / create).
pub const MIN_REASON: usize = 10;
const WAITING: &str = "waiting for your OK in Grill Me";

/// A branch name we'd hand to `git worktree add -b`: the safe subset of git's
/// ref rules (no spaces, no `..`, no leading `-` or `/`, no `.lock`, ≤ 100).
pub fn valid_branch(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 100
        && b.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        && !b.starts_with(['-', '/', '.'])
        && !b.ends_with(['/', '.'])
        && !b.contains("..")
        && !b.contains("//")
        && !b.ends_with(".lock")
        && !b.split('/').any(|seg| seg.is_empty() || seg.starts_with('.'))
}

fn reason_of(args: &Value) -> String {
    js::trim(&to_str(nn(get(args, "reason")).filter(|v| v.is_string()))).chars().take(500).collect()
}

fn gate(reason: &str, what: &str) -> Result<(), String> {
    if js::len16(js::trim(reason)) < MIN_REASON {
        return Err(format!("Grill gate: say why in `reason` (at least {MIN_REASON} characters) — {what}"));
    }
    Ok(())
}

/// One of `TOOLS` → push a pending action, say it's waiting for the user.
pub fn request(ctx: &Ctx, name: &str, args: &Value) -> Result<String, String> {
    let reason = reason_of(args);
    let mut item = Map::new();
    item.insert("kind".into(), json!(name));
    item.insert("reason".into(), json!(reason));
    let target = |m: &Value, item: &mut Map<String, Value>| {
        if let Some(id) = get(m, "id") {
            item.insert("session".into(), id.clone());
        }
        item.insert("sessionTitle".into(), ctx.label_v(m));
        ctx.label(m)
    };
    let text = match name {
        "run_tests" | "restart_session" => {
            if name == "restart_session" {
                gate(&reason, "restarting kills the session's current turn, so the user needs to know why.")?;
            }
            let key = nn(get(args, "session")).filter(|v| truthy(Some(v)));
            let m = match key {
                Some(_) => ctx.find_session(key)?,
                None => ctx.self_member(),
            };
            let Some(m) = m else {
                return Ok(format!("No session \"{}\". Call whats_new for the list.", to_str(key)));
            };
            let label = target(&m, &mut item);
            item.insert("args".into(), json!({}));
            if name == "run_tests" {
                format!("Running the tests in {label} is {WAITING}. Once the user clicks Run, the result shows in whats_new and ship_status.")
            } else {
                format!("Restarting {label} is {WAITING} (the session's current turn is lost when it restarts).")
            }
        }
        "open_preview" => {
            let key = nn(get(args, "session")).filter(|v| truthy(Some(v)));
            if key.is_some() {
                let Some(m) = ctx.find_session(key)? else {
                    return Ok(format!("No session \"{}\". Call whats_new for the list.", to_str(key)));
                };
                target(&m, &mut item);
            }
            item.insert("args".into(), json!({}));
            format!("Opening the preview is {WAITING}. Once the user clicks Run, the dev server's URL shows up in whats_new.")
        }
        "create_session" => {
            gate(&reason, "a new session is a new worktree and a new Claude, so the user needs to know why.")?;
            let branch = js::trim(&to_str(get(args, "branch"))).to_string();
            if !valid_branch(&branch) {
                return Err("branch must be a plain git branch name like feat/search (letters, digits, / - _ .).".into());
            }
            let task = js::trim(&to_str(nn(get(args, "task")).filter(|v| v.is_string()))).to_string();
            if task.is_empty() {
                return Err("task is required: it becomes the new session's first message.".into());
            }
            item.insert("args".into(), json!({ "branch": branch, "task": js::head16(&task, 4000) }));
            format!("A new session on {branch} is {WAITING} — once the user clicks Run, the task is typed in as its first message.")
        }
        _ => return Err(format!("Unknown tool {name}")),
    };
    super::http::push(ctx, "action", Value::Object(item))?;
    Ok(text)
}

/// "run tests in Auth", "start a session on feat/x", …
pub fn describe(a: &Value) -> String {
    let who = to_str(nn(get(a, "sessionTitle")).filter(|v| truthy(Some(v))).or(get(a, "session")));
    match get(a, "kind").and_then(Value::as_str).unwrap_or("") {
        "run_tests" => format!("run tests in {who}"),
        "restart_session" => format!("restart {who}"),
        "open_preview" if who.is_empty() || who == "undefined" => "open the preview".into(),
        "open_preview" => format!("open the preview of {who}"),
        "create_session" => format!("start a new session on {}", to_str(get(a, "args").and_then(|x| get(x, "branch")))),
        k => k.to_string(),
    }
}

fn actions(b: &Value) -> Vec<Value> {
    get(b, "actions").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// Requests still waiting for the user's click (for whats_new's Waiting list).
pub fn waiting_lines(b: &Value) -> Vec<String> {
    actions(b)
        .iter()
        .filter(|a| eq_str(get(a, "status"), Some("pending")) || eq_str(get(a, "status"), Some("running")))
        .map(|a| {
            let state = if eq_str(get(a, "status"), Some("running")) { "running now" } else { "waiting for the user's OK" };
            format!("- action: {} — {state}", describe(a))
        })
        .collect()
}

/// Outcomes of requested actions newer than `since` (or the latest few when `full`).
pub fn outcome_lines(b: &Value, since: f64, full: bool) -> Vec<String> {
    let mut found: Vec<(f64, String)> = actions(b)
        .iter()
        .filter_map(|a| {
            let st = get(a, "status").and_then(Value::as_str).unwrap_or("");
            let ts = ts_of(get(a, "outcomeTs"));
            let o = get(a, "outcome")?;
            if !matches!(st, "done" | "failed") || !(full || ts > since) {
                return None;
            }
            let verdict = if st == "done" { "done" } else { "FAILED" };
            Some((ts, format!("- {} ({verdict}): {}", describe(a), clip(&to_str(get(o, "summary")), 300))))
        })
        .collect();
    found.sort_by(|a, b| a.0.total_cmp(&b.0));
    let lines: Vec<String> = found.into_iter().map(|(_, l)| l).collect();
    js::tail(&lines, if full { 5 } else { 10 }).to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_names_are_validated() {
        for ok in ["feat/search", "fix-1", "a.b/c_d", "x"] {
            assert!(valid_branch(ok), "{ok}");
        }
        for bad in ["", "-x", "/x", "x/", "a..b", "a b", "a;rm", "a//b", "x.lock", "feat/.hidden", ".x", "$(x)", &"a".repeat(101)] {
            assert!(!valid_branch(bad), "{bad}");
        }
    }

    #[test]
    fn grill_gate_wants_a_real_reason() {
        assert!(gate("stuck", "x").is_err());
        assert!(gate("          ", "x").is_err());
        assert!(gate("it has been looping for 20 minutes", "x").is_ok());
    }

    #[test]
    fn describes_and_reports_outcomes() {
        let b = json!({ "actions": [
            { "id": "a1", "kind": "run_tests", "session": "s1", "sessionTitle": "Auth", "status": "pending", "ts": 1 },
            { "id": "a2", "kind": "create_session", "args": { "branch": "feat/x" }, "status": "done", "ts": 2, "outcome": { "ok": true, "summary": "Started x" }, "outcomeTs": 50 },
            { "id": "a3", "kind": "restart_session", "session": "s2", "status": "failed", "ts": 3, "outcome": { "ok": false, "summary": "no such session" }, "outcomeTs": 60 },
            { "id": "a4", "kind": "open_preview", "status": "dismissed", "ts": 4 },
        ] });
        assert_eq!(waiting_lines(&b), vec!["- action: run tests in Auth — waiting for the user's OK"]);
        assert_eq!(outcome_lines(&b, 55.0, false), vec!["- restart s2 (FAILED): no such session"]);
        assert_eq!(outcome_lines(&b, 1e15, true).len(), 2);
        assert_eq!(describe(&json!({ "kind": "open_preview" })), "open the preview");
    }
}
