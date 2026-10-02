// ---------------------------------------------------------------------------
// Team rooms over the hosted relay (relay/ in this repo, on Wasmer Edge).
//
// The relay only stores each room as one versioned JSON document. The rules
// stay here, in room_handle — the same code the LAN host runs. For a change,
// we read the latest document, apply room_handle to a copy, and write it back
// with the version we read. If someone else wrote first the relay answers 409
// with the newer document and we apply again on top of it. Nobody has to stay
// online as host, and both transports share one implementation of the rules.
//
// Heartbeats and presence ride a separate tiny table (one `tick` call that
// also polls), so the every-1.5s traffic never rewrites the document.
//
// The webview addresses a relay room as hostAddr "relay:<room>:<secret>" and
// keeps calling room_client exactly as it does for a LAN host.
// ---------------------------------------------------------------------------

use crate::room::{room_handle, RoomState};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

pub const DEFAULT_RELAY: &str = "https://grillme-relay.wasmer.app";
const CAS_RETRIES: usize = 6;

/// GRILLME_RELAY_URL overrides the hosted relay (local testing).
fn base() -> String {
    std::env::var("GRILLME_RELAY_URL").unwrap_or_else(|_| DEFAULT_RELAY.to_string()).trim_end_matches('/').to_string()
}

struct Cached {
    version: i64,
    doc: RoomState,
    /// member id → {lastSeen (relay clock), presence}
    presence: Value,
    /// local clock minus relay clock, so lastSeen lines up with ours
    skew_ms: i64,
}

static CACHE: Mutex<Option<HashMap<String, Cached>>> = Mutex::new(None);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn is_token(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// "relay:<room>:<secret>" → (room, secret)
pub fn parse_host(addr: &str) -> Option<(String, String)> {
    let rest = addr.strip_prefix("relay:")?;
    let (room, secret) = rest.split_once(':')?;
    (is_token(room, 32) && is_token(secret, 128)).then(|| (room.to_string(), secret.to_string()))
}

/// Accepts the invite link (`https://…/join/<room>#<secret>`) or a raw
/// hostAddr. Whitespace and a trailing slash from copy-paste are tolerated.
pub fn parse_invite(link: &str) -> Option<(String, String)> {
    let link = link.trim();
    if let Some(found) = parse_host(link) {
        return Some(found);
    }
    let (before, secret) = link.split_once('#')?;
    let room = before.trim_end_matches('/').rsplit_once("/join/")?.1;
    let secret = secret.trim();
    (is_token(room, 32) && is_token(secret, 128)).then(|| (room.to_string(), secret.to_string()))
}

pub fn invite_link(room: &str, secret: &str) -> String {
    format!("{}/join/{room}#{secret}", base())
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).build()
}

/// Send JSON, return (status, body JSON). Non-2xx is not an error here —
/// 409 carries data we need.
fn call(method: &str, url: &str, secret: Option<&str>, body: &Value) -> Result<(u16, Value), String> {
    let mut req = agent().request(method, url).set("Content-Type", "application/json");
    if let Some(s) = secret {
        req = req.set("Authorization", &format!("Bearer {s}"));
    }
    let resp = match req.send_string(&body.to_string()) {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(format!("can't reach the team relay: {e}")),
    };
    let status = resp.status();
    let text = resp.into_string().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status == 404 {
        return Err("this team no longer exists, or the invite is wrong".into());
    }
    Ok((status, v))
}

fn store(room: &str, version: i64, doc: RoomState, presence: Value, skew_ms: i64) {
    let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    g.get_or_insert_with(HashMap::new).insert(room.to_string(), Cached { version, doc, presence, skew_ms });
}

/// Poll (and optionally heartbeat). Refreshes the cache; returns nothing.
fn tick(room: &str, secret: &str, member: Option<&str>, presence: Option<&Value>) -> Result<(), String> {
    let since = {
        let g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        g.as_ref().and_then(|m| m.get(room)).map(|c| c.version)
    };
    let mut body = json!({});
    if let Some(v) = since {
        body["since"] = json!(v);
    }
    if let Some(m) = member {
        body["member"] = json!(m);
        body["presence"] = presence.cloned().unwrap_or(Value::Null);
    }
    let (status, v) = call("POST", &format!("{}/v1/rooms/{room}/tick", base()), Some(secret), &body)?;
    if status != 200 {
        return Err(v["error"].as_str().unwrap_or("relay error").to_string());
    }
    let skew = now_ms() as i64 - v["now"].as_i64().unwrap_or(now_ms() as i64);
    let presence = v["presence"].clone();
    let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let map = g.get_or_insert_with(HashMap::new);
    if v["unchanged"] == true {
        if let Some(c) = map.get_mut(room) {
            c.presence = presence;
            c.skew_ms = skew;
            return Ok(());
        }
    }
    let doc: RoomState = serde_json::from_value(v["doc"].clone()).map_err(|e| format!("bad room document: {e}"))?;
    let version = v["version"].as_i64().unwrap_or(0);
    map.insert(room.to_string(), Cached { version, doc, presence, skew_ms: skew });
    Ok(())
}

