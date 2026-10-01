// ---------------------------------------------------------------------------
// HTTP, both directions, on std::net only.
//
// * push(): the writes. POST http://127.0.0.1:4517/bridge/push to Grill Me's
//   loopback API (Bearer token from ~/.grillme/api-token), so nothing reaches
//   a session or the board until the user approves it in the app.
// * serve(): claude.ai over Tailscale Funnel. Streamable-HTTP MCP, JSON
//   responses only. Loopback only — Funnel is the sole way in. The URL
//   carries a 64-hex secret (/mcp/<secret>, or a Bearer header); anything
//   else is a 404 so the endpoint doesn't reveal itself. Auth is checked
//   BEFORE the rate limit (strangers get their own bucket), every request is
//   logged to ~/.grillme/remote-access.jsonl, and the server exits when the
//   app that started it goes away.
// ---------------------------------------------------------------------------

use super::data::Ctx;
use super::js::{self, get};
use super::tools::{handle, scrub_outgoing};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const API_PORT: u16 = 4517;
const RATE_PER_MIN: usize = 120;
const STRANGER_PER_MIN: usize = 60;
const MAX_BODY: usize = 1_000_000;
const MAX_HEADER: usize = 16 * 1024;
const MAX_CONNS: usize = 16;
const HEADERS_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

// ---- client: writes go through Grill Me ------------------------------------------

/// (status, body) from a tiny HTTP/1.1 POST. Err = couldn't get a response.
fn post(port: u16, path: &str, token: &str, body: &str) -> Result<(u16, String), ()> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(10)).map_err(|_| ())?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(300)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(30)));
    let req = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).map_err(|_| ())?;
    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match s.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&buf[..n]),
            Err(_) if !raw.is_empty() => break,
            Err(_) => return Err(()),
        }
    }
    let end = find(&raw, b"\r\n\r\n").ok_or(())?;
    let head = String::from_utf8_lossy(&raw[..end]).into_owned();
    let status: u16 = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).ok_or(())?;
    let mut body = raw[end + 4..].to_vec();
    let headers = parse_headers(head.lines().skip(1));
    if header(&headers, "transfer-encoding").is_some_and(|t| t.eq_ignore_ascii_case("chunked")) {
        body = dechunk(&body).unwrap_or_default();
    } else if let Some(n) = header(&headers, "content-length").and_then(|n| n.parse::<usize>().ok()) {
        body.truncate(n);
    }
    Ok((status, String::from_utf8_lossy(&body).into_owned()))
}

pub fn push(ctx: &Ctx, kind: &str, item: Value) -> Result<(), String> {
    // GRILLME_API_PORT: tests point writes at a stand-in (or a closed port)
    // instead of a Grill Me that may be running on this Mac
    let port = std::env::var("GRILLME_API_PORT").ok().and_then(|p| p.parse::<u16>().ok()).filter(|p| *p != 0).unwrap_or(API_PORT);
    push_to(port, ctx, kind, item)
}

fn push_to(port: u16, ctx: &Ctx, kind: &str, item: Value) -> Result<(), String> {
    let token = std::fs::read(ctx.root_path().join("api-token"))
        .map(|b| js::trim(&String::from_utf8_lossy(&b)).to_string())
        .unwrap_or_default();
    let body = js::stringify(&json!({ "kind": kind, "item": item, "project": ctx.project_dir().id }), 0);
    let Ok((status, text)) = post(port, "/bridge/push", &token, &body) else {
        return Err("Grill Me isn't running — open the Grill Me app, then try again.".into());
    };
    if !(200..300).contains(&status) {
        if text.contains("unknown route") {
            return Err("This Grill Me build doesn't have the bridge yet — update Grill Me (grill update), then try again.".into());
        }
        return Err(format!("Grill Me refused: {text}"));
    }
    // res.json(): a non-JSON success body is an error too
    js::parse(&text).map(|_| ()).ok_or_else(|| format!("Unexpected response from Grill Me: {}", js::clip(&text, 80)))
}

// ---- server -------------------------------------------------------------------------

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn parse_headers<'a>(lines: impl Iterator<Item = &'a str>) -> Vec<(String, String)> {
    lines
        .filter_map(|l| {
            let (k, v) = l.split_once(':')?;
            Some((k.trim().to_ascii_lowercase(), v.trim_matches([' ', '\t']).to_string()))
        })
        .collect()
}

