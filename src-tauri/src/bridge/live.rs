// ---------------------------------------------------------------------------
// The bridge loop: Grill Me closes the round trip between Claude and the
// coders instead of only relaying it.
//
// * Live answers — a coder's question gets a drafted answer (Sonnet) the
//   user sends with one click. One draft per question, never re-drafted.
// * Auto review — a session that finishes gets a ship / fix / wait verdict,
//   kept in reviews.json and skipped while HEAD + dirty state are unchanged.
// * Hand-off replies — once a delivered hand-off's session goes idle, a short
//   result report (Haiku) lands on the hand-off for the sender to read.
// * Phone approvals — ntfy action buttons POST "approve:<id>:<token>" to a
//   second private topic; tokens are 128-bit, single use, 24 h, kept on the
//   item in bridge.json and never sent to the webview.
//
// Inputs are gathered by the MCP binary (`--answer-input`, `--review-input`,
// `--reply-input`), like the other brain checks.
// ---------------------------------------------------------------------------

use super::{claude_quick, extract_json, install, load, now_ms, push, run_script, save, team_bridge, BRIDGE_LOCK};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;

const TOKEN_TTL_MS: u64 = 24 * 3_600_000;

/// Bridge item ids are generated (`q-…`, `h-…`, `tb-…`); keep them boring.
pub(super) fn valid_id(id: &str) -> bool {
    (1..=80).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn clip(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

fn handoff_mut<'a>(v: &'a mut Value, id: &str) -> Option<&'a mut Value> {
    v["handoffs"].as_array_mut()?.iter_mut().find(|h| h["id"] == id)
}

fn changed(app: &tauri::AppHandle) {
    let _ = app.emit("bridge-changed", ());
}

// ---- live answers -----------------------------------------------------------

const ANSWER_PROMPT: &str = "You are the product/brainstorm side of a hackathon team, answering a question one of the team's AI coding sessions asked. \
The input JSON has the question and its context, the goal, decisions, open tasks, shared notes, and the asking session's last turn. \
Write the answer the coder should receive: direct, specific and actionable, grounded in the goal and decisions. \
If the input can't settle it, choose the simplest option that serves the goal and say it's a default the user can change. \
Under 120 words, plain text, no preamble, no sign-off.";

/// Where a question's draft (and phone token) lives: on the question for a
/// local one, in bridge.json's `teamLocal[id]` for a teammate's question.
fn slot_mut<'a>(v: &'a mut Value, id: &str, team: bool) -> Option<&'a mut Value> {
    if team {
        if !v["teamLocal"].is_object() {
            v["teamLocal"] = json!({});
        }
        let t = v["teamLocal"].as_object_mut()?;
        return Some(t.entry(id.to_string()).or_insert_with(|| json!({})));
    }
    v["questions"].as_array_mut()?.iter_mut().find(|q| q["id"] == id)
}

/// Claim the one draft a question ever gets. False when it's already
/// drafted, failed, or drafting (a stale "drafting" — the app quit mid-call —
/// stays claimed too: never re-draft automatically).
pub(crate) fn claim_draft(v: &mut Value, id: &str, team: bool, now: u64) -> Result<bool, String> {
    let slot = slot_mut(v, id, team).ok_or("no question with that id")?;
    if slot.get("draftStarted").is_some() || slot.get("draft").is_some() || slot["answered"] == true {
        return Ok(false);
    }
    slot["draftStarted"] = json!(now);
    Ok(true)
}

/// A model reply → the draft text: no fences or wrapping quotes, capped.
pub(crate) fn clean_draft(reply: &str) -> String {
    let mut s = reply.trim();
    if s.starts_with("```") {
        s = s.trim_start_matches('`').trim_start_matches("text").trim_end_matches('`').trim();
    }
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        s = &s[1..s.len() - 1];
    }
    clip(s, 4000)
}

