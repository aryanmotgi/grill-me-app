// ---------------------------------------------------------------------------
// One interview turn on the user's own AI (onboarding "How do you work?").
// The app builds the prompt and the JSON schema (src/lib/interview.ts); this
// runs the AI once, headless, and returns its JSON reply.
//
// Locked down: no tools, no MCP servers, no user settings or rules, no saved
// session, and it runs in an empty folder, so the AI only sees the prompt.
// Arguments go to the CLI as separate argv entries (never through a shell
// string), so nothing the user types can become a command.
// ---------------------------------------------------------------------------

use serde_json::Value;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(90);

/// An empty folder to run in, so no project files or CLAUDE.md are read.
fn sandbox_dir() -> Result<std::path::PathBuf, String> {
    let dir = crate::grillme_root().join("interview");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The argv for each AI (after the program name). `schema_file` / `out_file`
/// are only used by Codex, which takes them as paths.
pub fn argv(brain: &str, system: &str, prompt: &str, schema: &str, schema_file: &str, out_file: &str) -> Option<(&'static str, Vec<String>)> {
    let s = |x: &str| x.to_string();
    match brain {
        "claude" => Some(("claude", vec![
            s("-p"), s("--model"), s("haiku"),
            s("--tools"), s(""), s("--strict-mcp-config"), s("--setting-sources"), s(""),
            s("--no-session-persistence"), s("--output-format"), s("json"),
            s("--json-schema"), s(schema), s("--system-prompt"), s(system), s(prompt),
        ])),
        "codex" => Some(("codex", vec![
            s("exec"), s("--ignore-user-config"), s("--ignore-rules"), s("--skip-git-repo-check"), s("--ephemeral"),
            s("-s"), s("read-only"), s("-c"), s("model_reasoning_effort=low"),
            s("--output-schema"), s(schema_file), s("-o"), s(out_file),
            format!("{system}\n\n{prompt}"),
        ])),
        // no schema flag: they're told to answer with JSON only, and we pull
        // the first JSON object out of the reply
        "cursor" => Some(("cursor-agent", vec![s("-p"), s("--output-format"), s("text"), format!("{system}\n\n{prompt}\n\nAnswer with only the JSON object.")])),
        "gemini" => Some(("gemini", vec![s("-p"), format!("{system}\n\n{prompt}\n\nAnswer with only the JSON object.")])),
        _ => None,
    }
}

/// The first balanced {...} in some text (models sometimes wrap JSON in prose or fences).
pub fn first_json_object(text: &str) -> Option<Value> {
    let bytes = text.as_bytes();
    let mut start = None;
    let (mut depth, mut in_str, mut esc) = (0i32, false, false);
    for (i, &b) in bytes.iter().enumerate() {
        if in_str {
            if esc { esc = false } else if b == b'\\' { esc = true } else if b == b'"' { in_str = false }
            continue;
        }
        match b {
            b'"' if start.is_some() => in_str = true,
            b'{' => { if start.is_none() { start = Some(i) } depth += 1 }
            b'}' if start.is_some() => {
                depth -= 1;
                if depth == 0 {
                    if let Ok(v) = serde_json::from_str::<Value>(&text[start.unwrap()..=i]) {
                        if v.is_object() { return Some(v); }
                    }
                    start = None;
                }
            }
            _ => {}
        }
    }
    None
}

/// A short, human error from a CLI's stderr: the API's "message", else the last ERROR line.
pub fn friendly_error(stderr: &str) -> String {
    if let Some(i) = stderr.find("\"message\":\"") {
        let rest = &stderr[i + 11..];
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    stderr.lines().rev().find(|l| l.contains("ERROR") || l.to_lowercase().contains("error"))
        .map(|l| l.trim().chars().take(200).collect())
        .unwrap_or_else(|| "The AI didn't answer".into())
}

/// Claude's `--output-format json` envelope → the structured reply.
pub fn claude_reply(stdout: &str) -> Result<Value, String> {
    let env: Value = serde_json::from_str(stdout.trim()).map_err(|_| "Claude's reply wasn't JSON".to_string())?;
    if env["is_error"] == true {
        return Err(env["result"].as_str().unwrap_or("Claude returned an error").to_string());
    }
    if env["structured_output"].is_object() {
        return Ok(env["structured_output"].clone());
    }
    env["result"].as_str().and_then(first_json_object).ok_or_else(|| "Claude's reply had no answer".into())
}

fn run(program: &str, args: &[String], cwd: &std::path::Path) -> Result<(bool, String, String), String> {
    // a login shell finds the CLI on the same PATH sessions use; the program
    // and its args are passed as "$@", never spliced into the script
    let mut child = Command::new("/bin/zsh")
        .arg("-lc").arg("exec \"$@\"").arg("grillme-interview").arg(program).args(args)
        .current_dir(cwd)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| e.to_string())?;
    let drain = |r: Option<Box<dyn Read + Send>>| std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut r) = r { let _ = r.read_to_string(&mut buf); }
        buf
    });
    let out_t = drain(child.stdout.take().map(|r| Box::new(r) as Box<dyn Read + Send>));
    let err_t = drain(child.stderr.take().map(|r| Box::new(r) as Box<dyn Read + Send>));
    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? { break s; }
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err("The AI took too long to answer".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    Ok((status.success(), out_t.join().unwrap_or_default(), err_t.join().unwrap_or_default()))
}

