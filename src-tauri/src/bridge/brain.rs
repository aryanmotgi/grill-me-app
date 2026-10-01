// ---------------------------------------------------------------------------
// Brain upgrades: the brain notices things on its own and remembers across
// projects.
//
// * Auto decisions — agreed decisions ("let's use Postgres") spotted in a
//   session's turn (piggybacks on brain_check's model call) or a Grill Me
//   Chat reply become proposals in bridge.json `decisionProposals`. Nothing
//   is logged until the user clicks Save (then the UI's addDecision syncs it).
// * Brain search — ranked search over everything (gathered + scored by the
//   MCP binary, `--search=`), plus an on-demand "why…?" answer (Haiku).
// * Drift alarm — sessions building in contradicting directions (Sonnet over
//   `--drift-input`). Throttling + dismiss memory live in the UI.
// * Starter kits — wrap-up also saves stack, key decisions, reusable file
//   paths (never contents) and playbook tweaks to ~/.grillme/starter-kits.json;
//   Kickoff can start from one and copy the chosen files after a confirm.
// ---------------------------------------------------------------------------

use super::{claude_quick, extract_json, install, load, now_ms, read_json, root, run_script, save, BRIDGE_LOCK};
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;

fn clip(s: &str, n: usize) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(n).collect()
}

// ---- decision similarity ------------------------------------------------------

const STOP: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "its", "of", "on", "or", "our", "so", "that", "the",
    "this", "to", "use", "using", "we", "well", "will", "with", "lets", "let", "go", "just", "should", "ll", "ve", "re", "s", "d",
];

/// Content words of a decision: lowercase, punctuation dropped, filler out,
/// a trailing plural "s" trimmed (so "use tokens" ≈ "use token").
pub(crate) fn decision_words(s: &str) -> Vec<String> {
    let flat: String = s.to_lowercase().chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect();
    let mut out: Vec<String> = Vec::new();
    for w in flat.split_whitespace().filter(|w| !STOP.contains(w)) {
        let w = if w.len() > 3 && w.ends_with('s') && !w.ends_with("ss") { &w[..w.len() - 1] } else { w };
        if !out.iter().any(|x| x == w) {
            out.push(w.to_string());
        }
    }
    out
}

/// Same decision in other words? Jaccard ≥ 0.6 over content words, or one
/// side's words (≥ 2 of them) all contained in the other's.
pub(crate) fn similar(a: &str, b: &str) -> bool {
    let (x, y) = (decision_words(a), decision_words(b));
    if x.is_empty() || y.is_empty() {
        return a.trim().eq_ignore_ascii_case(b.trim());
    }
    let inter = x.iter().filter(|w| y.contains(w)).count();
    let union = x.len() + y.len() - inter;
    let (small, big) = if x.len() <= y.len() { (&x, &y) } else { (&y, &x) };
    (inter as f64 / union as f64) >= 0.6 || (small.len() >= 2 && small.iter().all(|w| big.contains(w)))
}

// ---- decision proposals ---------------------------------------------------------

/// Model output → (text, quote) pairs: at most 3, trimmed, capped.
pub(crate) fn parse_spotted(v: &Value) -> Vec<(String, String)> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|d| {
                    let text = clip(d["text"].as_str()?, 200);
                    (text.len() >= 4).then(|| (text, clip(d["quote"].as_str().unwrap_or(""), 300)))
                })
                .take(3)
                .collect()
        })
        .unwrap_or_default()
}

const PROPOSAL_CAP: usize = 100;

