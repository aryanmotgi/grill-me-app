// ---------------------------------------------------------------------------
// Shared brain: catch-up digests, the hack clock, and the inputs Grill Me's
// AI checks run on (Grill Me runs claude; these only gather).
//
// One notebook per project: goal + decisions + notes + plans + what every
// session did. `catch_up(since)` renders everything new since a moment; the
// cursors file remembers each reader's "last seen" (a hook per session, a
// Grill Me Chat per chat, the Claude app).
// ---------------------------------------------------------------------------

use super::data::{arr_of, eq_str, read_json_or, read_list, read_text, ts_of, Ctx};
use super::js::{self, clip, get, nn, to_str, truthy};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

const THRESHOLDS_MIN: [f64; 6] = [720.0, 360.0, 180.0, 60.0, 30.0, 15.0];

/// Time left: "time's up" / "2h 05m" / "42m".
pub fn fmt_left(ms: f64) -> String {
    if ms <= 0.0 {
        return "time's up".into();
    }
    let m = (ms / 60000.0).floor();
    if m >= 60.0 {
        format!("{}h {:0>2}m", js::num_str((m / 60.0).floor()), js::num_str(m % 60.0))
    } else {
        format!("{}m", js::num_str(m))
    }
}

/// Did the reader miss a threshold (12h, 6h, 3h, 1h, 30m, 15m, or the end)
/// between `since` and `now`?
pub fn crossed(end: f64, since: f64, now: f64) -> bool {
    THRESHOLDS_MIN.iter().any(|t| {
        let at = end - t * 60000.0;
        since < at && at <= now
    }) || (since < end && end <= now)
}

/// Build a JSON object from (key, value) pairs; None values are left out
/// (JSON.stringify drops undefined properties).
fn obj(pairs: Vec<(&str, Option<Value>)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        if let Some(v) = v {
            m.insert(k.into(), v);
        }
    }
    Value::Object(m)
}

/// `b.goal ?? ""`
fn goal_or_empty(b: &Value) -> Value {
    nn(get(b, "goal")).cloned().unwrap_or(json!(""))
}

/// A string field, "" when missing or not a string.
fn str_of(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or("").to_string()
}

/// The turns a session took on a delivered hand-off: from the turn whose ask
/// contains the hand-off's text (it's typed in verbatim), else every turn
/// since delivery (2 min slack: the typed turn is stamped before deliveredAt).
pub fn turns_since_delivery<'a>(turns: &'a [super::data::Turn], message: &str, delivered: f64) -> &'a [super::data::Turn] {
    let probe: String = js::collapse_ws(message).chars().take(60).collect();
    if !probe.is_empty() {
        if let Some(i) = turns.iter().rposition(|t| js::collapse_ws(&t.ask).contains(&probe)) {
            return &turns[i..];
        }
    }
    match turns.iter().position(|t| ts_of(t.at.as_ref()) >= delivered - 120_000.0) {
        Some(i) => &turns[i..],
        None => &[],
    }
}

impl Ctx {
    fn cursors_path(&self) -> PathBuf {
        self.project_dir().dir.join("brain-cursors.json")
    }

    pub fn cursor(&self, key: &str) -> f64 {
        match get(&read_json_or(&self.cursors_path(), json!({})), key) {
            Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
            _ => 0.0,
        }
    }

    pub fn set_cursor(&self, key: &str, ms: f64) {
        // Node ran this read-modify-write on its single thread; HTTP calls
        // here run on a thread each, so serialize it
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let path = self.cursors_path();
        let mut all = match read_json_or(&path, json!({})) {
            Value::Object(o) => o,
            _ => Map::new(),
        };
        let v = if ms.fract() == 0.0 && ms.abs() < 9.0e15 { json!(ms as i64) } else { json!(ms) };
        all.insert(key.into(), v);
        let tmp = PathBuf::from(format!("{}.{}.tmp", path.to_string_lossy(), std::process::id()));
        if std::fs::write(&tmp, js::stringify(&Value::Object(all), 2)).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }

    /// Full view: always show time left. Incremental: only when a threshold
    /// was crossed since the reader last looked.
    fn deadline_line(&self, since: f64, full: bool) -> String {
        let end = js::to_num(get(&self.bridge_state(), "deadline"));
        if end == 0.0 || end.is_nan() {
            return String::new();
        }
        let now = js::now_ms();
        let left = end - now;
        if full {
            return format!("**⏰ Deadline:** {} left.", fmt_left(left));
        }
        if crossed(end, since, now) {
            format!("**⏰ {} left in the hackathon.** Prioritize the demo path; cut anything that isn't needed for it.", fmt_left(left))
        } else {
            String::new()
        }
    }

    /// Markdown of everything new since `since` (ms). Empty = nothing new.
    /// `exclude` = a member id whose own turns to skip (it already knows them).
    pub fn catch_up(&self, since: f64, exclude: Option<&str>, full: bool) -> Result<String, String> {
        let proj = self.project_dir();
        let b = self.bridge_state();
        let mut out: Vec<String> = Vec::new();
        if full && truthy(get(&b, "goal")) {
            out.push(format!("**Goal:** {}", to_str(get(&b, "goal"))));
        } else if truthy(get(&b, "goalTs")) && ts_of(get(&b, "goalTs")) > since && truthy(get(&b, "goal")) {
            out.push(format!("**New goal:** {}", to_str(get(&b, "goal"))));
        }

        let dl = self.deadline_line(since, full);
        if !dl.is_empty() {
            out.push(dl);
        }

        let notes_all: Vec<Value> = get(&b, "notes").and_then(Value::as_array).cloned().unwrap_or_default();
        // team brain: notes are mirrored to teammates as "brain-<noteId>"
        // decisions — don't show our own notes twice
        let own: Vec<String> = notes_all.iter().map(|n| format!("brain-{}", to_str(get(n, "id")))).collect();
        let decisions: Vec<Value> = read_list(&proj.dir.join("decisions.json"))
            .into_iter()
            .filter(|d| !matches!(get(d, "id"), Some(Value::String(id)) if own.contains(id)))
            .filter(|d| full || ts_of(get(d, "epochMs")) > since)
            .collect();
        if !decisions.is_empty() {
            let lines: Vec<String> = js::tail(&decisions, 12).iter().map(|d| format!("- {}", to_str(get(d, "text")))).collect();
            out.push(format!("**{}:**\n{}", if full { "Decisions" } else { "New decisions" }, lines.join("\n")));
        }

        let notes: Vec<&Value> = notes_all.iter().filter(|n| full || ts_of(get(n, "ts")) > since).collect();
        if !notes.is_empty() {
            let lines: Vec<String> = js::tail(&notes, 12)
                .iter()
                .map(|n| {
                    let by = if truthy(get(n, "by")) { format!(" ({})", to_str(get(n, "by"))) } else { String::new() };
                    format!("- {}{by}", to_str(get(n, "text")))
                })
                .collect();
            out.push(format!("**{}:**\n{}", if full { "Notes" } else { "New notes" }, lines.join("\n")));
        }

        let plans: Vec<&Value> = get(&b, "plans")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter(|p| eq_str(get(p, "status"), Some("applied")) && (full || ts_of(get(p, "ts")) > since)).collect())
            .unwrap_or_default();
        if !plans.is_empty() {
            let lines: Vec<String> = js::tail(&plans, 5)
                .iter()
                .map(|p| {
                    let tasks = get(p, "tasks").and_then(Value::as_array).map(|t| js::join(t.iter().map(|t| get(t, "title")), "; ")).unwrap_or_default();
                    format!("- {}: {tasks}", to_str(get(p, "title")))
                })
                .collect();
            out.push(format!("**{}:**\n{}", if full { "Plans" } else { "New plans" }, lines.join("\n")));
        }

        if full {
            let tasks: Vec<Value> = read_list(&proj.dir.join("tasks.json")).into_iter().filter(|t| !eq_str(get(t, "status"), Some("done"))).collect();
            if !tasks.is_empty() {
                let lines: Vec<String> =
                    js::head(&tasks, 15).iter().map(|t| format!("- [{}] {}", to_str(get(t, "status")), to_str(get(t, "title")))).collect();
                out.push(format!("**Open tasks:**\n{}", lines.join("\n")));
            }
        }

