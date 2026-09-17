//! Team-mode room protocol (v1 contract).
//!
//! The organizer's app is the HOST: it runs a second hand-rolled HTTP
//! listener on 0.0.0.0:4518 serving ONLY /room/* endpoints (the loopback
//! token API on 4517 is untouched). The 5-char room code is the password —
//! LAN threat model, flagged in the PR. Room state is a single host-owned
//! JSON document persisted atomically to ~/.grillme/room.json.
//!
//! Host-side assistant loop (documented choice): there is NO Rust-side
//! reply loop. The HOST frontend polls /room/state; when it sees a new
//! trailing user message it calls the `room_brainstorm_reply` command and
//! POSTs the result back via loopback POST /room/chat with
//! `role: "assistant"`. The `role` field is honored only when the sender
//! is the host member — guests can never forge assistant messages. This is
//! simpler than a Rust poller (no extra thread, no double-reply races: the
//! frontend serializes its own trigger) and keeps all chat writes on one
//! code path.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use crate::{grillme_root, lock_or_recover, merge_by_id, no_prompt, sh_quote};

pub const ROOM_PORT: u16 = 4518;

/// Shared documents carried live over the room AFTER onboarding (phase
/// "done"). Same id-keyed arrays the local ~/.grillme merge writer uses.
pub const SYNC_FILES: &[&str] = &["tasks.json", "messages.json", "decisions.json"];

/// Per-file tombstone cap — a bounded ring so a long session can't grow the
/// removed-id set without limit. Deletions older than this many removals may
/// be resurrected by a peer that was offline the whole time (documented).
const TOMBSTONE_CAP: usize = 2000;

/// messages/decisions render newest-first, so genuinely new entries prepend;
/// tasks append. Mirrors the local shared_upsert ordering.
fn prepend_for(file: &str) -> bool {
    file == "messages.json" || file == "decisions.json"
}

/// Room-code alphabet from the contract: no 0/O/1/I/L lookalikes.
pub const CODE_ALPHABET: &str = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
pub const CODE_LEN: usize = 5;