/// Append spotted decisions as pending proposals, skipping any that match a
/// logged decision or an earlier proposal (saved, dismissed or pending —
/// a dismissed one never comes back). Returns the proposals added.
pub(crate) fn add_proposals(v: &mut Value, logged: &[String], source: &str, items: &[(String, String)], now: u64) -> Vec<Value> {
    if !v["decisionProposals"].is_array() {
        v["decisionProposals"] = json!([]);
    }
    let mut added = Vec::new();
    for (i, (text, quote)) in items.iter().enumerate() {
        let list = v["decisionProposals"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        let dup = logged.iter().any(|d| similar(d, text)) || list.iter().any(|p| p["text"].as_str().is_some_and(|t| similar(t, text)));
        if dup {
            continue;
        }
        let p = json!({ "id": format!("dp-{now:x}-{i}"), "text": text, "source": clip(source, 120), "quote": quote, "ts": now, "status": "pending" });
        if let Some(a) = v["decisionProposals"].as_array_mut() {
            a.push(p.clone());
        }
        added.push(p);
    }
    if let Some(a) = v["decisionProposals"].as_array_mut() {
        while a.len() > PROPOSAL_CAP {
            let i = a.iter().position(|p| p["status"] != "pending").unwrap_or(0);
            a.remove(i);
        }
    }
    added
}

fn logged_decisions() -> Vec<String> {
    read_json(&super::project_dir().join("decisions.json"))
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|d| d["text"].as_str().map(str::to_owned))
        .collect()
}

/// Store spotted decisions as proposals for the active project. Returns how many were new.
pub(crate) fn propose(source: &str, items: &[(String, String)]) -> Result<usize, String> {
    if items.is_empty() {
        return Ok(0);
    }
    let logged = logged_decisions();
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    let added = add_proposals(&mut v, &logged, source, items, now_ms());
    if !added.is_empty() {
        save(&v)?;
    }
    Ok(added.len())
}

/// Added to brain_check's prompt when "Spot decisions automatically" is on —
/// the same model call, one more field.
pub(crate) const SPOT_ADDENDUM: &str = " Also add \"decisions\": [{\"text\": string, \"quote\": string}] — choices the user and the session clearly AGREED on in this turn \
(e.g. \"let's use Postgres\", \"we'll skip OAuth\") that aren't already in the input decisions. text = the decision as one short sentence; \
quote = the few words from the turn that show it was agreed. Never suggestions, options still open, or questions. Usually empty; at most 3.";

const SPOT_PROMPT: &str = "You spot decisions in a brainstorm chat between a developer and Claude about their hackathon project. \
The input JSON has the decisions already logged and the chat's previous and latest turn. \
Reply with ONLY a JSON object, no prose, no fences: {\"decisions\": [{\"text\": string, \"quote\": string}]}. \
A decision counts only when it was clearly AGREED in the latest turn (the user proposed or confirmed it, e.g. \"let's use Postgres\", \"we'll skip OAuth\") \
and isn't already logged. text = the decision as one short sentence; quote = the few words that show it was agreed. \
Never options still being weighed, suggestions the user didn't accept, or questions. Usually empty; at most 3.";

/// After a Grill Me Chat reply lands: spot agreed decisions in it. Returns
/// how many new proposals were stored.
#[tauri::command(async)]
pub(crate) fn brain_spot_chat(app: tauri::AppHandle, chat_id: String) -> Result<usize, String> {
    let ok = chat_id.len() == 36 && chat_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    if !ok {
        return Err("bad chat id".into());
    }
    install();
    let input = run_script(&["--chat-input", &chat_id])?;
    if input.trim().is_empty() {
        return Ok(0);
    }
    let source = serde_json::from_str::<Value>(&input).ok().and_then(|v| v["source"].as_str().map(str::to_owned)).unwrap_or_else(|| "Grill Me Chat".into());
    let r = extract_json(&claude_quick(&input, SPOT_PROMPT, "haiku")?).ok_or("decision check returned no JSON")?;
    let n = propose(&source, &parse_spotted(&r["decisions"]))?;
    if n > 0 {
        let _ = app.emit("bridge-changed", ());
    }
    Ok(n)
}