/// Keep teamLocal bounded: drop entries older than a week.
fn prune_team_local(v: &mut Value, now: u64) {
    if let Some(t) = v["teamLocal"].as_object_mut() {
        t.retain(|_, e| {
            let ts = ["draftStarted", "draftTs", "ts"].iter().filter_map(|k| e[*k].as_u64()).max().unwrap_or(now);
            now.saturating_sub(ts) < 7 * 24 * 3_600_000
        });
    }
}

/// Draft an answer to a coder's question (local or a teammate's) and store
/// it on the question. Throttled to one draft per question, ever.
#[tauri::command(async)]
pub(crate) fn bridge_draft_answer(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    if !valid_id(&id) {
        return Err("bad id".into());
    }
    install();
    let team = {
        let _g = crate::lock_or_recover(&BRIDGE_LOCK);
        let mut v = load();
        let local = v["questions"].as_array().is_some_and(|a| a.iter().any(|q| q["id"] == id.as_str()));
        let team = !local
            && team_bridge().iter().any(|e| e["kind"] == "question" && e["id"] == id.as_str() && e["status"] == "pending");
        if !local && !team {
            return Err("no question with that id".into());
        }
        let now = now_ms();
        if !claim_draft(&mut v, &id, team, now)? {
            return Ok(Value::Null);
        }
        prune_team_local(&mut v, now);
        save(&v)?;
        team
    };
    changed(&app);
    let input = run_script(&["--answer-input", &id]);
    let result = match input {
        Ok(i) if i.trim().is_empty() => Err("question not found".to_string()),
        Ok(i) => claude_quick(&i, ANSWER_PROMPT, "sonnet").map(|r| clean_draft(&r)),
        Err(e) => Err(e),
    };
    let result = result.and_then(|d| if d.is_empty() { Err("empty draft".into()) } else { Ok(d) });
    {
        let _g = crate::lock_or_recover(&BRIDGE_LOCK);
        let mut v = load();
        if let Some(slot) = slot_mut(&mut v, &id, team) {
            match &result {
                Ok(d) => {
                    slot["draft"] = json!(d);
                    slot["draftTs"] = json!(now_ms());
                }
                Err(e) => slot["draftError"] = json!(clip(e, 200)),
            }
            save(&v)?;
        }
    }
    changed(&app);
    result.map(|d| json!({ "draft": d }))
}

/// "Send answer": the drafted (maybe edited) answer becomes the usual answer
/// hand-off — the caller delivers it right away (that click is the approval).
#[tauri::command]
pub(crate) fn bridge_answer(id: String, answer: String) -> Result<Value, String> {
    if !valid_id(&id) {
        return Err("bad id".into());
    }
    // a double click (or a phone press racing the desktop) must not answer twice
    let done = {
        let _g = crate::lock_or_recover(&BRIDGE_LOCK);
        load()["questions"].as_array().is_some_and(|a| a.iter().any(|q| q["id"] == id.as_str() && q["answered"] == true))
    };
    if done {
        return Err("that question is already answered".into());
    }
    push("answer", &json!({ "id": id, "answer": answer }))
}

/// Small state flips from the UI: a hand-off was delivered; its reply was
/// read; a teammate's question or reply was dismissed on this Mac.
#[tauri::command]
pub(crate) fn bridge_flag(id: String, flag: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("bad id".into());
    }
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    match flag.as_str() {
        "delivered" => handoff_mut(&mut v, &id).ok_or("not found")?["deliveredAt"] = json!(now_ms()),
        "resultAck" => handoff_mut(&mut v, &id).ok_or("not found")?["resultAck"] = json!(true),
        // the user read a requested action's outcome in Flow
        "actionAck" => {
            v["actions"].as_array_mut().and_then(|a| a.iter_mut().find(|x| x["id"] == id.as_str())).ok_or("not found")?["outcomeAck"] = json!(true)
        }
        "teamDismiss" | "teamReplyAck" => {
            let slot = slot_mut(&mut v, &id, true).ok_or("not found")?;
            slot[if flag == "teamDismiss" { "dismissed" } else { "replyAck" }] = json!(true);
            slot["ts"] = json!(now_ms());
        }
        _ => return Err("bad flag".into()),
    }
    save(&v)
}

