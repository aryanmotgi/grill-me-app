// ---------------------------------------------------------------------------
// Brain search: one ranked search over everything the brain remembers —
// decisions, notes, plans, goal history, past lessons, hand-offs and their
// replies, questions and answers, reviews, commit messages, and session
// turns (this Mac's sessions only; withheld remotely with --no-transcripts).
//
// Scoring is deliberately simple and dependency-free: every query term must
// appear (multi-word AND, "quoted phrases" stay together), term frequency
// (capped) plus a title bonus, times a recency boost that halves over a day.
// ---------------------------------------------------------------------------

use super::data::{ago_f, read_json_or, read_list, ts_of, Ctx};
use super::js::{self, clip, get, nn, to_str};
use serde_json::{json, Value};

/// One searchable thing. `r#ref` is what a click jumps to (a decision id, a
/// session id, "<session>:<commit>", "<session>:<turn index>").
#[derive(Clone, Debug)]
pub struct Doc {
    pub kind: &'static str,
    pub title: String,
    pub text: String,
    pub ts: f64,
    pub source: String,
    pub r#ref: String,
}

/// Filler dropped from queries — including the verbs of a question ("why did
/// we PICK postgres") that the answer itself rarely contains.
const STOP: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "how", "i", "in", "is", "it", "of", "on", "or",
    "our", "should", "so", "that", "the", "this", "to", "us", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with",
    "about", "pick", "picked", "choose", "chose", "chosen", "decide", "decided", "go", "went", "going", "have", "has", "had", "can", "could",
    "would", "you", "my", "me", "they", "there", "any", "ever",
];

/// Query → lowercase terms: "quoted phrases" kept whole, other words split,
/// filler words dropped (unless that would leave nothing). At most 12.
pub fn parse_query(q: &str) -> Vec<String> {
    let lower = q.to_lowercase();
    let mut phrases: Vec<String> = Vec::new();
    let mut loose = String::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in lower.chars() {
        if matches!(c, '"' | '\u{201c}' | '\u{201d}') {
            if quoted {
                let p = js::collapse_ws(&cur);
                if !p.is_empty() {
                    phrases.push(p);
                }
                cur.clear();
            }
            quoted = !quoted;
            loose.push(' ');
            continue;
        }
        if quoted { cur.push(c) } else { loose.push(c) }
    }
    if quoted {
        loose.push(' ');
        loose.push_str(&cur); // unterminated quote: plain words
    }
    let words: Vec<String> = loose
        .split(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | '#' | '@')))
        .map(|w| w.trim_matches(|c: char| matches!(c, '.' | '-' | '/')).to_string())
        .filter(|w| !w.is_empty())
        .collect();
    let content: Vec<String> = words.iter().filter(|w| !STOP.contains(&w.as_str())).cloned().collect();
    let words = if content.is_empty() && phrases.is_empty() { words } else { content };
    let mut terms: Vec<String> = Vec::new();
    for t in phrases.into_iter().chain(words) {
        if !terms.contains(&t) {
            terms.push(t);
        }
    }
    terms.truncate(12);
    terms
}

/// Doc score, or None when any term is missing.
pub fn score(d: &Doc, terms: &[String], now: f64) -> Option<f64> {
    if terms.is_empty() {
        return None;
    }
    let title = d.title.to_lowercase();
    let hay = format!("{title}\n{}", d.text.to_lowercase());
    let mut tf = 0.0;
    for t in terms {
        let n = hay.matches(t.as_str()).count();
        if n == 0 {
            return None;
        }
        tf += n.min(5) as f64;
        if title.contains(t.as_str()) {
            tf += 2.0;
        }
    }
    let weight = match d.kind {
        "decision" => 1.3,
        "goal" => 1.2,
        _ => 1.0,
    };
    let recency = if d.ts > 0.0 { 1.0 / (1.0 + ((now - d.ts).max(0.0) / 86_400_000.0)) } else { 0.0 };
    Some(tf * weight * (1.0 + recency))
}