/// Save (after the UI logged it) or dismiss a proposal.
#[tauri::command]
pub(crate) fn decision_proposal_resolve(id: String, status: String) -> Result<(), String> {
    if !["saved", "dismissed"].contains(&status.as_str()) {
        return Err("bad status".into());
    }
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    let mut v = load();
    let p = v["decisionProposals"].as_array_mut().and_then(|a| a.iter_mut().find(|p| p["id"] == id.as_str())).ok_or("not found")?;
    p["status"] = json!(status);
    p["resolvedTs"] = json!(now_ms());
    save(&v)
}

// ---- brain search -------------------------------------------------------------------

fn valid_query(q: &str) -> Result<String, String> {
    let q = q.trim();
    if q.is_empty() || q.len() > 300 {
        return Err("search for 1-300 characters".into());
    }
    Ok(q.replace(['\n', '\r'], " "))
}

/// Ranked results over everything the brain remembers.
#[tauri::command(async)]
pub(crate) fn brain_search(query: String, limit: Option<u32>) -> Result<Value, String> {
    let q = valid_query(&query)?;
    let n = limit.unwrap_or(40).clamp(1, 100);
    let out = run_script(&[&format!("--search={q}"), &format!("--limit={n}")])?;
    serde_json::from_str(out.trim()).map_err(|_| "search failed".to_string())
}

const WHY_PROMPT: &str = "Answer the developer's question about their project using ONLY the numbered search results in the input JSON \
(decisions, notes, plans, commits, conversations, reviews…). Write at most 2 sentences, plain text, and cite the results you used by number like [3]. \
If the results don't answer it, say that in one sentence. No preamble.";

/// "Answer with Claude": a 2-sentence answer over the top 12 results, with citations.
#[tauri::command(async)]
pub(crate) fn brain_search_answer(query: String) -> Result<String, String> {
    let results = brain_search(query.clone(), Some(12))?;
    let list = results.as_array().cloned().unwrap_or_default();
    if list.is_empty() {
        return Ok("Nothing in the brain matches that yet.".into());
    }
    let numbered: Vec<Value> = list
        .iter()
        .enumerate()
        .map(|(i, r)| json!({ "n": i + 1, "kind": r["kind"], "title": r["title"], "text": r["snippet"], "ts": r["ts"], "source": r["source"] }))
        .collect();
    let input = json!({ "question": query.trim(), "results": numbered });
    let reply = claude_quick(&input.to_string(), WHY_PROMPT, "haiku")?;
    Ok(clip(&reply, 800))
}

// ---- drift alarm ----------------------------------------------------------------------

const DRIFT_PROMPT: &str = "You watch several AI coding sessions building one hackathon project in parallel. \
The input JSON has the goal, decisions, each active session on this Mac (last asks, tools, changed files, branch) and teammates' sessions (one-line status). \
Find pairs working in CONTRADICTING directions: competing versions of the same thing (one builds email login while another builds Google login), \
the same module edited with incompatible approaches, or one undoing another's work. Different features in parallel are NOT conflicts, \
and touching the same files isn't one either unless the approaches clash. \
Reply with ONLY a JSON object, no prose, no fences: {\"conflicts\": [{\"a\": string, \"b\": string, \"why\": string, \"suggestion\": string}]}. \
a and b = session names exactly as in the input; why = one short sentence; suggestion = one short sentence on who should change what. \
At most 3. An empty list when they're fine — the usual case.";

/// Validate drift output: known, distinct names; a reason; at most 3.
pub(crate) fn parse_drift(r: &Value, names: &[String]) -> Vec<Value> {
    let known = |n: &str| names.iter().any(|x| x == n);
    r["conflicts"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let (x, y) = (c["a"].as_str()?.trim(), c["b"].as_str()?.trim());
                    let why = clip(c["why"].as_str()?, 240);
                    (known(x) && known(y) && x != y && !why.is_empty())
                        .then(|| json!({ "a": x, "b": y, "why": why, "suggestion": clip(c["suggestion"].as_str().unwrap_or(""), 240) }))
                })
                .take(3)
                .collect()
        })
        .unwrap_or_default()
}