// ---- auto review --------------------------------------------------------------

const REVIEW_PROMPT: &str = "You review one AI coding session's work for a beginner-to-intermediate developer before it ships. \
The input JSON has the goal, decisions, the session's commits, changed files, diff, last test result (may be null) and its last turn. \
Reply with ONLY a JSON object, no prose, no fences: \
{\"summary\": string, \"risks\": string[], \"verdict\": \"ship\" | \"fix\" | \"wait\", \"reason\": string}. \
summary = 2-3 plain-English sentences: what changed and whether it looks right. risks = at most 3 concrete risks grounded in the diff (empty if none). \
verdict: ship = finished and safe to merge; fix = something is broken or wrong (failing tests, a bug in the diff, contradicts a decision); wait = clearly unfinished. \
Failing tests always mean fix. reason = one short sentence for the verdict.";

/// Validate a review reply: known verdict, non-empty summary, ≤ 3 risks.
pub(crate) fn parse_review(r: &Value) -> Option<Value> {
    let verdict = r["verdict"].as_str().map(str::to_lowercase).filter(|v| ["ship", "fix", "wait"].contains(&v.as_str()))?;
    let summary = clip(r["summary"].as_str()?, 600);
    if summary.is_empty() {
        return None;
    }
    let risks: Vec<String> = r["risks"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).map(|s| clip(s, 200)).filter(|s| !s.is_empty()).take(3).collect())
        .unwrap_or_default();
    Some(json!({ "summary": summary, "risks": risks, "verdict": verdict, "reason": clip(r["reason"].as_str().unwrap_or(""), 300) }))
}

static REVIEWS_LOCK: Mutex<()> = Mutex::new(());

fn reviews_path() -> PathBuf {
    crate::grillme_dir().join("reviews.json")
}