/// The cached document with live presence laid over each member.
fn current(room: &str) -> Option<(i64, RoomState)> {
    let g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let c = g.as_ref()?.get(room)?;
    let mut doc = c.doc.clone();
    overlay(&mut doc, &c.presence, c.skew_ms);
    Some((c.version, doc))
}

/// Presence from the relay wins over what's stored in the document: it is
/// fresher (written every tick) and never conflicts.
fn overlay(doc: &mut RoomState, presence: &Value, skew_ms: i64) {
    for m in doc.members.iter_mut() {
        let p = &presence[&m.id];
        if let Some(ts) = p["lastSeen"].as_i64() {
            m.last_seen = (ts + skew_ms).max(0) as u64;
        }
        if !p["presence"].is_null() {
            m.presence = Some(p["presence"].clone());
        }
    }
}

/// Apply one change with compare-and-swap, retrying on top of newer writes.
fn mutate(room: &str, secret: &str, path: &str, body: &[u8]) -> Result<String, String> {
    if current(room).is_none() {
        tick(room, secret, None, None)?;
    }
    for _ in 0..CAS_RETRIES {
        let (version, doc) = current(room).ok_or("room not loaded")?;
        let mut slot = Some(doc);
        let (status, resp) = room_handle("POST", path, body, &mut slot, now_ms());
        if status != 200 {
            return Ok(resp); // same error body a LAN host would send
        }
        let doc = slot.ok_or("room vanished")?;
        let (code, v) = call(
            "PUT",
            &format!("{}/v1/rooms/{room}", base()),
            Some(secret),
            &json!({ "expected": version, "doc": doc }),
        )?;
        let (presence, skew) = {
            let g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
            g.as_ref().and_then(|m| m.get(room)).map(|c| (c.presence.clone(), c.skew_ms)).unwrap_or((json!({}), 0))
        };
        match code {
            200 => {
                store(room, v["version"].as_i64().unwrap_or(version + 1), doc, presence, skew);
                return Ok(resp);
            }
            409 => {
                let newer: RoomState = serde_json::from_value(v["doc"].clone()).map_err(|e| format!("bad room document: {e}"))?;
                store(room, v["version"].as_i64().unwrap_or(version), newer, presence, skew);
            }
            _ => return Err(v["error"].as_str().unwrap_or("relay error").to_string()),
        }
    }
    Err("the team is busy — try again".into())
}

/// room_client's relay branch: same paths, same response bodies as LAN.
pub fn request(host_addr: &str, path: &str, body_json: &str) -> Result<String, String> {
    let (room, secret) = parse_host(host_addr).ok_or("invalid relay address")?;
    let route = path.split('?').next().unwrap_or("");
    let v: Value = serde_json::from_str(body_json).unwrap_or(Value::Null);
    match route {
        "/room/state" => {
            tick(&room, &secret, None, None)?;
            let (_, doc) = current(&room).ok_or("room not loaded")?;
            Ok(room_handle("GET", path, b"", &mut Some(doc), now_ms()).1)
        }
        "/room/heartbeat" => {
            let member = v["memberId"].as_str().unwrap_or("");
            tick(&room, &secret, Some(member), v.get("presence"))?;
            // answer as the host would (403 for an unknown member), but never
            // write the document for a heartbeat
            let (_, doc) = current(&room).ok_or("room not loaded")?;
            Ok(room_handle("POST", path, body_json.as_bytes(), &mut Some(doc), now_ms()).1)
        }
        "/room/create" => Err("create a relay room with room_relay_create".into()),
        _ => mutate(&room, &secret, path, body_json.as_bytes()),
    }
}

/// Create a team on the relay. Returns {code, memberId, hostAddr, invite}.
#[tauri::command(async)]
pub fn room_relay_create(name: String) -> Result<Value, String> {
    let mut slot: Option<RoomState> = None;
    let (status, resp) = room_handle("POST", "/room/create", json!({ "name": name }).to_string().as_bytes(), &mut slot, now_ms());
    if status != 200 {
        return Err(resp);
    }
    let created: Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;
    let doc = slot.ok_or("room not created")?;
    let (code, v) = call("POST", &format!("{}/v1/rooms", base()), None, &json!({ "doc": doc }))?;
    if code != 200 {
        return Err(v["error"].as_str().unwrap_or("relay error").to_string());
    }
    let room = v["room"].as_str().ok_or("relay sent no room id")?.to_string();
    let secret = v["secret"].as_str().ok_or("relay sent no secret")?.to_string();
    store(&room, v["version"].as_i64().unwrap_or(1), doc, json!({}), 0);
    Ok(json!({
        "code": created["code"],
        "memberId": created["memberId"],
        "hostAddr": format!("relay:{room}:{secret}"),
        "invite": invite_link(&room, &secret),
    }))
}