/// Are any sessions drifting apart? `{conflicts: […]}` (empty when fine or
/// fewer than two sessions are active). Throttled by the caller.
#[tauri::command(async)]
pub(crate) fn brain_drift() -> Result<Value, String> {
    install();
    let input = run_script(&["--drift-input"])?;
    if input.trim().is_empty() {
        return Ok(json!({ "conflicts": [] }));
    }
    let parsed: Value = serde_json::from_str(&input).unwrap_or_default();
    let names: Vec<String> = ["sessions", "teammates"]
        .iter()
        .flat_map(|k| parsed[*k].as_array().cloned().unwrap_or_default())
        .filter_map(|s| s["name"].as_str().map(str::to_owned))
        .collect();
    let r = extract_json(&claude_quick(&input, DRIFT_PROMPT, "sonnet")?).ok_or("drift check returned no JSON")?;
    Ok(json!({ "conflicts": parse_drift(&r, &names) }))
}

// ---- starter kits ---------------------------------------------------------------------

/// Appended to the wrap-up prompt: the kit rides in the same call.
pub(crate) const KIT_ADDENDUM: &str = " Also include \"kit\": {\"stack\": string[], \"decisions\": string[] (key decisions worth repeating next time), \
\"files\": [{\"path\": string, \"purpose\": string}] (up to 10 reusable files picked ONLY from the input's `files` list — setup, config, auth, API clients, \
UI primitives that would save time at the next hackathon; never app-specific screens), \"playbook\": string[] (tweaks to our hackathon playbooks)}. \
purpose = one short line.";

static KITS_LOCK: Mutex<()> = Mutex::new(());

fn kits_path() -> PathBuf {
    root().join("starter-kits.json")
}

fn list_of(v: &Value, n: usize, cap: usize) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_str).map(|s| clip(s, cap)).filter(|s| !s.is_empty()).take(n).collect())
        .unwrap_or_default()
}

/// Model kit → stored kit. Files must be from the candidate list (no
/// invented paths), never secret-named; each gets the worktree + main
/// checkout it came from (paths only, never contents).
pub(crate) fn parse_kit(kit: &Value, candidates: &[Value], repos: &Value) -> Value {
    let files: Vec<Value> = kit["files"]
        .as_array()
        .map(|a| {
            let mut seen = Vec::new();
            a.iter()
                .filter_map(|f| {
                    let path = f["path"].as_str()?.trim();
                    let c = candidates.iter().find(|c| c["path"] == path)?;
                    if crate::mcp::secret_file(path) || seen.contains(&path.to_string()) {
                        return None;
                    }
                    seen.push(path.to_string());
                    let session = c["session"].as_str().unwrap_or("");
                    Some(json!({
                        "path": path,
                        "purpose": clip(f["purpose"].as_str().unwrap_or(""), 160),
                        "session": session,
                        "repo": repos[session]["worktree"].as_str().unwrap_or(""),
                        "main": repos[session]["main"].as_str().unwrap_or(""),
                    }))
                })
                .take(15)
                .collect()
        })
        .unwrap_or_default();
    json!({
        "stack": list_of(&kit["stack"], 8, 80),
        "decisions": list_of(&kit["decisions"], 8, 200),
        "files": files,
        "playbook": list_of(&kit["playbook"], 5, 200),
    })
}

/// Save (replace) a project's starter kit.
pub(crate) fn save_kit(project: &str, name: &str, kit: Value) -> Result<Value, String> {
    let mut entry = kit;
    entry["project"] = json!(project);
    entry["name"] = json!(clip(name, 80));
    entry["date"] = json!(format!("{}", now_ms() / 1000));
    let _g = crate::lock_or_recover(&KITS_LOCK);
    let path = kits_path();
    let mut all: Vec<Value> = read_json(&path).and_then(|v| v.as_array().cloned()).unwrap_or_default();
    all.retain(|k| k["project"] != entry["project"]);
    all.push(entry.clone());
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(entry)
}

