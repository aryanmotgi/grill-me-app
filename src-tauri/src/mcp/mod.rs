// ---------------------------------------------------------------------------
// grill-me MCP bridge — connects the Claude app (brainstorm partner) and
// Claude Code sessions (the coders) through Grill Me.
//
// Runs as a mode of the app's own binary (`grill-me --mcp …`), before Tauri
// starts, so it needs no Node and starts in milliseconds (it runs as a hook
// on every prompt). Speaks MCP (JSON-RPC 2.0, newline-delimited) over stdio,
// or Streamable HTTP for claude.ai (--http). READS come straight from disk
// (Grill Me's project files, Claude Code transcripts, git). WRITES (handoffs,
// plans, questions, notes) go through Grill Me's loopback API, so nothing
// reaches a session or the task board until you approve it in Grill Me.
//
// This is a port of the former grillme-mcp.mjs; its output text is the
// contract (hooks paste it into prompts), so it's reproduced exactly —
// see js.rs for the JavaScript semantics it keeps.
//
//   grill-me --mcp                                   stdio MCP server
//   grill-me --mcp --sync <member> --project <dir> [--full]   hook
//   grill-me --mcp --catchup-chat <id> | --digest <ms>
//   grill-me --mcp --check-input <member> [--spot] | --cut-input | --pitch-input
//            | --quiz-input <member> | --wrapup-input | --kickoff-input
//            | --answer-input <questionId> | --review-input <member> | --reply-input <handoffId>
//            | --chat-input <chatId> | --drift-input | --search=<query> [--limit=<n>]
//   grill-me --mcp --http <port> --secret-file <path> [--allow-writes] [--no-transcripts]
//
// stdio also pushes: resource updates, list changes and "needs you" notices
// (push.rs). HTTP is stateless JSON and never pushes.
// ---------------------------------------------------------------------------

mod actions;
mod brain;
mod data;
mod http;
mod js;
mod push;
mod redact;
mod resources;
mod search;
mod tools;

pub use data::Ctx;
/// The secret-file name rule (.env, keys, credentials…) — shared with the
/// starter-kit file copy so it skips exactly what diffs skip.
pub use redact::secret_file;

use serde_json::{json, Value};
use std::io::{BufRead, Write};

/// Entry point for `grill-me --mcp <args…>` (args after `--mcp`). Never returns.
pub fn main(args: Vec<String>) -> ! {
    let mut ctx = Ctx::from_env();
    if args.iter().any(|a| a == "--http") {
        ctx.remote = data::Remote {
            on: true,
            allow_writes: args.iter().any(|a| a == "--allow-writes"),
            no_transcripts: args.iter().any(|a| a == "--no-transcripts"),
        };
        let port = flag(&args, "--http").map(|p| js::str_to_num(p)).filter(|p| *p != 0.0 && !p.is_nan()).unwrap_or(4519.0);
        let secret = flag(&args, "--secret-file").unwrap_or("undefined").to_string();
        http::serve(ctx, port as u16, &secret);
    }
    match cli_mode(&mut ctx, &args) {
        Ok(true) => std::process::exit(0),
        Ok(false) => serve_stdio(&ctx),
        Err(e) => {
            // an uncaught throw in the Node script: message on stderr, exit 1
            eprintln!("[grill-me mcp] {e}");
            std::process::exit(1);
        }
    }
}

/// This binary's absolute path — what hooks, the Claude app config and
/// `claude mcp add` run with `--mcp` (e.g. …/grill-me.app/Contents/MacOS/grill-me).
pub fn exe_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let exe = std::fs::canonicalize(&exe).unwrap_or(exe);
    Some(exe.to_string_lossy().into_owned())
}

/// `argv[argv.indexOf(f) + 1]`
fn flag<'a>(argv: &'a [String], f: &str) -> Option<&'a str> {
    let i = argv.iter().position(|a| a == f)?;
    argv.get(i + 1).map(String::as_str)
}

fn out(text: &str) {
    if !text.is_empty() {
        let mut o = std::io::stdout().lock();
        let _ = o.write_all(js::for_stdout(text).as_bytes());
        let _ = o.flush();
    }
}

