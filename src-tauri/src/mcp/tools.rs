// ---------------------------------------------------------------------------
// MCP tools + JSON-RPC dispatch (shared by stdio and HTTP).
// ---------------------------------------------------------------------------

use super::data::{eq_str, find_team_session, read_json_or, read_list, ship_verdict, Ctx};
use super::js::{self, clip, get, nn, to_str, truthy};
use super::redact::redact;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

pub const SERVER_NAME: &str = "grill-me";
pub const SERVER_VERSION: &str = "1.0.0";
pub const PROTOCOLS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

const ROLE_NOTE: &str = "Brainstorm side = the Claude app. Coder side = a Claude Code session running inside a Grill Me worktree.";

/// Hackathon playbooks, shared with Grill Me's composer: (id, title, description).
pub const SKILLS: [(&str, &str, &str); 6] = [
    ("prep", "Prep hack", "Before the event: stack, repo, rules"),
    ("intra", "Intra-hack", "Keep the team on track mid-build"),
    ("brainstorm", "Brainstorm", "Generate and pick an idea"),
    ("breakdown", "Breakdown", "Split the idea into tasks"),
    ("finalize", "Finalize", "Polish, fix, cut scope"),
    ("pitch", "Pitch", "Demo script and slides"),
];

pub const WRITE_TOOLS: [&str; 5] = ["save_plan", "send_to_coder", "ask_brainstorm", "answer_question", "set_goal"];
// Writes that land as PENDING items the user approves in Grill Me. The rest
// (goal, notes, questions) flow straight into every session's context, so
// they're never allowed from the internet — even with proposals on.
pub const REMOTE_PROPOSALS: [&str; 3] = ["save_plan", "send_to_coder", "answer_question"];

// MCP tool annotations: clients (claude.ai, Claude Code) use readOnlyHint to
// skip the permission prompt on reads and to flag the tools that change things.
// Nothing here reaches outside the Mac, so openWorldHint is false everywhere.
const TITLES: [(&str, &str); 16] = [
    ("whats_new", "What's new in my sessions"),
    ("read_session", "Read a session"),
    ("get_diff", "Get a session's diff"),
    ("get_plan", "Get the plan"),
    ("save_plan", "Propose a plan"),
    ("send_to_coder", "Hand a task to a session"),
    ("ask_brainstorm", "Ask the brainstorm side"),
    ("open_questions", "Open questions"),
    ("answer_question", "Answer a coder's question"),
    ("notes", "Shared notes"),
    ("past_lessons", "Past lessons"),
    ("catch_up", "Catch up"),
    ("set_goal", "Set the project goal"),
    ("team_status", "Team status"),
    ("ship_status", "Ship status"),
    ("list_projects", "List projects"),
];
const IDEMPOTENT: [&str; 1] = ["set_goal"];

/// The tool definitions, verbatim from the Node server (name, description,
/// inputSchema — key order matters for byte-identical tools/list output).
fn tools() -> &'static Vec<Value> {
    static T: OnceLock<Vec<Value>> = OnceLock::new();
    T.get_or_init(|| serde_json::from_str(include_str!("tools.json")).expect("tools.json"))
}

fn name_of(t: &Value) -> &str {
    get(t, "name").and_then(Value::as_str).unwrap_or("")
}

pub fn annotate(ctx: &Ctx, tool: &Value) -> Value {
    let name = name_of(tool);
    // remotely, notes is read-only (add is refused at call time)
    let write = WRITE_TOOLS.contains(&name) || (name == "notes" && !ctx.remote.on);
    let mut t = tool.as_object().cloned().unwrap_or_default();
    let title = TITLES.iter().find(|(n, _)| *n == name).map(|(_, t)| *t).unwrap_or(name);
    t.insert(
        "annotations".into(),
        json!({
            "title": title,
            "readOnlyHint": !write,
            "destructiveHint": false,
            "idempotentHint": !write || IDEMPOTENT.contains(&name),
            "openWorldHint": false,
        }),
    );
    Value::Object(t)
}

fn with_project_arg(mut t: Value) -> Value {
    if name_of(&t) == "list_projects" {
        return t;
    }
    let arg = json!({ "type": "string", "description": "Grill Me project name or id (see list_projects). Omit for the project open in the app." });
    if let Some(schema) = t.get_mut("inputSchema").and_then(Value::as_object_mut) {
        let props = schema.entry("properties").or_insert_with(|| json!({}));
        if let Some(p) = props.as_object_mut() {
            p.insert("project".into(), arg);
        }
    }
    t
}