fn kits() -> Vec<Value> {
    read_json(&kits_path()).and_then(|v| v.as_array().cloned()).unwrap_or_default()
}

/// Every starter kit, newest first.
#[tauri::command]
pub(crate) fn starter_kits_read() -> Value {
    let mut all = kits();
    all.reverse();
    Value::Array(all)
}

/// A kit as Kickoff's prompt sees it (no local paths).
pub(crate) fn kit_for_prompt(project: &str) -> Option<Value> {
    let k = kits().into_iter().find(|k| k["project"] == project)?;
    let files: Vec<Value> = k["files"].as_array().map(|a| a.iter().map(|f| json!({ "path": f["path"], "purpose": f["purpose"] })).collect()).unwrap_or_default();
    Some(json!({ "from": k["name"], "stack": k["stack"], "decisions": k["decisions"], "reusableFiles": files, "playbook": k["playbook"] }))
}

const COPY_MAX_BYTES: u64 = 1_000_000;

/// A kit-relative path that can't climb out: relative, no `..`, not empty.
fn plain_rel(p: &str) -> bool {
    let path = Path::new(p);
    !p.is_empty() && p.len() < 400 && path.components().all(|c| matches!(c, Component::Normal(_)))
}

/// The real source file for `rel` under one of `roots`, refusing symlinks,
/// anything resolving outside its root, non-files and big files.
fn source_file(rel: &str, roots: &[&str]) -> Result<PathBuf, String> {
    let mut last = "not found in the old repo".to_string();
    for r in roots.iter().filter(|r| !r.is_empty()) {
        let Ok(root) = std::fs::canonicalize(r) else { continue };
        let p = root.join(rel);
        let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
        if meta.file_type().is_symlink() {
            last = "is a symlink".into();
            continue;
        }
        let Ok(real) = std::fs::canonicalize(&p) else { continue };
        if !real.starts_with(&root) {
            last = "resolves outside the old repo".into();
            continue;
        }
        if !meta.is_file() {
            last = "not a file".into();
            continue;
        }
        if meta.len() > COPY_MAX_BYTES {
            last = "over 1 MB".into();
            continue;
        }
        return Ok(real);
    }
    Err(last)
}

/// Copy the chosen kit files into `dest` (a repo). Only paths the kit
/// lists; never secret-named files; never over an existing file.
pub(crate) fn copy_kit_files(kit: &Value, paths: &[String], dest: &Path) -> Result<Value, String> {
    let dest = std::fs::canonicalize(dest).map_err(|_| "the new repo folder doesn't exist".to_string())?;
    if !dest.join(".git").exists() {
        return Err("the destination isn't a git repo".into());
    }
    let mut copied = Vec::new();
    let mut skipped = Vec::new();
    for rel in paths.iter().take(30) {
        let skip = |why: &str| json!({ "path": rel, "why": why });
        let Some(f) = kit["files"].as_array().and_then(|a| a.iter().find(|f| f["path"] == rel.as_str())) else {
            skipped.push(skip("not in this kit"));
            continue;
        };
        if !plain_rel(rel) {
            skipped.push(skip("path climbs out of the repo"));
            continue;
        }
        if crate::mcp::secret_file(rel) {
            skipped.push(skip("secret-named file"));
            continue;
        }
        let src = match source_file(rel, &[f["repo"].as_str().unwrap_or(""), f["main"].as_str().unwrap_or("")]) {
            Ok(s) => s,
            Err(why) => {
                skipped.push(skip(&why));
                continue;
            }
        };
        let target = dest.join(rel);
        if std::fs::symlink_metadata(&target).is_ok() {
            skipped.push(skip("already exists in the new repo"));
            continue;
        }
        let Some(parent) = target.parent() else {
            skipped.push(skip("bad path"));
            continue;
        };
        if std::fs::create_dir_all(parent).is_err() || !std::fs::canonicalize(parent).is_ok_and(|p| p.starts_with(&dest)) {
            skipped.push(skip("can't create its folder inside the new repo"));
            continue;
        }
        match std::fs::copy(&src, &target) {
            Ok(_) => copied.push(json!(rel)),
            Err(e) => skipped.push(skip(&e.to_string())),
        }
    }
    Ok(json!({ "copied": copied, "skipped": skipped }))
}

