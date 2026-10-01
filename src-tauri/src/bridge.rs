// ---------------------------------------------------------------------------
// Claude bridge: Grill Me as the hub between the Claude app (brainstorm) and
// Claude Code sessions (coders), via the grill-me MCP server.
//
// * bridge.json (per project) holds handoffs, questions, plans, and notes.
//   Writes are serialized here (API thread + Tauri commands share one lock).
// * The MCP server is this app's own binary in `--mcp` mode (src/mcp/, no
//   Node needed); the hackathon skill playbooks are seeded to
//   ~/.grillme/skills (never overwritten — they're the user's to edit).
// * bridge_connect registers the MCP server with the Claude desktop app and
//   Claude Code (user scope).
// ---------------------------------------------------------------------------

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

/// Drafted answers, auto reviews, hand-off replies, phone approvals.
pub(crate) mod live;

const SERVER_NAME: &str = "grill-me";
const LIST_CAP: usize = 200;
const TEXT_CAP: usize = 20_000;

static BRIDGE_LOCK: Mutex<()> = Mutex::new(());

const DEFAULT_SKILLS: &[(&str, &str)] = &[
    ("prep", "# Prep hack\n\nWe're preparing for a hackathon. Help me get ready before it starts:\n\n1. Ask what the event, tracks, sponsors, and judging criteria are.\n2. Pick a stack we already know — speed beats novelty.\n3. Set up the repo skeleton, env vars, deploy target, and a hello-world that deploys.\n4. List the sponsor APIs/keys to grab now so we don't lose time later.\n\nEnd with a checklist of what's done and what's left.\n"),
    ("intra", "# Intra-hack check-in\n\nWe're mid-hackathon. Keep us on track:\n\n1. Read the plan and open tasks (get_plan) and what each session is doing (whats_new).\n2. Call out anything off-track, blocked, or growing in scope.\n3. Given the time left, say what to cut and what must ship for the demo.\n\nBe blunt. Output: the three most important next moves.\n"),
    ("brainstorm", "# Brainstorm\n\nHelp me find and pick an idea:\n\n1. Ask about the track, the judges, and what we're good at.\n2. Generate 5 distinct ideas — each with the user, the pain, and the wow moment for the demo.\n3. Grill me on the top 2: who actually needs this? Can we build the core in the time we have?\n4. Help me pick one, then save it with save_plan (decision + first tasks).\n"),
    ("breakdown", "# Breakdown\n\nSplit the chosen idea into tasks we can run in parallel:\n\n1. Define the demo path first — the exact clicks the judges will see.\n2. Break it into 4–8 tasks that touch different files so sessions don't collide.\n3. Mark what's must-have for the demo vs nice-to-have.\n4. Save it with save_plan so the tasks land on the board.\n"),
    ("finalize", "# Finalize\n\nWe're close to the deadline:\n\n1. Check every session's changes (get_diff) — flag anything risky or half-done.\n2. Decide what to cut so the demo path is rock solid.\n3. Make sure it deploys and the demo works end to end.\n4. List the final fixes in priority order.\n"),
    ("pitch", "# Pitch\n\nHelp me write the pitch and demo:\n\n1. One-line hook: who it's for and the problem.\n2. Demo script: the exact clicks, under 2 minutes, wow moment early.\n3. Why us / why now, plus the tech that makes it work (from what we built — read the sessions).\n4. Likely judge questions and crisp answers.\n\nOutput a 3-minute script and a 5-slide outline.\n"),
];

fn root() -> PathBuf {
    crate::grillme_root()
}

/// Seed missing skill playbooks. (The MCP server used to be a Node script
/// installed to ~/.grillme/bin; it's now `<this binary> --mcp`. A leftover
/// grillme-mcp.mjs is left in place so hooks written by older builds keep
/// working until they're rewritten.)
pub(crate) fn install() {
    let skills = root().join("skills");
    let _ = std::fs::create_dir_all(&skills);
    for (id, body) in DEFAULT_SKILLS {
        let p = skills.join(format!("{id}.md"));
        if !p.exists() {
            let _ = std::fs::write(p, body);
        }
    }
}