fn read_obj(p: &PathBuf) -> serde_json::Map<String, Value> {
    std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Every session's latest review (reviews.json in the project dir).
#[tauri::command]
pub(crate) fn reviews_read() -> Value {
    Value::Object(read_obj(&reviews_path()))
}

/// Review a session that just finished. Null when there's nothing to review;
/// the previous review (`skipped: true`) when HEAD + dirty state haven't
/// moved since it.
#[tauri::command(async)]
pub(crate) fn brain_review(member_id: String, repo_path: String) -> Result<Value, String> {
    crate::validate_member_id(&member_id)?;
    let repo = PathBuf::from(&repo_path);
    if !repo.join(".git").exists() {
        return Err("not a git worktree".into());
    }
    let sig = crate::automations::tree_signature(&repo);
    if let Some(prev) = read_obj(&reviews_path()).get(&member_id).filter(|p| p["sig"] == sig.as_str()) {
        let mut prev = prev.clone();
        prev["skipped"] = json!(true);
        return Ok(prev);
    }
    install();
    let input = run_script(&["--review-input", &member_id])?;
    if input.trim().is_empty() {
        return Ok(Value::Null);
    }
    let session = serde_json::from_str::<Value>(&input).ok().and_then(|v| v["session"].as_str().map(str::to_owned)).unwrap_or_else(|| member_id.clone());
    let reply = claude_quick(&input, REVIEW_PROMPT, "sonnet")?;
    let mut entry = extract_json(&reply).as_ref().and_then(parse_review).ok_or("review came back malformed")?;
    let head = std::process::Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["rev-parse", "HEAD"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    entry["session"] = json!(session);
    entry["ts"] = json!(now_ms());
    entry["head"] = json!(head);
    entry["sig"] = json!(sig);
    let _g = crate::lock_or_recover(&REVIEWS_LOCK);
    let path = reviews_path();
    let mut all = read_obj(&path);
    all.insert(member_id, entry.clone());
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(entry)
}

// ---- hand-off replies -----------------------------------------------------------

const REPLY_PROMPT: &str = "A coding session was handed a task. The input JSON has the task, the session's turns since it got it \
(what it was asked, tools it used, its replies) and the last test result (may be null). \
Reply with ONLY a JSON object, no prose, no fences: {\"done\": boolean, \"summary\": string}. \
summary = 1-2 plain sentences for whoever sent the task: what the session did, and what's left or blocked. done = true only when the task looks finished.";

pub(crate) fn parse_reply(r: &Value) -> Option<Value> {
    let summary = clip(r["summary"].as_str()?, 500);
    (!summary.is_empty()).then(|| json!({ "done": r["done"].as_bool().unwrap_or(false), "summary": summary }))
}

/// After a delivered hand-off's session goes idle: a short result report on
/// the hand-off. Null when the session hasn't taken a turn on it yet (try
/// again next idle) or it already has one. Returns the updated hand-off.
#[tauri::command(async)]
pub(crate) fn bridge_handoff_result(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    if !valid_id(&id) {
        return Err("bad id".into());
    }
    {
        let _g = crate::lock_or_recover(&BRIDGE_LOCK);
        let mut v = load();
        let h = handoff_mut(&mut v, &id).ok_or("not found")?;
        if h["status"] != "sent" || h["deliveredAt"].as_u64().is_none() || h.get("result").is_some() || h.get("resultError").is_some()
            // in progress (a claim left by a quit mid-call frees up after 5 min)
            || h["resultStarted"].as_u64().is_some_and(|t| now_ms().saturating_sub(t) < 300_000)
        {
            return Ok(Value::Null);
        }
        h["resultStarted"] = json!(now_ms());
        save(&v)?;
    }
    install();
    let outcome = run_script(&["--reply-input", &id]).and_then(|input| {
        if input.trim().is_empty() {
            return Ok(None);
        }
        let reply = claude_quick(&input, REPLY_PROMPT, "haiku")?;
        extract_json(&reply).as_ref().and_then(parse_reply).map(Some).ok_or_else(|| "reply came back malformed".to_string())
    });
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    let h = handoff_mut(&mut v, &id).ok_or("not found")?;
    if let Some(o) = h.as_object_mut() {
        o.remove("resultStarted");
    }
    let out = match outcome {
        Ok(None) => Value::Null,
        Ok(Some(r)) => {
            h["result"] = r;
            h["resultTs"] = json!(now_ms());
            h.clone()
        }
        Err(e) => {
            // one try per hand-off: a failure is final (no retry loop on every idle)
            h["resultError"] = json!(clip(&e, 200));
            save(&v)?;
            return Err(e);
        }
    };
    save(&v)?;
    drop(_g);
    if !out.is_null() {
        changed(&app);
    }
    Ok(out)
}

// ---- phone approvals ------------------------------------------------------------

/// 128 random bits as 32 hex chars, from the OS CSPRNG.
fn random_token() -> Result<String, String> {
    use std::io::Read;
    let mut buf = [0u8; 16];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut buf)).map_err(|e| format!("no randomness: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// The item a token belongs to, by list. "team" = a teammate's question
/// (its local draft lives in teamLocal).
fn item_mut<'a>(v: &'a mut Value, list: &str, id: &str) -> Option<&'a mut Value> {
    match list {
        "team" => slot_mut(v, id, true),
        "handoffs" | "plans" | "questions" => v[list].as_array_mut()?.iter_mut().find(|x| x["id"] == id),
        _ => None,
    }
}

/// Mint a one-time token for approving `id` from the phone (replaces any
/// earlier one for the same item).
#[tauri::command]
pub(crate) fn phone_token_issue(list: String, id: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("bad id".into());
    }
    let token = random_token()?;
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    let item = item_mut(&mut v, &list, &id).ok_or("not found")?;
    item["phoneToken"] = json!({ "token": token, "exp": now_ms() + TOKEN_TTL_MS, "used": false });
    save(&v)?;
    Ok(token)
}