fn header<'a>(h: &'a [(String, String)], name: &str) -> Option<&'a str> {
    h.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

fn dechunk(mut b: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let eol = find(b, b"\r\n")?;
        let size_s = String::from_utf8_lossy(&b[..eol]);
        let size = usize::from_str_radix(size_s.split(';').next()?.trim(), 16).ok()?;
        b = &b[eol + 2..];
        if size == 0 {
            return Some(out);
        }
        if b.len() < size + 2 {
            return None;
        }
        out.extend_from_slice(&b[..size]);
        if out.len() > MAX_BODY {
            return None;
        }
        b = &b[size + 2..];
    }
}

/// Constant-time byte comparison (lengths are compared first, like
/// crypto.timingSafeEqual guarded by a length check).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The secret, re-read on every request so "New secret" takes effect even if
/// this process somehow outlived the app that started it.
fn secret_now(file: &Path) -> Option<Vec<u8>> {
    let raw = std::fs::read(file).ok()?;
    let s = js::trim(&String::from_utf8_lossy(&raw)).to_string();
    (s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))).then(|| s.into_bytes())
}

/// Is this request authorized? The secret comes from the path (/mcp/<secret>)
/// or, when the path has none, from `Authorization: Bearer <secret>`.
pub fn authed(secret: Option<&[u8]>, path: &str, auth: Option<&str>) -> bool {
    let Some(secret) = secret else { return false };
    let from_path = path.strip_prefix("/mcp/").map(|r| r.split('/').next().unwrap_or("")).unwrap_or("");
    let from_header = auth.map(bearer).unwrap_or("");
    let given = if from_path.is_empty() { from_header } else { from_path };
    ct_eq(given.as_bytes(), secret)
}

/// `/^Bearer\s+(\S+)$/i` → the token, or "".
fn bearer(auth: &str) -> &str {
    let is_ws = |c: char| c.is_whitespace() && c != '\u{85}' || c == '\u{FEFF}';
    if auth.len() < 6 || !auth.is_char_boundary(6) || !auth[..6].eq_ignore_ascii_case("bearer") {
        return "";
    }
    let rest = &auth[6..];
    let tok = rest.trim_start_matches(is_ws);
    if tok.len() == rest.len() || tok.is_empty() || tok.contains(is_ws) {
        return "";
    }
    tok
}

/// Sliding one-minute window; false = over the limit.
fn within(hits: &Mutex<VecDeque<f64>>, limit: usize) -> bool {
    let now = js::now_ms();
    let mut h = hits.lock().unwrap_or_else(|e| e.into_inner());
    while h.front().is_some_and(|t| now - t > 60_000.0) {
        h.pop_front();
    }
    if h.len() >= limit {
        return false;
    }
    h.push_back(now);
    true
}

struct Server {
    ctx: Ctx,
    secret_file: PathBuf,
    access_log: PathBuf,
    authed_hits: Mutex<VecDeque<f64>>,
    stranger_hits: Mutex<VecDeque<f64>>,
    log_lock: Mutex<()>,
}

impl Server {
    fn log(&self, entry: Vec<(&str, Value)>) {
        let _g = self.log_lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut m = Map::new();
        m.insert("ts".into(), json!(js::now_ms() as i64));
        for (k, v) in entry {
            m.insert(k.into(), v);
        }
        if std::fs::metadata(&self.access_log).is_ok_and(|md| md.len() > 1_000_000) {
            let _ = std::fs::rename(&self.access_log, format!("{}.1", self.access_log.to_string_lossy()));
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&self.access_log) {
            let _ = f.write_all(format!("{}\n", js::stringify(&Value::Object(m), 0)).as_bytes());
        }
    }
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    }
}