pub fn tools_for(ctx: &Ctx) -> Vec<Value> {
    tools()
        .iter()
        .filter(|t| {
            let n = name_of(t);
            !ctx.remote.on || !WRITE_TOOLS.contains(&n) || (ctx.remote.allow_writes && REMOTE_PROPOSALS.contains(&n))
        })
        .map(|t| with_project_arg(annotate(ctx, t)))
        .collect()
}

/// Every text that goes to the app: `push(kind, item)` through the loopback API.
fn push(ctx: &Ctx, kind: &str, item: Value) -> Result<(), String> {
    super::http::push(ctx, kind, item)
}

fn s(v: Option<&Value>) -> String {
    to_str(v)
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

pub fn call_tool(ctx: &Ctx, name: &str, args: &Value) -> Result<String, String> {
    let me = ctx.self_member();
    let arg = |k: &str| get(args, k);
    match name {
        "whats_new" => {
            let all = ctx.members();
            if all.is_empty() {
                return Ok("No sessions — open a project in Grill Me first.".into());
            }
            let b = ctx.bridge_state();
            let list = |k: &str| get(&b, k).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut waiting: Vec<String> = Vec::new();
            for q in list("questions").iter().filter(|q| !truthy(get(q, "answered"))) {
                waiting.push(format!("- QUESTION from {} (id {}): {}", s(nn(get(q, "fromTitle")).or(get(q, "from"))), s(get(q, "id")), s(get(q, "question"))));
            }
            for h in list("handoffs").iter().filter(|h| eq_str(get(h, "status"), Some("pending"))) {
                waiting.push(format!("- handoff to {} waiting for the user's OK", s(get(h, "session"))));
            }
            for p in list("plans").iter().filter(|p| eq_str(get(p, "status"), Some("pending"))) {
                waiting.push(format!("- plan \"{}\" waiting for the user's OK", s(get(p, "title"))));
            }
            let you = me.as_ref().map(|m| format!(" You are the coder session \"{}\".", ctx.label(m))).unwrap_or_default();
            let mut parts = vec![format!("Project: {}. {ROLE_NOTE}{you}", ctx.project_dir().id)];
            for m in &all {
                parts.push(session_card(ctx, m)?);
            }
            parts.push(if waiting.is_empty() { "Nothing waiting.".into() } else { format!("## Waiting\n{}", waiting.join("\n")) });
            Ok(parts.join("\n\n"))
        }
        "read_session" => {
            let Some(m) = ctx.find_session(arg("session"))? else {
                return Ok(format!("No session \"{}\". Call whats_new for the list.", s(arg("session"))));
            };
            let t = js::to_num(arg("turns"));
            let n = 10f64.min(1f64.max(if t == 0.0 || t.is_nan() { 3.0 } else { t }));
            let ts = ctx.turns(&m)?.0;
            if ts.is_empty() {
                return Ok(format!("{} has no conversation yet.", ctx.label(&m)));
            }
            // ts.slice(-n) with a fractional n truncates, the numbering doesn't
            let take = n.trunc() as usize;
            let first = ts.len() as f64 - n.min(ts.len() as f64);
            Ok(js::tail(&ts, take)
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    let at = if truthy(t.at.as_ref()) { format!(" ({})", s(t.at.as_ref())) } else { String::new() };
                    let mut lines = vec![format!("## Turn {}{at}", js::num_str(first + i as f64 + 1.0)), format!("USER: {}", clip(&t.ask, 1500))];
                    if !t.tools.is_empty() {
                        lines.push(format!("TOOLS: {}", clip(&t.tools.join(", "), 800)));
                    }
                    lines.push(if t.reply.is_empty() { "CLAUDE: (no reply yet)".into() } else { format!("CLAUDE: {}", clip(&t.reply, 3000)) });
                    lines.join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n"))
        }
        "get_diff" => {
            let Some(m) = ctx.find_session(arg("session"))? else {
                return Ok(format!("No session \"{}\".", s(arg("session"))));
            };
            let d = ctx.diff_of(&m)?;
            let mut parts = vec![
                format!("Session {} on {}{}", ctx.label(&m), d.branch, if d.base.is_empty() { String::new() } else { format!(" (vs {})", d.base) }),
                if d.log.is_empty() { "No commits beyond the base branch.".into() } else { format!("## Commits\n{}", d.log) },
                if d.stat.is_empty() { "No changes.".into() } else { format!("## Files\n{}", d.stat) },
            ];
            if !d.diff.is_empty() {
                parts.push(format!("## Diff\n{}", clip(&d.diff, 24000)));
            }
            Ok(parts.join("\n\n"))
        }
        "past_lessons" => {
            let l = ctx.lessons_text(None, 20)?;
            Ok(if l.is_empty() { "No past hackathons wrapped up yet.".into() } else { l })
        }
        "get_plan" => {
            let dir = ctx.project_dir().dir;
            let decisions = read_list(&dir.join("decisions.json"));
            let tasks: Vec<Value> = read_list(&dir.join("tasks.json")).into_iter().filter(|t| !eq_str(get(t, "status"), Some("done"))).collect();
            let notes = ctx.bridge_state().get("notes").and_then(Value::as_array).cloned().unwrap_or_default();
            let parts = [
                if decisions.is_empty() {
                    "No decisions yet.".to_string()
                } else {
                    format!("## Decisions\n{}", js::tail(&decisions, 10).iter().map(|d| format!("- {}", s(get(d, "text")))).collect::<Vec<_>>().join("\n"))
                },
                if tasks.is_empty() {
                    "No open tasks.".to_string()
                } else {
                    format!(
                        "## Open tasks\n{}",
                        tasks
                            .iter()
                            .map(|t| {
                                let owner = if truthy(get(t, "owner")) { format!(" ({})", s(get(t, "owner"))) } else { String::new() };
                                format!("- [{}] {}{owner}", s(get(t, "status")), s(get(t, "title")))
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    )
                },
                if notes.is_empty() {
                    String::new()
                } else {
                    format!("## Notes\n{}", js::tail(&notes, 15).iter().map(|n| format!("- {}", s(get(n, "text")))).collect::<Vec<_>>().join("\n"))
                },
            ];
            Ok(parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join("\n\n"))
        }
        "save_plan" => {
            let tasks = match arg("tasks") {
                Some(Value::Array(a)) if !a.is_empty() => a,
                _ => return Err("A plan needs at least one task.".into()),
            };
            let decision = if truthy(arg("decision")) { s(arg("decision")) } else { String::new() };
            push(ctx, "plan", json!({ "title": s(arg("title")), "decision": decision, "tasks": js::head(tasks, 20) }))?;
            Ok("Plan sent to Grill Me — the user approves it there, then the tasks land on the board and the decision is logged.".into())
        }
        "send_to_coder" => {
            let m = ctx.find_session(arg("session"))?;
            // not one of ours? maybe a teammate's session, shared over the room
            let team = if m.is_some() { None } else { find_team_session(arg("session"), &ctx.team_sessions()) };
            if m.is_none() && team.is_none() {
                return Ok(format!("No session \"{}\". Call whats_new (yours) or team_status (teammates') for the list.", s(arg("session"))));
            }
            let exp_raw = match nn(arg("user_explanation")) {
                None => String::new(),
                v => s(v),
            };
            let exp = js::trim(&exp_raw).to_string();
            if js::len16(&exp) < 40 || exp == js::trim(&s(arg("message"))) {
                return Err("Grill gate: ask the user to explain the plan back in their own words (a few sentences) and pass that as user_explanation.".into());
            }
            if let Some(team) = team {
                let (member_name, title) = (s(get(&team, "memberName")), s(get(&team, "title")));
                let mut item = Map::new();
                for (k, v) in [
                    ("session", get(&team, "session").cloned()),
                    ("sessionTitle", get(&team, "title").cloned()),
                    ("message", Some(json!(s(arg("message"))))),
                    ("userExplanation", Some(json!(exp))),
                    ("to", get(&team, "member").cloned()),
                    ("toName", get(&team, "memberName").cloned()),
                ] {
                    if let Some(v) = v {
                        item.insert(k.into(), v);
                    }
                }
                push(ctx, "handoff", Value::Object(item))?;
                return Ok(format!(
                    "Handoff to {member_name}'s \"{title}\" is waiting for the user's OK in Grill Me; {member_name} approves it on their side before it's typed in."
                ));
            }
            let m = m.expect("session");
            let mut item = Map::new();
            if let Some(id) = get(&m, "id") {
                item.insert("session".into(), id.clone());
            }
            item.insert("sessionTitle".into(), ctx.label_v(&m));
            item.insert("message".into(), json!(s(arg("message"))));
            item.insert("userExplanation".into(), json!(exp));
            push(ctx, "handoff", Value::Object(item))?;
            Ok(format!("Handoff to {} is waiting for the user's OK in Grill Me.", ctx.label(&m)))
        }
        "ask_brainstorm" => {
            let from = me.as_ref().and_then(|m| nn(get(m, "id")).cloned()).unwrap_or(json!("unknown"));
            let from_title = me.as_ref().map(|m| ctx.label_v(m)).unwrap_or_else(|| json!("a session"));
            let context = if truthy(arg("context")) { s(arg("context")) } else { String::new() };
            push(ctx, "question", json!({ "from": from, "fromTitle": from_title, "question": s(arg("question")), "context": context }))?;
            Ok("Question sent. Keep working on anything that doesn't depend on it — the answer arrives in this session once the user approves it.".into())
        }
        "open_questions" => {
            let b = ctx.bridge_state();
            let q: Vec<Value> = get(&b, "questions")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter(|x| !truthy(get(x, "answered"))).cloned().collect())
                .unwrap_or_default();
            let ctx_line = |x: &Value| if truthy(get(x, "context")) { format!("\n  context: {}", s(get(x, "context"))) } else { String::new() };
            let mut lines: Vec<String> = q
                .iter()
                .map(|x| format!("- id {} from {}: {}{}", s(get(x, "id")), s(nn(get(x, "fromTitle")).or(get(x, "from"))), s(get(x, "question")), ctx_line(x)))
                .collect();
            // teammates' coders ask the whole team; answering one routes back to their Mac
            let mine: Vec<Value> = q.iter().map(|x| get(x, "id").cloned().unwrap_or(Value::Null)).collect();
            for t in ctx.team_questions(&mine) {
                lines.push(format!(
                    "- id {} from {}'s \"{}\" (teammate): {}{}",
                    s(get(&t, "id")),
                    s(get(&t, "fromName")),
                    s(nn(get(&t, "sessionTitle")).or(get(&t, "session"))),
                    s(get(&t, "message")),
                    ctx_line(&t)
                ));
            }
            Ok(if lines.is_empty() { "No open questions.".into() } else { lines.join("\n") })
        }
        "answer_question" => {
            push(ctx, "answer", json!({ "id": s(arg("id")), "answer": s(arg("answer")) }))?;
            Ok("Answer sent — it goes back to the coder after the user approves it in Grill Me.".into())
        }
        "notes" => {
            if eq_str(arg("action"), Some("add")) {
                if !truthy(arg("text")) {
                    return Err("text is required to add a note".into());
                }
                let by = me.as_ref().map(|m| ctx.label_v(m)).unwrap_or_else(|| json!("Claude app"));
                push(ctx, "note", json!({ "text": s(arg("text")), "by": by }))?;
                return Ok("Note added.".into());
            }
            let n = ctx.bridge_state().get("notes").and_then(Value::as_array).cloned().unwrap_or_default();
            Ok(if n.is_empty() {
                "No notes yet.".into()
            } else {
                js::tail(&n, 30)
                    .iter()
                    .map(|x| {
                        let by = if truthy(get(x, "by")) { format!(" ({})", s(get(x, "by"))) } else { String::new() };
                        format!("- {}{by}", s(get(x, "text")))
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
        }
        "catch_up" => {
            let key = if ctx.remote.on { "remote" } else { "app" };
            let since = if truthy(arg("hours")) { js::now_ms() - js::to_num(arg("hours")) * 3_600_000.0 } else { ctx.cursor(key) };
            let text = ctx.catch_up(since, None, since == 0.0)?;
            ctx.set_cursor(key, js::now_ms());
            Ok(if text.is_empty() { "Nothing new since last time.".into() } else { text })
        }
        "set_goal" => {
            push(ctx, "goal", json!({ "goal": s(arg("goal")) }))?;
            Ok("Goal saved to the shared brain.".into())
        }
        "list_projects" => {
            let open = ctx.project_dir().id;
            let mut list = vec![("default".to_string(), "default".to_string())];
            list.extend(ctx.project_list().into_iter().filter(|(id, _)| id != "default"));
            let rows: Vec<String> = list
                .iter()
                .filter_map(|(id, name)| {
                    let r = ctx.resolve_project(id)?;
                    let cfg = read_json_or(&r.dir.join("config.json"), json!({}));
                    let n = get(&cfg, "teammates").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
                    Some(format!("- {name} (id: {id}) · {n} session{}{}", plural(n), if *id == open { " · OPEN" } else { "" }))
                })
                .collect();
            Ok(rows.join("\n"))
        }
        "ship_status" => {
            let all = ctx.members();
            if all.is_empty() {
                return Ok("No sessions — open a project in Grill Me first.".into());
            }
            Ok(all
                .iter()
                .map(|m| {
                    let repo = s(get(m, "repoPath"));
                    let branch = super::data::git(&repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
                    let base = Ctx::base_branch(&repo);
                    let ahead = if !base.is_empty() && base != branch {
                        let n = js::str_to_num(&super::data::git(&repo, &["rev-list", "--count", &format!("{base}..HEAD")]));
                        if n == 0.0 || n.is_nan() { 0.0 } else { n }
                    } else {
                        0.0
                    };
                    let dirty = super::data::changed_files(&repo).len();
                    let tests = ctx.test_result(&repo);
                    let verdict = ship_verdict(&branch, &base, ahead, dirty, tests.as_ref());
                    let ahead_txt = if !base.is_empty() && branch != base {
                        format!(" · {} commit{} ahead of {base}", js::num_str(ahead), if ahead == 1.0 { "" } else { "s" })
                    } else {
                        String::new()
                    };
                    let mut lines = vec![
                        format!("### {}: {verdict}", ctx.label(m)),
                        format!("branch {}{ahead_txt} · {dirty} uncommitted", if branch.is_empty() { "?" } else { &branch }),
                        match &tests {
                            Some(_) => ctx.test_line(&repo).unwrap_or_default(),
                            None => "tests: not run yet (turn on Auto-test in Grill Me → Automations)".into(),
                        },
                    ];
                    if let Some(t) = &tests {
                        if !truthy(get(t, "ok")) && truthy(get(t, "tail")) {
                            lines.push(format!("last test output:\n{}", clip(&s(get(t, "tail")), 800)));
                        }
                    }
                    lines.into_iter().filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n"))
        }
        "team_status" => {
            let root = ctx.root_path();
            let settings = read_json_or(&root.join("settings.json"), json!({}));
            if !eq_str(get(&settings, "appMode"), Some("team")) {
                return Ok("Grill Me is in solo mode — no teammates.".into());
            }
            let room = read_json_or(&root.join("room.json"), json!({}));
            let people = get(&room, "members").and_then(Value::as_array).cloned().unwrap_or_default();
            if people.is_empty() {
                return Ok("No teammates in the room yet.".into());
            }
            let dir = ctx.project_dir().dir;
            let tasks = read_list(&dir.join("tasks.json"));
            // each teammate's Grill Me publishes a digest of its sessions over the room
            let now = js::now_ms();
            let sessions: Vec<Value> = read_list(&dir.join("team-sessions.json"))
                .into_iter()
                .filter(|d| truthy(Some(d)) && now - super::data::num_or0(get(d, "ts")) < 90_000.0)
                .collect();
            Ok(people
                .iter()
                .map(|p| {
                    let pid = get(p, "id");
                    let mine: Vec<&Value> = sessions.iter().filter(|d| strict_eq(get(d, "member"), pid)).collect();
                    let joined = js::join(
                        tasks
                            .iter()
                            .filter(|t| strict_eq(get(t, "owner"), pid) && !eq_str(get(t, "status"), Some("done")))
                            .map(|t| get(t, "title")),
                        ", ",
                    );
                    let lines = mine.iter().map(|d| {
                        let sentence = if truthy(get(d, "sentence")) { format!(" ({})", s(get(d, "sentence"))) } else { String::new() };
                        let branch = if truthy(get(d, "branch")) { s(get(d, "branch")) } else { "?".into() };
                        let tests = match get(d, "tests") {
                            Some(Value::Bool(true)) => " · tests passing",
                            Some(Value::Bool(false)) => " · TESTS FAILING",
                            _ => "",
                        };
                        format!("  - \"{}\" {}{sentence} on {branch}{tests}", s(get(d, "title")), s(get(d, "status")))
                    });
                    let status = if !mine.is_empty() {
                        format!("{} session{}", mine.len(), plural(mine.len()))
                    } else {
                        match nn(get(p, "presence").and_then(|pr| get(pr, "status"))) {
                            None => "no sessions shared".into(),
                            v => s(v),
                        }
                    };
                    let head = format!(
                        "- {}: {status}; tasks: {}",
                        s(nn(get(p, "name")).or(pid)),
                        if joined.is_empty() { "none" } else { &joined }
                    );
                    std::iter::once(head).chain(lines).collect::<Vec<_>>().join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n"))
        }
        _ => Err(format!("Unknown tool {name}")),
    }
}

/// JS `===` between two JSON values (objects/arrays compare by identity, so
/// two parsed ones are never equal).
fn strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Value::Null), Some(Value::Null)) => true,
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x == y,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::String(x)), Some(Value::String(y))) => x == y,
        _ => false,
    }
}

fn session_card(ctx: &Ctx, m: &Value) -> Result<String, String> {
    let (ts, updated) = ctx.turns(m)?;
    let repo = to_str(get(m, "repoPath"));
    let last = ts.last();
    let working = updated.is_some_and(|u| u != 0.0 && js::now_ms() - u < 20_000.0);
    let changed = super::data::changed_files(&repo).len();
    let branch = super::data::git(&repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let active = if working { "WORKING now".to_string() } else { format!("last active {}", updated.map(super::data::ago_f).unwrap_or_else(|| "never".into())) };
    let mut lines = vec![
        Some(format!("### {}  (id: {})", ctx.label(m), to_str(get(m, "id")))),
        Some(format!("branch: {} · {changed} changed files · {active}", if branch.is_empty() { "?" } else { &branch })),
        ctx.test_line(&repo),
        Some(match last {
            Some(l) => format!("last ask: \"{}\"", clip(&l.ask, 200)),
            None => "no conversation yet".into(),
        }),
    ];
    if let Some(l) = last {
        if !l.tools.is_empty() {
            lines.push(Some(format!("did: {}", clip(&js::tail(&l.tools, 8).join(", "), 300))));
        }
        if !l.reply.is_empty() {
            lines.push(Some(format!("last reply: {}", clip(&l.reply, 500))));
        }
    }
    Ok(lines.into_iter().flatten().filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n"))
}

const INSTRUCTIONS: &str = concat!(
    "Grill Me bridge. In the Claude app you are the user's brainstorm partner and reviewer; Claude Code sessions are the coders. ",
    "Start with catch_up (or whats_new). Save decisions the user makes with notes/save_plan so the coders see them. Explain code changes (get_diff) in plain English. Turn agreed plans into save_plan. ",
    "Before send_to_coder, grill the user: make them explain the plan back and push back on vague answers. ",
    "In a Claude Code session: read get_plan before starting, and use ask_brainstorm for product/design calls."
);

fn text_result(text: String, is_error: bool) -> Value {
    if is_error {
        json!({ "content": [{ "type": "text", "text": text }], "isError": true })
    } else {
        json!({ "content": [{ "type": "text", "text": text }] })
    }
}

/// One JSON-RPC message → the reply (None = nothing to send, e.g. a
/// notification). Err = the request made the JS handler throw (stdio logs
/// it; HTTP answers "Internal error").
pub fn handle(ctx: &Ctx, req: &Value) -> Result<Option<Value>, String> {
    let id = get(req, "id").cloned();
    let method = get(req, "method");
    let empty = json!({});
    let params = get(req, "params").unwrap_or(&empty);
    let reply = |result: Value| id.clone().map(|id| json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    let fail = |code: i64, message: String| id.clone().map(|id| json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }));
    let m = match method {
        Some(Value::String(m)) => Some(m.as_str()),
        None | Some(Value::Null) => None,
        // `method?.startsWith` on a non-string throws
        Some(_) => return Err("method?.startsWith is not a function".into()),
    };
    let needs_params = matches!(m, Some("initialize" | "tools/call" | "prompts/get"));
    if needs_params && params.is_null() {
        return Err("Cannot read properties of null".into());
    }
    match m {
        Some("initialize") => {
            let asked = get(params, "protocolVersion").and_then(Value::as_str).filter(|v| PROTOCOLS.contains(v));
            let mut instructions = INSTRUCTIONS.to_string();
            if ctx.remote.on && !ctx.remote.allow_writes {
                instructions.push_str(" This connection is read-only: you can see everything but not change anything.");
            }
            Ok(reply(json!({
                "protocolVersion": asked.unwrap_or(PROTOCOLS[0]),
                "capabilities": { "tools": {}, "prompts": {} },
                "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
                "instructions": instructions,
            })))
        }
        Some("ping") => Ok(reply(json!({}))),
        Some("tools/list") => Ok(reply(json!({ "tools": tools_for(ctx) }))),
        Some("tools/call") => {
            let name = get(params, "name");
            let args = nn(get(params, "arguments")).cloned().unwrap_or_else(|| json!({}));
            let name_s = name.and_then(Value::as_str);
            if !name_s.is_some_and(|n| tools_for(ctx).iter().any(|t| name_of(t) == n)) {
                return Ok(reply(text_result(format!("Tool {} isn't available on this connection.", to_str(name)), true)));
            }
            let name_s = name_s.expect("tool name");
            if ctx.remote.on && name_s == "notes" && to_str(get(&args, "action")).to_lowercase() != "read" {
                return Ok(reply(text_result("Adding notes isn't available over this connection.".into(), true)));
            }
            let mut scoped = ctx.clone();
            if let Some(p) = get(&args, "project").filter(|p| !eq_str(Some(p), Some(""))) {
                match ctx.resolve_project(&to_str(Some(p))) {
                    Some(scope) => scoped.scope = Some(scope),
                    None => {
                        let names: Vec<String> = ctx.project_list().into_iter().map(|(_, n)| n).collect();
                        let known = if names.is_empty() { "none".to_string() } else { names.join(", ") };
                        return Ok(reply(text_result(format!("No Grill Me project \"{}\". Projects: {known}.", to_str(Some(p))), true)));
                    }
                }
            }
            Ok(match call_tool(&scoped, name_s, &args) {
                Ok(text) => reply(text_result(if ctx.remote.on { redact(&text) } else { text }, false)),
                Err(e) => reply(text_result(e, true)),
            })
        }
        Some("prompts/list") => Ok(reply(json!({
            "prompts": SKILLS.iter().map(|(name, title, description)| json!({ "name": name, "title": title, "description": description })).collect::<Vec<_>>()
        }))),
        Some("prompts/get") => {
            let want = get(params, "name");
            let Some((id, title, desc)) = SKILLS.iter().find(|(n, _, _)| eq_str(want, Some(n))) else {
                return Ok(fail(-32602, format!("Unknown prompt {}", to_str(want))));
            };
            let body = ctx
                .skill_text(id)
                .unwrap_or_else(|| format!("# {title}\n\n{desc}. (Playbook not written yet — edit ~/.grillme/skills/{id}.md)"));
            Ok(reply(json!({ "description": desc, "messages": [{ "role": "user", "content": { "type": "text", "text": body } }] })))
        }
        Some(m) if m.starts_with("notifications/") => Ok(None),
        _ => Ok(fail(-32601, format!("Method not found: {}", to_str(method)))),
    }
}

/// Remote responses: every text that leaves the Mac goes through redact(),
/// and internal errors become generic (no paths, no stack traces).
pub fn scrub_outgoing(mut msg: Value) -> Value {
    if let Some(err) = get(&msg, "error").cloned() {
        let code = get(&err, "code").cloned().unwrap_or(Value::Null);
        let keep = matches!(code.as_i64(), Some(-32601) | Some(-32602));
        let message = if keep { get(&err, "message").cloned().unwrap_or(Value::Null) } else { json!("Internal error") };
        msg["error"] = json!({ "code": code, "message": message });
        return msg;
    }
    if let Some(r) = msg.get_mut("result").and_then(Value::as_object_mut) {
        if let Some(Value::Array(content)) = r.get_mut("content") {
            for c in content {
                if eq_str(get(c, "type"), Some("text")) {
                    let t = redact(&to_str(get(c, "text")));
                    c["text"] = json!(t);
                }
            }
        }
        if let Some(Value::Array(messages)) = r.get_mut("messages") {
            for m in messages {
                if let Some(content) = m.get_mut("content") {
                    if eq_str(get(content, "type"), Some("text")) {
                        let t = redact(&to_str(get(content, "text")));
                        content["text"] = json!(t);
                    }
                }
            }
        }
    }
    msg
}