thread_local! {
    /// Project a /bridge/push targets (set only for that call's duration).
    static TARGET: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

fn project_dir() -> PathBuf {
    TARGET.with(|t| t.borrow().clone()).unwrap_or_else(crate::grillme_dir)
}

/// `push` into a named project (the MCP server says which one it read from);
/// None = the project open in the app. Unknown ids are refused, not guessed.
pub(crate) fn push_to(project: Option<&str>, kind: &str, item: &Value) -> Result<Value, String> {
    let Some(id) = project else { return push(kind, item) };
    let dir = crate::project_dir_for(id).ok_or_else(|| format!("unknown project {id:?}"))?;
    TARGET.with(|t| *t.borrow_mut() = Some(dir));
    let r = push(kind, item);
    TARGET.with(|t| *t.borrow_mut() = None);
    r
}

fn bridge_path() -> PathBuf {
    project_dir().join("bridge.json")
}

fn load() -> Value {
    let mut v: Value = std::fs::read_to_string(bridge_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}));
    if !v.is_object() {
        v = json!({});
    }
    for k in ["handoffs", "questions", "plans", "notes"] {
        if !v[k].is_array() {
            v[k] = json!([]);
        }
    }
    v
}

fn save(v: &Value) -> Result<(), String> {
    let path = bridge_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_id(kind: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{kind}-{nanos:x}")
}

/// Required, non-empty string field, capped.
fn text(item: &Value, key: &str) -> Result<String, String> {
    let s = item[key].as_str().map(str::trim).unwrap_or("");
    if s.is_empty() {
        return Err(format!("missing {key}"));
    }
    Ok(s.chars().take(TEXT_CAP).collect())
}

fn opt_text(item: &Value, key: &str) -> String {
    item[key].as_str().map(|s| s.trim().chars().take(TEXT_CAP).collect()).unwrap_or_default()
}

/// Keep lists bounded: drop the oldest entries that are no longer pending.
fn trim(list: &mut Vec<Value>) {
    while list.len() > LIST_CAP {
        match list.iter().position(|x| x["status"] != "pending" && x["answered"] != false) {
            Some(i) => {
                list.remove(i);
            }
            None => {
                list.remove(0);
            }
        }
    }
}

/// Apply one write from the MCP server (via the loopback API).
pub(crate) fn push(kind: &str, item: &Value) -> Result<Value, String> {
    if kind == "goal" {
        return set_goal(&text(item, "goal")?);
    }
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    let ts = now_ms();
    let (list, entry) = match kind {
        "handoff" => (
            "handoffs",
            json!({
                "id": new_id("h"), "ts": ts, "status": "pending", "kind": "handoff",
                "session": text(item, "session")?,
                "sessionTitle": opt_text(item, "sessionTitle"),
                "message": text(item, "message")?,
                "userExplanation": text(item, "userExplanation")?,
                // set when the session lives on a teammate's Mac: approving
                // here routes it over the room instead of typing it locally
                "to": opt_text(item, "to"),
                "toName": opt_text(item, "toName"),
            }),
        ),
        "plan" => {
            let tasks: Vec<Value> = item["tasks"]
                .as_array()
                .ok_or("plan needs tasks")?
                .iter()
                .take(20)
                .filter_map(|t| {
                    let title = t["title"].as_str()?.trim();
                    (!title.is_empty()).then(|| {
                        json!({
                            "title": title.chars().take(200).collect::<String>(),
                            "desc": opt_text(t, "desc"),
                            "files": t["files"].as_array().map(|f| f.iter().filter_map(|x| x.as_str()).take(20).collect::<Vec<_>>()).unwrap_or_default(),
                        })
                    })
                })
                .collect();
            if tasks.is_empty() {
                return Err("plan needs at least one task".into());
            }
            (
                "plans",
                json!({ "id": new_id("p"), "ts": ts, "status": "pending", "title": text(item, "title")?, "decision": opt_text(item, "decision"), "tasks": tasks }),
            )
        }
        "question" => (
            "questions",
            json!({
                "id": new_id("q"), "ts": ts, "answered": false,
                "from": text(item, "from")?, "fromTitle": opt_text(item, "fromTitle"),
                "question": text(item, "question")?, "context": opt_text(item, "context"),
            }),
        ),
        "note" => ("notes", json!({ "id": new_id("n"), "ts": ts, "text": text(item, "text")?, "by": opt_text(item, "by") })),
        "answer" => {
            let qid = text(item, "id")?;
            let answer = text(item, "answer")?;
            let qs = v["questions"].as_array_mut().ok_or("corrupt bridge")?;
            let handoff = if let Some(q) = qs.iter_mut().find(|q| q["id"] == qid.as_str()) {
                q["answered"] = json!(true);
                q["answer"] = json!(answer);
                json!({
                    "id": new_id("h"), "ts": ts, "status": "pending", "kind": "answer",
                    "session": q["from"], "sessionTitle": q["fromTitle"],
                    "message": format!("Answer from the brainstorm side to your question \"{}\":\n\n{answer}", q["question"].as_str().unwrap_or("")),
                    "userExplanation": "",
                })
            } else {
                // a teammate's question (team-bridge.json): the answer goes back
                // to their session over the room once the user approves it here
                let tq = team_bridge().into_iter()
                    .find(|e| e["kind"] == "question" && e["id"] == qid.as_str() && e["status"] == "pending")
                    .ok_or("no question with that id")?;
                json!({
                    "id": new_id("h"), "ts": ts, "status": "pending", "kind": "answer",
                    "session": tq["session"], "sessionTitle": tq["sessionTitle"],
                    "to": tq["from"], "toName": tq["fromName"], "questionId": qid,
                    "message": format!("Answer from the brainstorm side to your question \"{}\":\n\n{answer}", tq["message"].as_str().unwrap_or("")),
                    "userExplanation": "",
                })
            };
            ("handoffs", handoff)
        }
        _ => return Err(format!("unknown kind {kind}")),
    };
    let arr = v[list].as_array_mut().ok_or("corrupt bridge")?;
    arr.push(entry.clone());
    trim(arr);
    save(&v)?;
    if kind == "note" {
        append_team(json!({ "id": entry["id"], "kind": "note", "ts": ts, "text": entry["text"], "by": entry["by"] }));
    }
    Ok(entry)
}

/// The project's one-line goal in the shared brain.
fn set_goal(goal: &str) -> Result<Value, String> {
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    let ts = now_ms();
    v["goal"] = json!(goal.chars().take(500).collect::<String>());
    v["goalTs"] = json!(ts);
    save(&v)?;
    append_team(json!({ "id": new_id("g"), "kind": "goal", "ts": ts, "text": v["goal"] }));
    Ok(json!({ "goal": v["goal"] }))
}

// ---- team brain -------------------------------------------------------------
// brain.json mirrors every goal change and note as an append-only entry. In
// team mode the room syncs it (room::SYNC_FILES), so teammates' goals and
// notes arrive here; `with_team` overlays them for reading. Solo, it's inert.

fn team_path() -> PathBuf {
    project_dir().join("brain.json")
}

/// Same locked merge-writer the room sync uses, so the two never race.
fn append_team(entry: Value) {
    let _ = crate::upsert_at(&team_path(), vec![entry], &[], false);
}

fn team_bridge() -> Vec<Value> {
    std::fs::read_to_string(project_dir().join("team-bridge.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// An inbound team-bridge item (a hand-off or answer a teammate routed to one
/// of THIS Mac's sessions) becomes a pending local hand-off, keyed by the
/// team id so re-imports are no-ops. An answer to one of our questions also
/// marks that question answered. Returns true when something was added.
#[tauri::command]
pub(crate) fn bridge_import(item: Value) -> Result<bool, String> {
    let id = text(&item, "id")?;
    let kind = text(&item, "kind")?;
    if kind != "handoff" && kind != "answer" {
        return Err("only hand-offs and answers can be imported".into());
    }
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    if v["handoffs"].as_array().is_some_and(|a| a.iter().any(|h| h["id"] == id.as_str())) {
        return Ok(false);
    }
    let session = text(&item, "session")?;
    let message = text(&item, "message")?;
    if kind == "answer" {
        if let Some(qid) = item["questionId"].as_str() {
            if let Some(q) = v["questions"].as_array_mut().and_then(|qs| qs.iter_mut().find(|q| q["id"] == qid)) {
                q["answered"] = json!(true);
                q["answer"] = json!(message);
            }
        }
    }
    let entry = json!({
        "id": id, "ts": now_ms(), "status": "pending", "kind": kind,
        "session": session, "sessionTitle": opt_text(&item, "sessionTitle"),
        "message": message, "userExplanation": opt_text(&item, "userExplanation"),
        "from": opt_text(&item, "fromName"),
    });
    let arr = v["handoffs"].as_array_mut().ok_or("corrupt bridge")?;
    arr.push(entry);
    trim(arr);
    save(&v)?;
    Ok(true)
}

/// Overlay the team's entries on this Mac's bridge: the newest goal from
/// anyone wins, and teammates' notes join ours (deduped by id).
pub(crate) fn with_team(mut v: Value, team: &[Value]) -> Value {
    let ts_of = |e: &Value| e["ts"].as_u64().unwrap_or(0);
    if let Some(g) = team.iter().filter(|e| e["kind"] == "goal").max_by_key(|e| ts_of(e)) {
        if ts_of(g) > v["goalTs"].as_u64().unwrap_or(0) {
            v["goal"] = g["text"].clone();
            v["goalTs"] = g["ts"].clone();
        }
    }
    if let Some(notes) = v["notes"].as_array_mut() {
        let mine: std::collections::HashSet<String> = notes.iter().filter_map(|n| n["id"].as_str().map(str::to_owned)).collect();
        for e in team.iter().filter(|e| e["kind"] == "note") {
            if e["id"].as_str().is_some_and(|id| !mine.contains(id)) {
                notes.push(json!({ "id": e["id"], "ts": e["ts"], "text": e["text"], "by": e["by"] }));
            }
        }
        notes.sort_by_key(|n| n["ts"].as_u64().unwrap_or(0));
    }
    v
}

fn team_entries() -> Vec<Value> {
    std::fs::read_to_string(team_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub(crate) fn bridge_set_goal(goal: String) -> Result<(), String> {
    set_goal(goal.trim()).map(|_| ())
}

fn mcp_exe() -> Result<String, String> {
    crate::mcp::exe_path().ok_or_else(|| "can't locate the Grill Me binary".to_string())
}

/// Run the grill-me MCP binary in a CLI mode for the ACTIVE project.
pub(crate) fn run_script(args: &[&str]) -> Result<String, String> {
    let out = Command::new(mcp_exe()?)
        .arg("--mcp")
        .args(args)
        .env("GRILLME_PROJECT_DIR", crate::grillme_dir())
        .current_dir(root())
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Brain page digest: everything since `since` ms (0 = full picture).
#[tauri::command(async)]
pub(crate) fn brain_digest(since: u64) -> Result<String, String> {
    install();
    run_script(&["--digest", &since.to_string()])
}

/// Hook command a Claude Code session runs to receive shared-brain updates
/// (stdout is added to its context). None when the binary can't be located.
pub(crate) fn sync_hook_command(member_id: &str, project_dir: &str) -> Option<String> {
    Some(format!(
        "{} --mcp --sync {} --project {}",
        crate::sh_quote(&crate::mcp::exe_path()?),
        member_id,
        crate::sh_quote(project_dir)
    ))
}


// ---- AI checks: mismatch + board, and "what should we cut?" ---------------

const CHECK_PROMPT: &str = "You check one coding session's latest turn against the team's plan. \
The input JSON has the goal, decisions, open tasks (with ids), the session's latest turn (user ask, tools used, reply) and changed files. \
Reply with ONLY a JSON object, no prose, no fences: \
{\"mismatch\": boolean, \"reason\": string, \"doneTaskIds\": string[], \"startedTaskIds\": string[]}. \
mismatch = true ONLY when the work clearly contradicts a decision or the goal (e.g. decision says Google login, session builds email login); \
different-but-compatible work is NOT a mismatch. reason = one short sentence naming the decision and what the session did (empty if no mismatch). \
doneTaskIds = ids of open tasks this turn clearly finished (never a task whose work is the mismatch); startedTaskIds = ids of not-started tasks it clearly began. \
Only use ids from the input. When unsure, leave it out.";

const CUT_PROMPT: &str = "You are the deadline coach for a hackathon team. The input JSON has the time left, goal, decisions, open tasks and what each session is doing. \
Write a short markdown plan with exactly three sections: '## Must finish' (what the demo cannot work without), \
'## Nice if time' and '## Cut' (what to drop now). Be blunt and specific, use the task names, and keep the whole thing under 150 words. \
Output only the markdown.";

/// One-shot claude call for Grill Me's own checks: no tools, no user
/// settings/hooks, prompt via argv ("$@", never shell-interpreted), data on stdin.
fn claude_quick(input: &str, prompt: &str, model: &str) -> Result<String, String> {
    use std::io::Write as _;
    use std::process::Stdio;
    crate::preflight_claude()?;
    let mut child = Command::new("/bin/zsh")
        .args(["-lc", "exec claude \"$@\"", "zsh", "-p", prompt, "--tools", "", "--setting-sources", "", "--model", model])
        .current_dir(root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn claude: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// First {...} object in a model reply, tolerant of stray prose/fences.
fn extract_json(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then(|| serde_json::from_str(&text[start..=end]).ok()).flatten()
}

fn id_list(v: &Value, allowed: &[String]) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str()).filter(|x| allowed.iter().any(|y| y == x)).take(20).map(str::to_owned).collect())
        .unwrap_or_default()
}

/// After a session's turn: does it contradict the plan, and which tasks did
/// it finish/start? A mismatch is also written to the brain as a note, so
/// the session (via its sync hook) and the Claude side both see it.
#[tauri::command(async)]
pub(crate) fn brain_check(app: tauri::AppHandle, member_id: String) -> Result<Value, String> {
    use tauri::Emitter;
    crate::validate_member_id(&member_id)?;
    install();
    let input = run_script(&["--check-input", &member_id])?;
    if input.trim().is_empty() {
        return Ok(Value::Null);
    }
    let parsed: Value = serde_json::from_str(&input).unwrap_or_default();
    let session = parsed["session"].as_str().unwrap_or(&member_id).to_string();
    let allowed: Vec<String> = parsed["openTasks"]
        .as_array()
        .map(|a| a.iter().filter_map(|t| t["id"].as_str().map(str::to_owned)).collect())
        .unwrap_or_default();
    let reply = claude_quick(&input, CHECK_PROMPT, "haiku")?;
    let r = extract_json(&reply).ok_or("check returned no JSON")?;
    let reason: String = r["reason"].as_str().unwrap_or("").trim().chars().take(300).collect();
    let mismatch = r["mismatch"].as_bool().unwrap_or(false) && !reason.is_empty();
    if mismatch {
        push("note", &json!({ "text": format!("⚠ Mismatch in {session}: {reason}"), "by": "Mismatch check" }))?;
        let _ = app.emit("bridge-changed", ());
    }
    Ok(json!({
        "session": session,
        "mismatch": mismatch,
        "reason": reason,
        "doneTaskIds": id_list(&r["doneTaskIds"], &allowed),
        "startedTaskIds": id_list(&r["startedTaskIds"], &allowed),
    }))
}

/// "What should we cut?" — must / nice / cut plan against the hack clock.
#[tauri::command(async)]
pub(crate) fn brain_cut() -> Result<String, String> {
    install();
    let input = run_script(&["--cut-input"])?;
    claude_quick(&input, CUT_PROMPT, "sonnet")
}

// ---- round 3: pitch writer, code quiz, hackathon wrap-up -------------------

const PITCH_PROMPT: &str = "You write hackathon pitches from what a team ACTUALLY built. The input JSON has the goal, decisions, README, \
each session's commits and recent work, and the team's pitch playbook (follow it when present). \
Write markdown with exactly these sections: '## One-liner', '## The problem', '## Demo script' (numbered steps, the exact clicks, under 2 minutes, wow moment early), \
'## Devpost' (What it does / How we built it / Challenges / What's next — short paragraphs), '## Judge Q&A' (4 likely questions with crisp answers). \
Never invent features that aren't in the work. Output only the markdown.";

const QUIZ_PROMPT: &str = "You quiz a beginner-to-intermediate developer on code an AI agent wrote for them, so they truly understand it. \
The input JSON has the session's commits, changed files, diff and recent work. Write 4 multiple-choice questions about what the code does, \
why it was done that way, and what would break if changed — grounded in the actual diff, not trivia. \
Reply with ONLY JSON, no prose, no fences: {\"questions\": [{\"q\": string, \"choices\": [string, string, string, string], \"answer\": 0-3, \"why\": string}]}. \
Keep each question and choice short.";

const WRAPUP_PROMPT: &str = "You capture lessons from a finished hackathon project so the next one goes better. The input JSON has the goal, \
decisions, notes, tasks and each session's commits and recent work. Reply with ONLY JSON, no prose, no fences: \
{\"summary\": string (one sentence: what we built), \"stack\": string[], \"worked\": string[], \"mistakes\": string[], \"reuse\": string[] (setups, snippets, or services worth reusing)}. \
Max 5 short items per list, grounded in the input.";

const KICKOFF_PROMPT: &str = "You kick off a hackathon build. The input JSON has the team's idea, hours available, how many parallel coding sessions they can run, \
the repo README (may be empty for a fresh project), lessons from past hackathons, and their brainstorm/breakdown playbooks. \
Turn the idea into a sharp plan: a one-line goal (what, for whom, the wow moment), the key decision behind the approach, and up to `maxSessions` tasks \
that can be built IN PARALLEL by separate AI coding sessions — each owning different files so they don't collide, the first task being the demo-path skeleton. \
For each task write a self-contained brief for the coding agent (what to build, files it owns, done-when). Respect the hours: cut scope hard. \
Reply with ONLY JSON, no prose, no fences: {\"goal\": string, \"decision\": string, \"tasks\": [{\"title\": string, \"files\": string[], \"brief\": string}]}.";

/// One-click hackathon start: idea → goal, decision, parallel task briefs.
#[tauri::command(async)]
pub(crate) fn brain_kickoff(idea: String, hours: u32, max_sessions: u32) -> Result<Value, String> {
    let idea = idea.trim();
    if idea.is_empty() || idea.len() > 5000 {
        return Err("describe the idea (under 5000 characters)".into());
    }
    install();
    let mut input: Value = serde_json::from_str(&run_script(&["--kickoff-input"])?).unwrap_or_else(|_| json!({}));
    input["idea"] = json!(idea);
    input["hours"] = json!(hours.clamp(1, 72));
    input["maxSessions"] = json!(max_sessions.clamp(1, 6));
    let r = extract_json(&claude_quick(&input.to_string(), KICKOFF_PROMPT, "sonnet")?).ok_or("plan came back empty — try again")?;
    let tasks: Vec<Value> = r["tasks"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|t| {
                    let title = t["title"].as_str()?.trim();
                    (!title.is_empty()).then(|| json!({
                        "title": title.chars().take(120).collect::<String>(),
                        "files": t["files"].as_array().map(|f| f.iter().filter_map(|x| x.as_str()).take(20).collect::<Vec<_>>()).unwrap_or_default(),
                        "brief": t["brief"].as_str().unwrap_or("").chars().take(4000).collect::<String>(),
                    }))
                })
                .take(max_sessions.clamp(1, 6) as usize)
                .collect()
        })
        .unwrap_or_default();
    if tasks.is_empty() {
        return Err("plan had no tasks — try again with more detail".into());
    }
    Ok(json!({
        "goal": r["goal"].as_str().unwrap_or("").chars().take(500).collect::<String>(),
        "decision": r["decision"].as_str().unwrap_or("").chars().take(1000).collect::<String>(),
        "tasks": tasks,
    }))
}

/// Pitch: one-liner, demo script, Devpost text, judge Q&A — from real work.
#[tauri::command(async)]
pub(crate) fn brain_pitch() -> Result<String, String> {
    install();
    claude_quick(&run_script(&["--pitch-input"])?, PITCH_PROMPT, "sonnet")
}

/// Code quiz on one session's changes. Returns validated questions.
#[tauri::command(async)]
pub(crate) fn brain_quiz(member_id: String) -> Result<Value, String> {
    crate::validate_member_id(&member_id)?;
    install();
    let input = run_script(&["--quiz-input", &member_id])?;
    if input.trim().is_empty() {
        return Err("That session hasn't changed any code yet.".into());
    }
    let r = extract_json(&claude_quick(&input, QUIZ_PROMPT, "sonnet")?).ok_or("quiz came back empty")?;
    let questions: Vec<Value> = r["questions"]
        .as_array()
        .map(|qs| {
            qs.iter()
                .filter_map(|q| {
                    let choices: Vec<&str> = q["choices"].as_array()?.iter().filter_map(|c| c.as_str()).collect();
                    let answer = q["answer"].as_u64()? as usize;
                    (choices.len() == 4 && answer < 4 && q["q"].is_string())
                        .then(|| json!({ "q": q["q"], "choices": choices, "answer": answer, "why": q["why"].as_str().unwrap_or("") }))
                })
                .take(6)
                .collect()
        })
        .unwrap_or_default();
    if questions.is_empty() {
        return Err("quiz came back malformed — try again".into());
    }
    Ok(json!({ "questions": questions }))
}

static LESSONS_LOCK: Mutex<()> = Mutex::new(());

fn str_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str()).take(5).map(|x| x.chars().take(200).collect()).collect())
        .unwrap_or_default()
}

/// Wrap up the active project: Claude distills lessons, saved to
/// ~/.grillme/lessons.json (one entry per project, replaced on re-run).
/// Future projects' sessions and chats get them in their first catch-up.
#[tauri::command(async)]
pub(crate) fn brain_wrapup(project_id: String, project_name: String) -> Result<Value, String> {
    install();
    let r = extract_json(&claude_quick(&run_script(&["--wrapup-input"])?, WRAPUP_PROMPT, "sonnet")?)
        .ok_or("wrap-up came back empty")?;
    let secs = now_ms() / 1000;
    let entry = json!({
        "project": project_id,
        "name": project_name.chars().take(80).collect::<String>(),
        "date": format!("{}", secs), // epoch secs; UI formats it
        "summary": r["summary"].as_str().unwrap_or("").chars().take(300).collect::<String>(),
        "stack": str_list(&r["stack"]),
        "worked": str_list(&r["worked"]),
        "mistakes": str_list(&r["mistakes"]),
        "reuse": str_list(&r["reuse"]),
    });
    let _g = crate::lock_or_recover(&LESSONS_LOCK);
    let path = root().join("lessons.json");
    let mut all: Vec<Value> = read_json(&path).and_then(|v| v.as_array().cloned()).unwrap_or_default();
    all.retain(|l| l["project"] != entry["project"]);
    all.push(entry.clone());
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(entry)
}

/// Hack clock end (epoch ms; 0 clears) — the brain tells sessions time left.
#[tauri::command]
pub(crate) fn bridge_set_deadline(ms: u64) -> Result<(), String> {
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    v["deadline"] = if ms == 0 { Value::Null } else { json!(ms) };
    save(&v)
}

/// A note from the Grill Me UI (e.g. saving the cut plan to the brain).
#[tauri::command]
pub(crate) fn bridge_add_note(text: String, by: String) -> Result<(), String> {
    push("note", &json!({ "text": text, "by": by })).map(|_| ())
}

#[tauri::command]
pub(crate) fn bridge_read() -> String {
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    live::scrub(with_team(load(), &team_entries())).to_string()
}

/// Mark a handoff/plan resolved (sent, applied, dismissed) or a question dismissed.
#[tauri::command]
pub(crate) fn bridge_resolve(list: String, id: String, status: String) -> Result<(), String> {
    if !["handoffs", "plans", "questions"].contains(&list.as_str()) {
        return Err("bad list".into());
    }
    if !["sent", "applied", "dismissed"].contains(&status.as_str()) {
        return Err("bad status".into());
    }
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    let item = v[list.as_str()]
        .as_array_mut()
        .and_then(|a| a.iter_mut().find(|x| x["id"] == id.as_str()))
        .ok_or("not found")?;
    if list == "questions" {
        item["answered"] = json!(true);
        item["dismissed"] = json!(true);
    } else {
        item["status"] = json!(status);
    }
    save(&v)
}

// ---- connect to Claude app + Claude Code -----------------------------------

fn desktop_config() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join("Library/Application Support/Claude");
    dir.exists().then(|| dir.join("claude_desktop_config.json"))
}