/// "approve:<id>:<token>" / "dismiss:<id>:<token>" → its parts.
pub(crate) fn parse_phone_msg(msg: &str) -> Option<(&str, &str, &str)> {
    let mut it = msg.trim().split(':');
    let (action, id, token) = (it.next()?, it.next()?, it.next()?);
    let hex = token.len() == 32 && token.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
    (it.next().is_none() && ["approve", "dismiss"].contains(&action) && valid_id(id) && hex).then_some((action, id, token))
}

fn ct_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Verify and burn a phone token. Ok(list) = the item's list; Err = why it
/// was refused (unknown, used, expired, bad token).
pub(crate) fn redeem(v: &mut Value, id: &str, token: &str, now: u64) -> Result<&'static str, &'static str> {
    for list in ["handoffs", "plans", "questions", "team"] {
        let exists = match list {
            "team" => v["teamLocal"][id].is_object(),
            _ => v[list].as_array().is_some_and(|a| a.iter().any(|x| x["id"] == id)),
        };
        if !exists {
            continue;
        }
        let item = item_mut(v, list, id).ok_or("unknown")?;
        let t = &item["phoneToken"];
        let Some(want) = t["token"].as_str() else { return Err("unknown") };
        if !ct_eq(want, token) {
            return Err("bad token");
        }
        if t["used"] != false {
            return Err("used");
        }
        if t["exp"].as_u64().unwrap_or(0) < now {
            return Err("expired");
        }
        item["phoneToken"]["used"] = json!(true);
        item["phoneToken"]["usedAt"] = json!(now);
        return Ok(list);
    }
    Err("unknown")
}

/// ntfy "Actions" header: Approve / Dismiss buttons that POST back to the
/// private reply topic. Every part is validated — commas and semicolons
/// would split the header into other actions.
pub(crate) fn ntfy_actions(reply_topic: &str, id: &str, token: &str, label: &str) -> Result<String, String> {
    if !crate::automations::valid_topic(reply_topic) || !valid_id(id) || parse_phone_msg(&format!("approve:{id}:{token}")).is_none() {
        return Err("bad approval".into());
    }
    let label: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ' ').take(20).collect();
    let label = if label.trim().is_empty() { "Approve".to_string() } else { label.trim().to_string() };
    let url = format!("https://ntfy.sh/{reply_topic}");
    Ok(format!(
        "http, {label}, {url}, method=POST, body=approve:{id}:{token}, clear=true; http, Dismiss, {url}, method=POST, body=dismiss:{id}:{token}, clear=true"
    ))
}

/// A phone ping with Approve / Dismiss buttons for one pending item.
#[tauri::command(async)]
pub(crate) fn phone_ping_approve(topic: String, reply_topic: String, title: String, body: String, item_id: String, token: String, label: String) -> Result<(), String> {
    let actions = ntfy_actions(&reply_topic, &item_id, &token, &label)?;
    crate::automations::ntfy_send(&topic, &title, &body, Some(&actions))
}

fn log_approval(entry: Value) {
    use std::io::Write;
    let path = crate::grillme_dir().join("phone-approvals.jsonl");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{entry}");
    }
}