/// ~`n` chars of `text` around the first matching term, one line.
pub fn snippet(text: &str, terms: &[String], n: usize) -> String {
    let flat = js::collapse_ws(text);
    let chars: Vec<char> = flat.chars().collect();
    let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
    let lower_s: String = lower.iter().collect();
    // first hit, as a char index (lower has one char per original char)
    let hit = terms
        .iter()
        .filter_map(|t| lower_s.find(t.as_str()).map(|b| lower_s[..b].chars().count()))
        .min()
        .unwrap_or(0);
    let start = hit.saturating_sub(n / 3);
    let end = (start + n).min(chars.len());
    let start = end.saturating_sub(n).min(start);
    let body: String = chars[start..end].iter().collect();
    format!("{}{}{}", if start > 0 { "…" } else { "" }, body.trim(), if end < chars.len() { "…" } else { "" })
}

/// Ranked results, best first (ties: newest first).
pub fn rank(docs: &[Doc], query: &str, now: f64, limit: usize) -> Vec<Value> {
    let terms = parse_query(query);
    let mut hits: Vec<(f64, &Doc)> = docs.iter().filter_map(|d| score(d, &terms, now).map(|s| (s, d))).collect();
    hits.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal).then(b.1.ts.partial_cmp(&a.1.ts).unwrap_or(std::cmp::Ordering::Equal)));
    hits.into_iter()
        .take(limit.clamp(1, 100))
        .map(|(s, d)| {
            json!({
                "kind": d.kind,
                "title": clip(&d.title, 140),
                "snippet": snippet(&d.text, &terms, 200),
                "ts": d.ts as i64,
                "source": d.source,
                "ref": d.r#ref,
                "score": (s * 100.0).round() / 100.0,
            })
        })
        .collect()
}

fn s(v: Option<&Value>) -> String {
    match nn(v) {
        None => String::new(),
        v => to_str(v),
    }
}

fn str_list(v: Option<&Value>) -> String {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; ")).unwrap_or_default()
}