fn respond(s: &mut TcpStream, code: u16, body: &str, ctype: Option<&str>) {
    let mut head = format!("HTTP/1.1 {code} {}\r\n", reason(code));
    if let Some(t) = ctype {
        head += &format!("Content-Type: {t}\r\nCache-Control: no-store\r\n");
    }
    head += &format!("Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body.as_bytes());
    let _ = s.flush();
}

enum ReadErr {
    Timeout,
    TooBig,
    Closed,
}

/// Read until `pred(buf)` says done, within `deadline`.
fn read_until(s: &mut TcpStream, buf: &mut Vec<u8>, deadline: Instant, cap: usize, done: impl Fn(&[u8]) -> bool) -> Result<(), ReadErr> {
    let mut chunk = [0u8; 8192];
    while !done(buf) {
        if buf.len() > cap {
            return Err(ReadErr::TooBig);
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(ReadErr::Timeout);
        }
        let _ = s.set_read_timeout(Some(left));
        match s.read(&mut chunk) {
            Ok(0) => return Err(ReadErr::Closed),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => return Err(ReadErr::Timeout),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Err(ReadErr::Closed),
        }
    }
    Ok(())
}

fn serve_conn(srv: &Server, mut s: TcpStream) {
    let started = Instant::now();
    let _ = s.set_write_timeout(Some(REQUEST_TIMEOUT));
    let mut buf = Vec::new();
    match read_until(&mut s, &mut buf, started + HEADERS_TIMEOUT, MAX_HEADER, |b| find(b, b"\r\n\r\n").is_some()) {
        Ok(()) => {}
        Err(ReadErr::Timeout) => return respond(&mut s, 408, "", None),
        Err(ReadErr::TooBig) => return respond(&mut s, 431, "", None),
        Err(ReadErr::Closed) => return,
    }
    let end = find(&buf, b"\r\n\r\n").unwrap_or(0);
    if end > MAX_HEADER {
        return respond(&mut s, 431, "", None);
    }
    let head = String::from_utf8_lossy(&buf[..end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut req_line = lines.next().unwrap_or("").split(' ');
    let (method, target) = (req_line.next().unwrap_or("").to_string(), req_line.next().unwrap_or("").to_string());
    if method.is_empty() || target.is_empty() {
        return respond(&mut s, 400, "", None);
    }
    let headers = parse_headers(lines);
    // Node's http server answers `Expect: 100-continue` as soon as the
    // headers are in, before the request handler runs
    if header(&headers, "expect").is_some_and(|e| e.eq_ignore_ascii_case("100-continue")) {
        let _ = s.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
    }
    let path = target.split('?').next().unwrap_or("");
    // Funnel proxies from loopback; the forwarded-for header is the caller
    let fwd: Vec<&str> = headers.iter().filter(|(k, _)| k == "x-forwarded-for").map(|(_, v)| v.as_str()).collect();
    let fwd = js::trim(fwd.join(", ").split(',').next().unwrap_or("")).to_string();
    let who = if !fwd.is_empty() {
        fwd
    } else if header(&headers, "tailscale-funnel-request").is_some_and(|v| !v.is_empty()) {
        "funnel".into()
    } else {
        "local".into()
    };

    // auth FIRST: strangers get their own bucket and always a plain 404, so
    // they can neither lock out the real client nor learn a server is here
    let secret = secret_now(&srv.secret_file);
    if !(path == "/mcp" || path.starts_with("/mcp/")) || !authed(secret.as_deref(), path, header(&headers, "authorization")) {
        if within(&srv.stranger_hits, STRANGER_PER_MIN) {
            srv.log(vec![("who", json!(who)), ("status", json!(404))]);
        }
        return respond(&mut s, 404, "Not found", Some("text/plain"));
    }
    if !within(&srv.authed_hits, RATE_PER_MIN) {
        srv.log(vec![("who", json!(who)), ("status", json!(429))]);
        return respond(&mut s, 429, "{\"error\":\"slow down\"}", Some("application/json"));
    }
    if method != "POST" {
        return respond(&mut s, 405, "{\"error\":\"POST only\"}", Some("application/json"));
    }

    // body: Content-Length or chunked, capped (over the cap = connection dropped)
    let mut body = buf[end + 4..].to_vec();
    let deadline = started + REQUEST_TIMEOUT;
    let chunked = header(&headers, "transfer-encoding").is_some_and(|t| t.to_ascii_lowercase().contains("chunked"));
    if chunked {
        match read_until(&mut s, &mut body, deadline, MAX_BODY + MAX_HEADER, |b| b.ends_with(b"0\r\n\r\n") && dechunk(b).is_some()) {
            Ok(()) => {}
            Err(ReadErr::Timeout) => return respond(&mut s, 408, "", None),
            Err(_) => return,
        }
        match dechunk(&body) {
            Some(b) => body = b,
            None => return,
        }
    } else {
        let len = match header(&headers, "content-length") {
            Some(n) => match n.parse::<usize>() {
                Ok(n) => n,
                Err(_) => return respond(&mut s, 400, "", None),
            },
            None => 0,
        };
        if len > MAX_BODY {
            return;
        }
        match read_until(&mut s, &mut body, deadline, MAX_BODY, |b| b.len() >= len) {
            Ok(()) => body.truncate(len),
            Err(ReadErr::Timeout) => return respond(&mut s, 408, "", None),
            Err(_) => return,
        }
    }
    if body.len() > MAX_BODY {
        return;
    }

    let Some(req) = js::parse(&String::from_utf8_lossy(&body)) else {
        return respond(&mut s, 400, r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}"#, Some("application/json"));
    };
    // one message per request: batches would multiply the rate limit
    if req.is_array() {
        return respond(&mut s, 400, r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Batches are not supported"}}"#, Some("application/json"));
    }
    let r = handle(&srv.ctx, &req).unwrap_or_else(|_| {
        Some(json!({ "jsonrpc": "2.0", "id": js::nn(get(&req, "id")).cloned().unwrap_or(Value::Null), "error": { "code": -32603, "message": "Internal error" } }))
    });
    let mut entry = vec![("who", json!(who)), ("status", json!(200))];
    if let Some(m) = get(&req, "method") {
        entry.push(("method", m.clone()));
    }
    if let Some(t) = get(&req, "params").and_then(|p| get(p, "name")) {
        entry.push(("tool", t.clone()));
    }
    srv.log(entry);
    match r {
        None => respond(&mut s, 202, "", None),
        Some(r) => respond(&mut s, 200, &js::stringify(&scrub_outgoing(r), 0), Some("application/json")),
    }
}

/// Bind and accept on 127.0.0.1:`port` (0 = ephemeral, for tests). Returns
/// the bound port and the accept-loop thread.
pub fn start(ctx: Ctx, port: u16, secret_file: PathBuf) -> std::io::Result<(u16, std::thread::JoinHandle<()>)> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let bound = listener.local_addr()?.port();
    let access_log = ctx.root_path().join("remote-access.jsonl");
    let srv = Arc::new(Server {
        ctx,
        secret_file,
        access_log,
        authed_hits: Mutex::new(VecDeque::new()),
        stranger_hits: Mutex::new(VecDeque::new()),
        log_lock: Mutex::new(()),
    });
    let active = Arc::new(AtomicUsize::new(0));
    let t = std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if active.load(Ordering::SeqCst) >= MAX_CONNS {
                continue; // dropped, like server.maxConnections
            }
            active.fetch_add(1, Ordering::SeqCst);
            let (srv, active) = (srv.clone(), active.clone());
            std::thread::spawn(move || {
                serve_conn(&srv, stream);
                active.fetch_sub(1, Ordering::SeqCst);
            });
        }
    });
    Ok((bound, t))
}