/// Poll the reply topic for button presses since `since` (an ntfy message
/// id, or a duration like "24h" on first run). Each press is verified and
/// burned here; the UI performs the approved actions.
#[tauri::command(async)]
pub(crate) fn phone_poll(reply_topic: String, since: String) -> Result<Value, String> {
    if !crate::automations::valid_topic(&reply_topic) {
        return Err("bad topic".into());
    }
    if since.is_empty() || since.len() > 32 || !since.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("bad since".into());
    }
    let out = std::process::Command::new("/usr/bin/curl")
        .args(["-sS", "-m", "8", "--fail"])
        .arg(format!("https://ntfy.sh/{reply_topic}/json?poll=1&since={since}"))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("ntfy.sh poll failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let mut last_id = since;
    let mut actions = Vec::new();
    let mut rejected = 0;
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Ok(m) = serde_json::from_str::<Value>(line) else { continue };
        if m["event"] != "message" {
            continue;
        }
        if let Some(mid) = m["id"].as_str().filter(|s| s.len() <= 32 && s.chars().all(|c| c.is_ascii_alphanumeric())) {
            last_id = mid.to_string();
        }
        let msg = m["message"].as_str().unwrap_or("");
        let now = now_ms();
        let Some((action, id, token)) = parse_phone_msg(msg) else {
            rejected += 1;
            log_approval(json!({ "ts": now, "ok": false, "reason": "malformed" }));
            continue;
        };
        let verdict = {
            let _g = crate::lock_or_recover(&BRIDGE_LOCK);
            let mut v = load();
            let r = redeem(&mut v, id, token, now);
            if r.is_ok() {
                save(&v)?;
            }
            r
        };
        match verdict {
            Ok(list) => {
                log_approval(json!({ "ts": now, "ok": true, "action": action, "list": list, "id": id }));
                actions.push(json!({ "action": action, "list": list, "id": id }));
            }
            Err(reason) => {
                rejected += 1;
                log_approval(json!({ "ts": now, "ok": false, "action": action, "id": id, "reason": reason }));
            }
        }
    }
    Ok(json!({ "lastId": last_id, "actions": actions, "rejected": rejected }))
}