        let mut activity: Vec<String> = Vec::new();
        for m in self.members() {
            if eq_str(get(&m, "id"), exclude) {
                continue;
            }
            let label = self.label(&m);
            let repo = to_str(get(&m, "repoPath"));
            let fresh: Vec<_> = self.turns(&m)?.0.into_iter().filter(|t| full || ts_of(t.at.as_ref()) > since).collect();
            let recent = if full { js::tail(&fresh, 1) } else { js::tail(&fresh, 4) };
            for t in recent {
                let tools = if t.tools.is_empty() { String::new() } else { format!(" → {}", clip(&js::tail(&t.tools, 5).join(", "), 160)) };
                let reply = if t.reply.is_empty() { String::new() } else { format!(" → {}", clip(&js::collapse_ws(&t.reply), 220)) };
                activity.push(format!("- **{label}**: asked \"{}\"{tools}{reply}", clip(&t.ask, 140)));
            }
            if !full && since != 0.0 && !since.is_nan() {
                let arg = format!("--since=@{}", js::num_str((since / 1000.0).floor()));
                let log = super::data::git(&repo, &["log", "--oneline", &arg, "-8"]);
                if !log.is_empty() {
                    let lines: Vec<String> = log.split('\n').map(|l| format!("  - {l}")).collect();
                    activity.push(format!("- **{label}** commits:\n{}", lines.join("\n")));
                }
            }
        }
        if !activity.is_empty() {
            out.push(format!("**{}:**\n{}", if full { "Sessions" } else { "Session activity" }, activity.join("\n")));
        }

        let replies = self.reply_lines(since, full);
        if !replies.is_empty() {
            out.push(format!("**Replies to your hand-offs:**\n{}", replies.join("\n")));
        }