/// `--http <port> --secret-file <path>`: serve until the parent goes away.
pub fn serve(ctx: Ctx, port: u16, secret_file: &str) -> ! {
    let file = PathBuf::from(secret_file);
    if std::fs::metadata(&file).is_err() {
        eprintln!("[grill-me mcp] Error: ENOENT: no such file or directory, open '{secret_file}'");
        std::process::exit(1);
    }
    if secret_now(&file).is_none() {
        eprintln!("[grill-me mcp] Error: bad secret file");
        std::process::exit(1);
    }
    // never outlive Grill Me: if the parent goes away, close the door
    let parent = std::os::unix::process::parent_id();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        if std::os::unix::process::parent_id() != parent || !alive(parent) {
            std::process::exit(0);
        }
    });
    let (_, t) = match start(ctx, port, file) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[grill-me mcp] Error: listen {e} 127.0.0.1:{port}");
            std::process::exit(1);
        }
    };
    eprintln!("[grill-me mcp] remote on 127.0.0.1:{port}");
    let _ = t.join();
    std::process::exit(0)
}

/// `process.kill(pid, 0)` without libc: /proc doesn't exist on macOS, so
/// ask ps (only every 3 s). A reparented child already fails the ppid check.
fn alive(pid: u32) -> bool {
    if pid <= 1 {
        return true;
    }
    std::process::Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn auth_by_path_or_bearer() {
        let s = Some(SECRET.as_bytes());
        assert!(authed(s, &format!("/mcp/{SECRET}"), None));
        assert!(authed(s, &format!("/mcp/{SECRET}/extra"), None));
        assert!(authed(s, "/mcp", Some(&format!("Bearer {SECRET}"))));
        assert!(authed(s, "/mcp", Some(&format!("bearer   {SECRET}"))));
        assert!(authed(s, "/mcp/", Some(&format!("Bearer {SECRET}"))));
        // a wrong path secret isn't rescued by a right header
        assert!(!authed(s, "/mcp/nope", Some(&format!("Bearer {SECRET}"))));
        // wrong length, wrong value, junk after the token, no secret
        assert!(!authed(s, &format!("/mcp/{}", &SECRET[..63]), None));
        assert!(!authed(s, &format!("/mcp/{SECRET}0"), None));
        assert!(!authed(s, &format!("/mcp/{}", SECRET.replace('0', "1")), None));
        assert!(!authed(s, "/mcp", Some(&format!("Bearer {SECRET} x"))));
        assert!(!authed(s, "/mcp", Some(SECRET)));
        assert!(!authed(s, "/mcp", None));
        assert!(!authed(None, &format!("/mcp/{SECRET}"), None));
    }

    #[test]
    fn secret_file_must_be_64_lowercase_hex() {
        let dir = std::env::temp_dir().join(format!("grillme-secret-{}-{}", std::process::id(), js::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("s");
        std::fs::write(&f, format!("{SECRET}\n")).unwrap();
        assert_eq!(secret_now(&f).as_deref(), Some(SECRET.as_bytes()));
        std::fs::write(&f, &SECRET[..63]).unwrap();
        assert!(secret_now(&f).is_none(), "wrong length");
        std::fs::write(&f, SECRET.replace('a', "g")).unwrap();
        assert!(secret_now(&f).is_none(), "non-hex");
        std::fs::write(&f, SECRET.to_uppercase()).unwrap();
        assert!(secret_now(&f).is_none(), "uppercase isn't what the app writes");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ct_eq_compares_whole_input() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"abcd"));
        assert!(ct_eq(b"", b""));
    }

    fn send(port: u16, raw: &str) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = Vec::new();
        let _ = s.read_to_end(&mut out);
        let text = String::from_utf8_lossy(&out).into_owned();
        let code = text.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
        let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
        (code, body)
    }

    fn post_to(port: u16, path: &str, body: &str) -> (u16, String) {
        send(port, &format!("POST {path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()))
    }

    /// One-shot fake Grill Me API: answers `status body`, hands back the request.
    fn fake_api(status: u16, body: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let t = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = Vec::new();
            let _ = read_until(&mut s, &mut buf, Instant::now() + Duration::from_secs(5), 1 << 20, |b| {
                find(b, b"\r\n\r\n").is_some_and(|e| {
                    let head = String::from_utf8_lossy(&b[..e]).to_lowercase();
                    let len = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|n| n.trim().parse::<usize>().ok()).unwrap_or(0);
                    b.len() >= e + 4 + len
                })
            });
            let _ = write!(s, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            String::from_utf8_lossy(&buf).into_owned()
        });
        (port, t)
    }

    #[test]
    fn push_goes_through_the_app_api() {
        let home = std::env::temp_dir().join(format!("grillme-push-{}-{}", std::process::id(), js::now_ms()));
        std::fs::create_dir_all(home.join(".grillme")).unwrap();
        std::fs::write(home.join(".grillme/api-token"), "tok123\n").unwrap();
        let h = home.to_string_lossy().into_owned();
        let ctx = Ctx { root: format!("{h}/.grillme"), home: h, remote: Default::default(), scope: None, forced: None };

        let (port, t) = fake_api(200, r#"{"id":"x"}"#);
        assert_eq!(push_to(port, &ctx, "goal", json!({ "goal": "ship" })), Ok(()));
        let req = t.join().unwrap();
        assert!(req.starts_with("POST /bridge/push HTTP/1.1\r\n"));
        assert!(req.contains("Authorization: Bearer tok123\r\n"));
        assert!(req.ends_with(r#"{"kind":"goal","item":{"goal":"ship"},"project":"default"}"#));

        let (port, t) = fake_api(400, r#"{"error":"bad kind"}"#);
        assert_eq!(push_to(port, &ctx, "x", json!({})), Err(r#"Grill Me refused: {"error":"bad kind"}"#.to_string()));
        t.join().unwrap();
        let (port, t) = fake_api(404, r#"{"error":"unknown route"}"#);
        assert!(push_to(port, &ctx, "x", json!({})).unwrap_err().starts_with("This Grill Me build doesn't have the bridge yet"));
        t.join().unwrap();

        // nothing listening
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert_eq!(push_to(port, &ctx, "x", json!({})), Err("Grill Me isn't running — open the Grill Me app, then try again.".to_string()));
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn wire_auth_methods_and_batches() {
        let home = std::env::temp_dir().join(format!("grillme-wire-{}-{}", std::process::id(), js::now_ms()));
        std::fs::create_dir_all(home.join(".grillme")).unwrap();
        let secret_file = home.join(".grillme/remote-secret");
        std::fs::write(&secret_file, SECRET).unwrap();
        let h = home.to_string_lossy().into_owned();
        let ctx = Ctx {
            root: format!("{h}/.grillme"),
            home: h,
            remote: super::super::data::Remote { on: true, allow_writes: false, no_transcripts: true },
            scope: None,
            forced: None,
        };
        let (port, _t) = start(ctx, 0, secret_file).unwrap();
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#;

        // no secret / wrong secret / other paths: a bare 404
        assert_eq!(post_to(port, "/mcp", init), (404, "Not found".into()));
        assert_eq!(post_to(port, "/mcp/deadbeef", init).0, 404);
        assert_eq!(post_to(port, &format!("/other/{SECRET}"), init).0, 404);
        assert_eq!(send(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n").0, 404);

        // the secret in the path: initialize works, read-only instructions
        let (code, body) = post_to(port, &format!("/mcp/{SECRET}"), init);
        assert_eq!(code, 200);
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["result"]["protocolVersion"], "2025-03-26");
        assert!(v["result"]["instructions"].as_str().unwrap().ends_with("but not change anything."));

        // Bearer works too
        let raw = format!(
            "POST /mcp HTTP/1.1\r\nAuthorization: Bearer {SECRET}\r\nContent-Length: {}\r\n\r\n{init}",
            init.len()
        );
        assert_eq!(send(port, &raw).0, 200);

        // authed but wrong method / batch / junk
        assert_eq!(send(port, &format!("GET /mcp/{SECRET} HTTP/1.1\r\n\r\n")), (405, r#"{"error":"POST only"}"#.into()));
        let (code, body) = post_to(port, &format!("/mcp/{SECRET}"), &format!("[{init}]"));
        assert_eq!(code, 400);
        assert!(body.contains("Batches are not supported"));
        assert_eq!(post_to(port, &format!("/mcp/{SECRET}"), "{nope").0, 400);

        // notifications: 202, no body; write tools hidden in read-only mode
        assert_eq!(post_to(port, &format!("/mcp/{SECRET}"), r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).0, 202);
        let (_, body) = post_to(port, &format!("/mcp/{SECRET}"), r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        let v: Value = serde_json::from_str(&body).unwrap();
        let names: Vec<&str> = v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"whats_new") && !names.contains(&"save_plan") && !names.contains(&"set_goal"));
        // notes is read-only remotely
        let (_, body) = post_to(
            port,
            &format!("/mcp/{SECRET}"),
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"notes","arguments":{"action":"add","text":"x"}}}"#,
        );
        assert!(body.contains("Adding notes isn't available over this connection."));
        // internal errors are generic; -32601 keeps its message
        let (_, body) = post_to(port, &format!("/mcp/{SECRET}"), r#"{"jsonrpc":"2.0","id":4,"method":"initialize","params":null}"#);
        assert_eq!(body, r#"{"jsonrpc":"2.0","id":4,"error":{"code":-32603,"message":"Internal error"}}"#);
        let (_, body) = post_to(port, &format!("/mcp/{SECRET}"), r#"{"jsonrpc":"2.0","id":5,"method":"nope"}"#);
        assert_eq!(body, r#"{"jsonrpc":"2.0","id":5,"error":{"code":-32601,"message":"Method not found: nope"}}"#);

        // rotation applies per request
        std::fs::write(home.join(".grillme/remote-secret"), SECRET.replace('0', "f")).unwrap();
        assert_eq!(post_to(port, &format!("/mcp/{SECRET}"), init).0, 404);

        let log = std::fs::read_to_string(home.join(".grillme/remote-access.jsonl")).unwrap();
        assert!(log.lines().any(|l| l.contains(r#""status":404"#)));
        assert!(log.lines().any(|l| l.contains(r#""method":"tools/call","tool":"notes""#)));
        assert!(!log.contains(SECRET));
        let _ = std::fs::remove_dir_all(home);
    }
}