// ---------------------------------------------------------------------------
// RoomState — single source of truth, host-owned (shape from the contract).
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RoomMember {
    pub id: String,
    pub name: String,
    #[serde(rename = "isHost")]
    pub is_host: bool,
    /// epoch ms of the last heartbeat — status is DERIVED client-side.
    #[serde(rename = "lastSeen")]
    pub last_seen: u64,
    /// Live presence pushed on each heartbeat: {status, file, task, name}.
    /// Opaque JSON so the shape can evolve without a Rust change; absent until
    /// the member's first heartbeat carries one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presence: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RoomChatMsg {
    pub from: String,
    pub name: String,
    /// "user" | "assistant"
    pub role: String,
    pub text: String,
    pub ts: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RoomTask {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub assignee: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RoomState {
    pub code: String,
    /// "lobby" | "brainstorm" | "plan" | "tasks" | "assign" | "done"
    pub phase: String,
    pub members: Vec<RoomMember>,
    pub chat: Vec<RoomChatMsg>,
    /// markdown project plan
    pub plan: String,
    pub tasks: Vec<RoomTask>,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
    /// Live shared docs (file name → id-keyed array), host-authoritative. Only
    /// populated once the room reaches phase "done" and members start syncing.
    #[serde(default)]
    pub shared: BTreeMap<String, Vec<serde_json::Value>>,
    /// Removed-id tombstones per file so a reconnecting peer can't resurrect
    /// something deleted while it was offline. Bounded (TOMBSTONE_CAP).
    #[serde(default)]
    pub tombstones: BTreeMap<String, Vec<String>>,
}

const PHASES: &[&str] = &["lobby", "brainstorm", "plan", "tasks", "assign", "done"];

// ---------------------------------------------------------------------------
// In-memory state + persistence (~/.grillme/room.json, atomic tmp+rename —
// same publish pattern as the shared-merge writers).
// ---------------------------------------------------------------------------

static ROOM: Mutex<Option<RoomState>> = Mutex::new(None);

fn room_path() -> PathBuf {
    // Global root by contract — a room spans whatever project the host has open.
    grillme_root().join("room.json")
}

/// Atomically publish the room to disk; a cleared room removes the file.
fn save_room(room: &Option<RoomState>) -> Result<(), String> {
    let target = room_path();
    match room {
        Some(state) => {
            let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
            let tmp = target.with_extension("tmp-room");
            std::fs::write(&tmp, &content).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &target).map_err(|e| e.to_string())
        }
        None => {
            let _ = std::fs::remove_file(&target);
            Ok(())
        }
    }
}

fn load_room_from_disk() -> Option<RoomState> {
    let raw = std::fs::read_to_string(room_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Room code generation — /dev/urandom bytes mapped onto the contract
// alphabet with rejection sampling (no modulo bias).
// ---------------------------------------------------------------------------

/// Map a byte stream onto CODE_ALPHABET, rejecting bytes that would bias the
/// distribution (alphabet len 31: accept bytes < 248 = 31 * 8). Returns None
/// if the stream runs dry before CODE_LEN chars are produced.
fn code_from_bytes(bytes: impl IntoIterator<Item = u8>) -> Option<String> {
    let alphabet: Vec<char> = CODE_ALPHABET.chars().collect();
    let n = alphabet.len(); // 31
    let limit = (256 / n) * n; // 248 — largest multiple of n that fits a byte
    let mut out = String::with_capacity(CODE_LEN);
    for b in bytes {
        if (b as usize) < limit {
            out.push(alphabet[b as usize % n]);
            if out.len() == CODE_LEN {
                return Some(out);
            }
        }
    }
    None
}

fn generate_room_code() -> String {
    let mut buf = [0u8; 64]; // 64 bytes: P(fewer than 5 accepted) is astronomically small
    if std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .is_ok()
    {
        if let Some(code) = code_from_bytes(buf) {
            return code;
        }
    }
    // Last-resort fallback (no /dev/urandom): clock-seeded — weak, but the
    // room only lives on a LAN and this path should never run on macOS.
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let alphabet: Vec<char> = CODE_ALPHABET.chars().collect();
    (0..CODE_LEN)
        .map(|i| {
            let x = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407 * (i as u64 + 1));
            alphabet[(x >> 33) as usize % alphabet.len()]
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Request handling — pure over (method, path, body, room, now) so tests
// exercise the handler directly, no network. The server loop owns locking,
// persistence, and socket I/O.
// ---------------------------------------------------------------------------

fn err_body(code: u16, msg: &str) -> (u16, String) {
    (code, format!("{{\"error\":\"{msg}\"}}"))
}

fn query_param(path: &str, key: &str) -> Option<String> {
    path.split('?')
        .nth(1)?
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.to_string())
}

fn norm_code(c: &str) -> String {
    c.trim().to_ascii_uppercase()
}

/// Code match = auth. Wrong code → 403 (the caller returns immediately).
fn check_code<'a>(room: &'a mut Option<RoomState>, code: &str) -> Result<&'a mut RoomState, (u16, String)> {
    match room {
        Some(state) if state.code == norm_code(code) && !code.trim().is_empty() => Ok(state),
        _ => Err(err_body(403, "bad room code")),
    }
}

/// Next unique id with the given prefix ("m" for members, "t" for tasks):
/// max existing numeric suffix + 1, so removals never cause id reuse.
fn next_id(prefix: &str, existing: impl Iterator<Item = String>) -> String {
    let max = existing
        .filter_map(|id| id.strip_prefix(prefix).and_then(|n| n.parse::<u64>().ok()))
        .max()
        .unwrap_or(0);
    format!("{prefix}{}", max + 1)
}

/// Handle one /room/* request against the room state. Pure over its inputs
/// (aside from code generation on create). Returns (http_status, json_body).
pub(crate) fn room_handle(
    method: &str,
    path: &str,
    body: &[u8],
    room: &mut Option<RoomState>,
    now: u64,
) -> (u16, String) {
    let route = path.split('?').next().unwrap_or("");
    let v: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
    let field = |k: &str| v[k].as_str().unwrap_or("").to_string();

    match (method, route) {
        ("GET", "/room/state") => {
            let code = query_param(path, "code").unwrap_or_default();
            match check_code(room, &code) {
                Ok(state) => (200, serde_json::to_string(state).unwrap_or_else(|_| "{}".into())),
                Err(e) => e,
            }
        }
        ("POST", "/room/create") => {
            let name = field("name");
            if name.trim().is_empty() {
                return err_body(400, "name required");
            }
            let code = generate_room_code();
            *room = Some(RoomState {
                code: code.clone(),
                phase: "lobby".into(),
                members: vec![RoomMember {
                    id: "m1".into(),
                    name: name.trim().to_string(),
                    is_host: true,
                    last_seen: now,
                    presence: None,
                }],
                chat: vec![],
                plan: String::new(),
                tasks: vec![],
                started_at: now,
                shared: BTreeMap::new(),
                tombstones: BTreeMap::new(),
            });
            (200, format!("{{\"code\":\"{code}\",\"memberId\":\"m1\"}}"))
        }
        ("POST", "/room/join") => {
            let name = field("name").trim().to_string();
            let state = match check_code(room, &field("code")) {
                Ok(s) => s,
                Err(e) => return e,
            };
            if name.is_empty() {
                return err_body(400, "name required");
            }
            // Duplicate name = the same person rejoining (app restart, wifi
            // blip): hand back their existing memberId instead of minting a
            // ghost duplicate. Members are never removed, so this is stable.
            if let Some(existing) = state
                .members
                .iter_mut()
                .find(|m| m.name.eq_ignore_ascii_case(&name))
            {
                existing.last_seen = now;
                return (200, format!("{{\"memberId\":\"{}\"}}", existing.id));
            }
            let id = next_id("m", state.members.iter().map(|m| m.id.clone()));
            state.members.push(RoomMember {
                id: id.clone(),
                name,
                is_host: false,
                last_seen: now,
                presence: None,
            });
            (200, format!("{{\"memberId\":\"{id}\"}}"))
        }
        ("POST", "/room/heartbeat") => {
            let member_id = field("memberId");
            // optional live presence blob ({status, file, task, name})
            let presence = v.get("presence").filter(|p| !p.is_null()).cloned();
            let state = match check_code(room, &field("code")) {
                Ok(s) => s,
                Err(e) => return e,
            };
            match state.members.iter_mut().find(|m| m.id == member_id) {
                Some(m) => {
                    m.last_seen = now;
                    if presence.is_some() {
                        m.presence = presence;
                    }
                    (200, "{\"ok\":true}".into())
                }
                None => err_body(403, "unknown member"),
            }
        }
        ("POST", "/room/sync") => {
            let member_id = field("memberId");
            let file = field("file");
            let items = v.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
            let removed: Vec<String> = v
                .get("removed")
                .and_then(|r| r.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            let state = match check_code(room, &field("code")) {
                Ok(s) => s,
                Err(e) => return e,
            };
            if !state.members.iter().any(|m| m.id == member_id) {
                return err_body(403, "unknown member");
            }
            if !SYNC_FILES.contains(&file.as_str()) {
                return err_body(400, "unknown sync file");
            }
            // syncing IS liveness — a member pushing state is alive.
            if let Some(m) = state.members.iter_mut().find(|m| m.id == member_id) {
                m.last_seen = now;
            }
            let merged = apply_sync(state, &file, items, &removed);
            let tombs = state.tombstones.get(&file).cloned().unwrap_or_default();
            (
                200,
                serde_json::json!({ "ok": true, "items": merged, "tombstones": tombs }).to_string(),
            )
        }
        ("POST", "/room/chat") => {
            let member_id = field("memberId");
            let text = field("text");
            let want_role = field("role");
            let state = match check_code(room, &field("code")) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let Some(member) = state.members.iter().find(|m| m.id == member_id) else {
                return err_body(403, "unknown member");
            };
            if text.trim().is_empty() {
                return err_body(400, "text required");
            }
            // Only the HOST may post assistant messages (its frontend relays
            // claude replies through this same endpoint via loopback).
            let role = if member.is_host && want_role == "assistant" {
                "assistant"
            } else {
                "user"
            };
            let name = member.name.clone();
            state.chat.push(RoomChatMsg {
                from: member_id,
                name,
                role: role.into(),
                text,
                ts: now,
            });
            (200, "{\"ok\":true}".into())
        }
        ("POST", "/room/advance") => {
            let member_id = field("memberId");
            let phase = field("phase");
            let payload = v.get("payload").cloned();
            let state = match check_code(room, &field("code")) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let is_host = state
                .members
                .iter()
                .any(|m| m.id == member_id && m.is_host);
            if !is_host {
                return err_body(403, "host only");
            }
            if !PHASES.contains(&phase.as_str()) {
                return err_body(400, "unknown phase");
            }
            match (phase.as_str(), payload) {
                ("plan", Some(serde_json::Value::String(plan))) => state.plan = plan,
                ("tasks" | "assign", Some(serde_json::Value::Array(items))) => {
                    state.tasks = normalize_tasks(&items);
                }
                _ => {}
            }
            state.phase = phase;
            (200, "{\"ok\":true}".into())
        }
        ("POST", "/room/task") => {
            let member_id = field("memberId");
            let op = field("op");
            let task = v.get("task").cloned().unwrap_or_default();
            let state = match check_code(room, &field("code")) {
                Ok(s) => s,
                Err(e) => return e,
            };
            if !state.members.iter().any(|m| m.id == member_id) {
                return err_body(403, "unknown member");
            }
            let t_id = task["id"].as_str().unwrap_or("").to_string();
            let title = task["title"].as_str().unwrap_or("").to_string();
            let detail = task["detail"].as_str().unwrap_or("").to_string();
            let assignee = task["assignee"].as_str().map(str::to_string);
            match op.as_str() {
                "add" => {
                    if title.trim().is_empty() {
                        return err_body(400, "title required");
                    }
                    let id = next_id("t", state.tasks.iter().map(|t| t.id.clone()));
                    state.tasks.push(RoomTask { id, title, detail, assignee });
                }
                "edit" => {
                    let Some(t) = state.tasks.iter_mut().find(|t| t.id == t_id) else {
                        return err_body(404, "no such task");
                    };
                    if !title.is_empty() {
                        t.title = title;
                    }
                    if task.get("detail").is_some() {
                        t.detail = detail;
                    }
                }
                "remove" => {
                    let before = state.tasks.len();
                    state.tasks.retain(|t| t.id != t_id);
                    if state.tasks.len() == before {
                        return err_body(404, "no such task");
                    }
                }
                "assign" => {
                    let Some(t) = state.tasks.iter_mut().find(|t| t.id == t_id) else {
                        return err_body(404, "no such task");
                    };
                    t.assignee = assignee;
                }
                _ => return err_body(400, "unknown op"),
            }
            (200, "{\"ok\":true}".into())
        }
        _ => err_body(404, "unknown route"),
    }
}

/// Normalize an incoming tasks payload ([{title, detail, id?, assignee?}])
/// into RoomTasks, minting sequential ids where missing.
fn normalize_tasks(items: &[serde_json::Value]) -> Vec<RoomTask> {
    let mut out: Vec<RoomTask> = vec![];
    for item in items {
        let title = item["title"].as_str().unwrap_or("").trim().to_string();
        if title.is_empty() {
            continue;
        }
        let id = match item["id"].as_str() {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => next_id("t", out.iter().map(|t| t.id.clone())),
        };
        out.push(RoomTask {
            id,
            title,
            detail: item["detail"].as_str().unwrap_or("").to_string(),
            assignee: item["assignee"].as_str().map(str::to_string),
        });
    }
    out
}

/// id of a shared-doc entry, if it has a string "id".
fn value_id(v: &serde_json::Value) -> Option<String> {
    v.get("id").and_then(|i| i.as_str()).map(str::to_string)
}

/// Merge an incoming delta into the host-authoritative `shared[file]`, honoring
/// tombstones so a peer that was offline during a delete can't resurrect the
/// removed entry when it reconnects and re-pushes its stale copy.
///
/// Steps: (1) record `removed` ids as tombstones (bounded ring); (2) drop any
/// tombstoned id from the incoming items BEFORE merge; (3) run the same
/// id-keyed merge the local writer uses; (4) sweep tombstoned ids out of the
/// result. Returns the merged array (also stored back into `shared[file]`).
fn apply_sync(
    state: &mut RoomState,
    file: &str,
    items: Vec<serde_json::Value>,
    removed: &[String],
) -> Vec<serde_json::Value> {
    // (1) grow the tombstone ring
    {
        let tombs = state.tombstones.entry(file.to_string()).or_default();
        for id in removed {
            if !tombs.contains(id) {
                tombs.push(id.clone());
            }
        }
        if tombs.len() > TOMBSTONE_CAP {
            let overflow = tombs.len() - TOMBSTONE_CAP;
            tombs.drain(0..overflow);
        }
    }
    let tomb_set: std::collections::HashSet<String> = state
        .tombstones
        .get(file)
        .map(|t| t.iter().cloned().collect())
        .unwrap_or_default();

    // (2) never let a tombstoned id back in via incoming
    let incoming: Vec<serde_json::Value> = items
        .into_iter()
        .filter(|it| value_id(it).map(|id| !tomb_set.contains(&id)).unwrap_or(false))
        .collect();

    // (3) merge against the current authoritative array
    let current = state
        .shared
        .get(file)
        .map(|arr| serde_json::to_string(arr).unwrap_or_else(|_| "[]".into()))
        .unwrap_or_else(|| "[]".into());
    let mut merged = merge_by_id(&current, incoming, removed, prepend_for(file));

    // (4) final sweep — drop anything tombstoned (covers ids removed this call)
    merged.retain(|it| value_id(it).map(|id| !tomb_set.contains(&id)).unwrap_or(true));

    state.shared.insert(file.to_string(), merged.clone());
    merged
}

// ---------------------------------------------------------------------------
// The 0.0.0.0:4518 listener — same hand-rolled style as start_api_server,
// but every accepted stream gets a READ TIMEOUT so a client that connects
// and never sends a full request can't wedge the accept loop (the known
// 4517 hazard). No bearer token: the room code inside each request is auth.
// ---------------------------------------------------------------------------

static ROOM_SERVER_STARTED: AtomicBool = AtomicBool::new(false);

pub(crate) fn start_room_server() -> Result<(), String> {
    if ROOM_SERVER_STARTED.swap(true, Ordering::SeqCst) {
        return Ok(()); // already running
    }
    // Bind before spawning so the caller sees bind errors (port in use).
    let listener = match TcpListener::bind(("0.0.0.0", ROOM_PORT)) {
        Ok(l) => l,
        Err(e) => {
            ROOM_SERVER_STARTED.store(false, Ordering::SeqCst); // allow retry
            return Err(format!("room listener bind failed on :{ROOM_PORT}: {e}"));
        }
    };
    // Warm the in-memory room from disk (host app restarted mid-session).
    {
        let mut room = lock_or_recover(&ROOM);
        if room.is_none() {
            *room = load_room_from_disk();
        }
    }
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        for stream in listener.incoming().flatten() {
            // Read timeout: a half-open or stalled peer errors out of the
            // read calls below instead of blocking the loop forever.
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
            let mut reader = BufReader::new(match stream.try_clone() {
                Ok(s) => s,
                Err(_) => continue,
            });
            let mut stream = stream;
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();
            let mut content_len = 0usize;
            loop {
                let mut h = String::new();
                if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
                    break;
                }
                if let Some(v) = h.to_lowercase().strip_prefix("content-length:") {
                    content_len = v.trim().parse().unwrap_or(0);
                }
            }
            let mut body = vec![0u8; content_len.min(262_144)];
            if !body.is_empty() && reader.read_exact(&mut body).is_err() {
                continue; // timed out mid-body — drop the connection
            }
            let respond = |stream: &mut std::net::TcpStream, code: u16, body: &str| {
                let _ = write!(
                    stream,
                    "HTTP/1.1 {code} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            };
            if !path.starts_with("/room/") {
                respond(&mut stream, 404, "{\"error\":\"unknown route\"}");
                continue;
            }
            let (status, out) = {
                let mut room = lock_or_recover(&ROOM);
                let (status, out) = room_handle(&method, &path, &body, &mut room, now_ms());
                // Persist every successful mutation atomically.
                if method == "POST" && status == 200 {
                    let _ = save_room(&room);
                }
                (status, out)
            };
            respond(&mut stream, status, &out);
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands.
// ---------------------------------------------------------------------------

/// First non-loopback IPv4 for display next to the room code. macOS-first:
/// `ipconfig getifaddr en0`, then en1; falls back to 127.0.0.1 so the host
/// can still demo solo.
fn lan_ip() -> String {
    for iface in ["en0", "en1"] {
        if let Ok(out) = Command::new("ipconfig").args(["getifaddr", iface]).output() {
            let ip = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if out.status.success() && !ip.is_empty() && ip != "127.0.0.1" {
                return ip;
            }
        }
    }
    "127.0.0.1".into()
}

#[tauri::command]
pub fn room_host_start(name: String) -> Result<serde_json::Value, String> {
    start_room_server()?;
    let (status, body) = {
        let mut room = lock_or_recover(&ROOM);
        let create = serde_json::json!({ "name": name }).to_string();
        let res = room_handle("POST", "/room/create", create.as_bytes(), &mut room, now_ms());
        if res.0 == 200 {
            save_room(&room)?;
        }
        res
    };
    if status != 200 {
        return Err(body);
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("bad create response: {e}"))?;
    Ok(serde_json::json!({
        "code": v["code"],
        "memberId": v["memberId"],
        "ip": lan_ip(),
    }))
}

#[tauri::command]
pub fn room_host_stop() -> Result<(), String> {
    // The listener thread stays up (a blocking accept loop can't be joined
    // cheaply); with the room cleared every request 403s, which is the
    // observable contract. room.json is removed.
    let mut room = lock_or_recover(&ROOM);
    *room = None;
    save_room(&room)
}

/// Plain-TCP HTTP client proxy so the webview never fetches cross-origin.
/// `host_addr` like "192.168.1.7:4518"; GET when bodyJson is empty, POST
/// otherwise. ~3s timeouts on connect/read/write. Returns the response body
/// (which carries {"error": ...} on non-200 — the caller inspects it).
#[tauri::command]
pub fn room_client(host_addr: String, path: String, body_json: String) -> Result<String, String> {
    use std::net::ToSocketAddrs;
    if !path.starts_with("/room/") {
        return Err("room_client only proxies /room/* paths".into());
    }
    let ok_addr = !host_addr.is_empty()
        && host_addr
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-'));
    if !ok_addr {
        return Err(format!("invalid host address {host_addr:?}"));
    }
    let addr = host_addr
        .to_socket_addrs()
        .map_err(|e| format!("cannot resolve {host_addr}: {e}"))?
        .next()
        .ok_or_else(|| format!("cannot resolve {host_addr}"))?;
    let timeout = Duration::from_secs(3);
    let mut stream = std::net::TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("connect {host_addr}: {e}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = if body_json.trim().is_empty() {
        format!("GET {path} HTTP/1.1\r\nHost: {host_addr}\r\nConnection: close\r\n\r\n")
    } else {
        format!(
            "POST {path} HTTP/1.1\r\nHost: {host_addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body_json}",
            body_json.len()
        )
    };
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("send: {e}"))?;
    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|e| format!("read: {e}"))?;
    let text = String::from_utf8_lossy(&raw);
    match text.split_once("\r\n\r\n") {
        Some((_headers, body)) => Ok(body.to_string()),
        None => Err("malformed HTTP response".into()),
    }
}

// ---------------------------------------------------------------------------
// claude -p helpers — mirror pr_draft's pattern (zsh -lc for login-shell
// PATH, no_prompt env), but feed the input over stdin instead of a shell
// pipe so transcripts/plans never touch a command line.
// ---------------------------------------------------------------------------

pub(crate) fn claude_pipe(input: &str, prompt: &str) -> Result<String, String> {
    let script = format!("claude -p {}", sh_quote(prompt));
    let mut child = no_prompt(Command::new("/bin/zsh").args(["-lc", &script]))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn claude: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
        // dropping stdin closes the pipe so claude sees EOF
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

const BRAINSTORM_PROMPT: &str = "You are the facilitator of a small dev team's project brainstorm. \
The input is the chat transcript as a JSON array of {name, role, text}. \
Reply as the facilitator: build on the newest ideas, connect suggestions from different people, \
and either sharpen the direction or ask ONE pointed question that moves the plan forward. \
Under 120 words. Output only the reply text — no preamble, no quotes.";

const PLAN_PROMPT: &str = "The input is a team brainstorm transcript as a JSON array of {name, role, text}. \
Condense it into a concise markdown project plan the team can execute: \
a one-line goal, a Scope section (in/out), an Approach section, and Milestones as a short ordered list. \
Prefer decisions actually made in the chat; flag open questions at the end. \
Output only the markdown plan — no preamble.";

const TASKS_PROMPT: &str = "The input is a markdown project plan. Break it into 3-10 concrete, \
independently workable engineering tasks. \
Output ONLY a strict JSON array of objects with exactly these keys: \
[{\"title\": \"short imperative title\", \"detail\": \"1-3 sentence description\"}]. \
No markdown fences, no comments, no prose before or after the JSON.";

#[tauri::command]
pub fn room_brainstorm_reply(transcript_json: String) -> Result<String, String> {
    claude_pipe(&transcript_json, BRAINSTORM_PROMPT)
}

#[tauri::command]
pub fn room_make_plan(transcript_json: String) -> Result<String, String> {
    claude_pipe(&transcript_json, PLAN_PROMPT)
}

/// Strip a leading/trailing markdown code fence (```json … ```), then, if
/// the remainder still isn't a bare array, cut to the outermost [ … ] span.
/// Models occasionally fence or preface JSON despite instructions.
fn extract_json_array(raw: &str) -> String {
    let mut s = raw.trim();
    if s.starts_with("```") {
        // drop the opening fence line and a trailing fence if present
        s = s.split_once('\n').map(|(_, rest)| rest).unwrap_or("");
        if let Some(stripped) = s.trim_end().strip_suffix("```") {
            s = stripped;
        }
        s = s.trim();
    }
    if s.starts_with('[') {
        return s.to_string();
    }
    match (s.find('['), s.rfind(']')) {
        (Some(a), Some(b)) if a < b => s[a..=b].to_string(),
        _ => s.to_string(),
    }
}

#[tauri::command]
pub fn room_make_tasks(plan: String) -> Result<String, String> {
    let raw = claude_pipe(&plan, TASKS_PROMPT)?;
    let cleaned = extract_json_array(&raw);
    // Validate + normalize so the frontend always receives [{title, detail}].
    let items: Vec<serde_json::Value> = serde_json::from_str(&cleaned)
        .map_err(|e| format!("claude did not return a JSON task array: {e}"))?;
    let tasks: Vec<serde_json::Value> = items
        .iter()
        .filter_map(|t| {
            let title = t["title"].as_str()?.trim().to_string();
            if title.is_empty() {
                return None;
            }
            Some(serde_json::json!({
                "title": title,
                "detail": t["detail"].as_str().unwrap_or("").to_string(),
            }))
        })
        .collect();
    if tasks.is_empty() {
        return Err("claude returned no usable tasks".into());
    }
    serde_json::to_string(&tasks).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tests — pure fns and the handler exercised directly (no network).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- code generation -----------------------------------------------------

    #[test]
    fn alphabet_has_no_lookalikes_and_31_chars() {
        assert_eq!(CODE_ALPHABET.len(), 31);
        for banned in ['0', 'O', '1', 'I', 'L'] {
            assert!(!CODE_ALPHABET.contains(banned), "{banned} must be excluded");
        }
    }

    #[test]
    fn generated_code_is_5_chars_from_alphabet() {
        for _ in 0..50 {
            let code = generate_room_code();
            assert_eq!(code.len(), CODE_LEN);
            assert!(code.chars().all(|c| CODE_ALPHABET.contains(c)), "bad char in {code}");
        }
    }

    #[test]
    fn code_from_bytes_maps_and_rejects_biased_bytes() {
        // bytes 0..5 map straight onto the first alphabet chars
        assert_eq!(code_from_bytes([0, 1, 2, 3, 4]), Some("ABCDE".into()));
        // 248..=255 are rejected (would bias A..H); the next bytes are used
        assert_eq!(
            code_from_bytes([248, 255, 0, 1, 2, 3, 4]),
            Some("ABCDE".into())
        );
        // byte 31 wraps to 'A' again (31 % 31 == 0)
        assert_eq!(code_from_bytes([31, 31, 31, 31, 31]), Some("AAAAA".into()));
        // stream too short → None
        assert_eq!(code_from_bytes([0, 1]), None);
    }

    // -- state JSON round-trip ------------------------------------------------

    fn sample_state() -> RoomState {
        RoomState {
            code: "K7M2P".into(),
            phase: "brainstorm".into(),
            members: vec![
                RoomMember { id: "m1".into(), name: "Aryan".into(), is_host: true, last_seen: 1758040000000, presence: None },
                RoomMember { id: "m2".into(), name: "Sam".into(), is_host: false, last_seen: 1758040001000, presence: None },
            ],
            chat: vec![RoomChatMsg {
                from: "m2".into(),
                name: "Sam".into(),
                role: "user".into(),
                text: "let's build it".into(),
                ts: 1758040002000,
            }],
            plan: "# Plan".into(),
            tasks: vec![RoomTask { id: "t1".into(), title: "scaffold".into(), detail: "vite app".into(), assignee: Some("m2".into()) }],
            started_at: 1758040000000,
            shared: BTreeMap::new(),
            tombstones: BTreeMap::new(),
        }
    }

    #[test]
    fn room_state_json_round_trip_preserves_everything() {
        let state = sample_state();
        let json = serde_json::to_string(&state).unwrap();
        let back: RoomState = serde_json::from_str(&json).unwrap();
        assert_eq!(back, state);
    }

    #[test]
    fn room_state_serializes_contract_field_names() {
        let json = serde_json::to_string(&sample_state()).unwrap();
        for key in ["\"isHost\"", "\"lastSeen\"", "\"startedAt\"", "\"assignee\""] {
            assert!(json.contains(key), "missing contract key {key} in {json}");
        }
        assert!(!json.contains("is_host") && !json.contains("last_seen") && !json.contains("started_at"));
    }

    // -- handler: create / join / auth ----------------------------------------

    fn post(room: &mut Option<RoomState>, path: &str, body: serde_json::Value, now: u64) -> (u16, String) {
        room_handle("POST", path, body.to_string().as_bytes(), room, now)
    }

    fn hosted_room() -> (Option<RoomState>, String) {
        let mut room = None;
        let (st, body) = post(&mut room, "/room/create", serde_json::json!({"name":"Aryan"}), 1_000);
        assert_eq!(st, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["memberId"], "m1");
        let code = v["code"].as_str().unwrap().to_string();
        (room, code)
    }

    #[test]
    fn create_makes_lobby_room_with_host_member() {
        let (room, code) = hosted_room();
        let state = room.unwrap();
        assert_eq!(state.code, code);
        assert_eq!(state.phase, "lobby");
        assert_eq!(state.members.len(), 1);
        assert!(state.members[0].is_host);
        assert_eq!(state.members[0].name, "Aryan");
        assert_eq!(state.started_at, 1_000);
    }

    #[test]
    fn join_adds_member_and_dup_name_rejoins_without_ghost() {
        let (mut room, code) = hosted_room();
        let (st, body) = post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "Sam"}), 2_000);
        assert_eq!(st, 200);
        assert!(body.contains("\"memberId\":\"m2\""));
        // same name joins again (app restart) → SAME id, no duplicate member
        let (st, body) = post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "sam"}), 3_000);
        assert_eq!(st, 200);
        assert!(body.contains("\"memberId\":\"m2\""));
        let state = room.as_ref().unwrap();
        assert_eq!(state.members.len(), 2);
        // rejoin refreshed the heartbeat
        assert_eq!(state.members[1].last_seen, 3_000);
        // a genuinely new name gets the next id
        let (st, body) = post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "Ana"}), 4_000);
        assert_eq!(st, 200);
        assert!(body.contains("\"memberId\":\"m3\""));
    }

    #[test]
    fn wrong_code_is_403_everywhere() {
        let (mut room, _code) = hosted_room();
        let bad = serde_json::json!({"code": "XXXXX", "name": "Eve", "memberId": "m1", "text": "hi", "phase": "brainstorm"});
        for path in ["/room/join", "/room/heartbeat", "/room/chat", "/room/advance", "/room/task"] {
            let (st, body) = post(&mut room, path, bad.clone(), 5_000);
            assert_eq!(st, 403, "{path} must 403 on wrong code: {body}");
        }
        let (st, _) = room_handle("GET", "/room/state?code=XXXXX", b"", &mut room, 5_000);
        assert_eq!(st, 403);
        // and with no room at all, even the right-looking code 403s
        let mut none: Option<RoomState> = None;
        let (st, _) = room_handle("GET", "/room/state?code=ABCDE", b"", &mut none, 5_000);
        assert_eq!(st, 403);
    }

    #[test]
    fn state_returns_full_room_for_correct_code() {
        let (mut room, code) = hosted_room();
        let (st, body) = room_handle("GET", &format!("/room/state?code={code}"), b"", &mut room, 6_000);
        assert_eq!(st, 200);
        let v: RoomState = serde_json::from_str(&body).unwrap();
        assert_eq!(v.code, code);
        assert_eq!(v.members[0].name, "Aryan");
    }

    #[test]
    fn code_check_is_case_insensitive_on_input() {
        let (mut room, code) = hosted_room();
        let lower = code.to_lowercase();
        let (st, _) = post(&mut room, "/room/join", serde_json::json!({"code": lower, "name": "Sam"}), 2_000);
        assert_eq!(st, 200);
    }

    // -- handler: heartbeat / chat --------------------------------------------

    #[test]
    fn heartbeat_updates_last_seen() {
        let (mut room, code) = hosted_room();
        post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "Sam"}), 2_000);
        let (st, _) = post(&mut room, "/room/heartbeat", serde_json::json!({"code": code, "memberId": "m2"}), 9_999);
        assert_eq!(st, 200);
        assert_eq!(room.as_ref().unwrap().members[1].last_seen, 9_999);
        // unknown member → 403
        let (st, _) = post(&mut room, "/room/heartbeat", serde_json::json!({"code": code, "memberId": "m9"}), 9_999);
        assert_eq!(st, 403);
    }

    #[test]
    fn chat_appends_user_msg_and_guests_cannot_forge_assistant_role() {
        let (mut room, code) = hosted_room();
        post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "Sam"}), 2_000);
        // guest asks for assistant role — forced to "user"
        let (st, _) = post(
            &mut room,
            "/room/chat",
            serde_json::json!({"code": code, "memberId": "m2", "text": "i am claude", "role": "assistant"}),
            3_000,
        );
        assert_eq!(st, 200);
        // host relays a real assistant reply — role honored
        let (st, _) = post(
            &mut room,
            "/room/chat",
            serde_json::json!({"code": code, "memberId": "m1", "text": "great idea, what stack?", "role": "assistant"}),
            4_000,
        );
        assert_eq!(st, 200);
        let chat = &room.as_ref().unwrap().chat;
        assert_eq!(chat.len(), 2);
        assert_eq!(chat[0].role, "user");
        assert_eq!(chat[0].name, "Sam");
        assert_eq!(chat[1].role, "assistant");
        assert_eq!(chat[1].from, "m1");
        // empty text → 400
        let (st, _) = post(&mut room, "/room/chat", serde_json::json!({"code": code, "memberId": "m2", "text": "  "}), 5_000);
        assert_eq!(st, 400);
    }

    // -- handler: advance (host only) -----------------------------------------

    #[test]
    fn advance_is_host_only_and_applies_payloads() {
        let (mut room, code) = hosted_room();
        post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "Sam"}), 2_000);
        // guest may not advance
        let (st, _) = post(&mut room, "/room/advance", serde_json::json!({"code": code, "memberId": "m2", "phase": "brainstorm"}), 3_000);
        assert_eq!(st, 403);
        assert_eq!(room.as_ref().unwrap().phase, "lobby");
        // host advances to brainstorm
        let (st, _) = post(&mut room, "/room/advance", serde_json::json!({"code": code, "memberId": "m1", "phase": "brainstorm"}), 3_000);
        assert_eq!(st, 200);
        assert_eq!(room.as_ref().unwrap().phase, "brainstorm");
        // plan payload lands in room.plan
        let (st, _) = post(
            &mut room,
            "/room/advance",
            serde_json::json!({"code": code, "memberId": "m1", "phase": "plan", "payload": "# The Plan"}),
            4_000,
        );
        assert_eq!(st, 200);
        assert_eq!(room.as_ref().unwrap().plan, "# The Plan");
        // tasks payload lands in room.tasks with minted ids
        let (st, _) = post(
            &mut room,
            "/room/advance",
            serde_json::json!({"code": code, "memberId": "m1", "phase": "tasks",
                "payload": [{"title": "scaffold", "detail": "vite"}, {"title": "api", "detail": "rust"}]}),
            5_000,
        );
        assert_eq!(st, 200);
        let state = room.as_ref().unwrap();
        assert_eq!(state.phase, "tasks");
        assert_eq!(state.tasks.len(), 2);
        assert_eq!(state.tasks[0].id, "t1");
        assert_eq!(state.tasks[1].id, "t2");
        // bogus phase → 400
        let (st, _) = post(&mut room, "/room/advance", serde_json::json!({"code": code, "memberId": "m1", "phase": "warp"}), 6_000);
        assert_eq!(st, 400);
    }

    // -- handler: task ops -----------------------------------------------------

    #[test]
    fn task_add_edit_assign_remove_lifecycle() {
        let (mut room, code) = hosted_room();
        post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "Sam"}), 2_000);
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m2", "op": "add", "task": {"title": "write docs", "detail": "readme"}}), 3_000);
        assert_eq!(st, 200);
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m1", "op": "add", "task": {"title": "ship it"}}), 3_100);
        assert_eq!(st, 200);
        assert_eq!(room.as_ref().unwrap().tasks[1].id, "t2");
        // edit t1
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m2", "op": "edit", "task": {"id": "t1", "title": "write GOOD docs", "detail": "readme + demo"}}), 3_200);
        assert_eq!(st, 200);
        assert_eq!(room.as_ref().unwrap().tasks[0].title, "write GOOD docs");
        // assign t2 → m2
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m1", "op": "assign", "task": {"id": "t2", "assignee": "m2"}}), 3_300);
        assert_eq!(st, 200);
        assert_eq!(room.as_ref().unwrap().tasks[1].assignee.as_deref(), Some("m2"));
        // unassign (null assignee)
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m1", "op": "assign", "task": {"id": "t2", "assignee": null}}), 3_350);
        assert_eq!(st, 200);
        assert_eq!(room.as_ref().unwrap().tasks[1].assignee, None);
        // remove t1; removing again 404s
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m2", "op": "remove", "task": {"id": "t1"}}), 3_400);
        assert_eq!(st, 200);
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m2", "op": "remove", "task": {"id": "t1"}}), 3_500);
        assert_eq!(st, 404);
        // id minting never reuses a removed id's successor: next add is t3
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m1", "op": "add", "task": {"title": "one more"}}), 3_600);
        assert_eq!(st, 200);
        assert_eq!(room.as_ref().unwrap().tasks.last().unwrap().id, "t3");
        // unknown op → 400
        let (st, _) = post(&mut room, "/room/task",
            serde_json::json!({"code": code, "memberId": "m1", "op": "explode", "task": {}}), 3_700);
        assert_eq!(st, 400);
    }

    // -- misc pure helpers -----------------------------------------------------

    #[test]
    fn unknown_route_404s() {
        let mut room = None;
        let (st, _) = room_handle("GET", "/room/nope", b"", &mut room, 1);
        assert_eq!(st, 404);
        let (st, _) = room_handle("DELETE", "/room/state", b"", &mut room, 1);
        assert_eq!(st, 404);
    }

    #[test]
    fn extract_json_array_strips_fences_and_prose() {
        let plain = r#"[{"title":"a","detail":"b"}]"#;
        assert_eq!(extract_json_array(plain), plain);
        assert_eq!(extract_json_array(&format!("```json\n{plain}\n```")), plain);
        assert_eq!(extract_json_array(&format!("```\n{plain}\n```")), plain);
        assert_eq!(
            extract_json_array(&format!("Here are the tasks:\n{plain}\nHope that helps!")),
            plain
        );
        // garbage passes through (caller's serde parse reports the error)
        assert_eq!(extract_json_array("no json here"), "no json here");
    }

    #[test]
    fn normalize_tasks_mints_ids_and_drops_untitled() {
        let items = vec![
            serde_json::json!({"title": "a", "detail": "d1"}),
            serde_json::json!({"detail": "no title — dropped"}),
            serde_json::json!({"title": "b", "id": "t9", "assignee": "m2"}),
            serde_json::json!({"title": "c"}),
        ];
        let tasks = normalize_tasks(&items);
        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].id, "t1");
        assert_eq!(tasks[1].id, "t9");
        assert_eq!(tasks[1].assignee.as_deref(), Some("m2"));
        assert_eq!(tasks[2].id, "t10"); // continues past the explicit t9
    }

    // -- handler: live shared sync (post-onboarding) --------------------------

    fn ids(arr: &serde_json::Value) -> Vec<String> {
        arr.as_array()
            .unwrap()
            .iter()
            .map(|v| v["id"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn sync_merges_deltas_from_multiple_members_by_id() {
        let (mut room, code) = hosted_room();
        post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "Sam"}), 2_000);
        // host pushes a task
        let (st, body) = post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m1", "file": "tasks.json",
            "items": [{"id": "t1", "title": "A", "status": "not-started"}]
        }), 3_000);
        assert_eq!(st, 200);
        assert_eq!(ids(&serde_json::from_str::<serde_json::Value>(&body).unwrap()["items"]), vec!["t1"]);
        // guest pushes a different task — must NOT clobber t1
        let (_st, body) = post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m2", "file": "tasks.json",
            "items": [{"id": "t2", "title": "B", "status": "not-started"}]
        }), 3_100);
        let merged = &serde_json::from_str::<serde_json::Value>(&body).unwrap()["items"];
        assert_eq!(ids(merged), vec!["t1", "t2"], "tasks append and both survive");
        // host updates t1 in place (status change) — overwrite by id, order kept
        let (_st, body) = post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m1", "file": "tasks.json",
            "items": [{"id": "t1", "title": "A", "status": "done"}]
        }), 3_200);
        let merged = &serde_json::from_str::<serde_json::Value>(&body).unwrap()["items"];
        assert_eq!(ids(merged), vec!["t1", "t2"]);
        assert_eq!(merged.as_array().unwrap()[0]["status"], "done");
    }

    #[test]
    fn sync_messages_prepend_newest_first() {
        let (mut room, code) = hosted_room();
        post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m1", "file": "messages.json", "items": [{"id": "a", "text": "1"}]
        }), 1_000);
        let (_st, body) = post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m1", "file": "messages.json", "items": [{"id": "b", "text": "2"}]
        }), 1_100);
        let merged = &serde_json::from_str::<serde_json::Value>(&body).unwrap()["items"];
        assert_eq!(ids(merged), vec!["b", "a"], "messages newest-first");
    }

    #[test]
    fn sync_tombstone_prevents_offline_peer_resurrection() {
        let (mut room, code) = hosted_room();
        post(&mut room, "/room/join", serde_json::json!({"code": code, "name": "Sam"}), 2_000);
        // both members know t1
        post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m1", "file": "tasks.json", "items": [{"id": "t1", "title": "A"}]
        }), 3_000);
        // host deletes t1 (removed) — tombstoned + dropped from authority
        let (_st, body) = post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m1", "file": "tasks.json", "items": [], "removed": ["t1"]
        }), 3_100);
        let merged = &serde_json::from_str::<serde_json::Value>(&body).unwrap()["items"];
        assert!(merged.as_array().unwrap().is_empty(), "t1 gone from authority");
        // a reconnecting guest re-pushes its stale copy of t1 — MUST be rejected
        let (_st, body) = post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m2", "file": "tasks.json", "items": [{"id": "t1", "title": "A"}]
        }), 3_200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(v["items"].as_array().unwrap().is_empty(), "tombstoned t1 not resurrected");
        assert_eq!(v["tombstones"].as_array().unwrap()[0], "t1");
    }

    #[test]
    fn sync_rejects_unknown_file_member_and_code() {
        let (mut room, code) = hosted_room();
        // unknown file
        let (st, _) = post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m1", "file": "secrets.json", "items": []
        }), 1_000);
        assert_eq!(st, 400);
        // unknown member
        let (st, _) = post(&mut room, "/room/sync", serde_json::json!({
            "code": code, "memberId": "m9", "file": "tasks.json", "items": []
        }), 1_000);
        assert_eq!(st, 403);
        // wrong code
        let (st, _) = post(&mut room, "/room/sync", serde_json::json!({
            "code": "XXXXX", "memberId": "m1", "file": "tasks.json", "items": []
        }), 1_000);
        assert_eq!(st, 403);
    }

    #[test]
    fn heartbeat_stores_presence_and_state_echoes_it() {
        let (mut room, code) = hosted_room();
        let (st, _) = post(&mut room, "/room/heartbeat", serde_json::json!({
            "code": code, "memberId": "m1", "presence": {"status": "needs-input", "file": "lib.rs"}
        }), 5_000);
        assert_eq!(st, 200);
        let (_st, body) = room_handle("GET", &format!("/room/state?code={code}"), b"", &mut room, 6_000);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["members"][0]["presence"]["status"], "needs-input");
        assert_eq!(v["members"][0]["presence"]["file"], "lib.rs");
        // a heartbeat without presence keeps the last one (doesn't wipe it)
        post(&mut room, "/room/heartbeat", serde_json::json!({"code": code, "memberId": "m1"}), 7_000);
        let (_st, body) = room_handle("GET", &format!("/room/state?code={code}"), b"", &mut room, 8_000);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["members"][0]["presence"]["status"], "needs-input");
    }

    #[test]
    fn next_id_continues_after_gaps() {
        assert_eq!(next_id("m", vec![].into_iter()), "m1");
        assert_eq!(
            next_id("m", vec!["m1".to_string(), "m3".to_string()].into_iter()),
            "m4"
        );
        assert_eq!(
            next_id("t", vec!["t2".to_string(), "weird".to_string()].into_iter()),
            "t3"
        );
    }
}