fn doc(kind: &'static str, title: String, text: String, ts: f64, source: String, r#ref: String) -> Doc {
    Doc { kind, title, text, ts, source, r#ref }
}

impl Ctx {
    /// Everything the brain remembers, as search docs. `turns` = include
    /// session conversations (local sessions only).
    pub fn search_docs(&self, turns: bool) -> Result<Vec<Doc>, String> {
        let dir = self.project_dir().dir;
        let root = self.root_path();
        let mut docs: Vec<Doc> = Vec::new();
        for d in read_list(&dir.join("decisions.json")) {
            let text = s(get(&d, "text"));
            if text.is_empty() {
                continue;
            }
            let src = if s(get(&d, "tag")).is_empty() { s(get(&d, "author")) } else { s(get(&d, "tag")) };
            docs.push(doc("decision", clip(&text, 140), text, ts_of(get(&d, "epochMs")), src, s(get(&d, "id"))));
        }
        let b = self.bridge_state();
        let list = |k: &str| get(&b, k).and_then(Value::as_array).cloned().unwrap_or_default();
        for n in list("notes") {
            let text = s(get(&n, "text"));
            docs.push(doc("note", clip(&text, 140), text, ts_of(get(&n, "ts")), s(get(&n, "by")), s(get(&n, "id"))));
        }
        for p in list("plans") {
            let tasks = get(&p, "tasks").and_then(Value::as_array).map(|t| js::join(t.iter().map(|t| get(t, "title")), "; ")).unwrap_or_default();
            let text = format!("{}\n{}\n{tasks}", s(get(&p, "title")), s(get(&p, "decision")));
            docs.push(doc("plan", s(get(&p, "title")), text, ts_of(get(&p, "ts")), s(get(&p, "status")), s(get(&p, "id"))));
        }
        for q in list("questions") {
            let text = format!("{}\n{}\n{}", s(get(&q, "question")), s(get(&q, "context")), s(get(&q, "answer")));
            let who = s(nn(get(&q, "fromTitle")).or(get(&q, "from")));
            docs.push(doc("question", clip(&s(get(&q, "question")), 140), text, ts_of(get(&q, "ts")), who, s(get(&q, "id"))));
        }
        for h in list("handoffs") {
            let reply = get(&h, "result").map(|r| s(get(r, "summary"))).unwrap_or_default();
            let text = format!("{}\n{reply}", s(get(&h, "message")));
            let who = s(nn(get(&h, "sessionTitle")).or(get(&h, "session")));
            docs.push(doc("handoff", clip(&s(get(&h, "message")), 140), text, ts_of(get(&h, "ts")), who, s(get(&h, "session"))));
        }
        // goal history: every goal ever set (team brain), plus the current one
        let mut goals: Vec<(String, f64)> = read_list(&dir.join("brain.json"))
            .iter()
            .filter(|e| get(e, "kind").and_then(Value::as_str) == Some("goal"))
            .map(|e| (s(get(e, "text")), ts_of(get(e, "ts"))))
            .collect();
        let cur = s(get(&b, "goal"));
        if !cur.is_empty() && !goals.iter().any(|(g, _)| *g == cur) {
            goals.push((cur, ts_of(get(&b, "goalTs"))));
        }
        for (g, ts) in goals.into_iter().filter(|(g, _)| !g.is_empty()) {
            docs.push(doc("goal", clip(&g, 140), g, ts, String::new(), String::new()));
        }
        for l in read_list(&root.join("lessons.json")) {
            let name = s(nn(get(&l, "name")).or(get(&l, "project")));
            let text = format!(
                "{}\nstack: {}\nworked: {}\navoid: {}\nreuse: {}",
                s(get(&l, "summary")),
                str_list(get(&l, "stack")),
                str_list(get(&l, "worked")),
                str_list(get(&l, "mistakes")),
                str_list(get(&l, "reuse"))
            );
            docs.push(doc("lesson", name, text, js::to_num(get(&l, "date")) * 1000.0, String::new(), s(get(&l, "project"))));
        }
        if let Value::Object(all) = read_json_or(&dir.join("reviews.json"), json!({})) {
            for (id, r) in all {
                let who = if s(get(&r, "session")).is_empty() { id.clone() } else { s(get(&r, "session")) };
                let text = format!("{}\n{}\n{}", s(get(&r, "summary")), str_list(get(&r, "risks")), s(get(&r, "reason")));
                docs.push(doc("review", format!("{who}: {}", s(get(&r, "verdict"))), text, ts_of(get(&r, "ts")), who, id));
            }
        }
        let mut seen = std::collections::HashSet::new();
        for m in self.members() {
            let id = s(get(&m, "id"));
            let label = self.label(&m);
            let repo = s(get(&m, "repoPath"));
            // worktrees share history: a commit is listed once, under the first session that has it
            for line in super::data::git(&repo, &["log", "-200", "--format=%h%x1f%ct%x1f%s"]).lines() {
                let mut it = line.split('\u{1f}');
                let (Some(h), Some(ct), Some(subj)) = (it.next(), it.next(), it.next()) else { continue };
                if !seen.insert(h.to_string()) {
                    continue;
                }
                let ts = js::str_to_num(ct) * 1000.0;
                docs.push(doc("commit", self.r(subj.to_string()), self.r(subj.to_string()), if ts.is_nan() { 0.0 } else { ts }, label.clone(), format!("{id}:{h}")));
            }
            if turns {
                for (i, t) in self.turns(&m)?.0.iter().enumerate() {
                    let text = format!("{}\n{}", t.ask, t.reply);
                    docs.push(doc("turn", clip(&t.ask, 140), text, ts_of(t.at.as_ref()), label.clone(), format!("{id}:{i}")));
                }
            }
        }
        Ok(docs)
    }

    /// Ranked results for `query` (JSON objects, see `rank`).
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Value>, String> {
        let turns = !(self.remote.on && self.remote.no_transcripts);
        Ok(rank(&self.search_docs(turns)?, query, js::now_ms(), limit))
    }

    /// The MCP tool's text: numbered results, one per line.
    pub fn search_text(&self, query: &str, limit: usize) -> Result<String, String> {
        let q = js::trim(query);
        if q.is_empty() {
            return Err("query is required".into());
        }
        let hits = self.search(q, limit)?;
        if hits.is_empty() {
            return Ok(format!("Nothing in the brain matches \"{q}\"."));
        }
        let lines: Vec<String> = hits
            .iter()
            .enumerate()
            .map(|(i, h)| {
                let ts = js::to_num(get(h, "ts"));
                let when = if ts > 0.0 { ago_f(ts) } else { String::new() };
                let src = s(get(h, "source"));
                let meta: Vec<String> = [when, src].into_iter().filter(|x| !x.is_empty()).collect();
                let meta = if meta.is_empty() { String::new() } else { format!(" ({})", meta.join(" · ")) };
                let snip = s(get(h, "snippet"));
                let title = s(get(h, "title"));
                let body = if snip.is_empty() || snip == title { String::new() } else { format!("\n   {snip}") };
                format!("{}. [{}] {title}{meta}{body}", i + 1, s(get(h, "kind")))
            })
            .collect();
        Ok(format!("{} result{} for \"{q}\":\n{}", hits.len(), if hits.len() == 1 { "" } else { "s" }, lines.join("\n")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(kind: &'static str, title: &str, text: &str, ts: f64) -> Doc {
        doc(kind, title.into(), text.into(), ts, String::new(), String::new())
    }

    #[test]
    fn parses_words_phrases_and_drops_filler() {
        assert_eq!(parse_query("Why did we pick Postgres?"), vec!["postgres"]);
        assert_eq!(parse_query("when did we add login"), vec!["add", "login"]);
        assert_eq!(parse_query("\"google login\" oauth"), vec!["google login", "oauth"]);
        assert_eq!(parse_query("  “dark   mode” first "), vec!["dark mode", "first"]);
        assert_eq!(parse_query("the"), vec!["the"], "all filler: keep it");
        assert_eq!(parse_query("\"unterminated phrase"), vec!["unterminated", "phrase"]);
        assert_eq!(parse_query("src/app.ts fix-login"), vec!["src/app.ts", "fix-login"]);
        assert!(parse_query("   ").is_empty());
        assert_eq!(parse_query("a b c d e f g h i j k l m n o p q r s t u v w x y z").len(), 12);
    }

    #[test]
    fn every_term_must_match() {
        let doc = d("note", "Use Postgres", "We picked Postgres over SQLite for JSON columns", 0.0);
        assert!(score(&doc, &parse_query("postgres json"), 0.0).is_some());
        assert!(score(&doc, &parse_query("postgres redis"), 0.0).is_none());
        assert!(score(&doc, &parse_query("\"postgres over sqlite\""), 0.0).is_some());
        assert!(score(&doc, &parse_query("\"sqlite over postgres\""), 0.0).is_none());
        assert!(score(&doc, &[], 0.0).is_none());
    }

    #[test]
    fn title_hits_frequency_and_recency_rank() {
        let now = 10.0 * 86_400_000.0;
        let docs = vec![
            d("note", "misc", "postgres mentioned once", now - 9.0 * 86_400_000.0),
            d("note", "Postgres", "postgres postgres", now - 9.0 * 86_400_000.0),
            d("note", "misc", "postgres mentioned once, but today", now),
        ];
        let r = rank(&docs, "postgres", now, 10);
        assert_eq!(r.len(), 3);
        assert_eq!(r[0]["title"], "Postgres", "title + frequency wins");
        assert_eq!(r[1]["snippet"], "postgres mentioned once, but today", "recency breaks the tie");
        assert_eq!(rank(&docs, "postgres", now, 1).len(), 1);
        assert!(rank(&docs, "mysql", now, 10).is_empty());
    }

    #[test]
    fn decisions_outrank_equal_notes() {
        let docs = vec![d("note", "x", "use redis", 0.0), d("decision", "x", "use redis", 0.0)];
        assert_eq!(rank(&docs, "redis", 0.0, 5)[0]["kind"], "decision");
    }

    #[test]
    fn snippets_center_on_the_match() {
        let long = format!("{} the login flow uses Google OAuth {}", "lorem ".repeat(60), "ipsum ".repeat(60));
        let sn = snippet(&long, &["oauth".to_string()], 60);
        assert!(sn.starts_with('…') && sn.ends_with('…'), "{sn}");
        assert!(sn.contains("OAuth"), "{sn}");
        assert_eq!(snippet("short text", &["text".to_string()], 60), "short text");
        // multi-byte text before the hit doesn't break char indexing
        let sn = snippet("ééééé café menu", &["menu".to_string()], 8);
        assert!(sn.contains("menu"), "{sn}");
    }

    #[test]
    fn searches_project_files() {
        let home = std::env::temp_dir().join(format!("grillme-search-{}-{}", std::process::id(), js::now_ms()));
        let g = home.join(".grillme");
        std::fs::create_dir_all(&g).unwrap();
        let now = js::now_ms() as i64;
        std::fs::write(g.join("decisions.json"), json!([{ "id": "d-1", "text": "Use Postgres for the leaderboard", "epochMs": now, "author": "me" }]).to_string()).unwrap();
        std::fs::write(
            g.join("bridge.json"),
            json!({ "goal": "Leaderboard app", "goalTs": now, "notes": [{ "id": "n", "ts": now, "text": "postgres needs a migration" }], "plans": [],
                "handoffs": [{ "id": "h", "ts": now, "session": "s1", "message": "Add the leaderboard API", "result": { "summary": "Postgres table added" } }],
                "questions": [{ "id": "q", "ts": now, "from": "s1", "question": "Which DB?", "answer": "Postgres" }] })
            .to_string(),
        )
        .unwrap();
        std::fs::write(g.join("brain.json"), json!([{ "id": "g1", "kind": "goal", "ts": 1, "text": "Old goal: chess app" }]).to_string()).unwrap();
        std::fs::write(g.join("reviews.json"), json!({ "s1": { "verdict": "ship", "summary": "Postgres schema looks right", "ts": now } }).to_string()).unwrap();
        std::fs::write(home.join(".grillme").join("lessons.json"), json!([{ "project": "old", "name": "Old hack", "date": "1", "summary": "Postgres was slow to set up" }]).to_string()).unwrap();
        let h = home.to_string_lossy().into_owned();
        let ctx = Ctx { root: format!("{h}/.grillme"), home: h, remote: Default::default(), scope: None, forced: None };
        let r = ctx.search("postgres", 20).unwrap();
        let kinds: Vec<&str> = r.iter().filter_map(|x| x["kind"].as_str()).collect();
        for k in ["decision", "note", "handoff", "question", "review", "lesson"] {
            assert!(kinds.contains(&k), "{k} in {kinds:?}");
        }
        assert_eq!(r[0]["kind"], "decision");
        let goals = ctx.search("chess", 5).unwrap();
        assert_eq!(goals[0]["kind"], "goal");
        let text = ctx.search_text("postgres leaderboard", 5).unwrap();
        assert!(text.starts_with("2 results for \"postgres leaderboard\":\n1. [decision] Use Postgres for the leaderboard"), "{text}");
        assert!(ctx.search_text(" ", 5).is_err());
        assert!(ctx.search_text("zebra", 5).unwrap().contains("Nothing in the brain matches"));
        let _ = std::fs::remove_dir_all(home);
    }
}