/// CLI modes (hooks and Grill Me call these directly, not over MCP).
/// Ok(false) = no CLI flag: run the stdio server.
fn cli_mode(ctx: &mut Ctx, argv: &[String]) -> Result<bool, String> {
    let has = |f: &str| argv.iter().any(|a| a == f);
    if let Some(p) = flag(argv, "--project").filter(|p| !p.is_empty()) {
        ctx.forced = Some(p.to_string());
    }
    let now = js::now_ms();
    // first: the query is free text, so it rides in one `--search=<q>` arg
    // and can never be mistaken for another flag
    if let Some(q) = argv.iter().find_map(|a| a.strip_prefix("--search=")) {
        let limit = argv.iter().find_map(|a| a.strip_prefix("--limit=")).map(js::str_to_num).filter(|n| n.is_finite() && *n >= 1.0).unwrap_or(30.0);
        out(&js::stringify(&Value::Array(ctx.search(q, limit as usize)?), 0));
        return Ok(true);
    }
    if has("--sync") {
        // Claude Code hook (SessionStart / UserPromptSubmit): stdout becomes context
        let member = flag(argv, "--sync");
        let key = format!("hook:{}", member.unwrap_or("undefined"));
        let since = ctx.cursor(&key);
        let text = ctx.catch_up(since, member, since == 0.0 || has("--full"))?;
        ctx.set_cursor(&key, now);
        if !text.is_empty() {
            out(&format!(
                "<grill-me-sync>\nShared project brain from Grill Me — new since your last message (from the brainstorm side and other sessions). Use it; don't repeat it back.\n\n{text}\n</grill-me-sync>\n"
            ));
        }
        return Ok(true);
    }
    if has("--catchup-chat") {
        let key = format!("chat:{}", flag(argv, "--catchup-chat").unwrap_or("undefined"));
        let since = ctx.cursor(&key);
        let text = ctx.catch_up(since, None, since == 0.0)?;
        ctx.set_cursor(&key, now);
        out(&text);
        return Ok(true);
    }
    if has("--check-input") {
        out(&ctx.check_input(flag(argv, "--check-input"), has("--spot"))?);
        return Ok(true);
    }
    if has("--chat-input") {
        out(&ctx.chat_input(flag(argv, "--chat-input"))?);
        return Ok(true);
    }
    if has("--drift-input") {
        out(&ctx.drift_input()?);
        return Ok(true);
    }
    if has("--answer-input") {
        out(&ctx.answer_input(flag(argv, "--answer-input"))?);
        return Ok(true);
    }
    if has("--review-input") {
        out(&ctx.review_input(flag(argv, "--review-input"))?);
        return Ok(true);
    }
    if has("--reply-input") {
        out(&ctx.reply_input(flag(argv, "--reply-input"))?);
        return Ok(true);
    }
    if has("--kickoff-input") {
        out(&ctx.kickoff_input()?);
        return Ok(true);
    }
    if has("--pitch-input") {
        out(&ctx.pitch_input()?);
        return Ok(true);
    }
    if has("--quiz-input") {
        out(&ctx.quiz_input(flag(argv, "--quiz-input"))?);
        return Ok(true);
    }
    if has("--wrapup-input") {
        out(&ctx.wrapup_input()?);
        return Ok(true);
    }
    if has("--cut-input") {
        out(&ctx.cut_input()?);
        return Ok(true);
    }
    if has("--digest") {
        // Grill Me's Brain page: read-only, no cursor
        let since = flag(argv, "--digest").map(js::str_to_num).unwrap_or(f64::NAN);
        let since = if since.is_nan() { 0.0 } else { since };
        let text = ctx.catch_up(since, None, since == 0.0)?;
        out(if text.is_empty() { "Nothing new." } else { &text });
        return Ok(true);
    }
    Ok(false)
}

/// The one stdout writer: responses (main loop) and notifications (watcher
/// thread) each go out as one whole line under this lock.
static OUT: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn send(msg: &Value) {
    let line = format!("{}\n", js::stringify(msg, 0));
    let _g = OUT.lock().unwrap_or_else(|e| e.into_inner());
    let mut o = std::io::stdout().lock();
    let _ = o.write_all(line.as_bytes());
    let _ = o.flush();
}

/// stdio (Claude app + Claude Code, local): one JSON-RPC message per line.
fn serve_stdio(ctx: &Ctx) -> ! {
    let sess = std::sync::Arc::new(std::sync::Mutex::new(push::Session::default()));
    push::spawn_watcher(ctx.clone(), sess.clone(), send);
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let mut raw = Vec::new();
    loop {
        raw.clear();
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) | Err(_) => std::process::exit(0),
            Ok(_) => {}
        }
        if raw.last() == Some(&b'\n') {
            raw.pop();
        }
        if raw.last() == Some(&b'\r') {
            raw.pop();
        }
        // readline also ends a line at a lone \r
        let text = String::from_utf8_lossy(&raw).into_owned();
        for line in text.split('\r') {
            if js::trim(line).is_empty() {
                continue;
            }
            let Some(req) = js::parse(line) else {
                send(&json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } }));
                continue;
            };
            match tools::handle(ctx, &req) {
                Ok(Some(msg)) => {
                    let ok = msg.get("result").is_some();
                    sess.lock().unwrap_or_else(|e| e.into_inner()).note(&req, ok);
                    send(&msg);
                }
                Ok(None) => sess.lock().unwrap_or_else(|e| e.into_inner()).note(&req, true),
                Err(e) => eprintln!("[grill-me mcp] TypeError: {e}"),
            }
        }
    }
}