/// Kickoff's explicit "copy these files" (after the user confirmed).
#[tauri::command]
pub(crate) fn starter_kit_copy(project: String, paths: Vec<String>, dest: String) -> Result<Value, String> {
    let kit = kits().into_iter().find(|k| k["project"] == project.as_str()).ok_or("no starter kit for that project")?;
    copy_kit_files(&kit, &paths, Path::new(&dest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn similar_decisions_match() {
        assert!(similar("Use Postgres for the database", "We'll use postgres for the database."));
        assert!(similar("Skip OAuth", "skip oauth for v1")); // containment
        assert!(similar("Light theme only", "light theme only!"));
        assert!(!similar("Use Postgres", "Use Redis"));
        assert!(!similar("Google login only", "Email login with magic links"));
        assert!(similar("Use JWT tokens", "use jwt token"));
        assert!(!similar("", "x"));
    }

    #[test]
    fn spotted_decisions_are_validated() {
        let v = json!([{ "text": "  Use   Postgres ", "quote": "let's use postgres" }, { "text": "no" }, { "quote": "x" }, { "text": "a" }, { "text": "b4ever" }, { "text": "c-side" }, { "text": "d-day" }]);
        let p = parse_spotted(&v);
        assert_eq!(p.len(), 3);
        assert_eq!(p[0], ("Use Postgres".to_string(), "let's use postgres".to_string()));
        assert!(parse_spotted(&json!("nope")).is_empty());
    }

    #[test]
    fn proposals_dedupe_against_log_and_each_other() {
        let mut v = json!({});
        let logged = vec!["Use Postgres for storage".to_string()];
        let items = vec![
            ("We'll use Postgres for storage".to_string(), "q".to_string()),
            ("Skip OAuth for v1".to_string(), "we'll skip oauth".to_string()),
            ("skip oauth for v1".to_string(), "dup in the same batch".to_string()),
        ];
        let added = add_proposals(&mut v, &logged, "Auth session", &items, 7);
        assert_eq!(added.len(), 1);
        assert_eq!(added[0]["text"], "Skip OAuth for v1");
        assert_eq!(added[0]["status"], "pending");
        assert_eq!(added[0]["source"], "Auth session");
        // dismissed proposals never come back
        v["decisionProposals"][0]["status"] = json!("dismissed");
        assert!(add_proposals(&mut v, &[], "Chat", &[("Skip OAuth for v1".into(), String::new())], 8).is_empty());
        // capped: resolved ones go first
        let many: Vec<(String, String)> = (0..120).map(|i| (format!("decision number {i} unique{i}"), String::new())).collect();
        add_proposals(&mut v, &[], "x", &many, 9);
        let list = v["decisionProposals"].as_array().unwrap();
        assert_eq!(list.len(), PROPOSAL_CAP);
        assert!(list.iter().all(|p| p["status"] == "pending"));
    }

    #[test]
    fn drift_output_is_validated() {
        let names = vec!["Auth".to_string(), "Maya's Login".to_string(), "UI".to_string()];
        let r = json!({ "conflicts": [
            { "a": "Auth", "b": "Maya's Login", "why": "email vs Google login", "suggestion": "Pick Google" },
            { "a": "Auth", "b": "Auth", "why": "self" },
            { "a": "Ghost", "b": "UI", "why": "unknown name" },
            { "a": "UI", "b": "Auth", "why": "  " },
            { "a": "UI", "b": "Auth", "why": "x" }, { "a": "UI", "b": "Auth", "why": "y" }, { "a": "UI", "b": "Auth", "why": "z" },
        ] });
        let c = parse_drift(&r, &names);
        assert_eq!(c.len(), 3);
        assert_eq!(c[0]["why"], "email vs Google login");
        assert!(parse_drift(&json!({}), &names).is_empty());
    }

    #[test]
    fn kit_files_come_only_from_candidates() {
        let candidates = vec![json!({ "session": "Auth", "path": "lib/auth.ts" }), json!({ "session": "Auth", "path": ".env.local" })];
        let repos = json!({ "Auth": { "worktree": "/w/auth", "main": "/m" } });
        let kit = json!({ "stack": ["Next.js", 3], "decisions": ["Magic links"], "playbook": [],
            "files": [{ "path": "lib/auth.ts", "purpose": "auth helper" }, { "path": "invented.ts" }, { "path": ".env.local" }, { "path": "lib/auth.ts" }] });
        let k = parse_kit(&kit, &candidates, &repos);
        assert_eq!(k["stack"], json!(["Next.js"]));
        let files = k["files"].as_array().unwrap();
        assert_eq!(files.len(), 1, "{files:?}");
        assert_eq!(files[0]["repo"], "/w/auth");
        assert_eq!(files[0]["main"], "/m");
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("grillme-kit-{tag}-{}-{}", std::process::id(), now_ms()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn copies_kit_files_safely() {
        let old = tmp("old");
        let new = tmp("new");
        let outside = tmp("outside");
        std::fs::create_dir_all(old.join("lib")).unwrap();
        std::fs::write(old.join("lib/auth.ts"), "export const auth = 1;").unwrap();
        std::fs::write(old.join(".env"), "SECRET=1").unwrap();
        std::fs::write(outside.join("x.ts"), "nope").unwrap();
        std::os::unix::fs::symlink(outside.join("x.ts"), old.join("lib/link.ts")).unwrap();
        std::fs::create_dir_all(new.join(".git")).unwrap();
        std::fs::create_dir_all(new.join("lib")).unwrap();
        std::fs::write(new.join("lib/taken.ts"), "mine").unwrap();
        std::fs::write(old.join("lib/taken.ts"), "theirs").unwrap();
        let repo = old.to_string_lossy().into_owned();
        let f = |p: &str| json!({ "path": p, "repo": repo, "main": "" });
        let kit = json!({ "files": [f("lib/auth.ts"), f(".env"), f("lib/link.ts"), f("../outside/x.ts"), f("lib/taken.ts"), f("lib/missing.ts")] });
        let paths: Vec<String> = ["lib/auth.ts", ".env", "lib/link.ts", "../outside/x.ts", "lib/taken.ts", "lib/missing.ts", "not/in/kit.ts"].iter().map(|s| s.to_string()).collect();
        let r = copy_kit_files(&kit, &paths, &new).unwrap();
        assert_eq!(r["copied"], json!(["lib/auth.ts"]));
        assert_eq!(std::fs::read_to_string(new.join("lib/auth.ts")).unwrap(), "export const auth = 1;");
        let why = |p: &str| r["skipped"].as_array().unwrap().iter().find(|s| s["path"] == p).map(|s| s["why"].as_str().unwrap().to_string()).unwrap();
        assert_eq!(why(".env"), "secret-named file");
        assert_eq!(why("lib/link.ts"), "is a symlink");
        assert_eq!(why("../outside/x.ts"), "path climbs out of the repo");
        assert_eq!(why("lib/taken.ts"), "already exists in the new repo");
        assert_eq!(why("lib/missing.ts"), "not found in the old repo");
        assert_eq!(why("not/in/kit.ts"), "not in this kit");
        assert_eq!(std::fs::read_to_string(new.join("lib/taken.ts")).unwrap(), "mine", "never overwrites");
        assert!(!new.join(".env").exists());
        // not a repo: refused outright
        assert!(copy_kit_files(&kit, &paths, &outside).is_err());
        for d in [old, new, outside] {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}
