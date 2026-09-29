// ---------------------------------------------------------------------------
// Claude bridge: Grill Me as the hub between the Claude app (brainstorm) and
// Claude Code sessions (coders), via the grill-me MCP server.
//
// * bridge.json (per project) holds handoffs, questions, plans, and notes.
//   Writes are serialized here (API thread + Tauri commands share one lock).
// * The MCP server script is embedded and installed to ~/.grillme/bin; the
//   hackathon skill playbooks are seeded to ~/.grillme/skills (never
//   overwritten — they're the user's to edit).
// * bridge_connect registers the MCP server with the Claude desktop app and
//   Claude Code (user scope).
// ---------------------------------------------------------------------------

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

pub(crate) const MCP_SCRIPT: &str = include_str!("grillme-mcp.mjs");
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

/// Install/refresh the MCP server script and seed missing skill playbooks.
pub(crate) fn install() {
    let bin = root().join("bin");
    let _ = std::fs::create_dir_all(&bin);
    let script = bin.join("grillme-mcp.mjs");
    if std::fs::read_to_string(&script).map(|c| c != MCP_SCRIPT).unwrap_or(true) {
        let _ = std::fs::write(&script, MCP_SCRIPT);
    }
    let skills = root().join("skills");
    let _ = std::fs::create_dir_all(&skills);
    for (id, body) in DEFAULT_SKILLS {
        let p = skills.join(format!("{id}.md"));
        if !p.exists() {
            let _ = std::fs::write(p, body);
        }
    }
}

fn bridge_path() -> PathBuf {
    crate::grillme_dir().join("bridge.json")
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
            let q = qs.iter_mut().find(|q| q["id"] == qid.as_str()).ok_or("no question with that id")?;
            q["answered"] = json!(true);
            q["answer"] = json!(answer);
            let handoff = json!({
                "id": new_id("h"), "ts": ts, "status": "pending", "kind": "answer",
                "session": q["from"], "sessionTitle": q["fromTitle"],
                "message": format!("Answer from the brainstorm side to your question \"{}\":\n\n{answer}", q["question"].as_str().unwrap_or("")),
                "userExplanation": "",
            });
            ("handoffs", handoff)
        }
        _ => return Err(format!("unknown kind {kind}")),
    };
    let arr = v[list].as_array_mut().ok_or("corrupt bridge")?;
    arr.push(entry.clone());
    trim(arr);
    save(&v)?;
    Ok(entry)
}

#[tauri::command]
pub(crate) fn bridge_read() -> String {
    let _g = crate::lock_or_recover(&BRIDGE_LOCK);
    load().to_string()
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

pub(crate) fn node_path() -> Option<String> {
    for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        if std::path::Path::new(c).exists() {
            return Some(c.into());
        }
    }
    let out = Command::new("/bin/zsh").args(["-lc", "command -v node"]).output().ok()?;
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && p.starts_with('/')).then_some(p)
}

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
    json!({ "desktop": desktop, "code": code, "desktopInstalled": desktop_config().is_some(), "node": node_path() })
}

/// Register the grill-me MCP server with the Claude desktop app (its config
/// file, backed up first) and Claude Code (user scope). Returns a summary.
#[tauri::command]
pub(crate) fn bridge_connect() -> Result<String, String> {
    install();
    let node = node_path().ok_or("Node.js not found — install it (brew install node) and try again.")?;
    let script = root().join("bin/grillme-mcp.mjs").to_string_lossy().into_owned();
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
        cfg["mcpServers"][SERVER_NAME] = json!({ "command": node, "args": [script] });
        std::fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)
            .map_err(|e| format!("couldn't write Claude app config: {e}"))?;
        done.push("Claude app (restart it to load)");
    }

    if let Ok(claude) = crate::preflight_claude() {
        let _ = Command::new(&claude).args(["mcp", "remove", "--scope", "user", SERVER_NAME]).output();
        let out = Command::new(&claude)
            .args(["mcp", "add", "--scope", "user", SERVER_NAME, "--", &node, &script])
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
    fn skills_and_script_are_embedded() {
        assert!(MCP_SCRIPT.contains("tools/list"));
        assert_eq!(DEFAULT_SKILLS.len(), 6);
    }
}