fn read_json(p: &PathBuf) -> Option<Value> {
    std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
pub(crate) fn bridge_status() -> Value {
    let desktop = desktop_config()
        .and_then(|p| read_json(&p))
        .map(|c| c["mcpServers"][SERVER_NAME].is_object())
        .unwrap_or(false);
    let code = std::env::var("HOME")
        .ok()
        .and_then(|h| read_json(&PathBuf::from(h).join(".claude.json")))
        .map(|c| c["mcpServers"][SERVER_NAME].is_object())
        .unwrap_or(false);
    json!({ "desktop": desktop, "code": code, "desktopInstalled": desktop_config().is_some() })
}

/// Register the grill-me MCP server with the Claude desktop app (its config
/// file, backed up first) and Claude Code (user scope). Returns a summary.
#[tauri::command(async)]
pub(crate) fn bridge_connect() -> Result<String, String> {
    install();
    let exe = mcp_exe()?;
    let mut done = Vec::new();

    if let Some(cfg_path) = desktop_config() {
        let mut cfg = if cfg_path.exists() {
            // never clobber a config we can't parse
            read_json(&cfg_path).ok_or("Claude app config isn't valid JSON — left untouched.")?
        } else {
            json!({})
        };
        let backup = cfg_path.with_file_name("claude_desktop_config.grillme-backup.json");
        if cfg_path.exists() && !backup.exists() {
            let _ = std::fs::copy(&cfg_path, &backup);
        }
        if !cfg["mcpServers"].is_object() {
            cfg["mcpServers"] = json!({});
        }
        cfg["mcpServers"][SERVER_NAME] = json!({ "command": exe, "args": ["--mcp"] });
        std::fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)
            .map_err(|e| format!("couldn't write Claude app config: {e}"))?;
        done.push("Claude app (restart it to load)");
    }

    if let Ok(claude) = crate::preflight_claude() {
        let _ = Command::new(&claude).args(["mcp", "remove", "--scope", "user", SERVER_NAME]).output();
        let out = Command::new(&claude)
            .args(["mcp", "add", "--scope", "user", SERVER_NAME, "--", &exe, "--mcp"])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            done.push("Claude Code (new sessions)");
        } else {
            return Err(format!("claude mcp add failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
    }

    if done.is_empty() {
        return Err("Neither the Claude app nor Claude Code was found.".into());
    }
    Ok(format!("Connected: {}", done.join(", ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_requires_and_caps() {
        assert!(text(&json!({}), "x").is_err());
        assert!(text(&json!({"x": "   "}), "x").is_err());
        let long = "a".repeat(TEXT_CAP + 50);
        assert_eq!(text(&json!({ "x": long }), "x").unwrap().len(), TEXT_CAP);
    }

    #[test]
    fn trim_drops_resolved_before_pending() {
        let mut list: Vec<Value> = (0..LIST_CAP).map(|i| json!({"id": i, "status": "pending"})).collect();
        list.insert(5, json!({"id": "old", "status": "sent"}));
        trim(&mut list);
        assert_eq!(list.len(), LIST_CAP);
        assert!(list.iter().all(|x| x["id"] != "old"));
    }

    #[test]
    fn extracts_json_from_chatty_replies() {
        let v = extract_json("Sure!\n```json\n{\"mismatch\": true, \"reason\": \"x\"}\n```").unwrap();
        assert_eq!(v["mismatch"], true);
        assert!(extract_json("no json here").is_none());
    }

    #[test]
    fn id_list_only_keeps_known_ids() {
        let allowed = vec!["t1".to_string(), "t2".to_string()];
        assert_eq!(id_list(&json!(["t1", "evil", 3, "t2"]), &allowed), vec!["t1", "t2"]);
        assert!(id_list(&json!("t1"), &allowed).is_empty());
    }

    #[test]
    fn skills_are_embedded() {
        assert_eq!(DEFAULT_SKILLS.len(), 6);
    }

    #[test]
    fn sync_hook_runs_this_binary_in_mcp_mode() {
        let cmd = sync_hook_command("s1", "/Users/x/.grillme/projects/p").unwrap();
        assert!(cmd.contains(" --mcp --sync s1 --project '/Users/x/.grillme/projects/p'"), "{cmd}");
        assert!(!cmd.contains("node") && !cmd.contains(".mjs"), "{cmd}");
    }
}

#[cfg(test)]
mod team_brain_tests {
    use serde_json::json;

    #[test]
    fn newest_goal_wins_and_team_notes_join() {
        let local = json!({ "goal": "mine", "goalTs": 100, "notes": [{ "id": "n-1", "ts": 50, "text": "a" }] });
        let team = vec![
            json!({ "id": "g-1", "kind": "goal", "ts": 90, "text": "older" }),
            json!({ "id": "g-2", "kind": "goal", "ts": 200, "text": "team goal" }),
            json!({ "id": "n-1", "kind": "note", "ts": 50, "text": "a" }),
            json!({ "id": "n-2", "kind": "note", "ts": 10, "text": "from Maya", "by": "Maya" }),
        ];
        let v = super::with_team(local, &team);
        assert_eq!(v["goal"], "team goal");
        let notes = v["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 2, "own note not duplicated");
        assert_eq!(notes[0]["text"], "from Maya", "sorted by time");
    }

    #[test]
    fn local_goal_kept_when_newer() {
        let v = super::with_team(json!({ "goal": "mine", "goalTs": 300, "notes": [] }), &[json!({ "id": "g", "kind": "goal", "ts": 200, "text": "old" })]);
        assert_eq!(v["goal"], "mine");
    }
}