// ---------------------------------------------------------------------------
// Over-the-wire integration test: the REAL 0.0.0.0:4518 listener, driven by
// two independent TCP clients (as two machines would), proving a delta pushed
// by one client converges into the other's GET /room/state. Skips gracefully
// if :4518 is already bound (e.g. the app is running a room) so it never
// fails a dev machine.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod wire_tests {
    use super::*;
    use std::net::TcpStream;

    /// One raw HTTP round-trip to the local room server; returns (status, body).
    fn req(method: &str, path: &str, body: &str) -> Option<(u16, String)> {
        let mut s = TcpStream::connect(("127.0.0.1", ROOM_PORT)).ok()?;
        s.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
        let req = if body.is_empty() {
            format!("{method} {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        } else {
            format!(
                "{method} {path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
        };
        s.write_all(req.as_bytes()).ok()?;
        let mut raw = String::new();
        s.read_to_string(&mut raw).ok()?;
        let status: u16 = raw
            .split_whitespace()
            .nth(1)
            .and_then(|c| c.parse().ok())
            .unwrap_or(0);
        let body = raw.split_once("\r\n\r\n").map(|(_, b)| b.to_string())?;
        Some((status, body))
    }

    #[test]
    fn two_tcp_clients_converge_through_the_real_listener() {
        // Isolate from any persisted room and from other tests' global state.
        *lock_or_recover(&ROOM) = None;
        if start_room_server().is_err() {
            eprintln!("skipping wire test — :{ROOM_PORT} already bound");
            return;
        }
        // brief grace for the accept thread to be ready
        std::thread::sleep(Duration::from_millis(50));

        // client A (host) creates the room
        let Some((st, body)) = req("POST", "/room/create", r#"{"name":"Host"}"#) else {
            eprintln!("skipping wire test — server not reachable");
            return;
        };
        assert_eq!(st, 200, "create: {body}");
        let code = serde_json::from_str::<serde_json::Value>(&body).unwrap()["code"]
            .as_str()
            .unwrap()
            .to_string();

        // client B (guest) joins over its own connection
        let (st, _) = req("POST", "/room/join", &format!(r#"{{"code":"{code}","name":"Guest"}}"#)).unwrap();
        assert_eq!(st, 200);

        // advance to the live phase so this mirrors post-onboarding sync
        let (st, _) = req("POST", "/room/advance", &format!(r#"{{"code":"{code}","memberId":"m1","phase":"done"}}"#)).unwrap();
        assert_eq!(st, 200);

        // A pushes a task; B pushes a different task — separate connections
        let (st, _) = req("POST", "/room/sync", &format!(r#"{{"code":"{code}","memberId":"m1","file":"tasks.json","items":[{{"id":"t1","title":"A"}}]}}"#)).unwrap();
        assert_eq!(st, 200);
        let (st, _) = req("POST", "/room/sync", &format!(r#"{{"code":"{code}","memberId":"m2","file":"tasks.json","items":[{{"id":"t2","title":"B"}}]}}"#)).unwrap();
        assert_eq!(st, 200);

        // a THIRD independent reader pulls state — sees BOTH tasks merged
        let (st, body) = req("GET", &format!("/room/state?code={code}"), "").unwrap();
        assert_eq!(st, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        let ids: Vec<&str> = v["shared"]["tasks.json"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_str().unwrap())
            .collect();
        assert!(ids.contains(&"t1") && ids.contains(&"t2"), "both clients' tasks converged: {ids:?}");

        // presence pushed by B over the wire is visible to A's read
        let (st, _) = req("POST", "/room/heartbeat", &format!(r#"{{"code":"{code}","memberId":"m2","presence":{{"status":"working","file":"api.rs"}}}}"#)).unwrap();
        assert_eq!(st, 200);
        let (_st, body) = req("GET", &format!("/room/state?code={code}"), "").unwrap();
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["members"][1]["presence"]["status"], "working");

        // clean the global so we don't leak a room into other test binaries
        *lock_or_recover(&ROOM) = None;
    }
}