        let open_q: Vec<&Value> = get(&b, "questions")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter(|q| !truthy(get(q, "answered"))).collect())
            .unwrap_or_default();
        if !open_q.is_empty() && (full || open_q.iter().any(|q| ts_of(get(q, "ts")) > since)) {
            let lines: Vec<String> = open_q
                .iter()
                .map(|q| format!("- {}: {}", to_str(nn(get(q, "fromTitle")).or(get(q, "from"))), to_str(get(q, "question"))))
                .collect();
            out.push(format!("**Open questions for the brainstorm side:**\n{}", lines.join("\n")));
        }
        if full {
            let lessons = self.lessons_text(Some(&proj.id), 6)?;
            if !lessons.is_empty() {
                out.push(format!("**Lessons from past hackathons:**\n{lessons}"));
            }
        }
        Ok(if out.is_empty() { String::new() } else { format!("*Project: {}*\n\n{}", proj.id, out.join("\n\n")) })
    }

    // ---- inputs for Grill Me's AI checks -------------------------------------------

    fn decision_texts(&self, n: usize) -> Value {
        let d = read_list(&self.project_dir().dir.join("decisions.json"));
        arr_of(js::tail(&d, n).iter().map(|d| get(d, "text")))
    }

    fn open_tasks(&self) -> Vec<Value> {
        read_list(&self.project_dir().dir.join("tasks.json")).into_iter().filter(|t| !eq_str(get(t, "status"), Some("done"))).collect()
    }

    /// Mismatch + board check for one session's latest turn. Empty when
    /// there's nothing to compare against or no new turn since the last check.
    pub fn check_input(&self, member: Option<&str>) -> Result<String, String> {
        let Some(m) = self.members().into_iter().find(|x| eq_str(get(x, "id"), member)) else { return Ok(String::new()) };
        let b = self.bridge_state();
        let decisions = self.decision_texts(15);
        let tasks: Vec<Value> = js::head(&self.open_tasks(), 25)
            .iter()
            .map(|t| obj(vec![("id", get(t, "id").cloned()), ("title", get(t, "title").cloned()), ("status", get(t, "status").cloned())]))
            .collect();
        if !truthy(get(&b, "goal")) && decisions.as_array().is_some_and(Vec::is_empty) && tasks.is_empty() {
            return Ok(String::new());
        }
        let key = format!("check:{}", member.unwrap_or("undefined"));
        let since = self.cursor(&key);
        let repo = to_str(get(&m, "repoPath"));
        let fresh: Vec<_> = self.turns(&m)?.0.into_iter().filter(|t| ts_of(t.at.as_ref()) > since).collect();
        let Some(last) = fresh.last() else { return Ok(String::new()) };
        self.set_cursor(&key, js::now_ms());
        let v = json!({
            "session": self.label_v(&m),
            "goal": goal_or_empty(&b),
            "decisions": decisions,
            "openTasks": tasks,
            "latestTurn": { "ask": clip(&last.ask, 1500), "tools": js::tail(&last.tools, 30), "reply": clip(&last.reply, 2500) },
            "changedFiles": js::head(&super::data::changed_files(&repo), 40),
        });
        Ok(js::stringify(&v, 1))
    }

    pub fn cut_input(&self) -> Result<String, String> {
        let b = self.bridge_state();
        let end = js::to_num(get(&b, "deadline"));
        let end = if end.is_nan() { 0.0 } else { end };
        let mut sessions: Vec<Value> = Vec::new();
        for m in self.members() {
            let ts = self.turns(&m)?.0;
            let t = ts.last();
            sessions.push(json!({
                "name": self.label_v(&m),
                "lastAsk": t.map(|t| clip(&t.ask, 300)).unwrap_or_default(),
                "lastReply": t.map(|t| clip(&t.reply, 600)).unwrap_or_default(),
            }));
        }
        let v = json!({
            "timeLeft": if end != 0.0 { fmt_left(end - js::now_ms()) } else { "unknown".into() },
            "goal": goal_or_empty(&b),
            "decisions": self.decision_texts(15),
            "openTasks": self.open_tasks().iter().map(|t| format!("[{}] {}", to_str(get(t, "status")), to_str(get(t, "title")))).collect::<Vec<_>>(),
            "sessions": sessions,
        });
        Ok(js::stringify(&v, 1))
    }

    fn readme(&self) -> String {
        let Some(m) = self.members().into_iter().next() else { return String::new() };
        let repo = to_str(get(&m, "repoPath"));
        for f in ["README.md", "readme.md", "README"] {
            if let Some(t) = read_text(&std::path::Path::new(&repo).join(f)) {
                return clip(&self.r(t), 3000);
            }
        }
        String::new()
    }

    fn work_summary(&self, turns_per: usize) -> Result<Vec<Value>, String> {
        let mut out = Vec::new();
        for m in self.members() {
            // diffOf() in JS: only its commit log is used here, but it throws
            // the same way when the worktree is gone
            let repo = to_str(get(&m, "repoPath"));
            let (_, _, log) = Ctx::commit_log(&repo);
            super::data::realpath(&repo)?;
            let commits: Vec<&str> = log.split('\n').filter(|l| !l.is_empty()).take(25).collect();
            let ts = self.turns(&m)?.0;
            let recent: Vec<Value> = js::tail(&ts, turns_per)
                .iter()
                .map(|t| json!({ "ask": clip(&t.ask, 300), "did": js::tail(&t.tools, 8), "reply": clip(&t.reply, 500) }))
                .collect();
            out.push(json!({ "session": self.label_v(&m), "commits": commits, "recentWork": recent }));
        }
        Ok(out)
    }

    pub fn skill_text(&self, id: &str) -> Option<String> {
        read_text(&self.root_path().join("skills").join(format!("{id}.md")))
    }

    pub fn pitch_input(&self) -> Result<String, String> {
        let b = self.bridge_state();
        let v = json!({
            "goal": goal_or_empty(&b),
            "decisions": self.decision_texts(20),
            "readme": self.readme(),
            "work": self.work_summary(6)?,
            "playbook": self.skill_text("pitch").unwrap_or_default(),
        });
        Ok(js::stringify(&v, 1))
    }

    pub fn quiz_input(&self, member: Option<&str>) -> Result<String, String> {
        let key = member.map(|m| json!(m));
        let Some(m) = self.find_session(key.as_ref())? else { return Ok(String::new()) };
        let d = self.diff_of(&m)?;
        if d.diff.is_empty() && d.log.is_empty() {
            return Ok(String::new());
        }
        let ts = self.turns(&m)?.0;
        let v = json!({
            "session": self.label_v(&m),
            "commits": d.log,
            "files": d.stat,
            "diff": clip(&d.diff, 16000),
            "recentWork": js::tail(&ts, 3).iter().map(|t| json!({ "ask": clip(&t.ask, 300), "reply": clip(&t.reply, 600) })).collect::<Vec<_>>(),
        });
        Ok(js::stringify(&v, 1))
    }

    pub fn wrapup_input(&self) -> Result<String, String> {
        let proj = self.project_dir();
        let b = self.bridge_state();
        let notes: Vec<Value> = get(&b, "notes").and_then(Value::as_array).cloned().unwrap_or_default();
        let v = json!({
            "project": proj.id,
            "goal": goal_or_empty(&b),
            "decisions": self.decision_texts(25),
            "notes": arr_of(js::tail(&notes, 25).iter().map(|n| get(n, "text"))),
            "tasks": read_list(&proj.dir.join("tasks.json")).iter().map(|t| format!("[{}] {}", to_str(get(t, "status")), to_str(get(t, "title")))).collect::<Vec<_>>(),
            "work": self.work_summary(4)?,
        });
        Ok(js::stringify(&v, 1))
    }

    // ---- the bridge loop: drafted answers, reviews, hand-off replies ------------

    /// A local member by id (bridge items store the member id).
    fn member_by_id(&self, id: Option<&Value>) -> Option<Value> {
        let id = id.and_then(Value::as_str)?;
        self.members().into_iter().find(|m| eq_str(get(m, "id"), Some(id)))
    }

    /// Input for drafting an answer to a coder's question: the question, the
    /// plan (goal, decisions, open tasks, notes) and the asker's last turn.
    /// Local questions live in bridge.json; teammates' in team-bridge.json
    /// (their session is on another Mac, so no turn). Empty = no such question.
    pub fn answer_input(&self, qid: Option<&str>) -> Result<String, String> {
        let Some(qid) = qid.filter(|q| !q.is_empty()) else { return Ok(String::new()) };
        let b = self.bridge_state();
        let local = get(&b, "questions").and_then(Value::as_array).and_then(|a| a.iter().find(|q| eq_str(get(q, "id"), Some(qid))).cloned());
        let (question, context, session, member) = if let Some(q) = local {
            let who = nn(get(&q, "fromTitle")).or(get(&q, "from")).map(|v| to_str(Some(v))).unwrap_or_default();
            (str_of(get(&q, "question")), str_of(get(&q, "context")), who, self.member_by_id(get(&q, "from")))
        } else if let Some(t) = read_list(&self.project_dir().dir.join("team-bridge.json"))
            .into_iter()
            .find(|e| eq_str(get(e, "kind"), Some("question")) && eq_str(get(e, "id"), Some(qid)))
        {
            let title = nn(get(&t, "sessionTitle")).or(get(&t, "session")).map(|v| to_str(Some(v))).unwrap_or_default();
            (str_of(get(&t, "message")), str_of(get(&t, "context")), format!("{}'s {title}", str_of(get(&t, "fromName"))), None)
        } else {
            return Ok(String::new());
        };
        let last = match &member {
            Some(m) => self.turns(m)?.0.pop(),
            None => None,
        };
        let notes: Vec<Value> = get(&b, "notes").and_then(Value::as_array).cloned().unwrap_or_default();
        let v = json!({
            "session": session,
            "question": clip(&question, 3000),
            "context": clip(&context, 3000),
            "goal": goal_or_empty(&b),
            "decisions": self.decision_texts(15),
            "openTasks": js::head(&self.open_tasks(), 25).iter().map(|t| format!("[{}] {}", to_str(get(t, "status")), to_str(get(t, "title")))).collect::<Vec<_>>(),
            "notes": arr_of(js::tail(&notes, 15).iter().map(|n| get(n, "text"))),
            "lastTurn": last.map(|t| json!({ "ask": clip(&t.ask, 1500), "tools": js::tail(&t.tools, 20), "reply": clip(&t.reply, 2500) })),
        });
        Ok(js::stringify(&v, 1))
    }

    /// Input for reviewing one session's work: diff vs its base + commits,
    /// last test result, last turn, goal and decisions. Empty when there's
    /// nothing to review (no commits beyond the base, clean tree).
    pub fn review_input(&self, member: Option<&str>) -> Result<String, String> {
        let Some(m) = self.member_by_id(member.map(|s| json!(s)).as_ref()) else { return Ok(String::new()) };
        let d = self.diff_of(&m)?;
        if d.diff.is_empty() && d.log.is_empty() {
            return Ok(String::new());
        }
        let repo = to_str(get(&m, "repoPath"));
        let tests = self
            .test_result(&repo)
            .map(|t| json!({ "ok": truthy(get(&t, "ok")), "cmd": str_of(get(&t, "cmd")), "tail": clip(&str_of(get(&t, "tail")), 800) }));
        let last = self.turns(&m)?.0.pop();
        let b = self.bridge_state();
        let v = json!({
            "session": self.label_v(&m),
            "branch": d.branch,
            "base": d.base,
            "goal": goal_or_empty(&b),
            "decisions": self.decision_texts(15),
            "commits": d.log,
            "files": d.stat,
            "diff": clip(&d.diff, 16000),
            "tests": tests,
            "lastTurn": last.map(|t| json!({ "ask": clip(&t.ask, 800), "reply": clip(&t.reply, 1500) })),
        });
        Ok(js::stringify(&v, 1))
    }

    /// Input for a hand-off's result report: the task, the session's turns
    /// since it was delivered, and the last test result. Empty when the
    /// hand-off is unknown, undelivered, or the session hasn't taken a turn.
    pub fn reply_input(&self, hid: Option<&str>) -> Result<String, String> {
        let Some(hid) = hid.filter(|h| !h.is_empty()) else { return Ok(String::new()) };
        let b = self.bridge_state();
        let Some(h) = get(&b, "handoffs").and_then(Value::as_array).and_then(|a| a.iter().find(|h| eq_str(get(h, "id"), Some(hid))).cloned()) else {
            return Ok(String::new());
        };
        let delivered = ts_of(get(&h, "deliveredAt"));
        let Some(m) = self.member_by_id(get(&h, "session")).filter(|_| delivered > 0.0) else { return Ok(String::new()) };
        let message = str_of(get(&h, "message"));
        let turns = self.turns(&m)?.0;
        let since = turns_since_delivery(&turns, &message, delivered);
        if since.is_empty() {
            return Ok(String::new());
        }
        let repo = to_str(get(&m, "repoPath"));
        let v = json!({
            "session": self.label_v(&m),
            "task": clip(&message, 2000),
            "turns": js::tail(since, 6).iter().map(|t| json!({ "ask": clip(&t.ask, 600), "did": js::tail(&t.tools, 15), "reply": clip(&t.reply, 1500) })).collect::<Vec<_>>(),
            "tests": self.test_result(&repo).map(|t| json!({ "ok": truthy(get(&t, "ok")), "cmd": str_of(get(&t, "cmd")) })),
        });
        Ok(js::stringify(&v, 1))
    }

    /// The latest auto-review of a session (reviews.json), as one line.
    pub fn review_line(&self, member: Option<&Value>) -> Option<String> {
        let id = member.and_then(Value::as_str)?;
        let all = read_json_or(&self.project_dir().dir.join("reviews.json"), json!({}));
        let r = get(&all, id)?;
        let verdict = str_of(get(r, "verdict"));
        if verdict.is_empty() {
            return None;
        }
        let risks: Vec<String> = get(r, "risks").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect()).unwrap_or_default();
        let risk_txt = if risks.is_empty() { String::new() } else { format!(" Risks: {}.", risks.join("; ")) };
        Some(format!("review ({}): {} — {}{risk_txt}", super::data::ago(get(r, "ts")), verdict.to_uppercase(), clip(&str_of(get(r, "summary")), 400)))
    }

    /// Sessions' replies to hand-offs — local ones (bridge.json) and ones a
    /// teammate's session sent back (team-bridge.json) — newer than `since`,
    /// or the latest few when `full`.
    pub fn reply_lines(&self, since: f64, full: bool) -> Vec<String> {
        let b = self.bridge_state();
        let mut found: Vec<(f64, String)> = Vec::new();
        let line = |who: String, h: &Value, r: &Value| {
            let done = if truthy(get(r, "done")) { "done" } else { "not done yet" };
            format!("- **{who}** ({done}) on \"{}\": {}", clip(&str_of(get(h, "message")), 100), clip(&str_of(get(r, "summary")), 400))
        };
        let title = |e: &Value| nn(get(e, "sessionTitle")).or(get(e, "session")).map(|v| to_str(Some(v))).unwrap_or_default();
        for h in get(&b, "handoffs").and_then(Value::as_array).cloned().unwrap_or_default() {
            let ts = ts_of(get(&h, "resultTs"));
            if let Some(r) = get(&h, "result").filter(|r| r.is_object() && (full || ts > since)) {
                found.push((ts, line(title(&h), &h, r)));
            }
        }
        for e in read_list(&self.project_dir().dir.join("team-bridge.json")) {
            let ts = ts_of(get(&e, "resultTs"));
            if let Some(r) = get(&e, "result").filter(|r| r.is_object() && (full || ts > since)) {
                found.push((ts, line(format!("{}'s {}", str_of(get(&e, "toName")), title(&e)), &e, r)));
            }
        }
        found.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let lines: Vec<String> = found.into_iter().map(|(_, l)| l).collect();
        js::tail(&lines, if full { 5 } else { 10 }).to_vec()
    }

    pub fn kickoff_input(&self) -> Result<String, String> {
        let v = json!({
            "readme": self.readme(),
            "pastLessons": self.lessons_text(Some(&self.project_dir().id), 5)?,
            "brainstormPlaybook": self.skill_text("brainstorm").unwrap_or_default(),
            "breakdownPlaybook": self.skill_text("breakdown").unwrap_or_default(),
            "existingSessions": self.members().iter().map(|m| self.label_v(m)).collect::<Vec<_>>(),
        });
        Ok(js::stringify(&v, 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: f64 = 60_000.0;

    #[test]
    fn deadline_thresholds() {
        let end = 1_000_000_000.0;
        // crossing the 1h mark since the last look
        assert!(crossed(end, end - 61.0 * MIN, end - 59.0 * MIN));
        // nothing crossed between 50m and 40m left
        assert!(!crossed(end, end - 50.0 * MIN, end - 40.0 * MIN));
        // every threshold: 12h, 6h, 3h, 1h, 30m, 15m
        for t in [720.0, 360.0, 180.0, 60.0, 30.0, 15.0] {
            assert!(crossed(end, end - (t + 1.0) * MIN, end - (t - 1.0) * MIN), "{t}");
        }
        // landing exactly on a threshold counts; starting on it doesn't
        assert!(crossed(end, end - 16.0 * MIN, end - 15.0 * MIN));
        assert!(!crossed(end, end - 15.0 * MIN, end - 14.0 * MIN));
        // the deadline itself
        assert!(crossed(end, end - 1.0 * MIN, end + 1.0 * MIN));
        assert!(!crossed(end, end + 1.0 * MIN, end + 2.0 * MIN));
        // a reader who has never looked (since = 0) sees the latest crossing
        assert!(crossed(end, 0.0, end - 100.0 * MIN));
    }

    #[test]
    fn catch_up_reports_deadline_crossings() {
        let home = std::env::temp_dir().join(format!("grillme-dl-{}-{}", std::process::id(), js::now_ms()));
        let g = home.join(".grillme");
        std::fs::create_dir_all(&g).unwrap();
        let now = js::now_ms();
        let end = now + 59.0 * MIN + 30_000.0;
        std::fs::write(g.join("bridge.json"), json!({ "deadline": end as i64, "handoffs": [], "questions": [], "plans": [], "notes": [] }).to_string()).unwrap();
        let h = home.to_string_lossy().into_owned();
        let ctx = Ctx { root: format!("{h}/.grillme"), home: h, remote: Default::default(), scope: None, forced: None };
        // the 1h mark passed since the reader last looked
        let text = ctx.catch_up(now - 2.0 * MIN, None, false).unwrap();
        assert!(text.contains("**⏰ 59m left in the hackathon.** Prioritize the demo path"), "{text}");
        assert!(text.starts_with("*Project: default*\n\n"));
        // nothing crossed since 30 s ago: nothing new at all
        assert_eq!(ctx.catch_up(now - 30_000.0, None, false).unwrap(), "");
        // the full picture always shows time left
        assert!(ctx.catch_up(0.0, None, true).unwrap().contains("**⏰ Deadline:** 59m left."));
        let _ = std::fs::remove_dir_all(home);
    }

    fn temp_ctx(tag: &str) -> (Ctx, PathBuf) {
        let home = std::env::temp_dir().join(format!("grillme-{tag}-{}-{}", std::process::id(), js::now_ms()));
        std::fs::create_dir_all(home.join(".grillme")).unwrap();
        let h = home.to_string_lossy().into_owned();
        (Ctx { root: format!("{h}/.grillme"), home: h, remote: Default::default(), scope: None, forced: None }, home)
    }

    #[test]
    fn delivery_turns_start_at_the_typed_handoff() {
        let t = |ask: &str, at: &str| super::super::data::Turn { ask: ask.into(), at: Some(json!(at)), tools: vec![], reply: String::new() };
        let turns = vec![
            t("earlier work", "2026-01-01T10:00:00Z"),
            t("Add a copy button to   the review modal", "2026-01-01T10:05:00Z"),
            t("also fix the test", "2026-01-01T10:09:00Z"),
        ];
        let delivered = js::date_parse("2026-01-01T10:05:30Z");
        let got = turns_since_delivery(&turns, "Add a copy button to the review modal", delivered);
        assert_eq!(got.len(), 2);
        // no matching ask: everything since delivery (with slack)
        assert_eq!(turns_since_delivery(&turns, "something else", delivered).len(), 2);
        assert!(turns_since_delivery(&turns, "something else", js::date_parse("2026-01-02T00:00:00Z")).is_empty());
    }

    #[test]
    fn answer_input_has_question_and_plan() {
        let (ctx, home) = temp_ctx("ans");
        let g = home.join(".grillme");
        std::fs::write(
            g.join("bridge.json"),
            json!({ "goal": "Ship the demo", "handoffs": [], "plans": [], "notes": [{ "id": "n", "ts": 1, "text": "judges like live demos" }],
                "questions": [{ "id": "q-1", "ts": 1, "answered": false, "from": "ui", "fromTitle": "UI", "question": "Dark mode first?" }] })
            .to_string(),
        )
        .unwrap();
        std::fs::write(g.join("decisions.json"), json!([{ "id": "d", "text": "Light theme only for v1" }]).to_string()).unwrap();
        std::fs::write(g.join("team-bridge.json"), json!([{ "id": "tb-1", "kind": "question", "fromName": "Maya", "session": "api", "sessionTitle": "API", "message": "Redis?", "status": "pending" }]).to_string()).unwrap();
        let v: Value = serde_json::from_str(&ctx.answer_input(Some("q-1")).unwrap()).unwrap();
        assert_eq!(v["question"], "Dark mode first?");
        assert_eq!(v["session"], "UI");
        assert_eq!(v["goal"], "Ship the demo");
        assert_eq!(v["decisions"][0], "Light theme only for v1");
        assert_eq!(v["notes"][0], "judges like live demos");
        let t: Value = serde_json::from_str(&ctx.answer_input(Some("tb-1")).unwrap()).unwrap();
        assert_eq!(t["session"], "Maya's API");
        assert_eq!(t["question"], "Redis?");
        assert_eq!(ctx.answer_input(Some("nope")).unwrap(), "");
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn review_and_reply_lines() {
        let (ctx, home) = temp_ctx("rev");
        let g = home.join(".grillme");
        let now = js::now_ms() as i64;
        std::fs::write(g.join("reviews.json"), json!({ "s1": { "verdict": "fix", "summary": "Adds login.", "risks": ["no rate limit"], "ts": now } }).to_string()).unwrap();
        let line = ctx.review_line(Some(&json!("s1"))).unwrap();
        assert!(line.contains("FIX — Adds login. Risks: no rate limit."), "{line}");
        assert!(ctx.review_line(Some(&json!("s2"))).is_none());
        std::fs::write(
            g.join("bridge.json"),
            json!({ "handoffs": [{ "id": "h", "session": "s1", "sessionTitle": "Auth", "message": "Add login", "status": "sent", "result": { "done": true, "summary": "Login works." }, "resultTs": now }],
                "plans": [], "notes": [], "questions": [] })
            .to_string(),
        )
        .unwrap();
        let r = ctx.reply_lines((now - 1000) as f64, false);
        assert_eq!(r, vec!["- **Auth** (done) on \"Add login\": Login works.".to_string()]);
        assert!(ctx.reply_lines(now as f64, false).is_empty());
        assert!(ctx.catch_up((now - 1000) as f64, None, false).unwrap().contains("**Replies to your hand-offs:**"));
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn formats_time_left() {
        assert_eq!(fmt_left(0.0), "time's up");
        assert_eq!(fmt_left(-5.0), "time's up");
        assert_eq!(fmt_left(42.0 * MIN + 30_000.0), "42m");
        assert_eq!(fmt_left(125.0 * MIN), "2h 05m");
        assert_eq!(fmt_left(60.0 * MIN), "1h 00m");
    }
}