/// Join a team from an invite link. Returns {code, memberId, hostAddr, invite}.
#[tauri::command(async)]
pub fn room_relay_join(invite: String, name: String) -> Result<Value, String> {
    let (room, secret) = parse_invite(&invite).ok_or("That doesn't look like a Grill Me invite link")?;
    tick(&room, &secret, None, None)?;
    let (_, doc) = current(&room).ok_or("room not loaded")?;
    let resp = mutate(&room, &secret, "/room/join", json!({ "code": doc.code, "name": name }).to_string().as_bytes())?;
    let joined: Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;
    if joined.get("memberId").is_none() {
        return Err(joined["error"].as_str().unwrap_or("couldn't join").to_string());
    }
    Ok(json!({
        "code": doc.code,
        "memberId": joined["memberId"],
        "hostAddr": format!("relay:{room}:{secret}"),
        "invite": invite_link(&room, &secret),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_invites_and_host_addrs() {
        let want = Some(("abc123def456".to_string(), "s3cr-et_X".to_string()));
        assert_eq!(parse_invite("https://grillme-relay.wasmer.app/join/abc123def456#s3cr-et_X"), want);
        assert_eq!(parse_invite("  https://x.dev/join/abc123def456/#s3cr-et_X \n"), want);
        assert_eq!(parse_invite("relay:abc123def456:s3cr-et_X"), want);
        assert_eq!(parse_host("relay:abc123def456:s3cr-et_X"), want);
    }

    #[test]
    fn rejects_lookalikes() {
        assert_eq!(parse_invite("https://x.dev/join/abc123def456"), None); // no secret
        assert_eq!(parse_invite("https://x.dev/join/../etc#x"), None);
        assert_eq!(parse_host("relay:room"), None);
        assert_eq!(parse_host("192.168.1.4:4518"), None);
        assert_eq!(parse_host("relay:a b:c"), None);
    }

    #[test]
    fn presence_overlay_uses_local_clock() {
        let mut slot = None;
        room_handle("POST", "/room/create", br#"{"name":"Ana"}"#, &mut slot, 1_000);
        let mut doc = slot.unwrap();
        // relay clock is 500ms behind ours
        overlay(&mut doc, &json!({ "m1": { "lastSeen": 9_000, "presence": { "file": "a.ts" } } }), 500);
        assert_eq!(doc.members[0].last_seen, 9_500);
        assert_eq!(doc.members[0].presence, Some(json!({ "file": "a.ts" })));
    }

    /// Talks to the live relay (or GRILLME_RELAY_URL). Run with:
    /// cargo test --lib relay::tests::live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_two_people_and_a_stale_write() {
        let made = room_relay_create("Ana".into()).expect("create");
        let host = made["hostAddr"].as_str().unwrap().to_string();
        let code = made["code"].as_str().unwrap().to_string();
        let (room, _) = parse_host(&host).unwrap();

        // Ana's copy is about to go stale: keep it, let Ben join, put it back
        let stale = { let g = CACHE.lock().unwrap(); let c = g.as_ref().unwrap().get(&room).unwrap(); (c.version, c.doc.clone()) };
        let joined = room_relay_join(made["invite"].as_str().unwrap().into(), "Ben".into()).expect("join");
        assert_eq!(joined["memberId"], "m2");
        store(&room, stale.0, stale.1, json!({}), 0);

        // Ana writes from version 1 → 409 → retried on top of Ben's join
        let r = request(&host, "/room/chat", &json!({ "code": code, "memberId": "m1", "text": "hi Ben" }).to_string()).unwrap();
        assert!(!r.contains("error"), "{r}");

        // Ben heartbeats with presence; a fresh read sees both members, the chat and presence
        request(&host, "/room/heartbeat", &json!({ "code": code, "memberId": "m2", "presence": { "file": "api.ts" } }).to_string()).unwrap();
        let state: RoomState = serde_json::from_str(&request(&host, &format!("/room/state?code={code}"), "").unwrap()).unwrap();
        assert_eq!(state.members.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), ["Ana", "Ben"]);
        assert_eq!(state.chat.last().unwrap().text, "hi Ben");
        assert_eq!(state.members[1].presence, Some(json!({ "file": "api.ts" })));

        // wrong secret is refused
        let bad = format!("relay:{room}:wrongsecret");
        assert!(request(&bad, &format!("/room/state?code={code}"), "").is_err());
    }
}