/// Ask the chosen AI for one turn. Returns its JSON reply (not yet validated:
/// the app keeps only fields it recognizes).
#[tauri::command(async)]
pub fn interview_turn(brain: String, system: String, prompt: String, schema: String) -> Result<Value, String> {
    if prompt.len() > 40_000 || system.len() > 20_000 || schema.len() > 20_000 {
        return Err("Interview is too long".into());
    }
    serde_json::from_str::<Value>(&schema).map_err(|_| "bad schema".to_string())?;
    let dir = sandbox_dir()?;
    let schema_file = dir.join("schema.json");
    let out_file = dir.join("reply.json");
    let _ = std::fs::remove_file(&out_file);
    if brain == "codex" {
        std::fs::write(&schema_file, &schema).map_err(|e| e.to_string())?;
    }
    let (program, args) = argv(&brain, &system, &prompt, &schema, &schema_file.to_string_lossy(), &out_file.to_string_lossy())
        .ok_or_else(|| "That AI can't run the interview yet".to_string())?;
    let (ok, stdout, stderr) = run(program, &args, &dir)?;
    match brain.as_str() {
        "claude" => claude_reply(&stdout).map_err(|e| if ok { e } else { friendly_error(&format!("{stdout}\n{stderr}")) }),
        "codex" => {
            let text = std::fs::read_to_string(&out_file).unwrap_or_default();
            first_json_object(&text).ok_or_else(|| friendly_error(&stderr))
        }
        _ => first_json_object(&stdout).ok_or_else(|| if ok { "The AI's reply had no answer".into() } else { friendly_error(&stderr) }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_ais_and_no_shell_strings() {
        assert!(argv("rm", "s", "p", "{}", "a", "b").is_none());
        let (prog, args) = argv("claude", "sys", "hi; rm -rf ~", "{}", "a", "b").unwrap();
        assert_eq!(prog, "claude");
        // the user's words stay one argv entry
        assert!(args.contains(&"hi; rm -rf ~".to_string()));
        assert!(args.windows(2).any(|w| w[0] == "--tools" && w[1].is_empty()));
        let (_, codex) = argv("codex", "sys", "p", "{}", "/s.json", "/o.json").unwrap();
        assert!(codex.contains(&"--ignore-user-config".to_string()));
        assert!(codex.windows(2).any(|w| w[0] == "-s" && w[1] == "read-only"));
    }

    #[test]
    fn pulls_json_out_of_prose() {
        let v = first_json_object("Sure! ```json\n{\"say\":\"a {b}\",\"done\":false}\n``` hope that helps").unwrap();
        assert_eq!(v["say"], "a {b}");
        assert!(first_json_object("no json here").is_none());
        assert!(first_json_object("{broken").is_none());
    }

    #[test]
    fn reads_claude_envelope() {
        let ok = r#"{"is_error":false,"result":"x","structured_output":{"say":"hi","done":false}}"#;
        assert_eq!(claude_reply(ok).unwrap()["say"], "hi");
        let text = r#"{"is_error":false,"result":"{\"say\":\"yo\"}"}"#;
        assert_eq!(claude_reply(text).unwrap()["say"], "yo");
        let err = r#"{"is_error":true,"result":"Credit balance is too low"}"#;
        assert_eq!(claude_reply(err).unwrap_err(), "Credit balance is too low");
    }

    #[test]
    fn friendly_errors() {
        let e = r#"ERROR: {"type":"error","status":400,"error":{"message":"The 'gpt-5.5' model is not supported"}}"#;
        assert_eq!(friendly_error(e), "The 'gpt-5.5' model is not supported");
        assert_eq!(friendly_error("boom\nERROR: network down\n"), "ERROR: network down");
    }

    #[test]
    #[ignore] // calls the real Claude on this Mac
    fn live_claude_turn() {
        let schema = r#"{"type":"object","properties":{"say":{"type":"string"},"done":{"type":"boolean"}},"required":["say","done"]}"#;
        let v = interview_turn("claude".into(), "Ask one short question.".into(), "Start.".into(), schema.into()).unwrap();
        println!("{v}");
        assert!(v["say"].is_string());
    }
}