/// bridge_read without secrets: phone tokens stay in Rust.
pub(crate) fn scrub(mut v: Value) -> Value {
    for list in ["handoffs", "plans", "questions"] {
        if let Some(a) = v[list].as_array_mut() {
            for x in a {
                if let Some(o) = x.as_object_mut() {
                    o.remove("phoneToken");
                }
            }
        }
    }
    if let Some(t) = v["teamLocal"].as_object_mut() {
        for e in t.values_mut() {
            if let Some(o) = e.as_object_mut() {
                o.remove("phoneToken");
            }
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOK: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn one_draft_per_question_ever() {
        let mut v = json!({ "questions": [{ "id": "q-1", "answered": false }] });
        assert!(claim_draft(&mut v, "q-1", false, 5).unwrap());
        assert!(!claim_draft(&mut v, "q-1", false, 6).unwrap(), "drafting already");
        assert_eq!(v["questions"][0]["draftStarted"], 5);
        // a teammate's question gets its slot in teamLocal
        assert!(claim_draft(&mut v, "tb-x", true, 7).unwrap());
        assert!(!claim_draft(&mut v, "tb-x", true, 8).unwrap());
        assert_eq!(v["teamLocal"]["tb-x"]["draftStarted"], 7);
        assert!(claim_draft(&mut v, "nope", false, 9).is_err());
        let mut answered = json!({ "questions": [{ "id": "q-2", "answered": true }] });
        assert!(!claim_draft(&mut answered, "q-2", false, 1).unwrap());
    }

    #[test]
    fn drafts_are_cleaned() {
        assert_eq!(clean_draft("  \"Use Postgres.\"  "), "Use Postgres.");
        assert_eq!(clean_draft("```text\nUse Redis.\n```"), "Use Redis.");
        assert_eq!(clean_draft(&"a".repeat(5000)).len(), 4000);
    }

    #[test]
    fn review_json_is_validated() {
        let r = extract_json("Here:\n{\"summary\": \"Adds login.\", \"risks\": [\"a\",\"b\",\"c\",\"d\"], \"verdict\": \"FIX\", \"reason\": \"tests fail\"}").unwrap();
        let p = parse_review(&r).unwrap();
        assert_eq!(p["verdict"], "fix");
        assert_eq!(p["risks"].as_array().unwrap().len(), 3);
        assert!(parse_review(&json!({ "summary": "x", "verdict": "maybe" })).is_none());
        assert!(parse_review(&json!({ "summary": " ", "verdict": "ship" })).is_none());
        assert_eq!(parse_review(&json!({ "summary": "ok", "verdict": "ship" })).unwrap()["risks"], json!([]));
    }

    #[test]
    fn reply_json_is_validated() {
        let p = parse_reply(&extract_json("{\"done\": true, \"summary\": \"Added the button.\"}").unwrap()).unwrap();
        assert_eq!(p["done"], true);
        assert!(parse_reply(&json!({ "done": true })).is_none());
        assert_eq!(parse_reply(&json!({ "summary": "half way" })).unwrap()["done"], false);
    }

    #[test]
    fn phone_messages_parse_strictly() {
        assert_eq!(parse_phone_msg(&format!("approve:h-1a:{TOK}")), Some(("approve", "h-1a", TOK)));
        assert_eq!(parse_phone_msg(&format!("dismiss:p-2:{TOK}\n")), Some(("dismiss", "p-2", TOK)));
        assert!(parse_phone_msg(&format!("delete:h-1:{TOK}")).is_none());
        assert!(parse_phone_msg(&format!("approve:h 1:{TOK}")).is_none());
        assert!(parse_phone_msg("approve:h-1:short").is_none());
        assert!(parse_phone_msg(&format!("approve:h-1:{}", TOK.to_uppercase())).is_none());
        assert!(parse_phone_msg(&format!("approve:h-1:{TOK}:extra")).is_none());
    }

    #[test]
    fn tokens_are_single_use_and_expire() {
        let tok = |exp: u64| json!({ "token": TOK, "exp": exp, "used": false });
        let mut v = json!({
            "handoffs": [{ "id": "h-1", "phoneToken": tok(1000) }],
            "plans": [{ "id": "p-1", "phoneToken": tok(10) }],
            "questions": [{ "id": "q-1" }],
            "teamLocal": { "tb-1": { "phoneToken": tok(1000) } },
        });
        assert_eq!(redeem(&mut v, "h-1", "ffffffffffffffffffffffffffffffff", 5), Err("bad token"));
        assert_eq!(redeem(&mut v, "h-1", TOK, 5), Ok("handoffs"));
        assert_eq!(redeem(&mut v, "h-1", TOK, 6), Err("used"));
        assert_eq!(redeem(&mut v, "p-1", TOK, 50), Err("expired"));
        assert_eq!(redeem(&mut v, "q-1", TOK, 5), Err("unknown"), "no token issued");
        assert_eq!(redeem(&mut v, "zzz", TOK, 5), Err("unknown"));
        assert_eq!(redeem(&mut v, "tb-1", TOK, 5), Ok("team"));
    }

    #[test]
    fn tokens_are_random_and_128_bit() {
        let a = random_token().unwrap();
        let b = random_token().unwrap();
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
        assert!(parse_phone_msg(&format!("approve:h-1:{a}")).is_some());
    }

    #[test]
    fn ntfy_actions_are_injection_safe() {
        let a = ntfy_actions("grillme-0123456789abcdef", "h-1", TOK, "Send, now; evil").unwrap();
        assert!(a.starts_with("http, Send now evil, https://ntfy.sh/grillme-0123456789abcdef, method=POST, body=approve:h-1:"), "{a}");
        assert_eq!(a.matches(';').count(), 1, "exactly two actions");
        assert!(ntfy_actions("grillme-0123456789abcdef", "h,1", TOK, "x").is_err());
        assert!(ntfy_actions("bad topic!", "h-1", TOK, "x").is_err());
        assert!(ntfy_actions("grillme-0123456789abcdef", "h-1", "nothex", "x").is_err());
    }

    #[test]
    fn scrub_hides_tokens() {
        let v = scrub(json!({ "handoffs": [{ "id": "h", "phoneToken": { "token": TOK } }], "plans": [], "questions": [], "teamLocal": { "t": { "draft": "d", "phoneToken": {} } } }));
        assert!(v.to_string().find(TOK).is_none());
        assert_eq!(v["teamLocal"]["t"]["draft"], "d");
    }
}
