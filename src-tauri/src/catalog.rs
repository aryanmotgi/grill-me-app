// ---------------------------------------------------------------------------
// Tool catalog: lookups for tools the built-in catalog doesn't know, and the
// remote catalog refresh.
//
// The catalog itself lives in the webview (src/lib/catalog.ts + the shipped
// src/data/catalog.json). Rust only does the network parts:
//   catalog_lookup(name)   GitHub → npm → PyPI, returns an unverified draft
//                          entry shaped like CatalogEntry, or {"found":false}
//   catalog_fetch_remote() GET <relay>/v1/catalog → ~/.grillme/catalog.json
// ---------------------------------------------------------------------------

use serde_json::{json, Map, Value};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(8);
const UA: &str = "grill-me-catalog (+https://github.com)";
const MAX_WHAT: usize = 200;

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(TIMEOUT).user_agent(UA).build()
}

/// Names go into URLs, so only registry-ish characters: [A-Za-z0-9@/._-]{1,80}.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '/' | '.' | '_' | '-'))
        && !name.contains("..")
}

/// Percent-encode everything but RFC 3986 unreserved characters.
pub fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// "My Tool.js" → "my-tool-js"; "@scope/pkg" → "scope-pkg".
pub fn kebab(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let mut id = out.trim_end_matches('-').to_string();
    id.truncate(80);
    let id = id.trim_end_matches('-').to_string();
    if id.is_empty() { "tool".into() } else { id }
}

fn today() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    crate::fmt_unix_utc(secs)[..10].to_string()
}

fn https(v: &Value) -> Option<String> {
    let s = v.as_str()?.trim();
    (s.starts_with("https://") && !s.contains(char::is_whitespace)).then(|| s.to_string())
}

fn what(desc: Option<&str>, name: &str) -> String {
    let d = desc.map(str::trim).filter(|d| !d.is_empty());
    match d {
        Some(d) => {
            let mut s: String = d.chars().take(MAX_WHAT).collect();
            if d.chars().count() > MAX_WHAT {
                s.push('…');
            }
            s
        }
        None => format!("{name} (no description found)."),
    }
}

/// MCP servers usually say so in their name.
fn guess_kind(name: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    if n.contains("mcp") { "mcp" } else { "cli" }
}

fn draft(name: &str, what_: String, kind: &str, detect: Value, source: String, from: &str, date: &str) -> Value {
    json!({
        "id": kebab(name),
        "name": name,
        "kind": kind,
        "what": what_,
        "solves": [],
        "agents": ["any"],
        "detect": detect,
        "source": source,
        "verified": false,
        "updated": date,
        "lookup": from,
    })
}

/// GitHub repository search → draft. Prefers an exact repo-name match.
pub fn draft_from_github(query: &str, body: &Value, date: &str) -> Option<Value> {
    let items = body.get("items")?.as_array()?;
    let item = items
        .iter()
        .find(|i| i["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(query)))
        .or_else(|| items.first())?;
    let name = item["name"].as_str()?;
    let source = https(&item["html_url"])?;
    let kind = guess_kind(name);
    let lower = name.to_ascii_lowercase();
    let detect = if kind == "mcp" { json!({ "mcp": [lower] }) } else { json!({ "bins": [lower] }) };
    Some(draft(name, what(item["description"].as_str(), name), kind, detect, source, "github", date))
}

/// npm registry document → draft. Uses the latest version's `bin` for bins.
pub fn draft_from_npm(body: &Value, date: &str) -> Option<Value> {
    let name = body["name"].as_str()?;
    let lower = name.to_ascii_lowercase();
    let latest = body["dist-tags"]["latest"].as_str().and_then(|v| body["versions"].get(v));
    let mut bins: Vec<String> = Vec::new();
    if let Some(bin) = latest.map(|l| &l["bin"]) {
        match bin {
            Value::String(_) => bins.push(lower.rsplit('/').next().unwrap_or(&lower).to_string()),
            Value::Object(m) => bins.extend(m.keys().map(|k| k.to_ascii_lowercase())),
            _ => {}
        }
    }
    let desc = body["description"].as_str().or_else(|| latest.and_then(|l| l["description"].as_str()));
    let kind = guess_kind(name);
    let mut detect = Map::new();
    detect.insert("npm".into(), json!([lower]));
    detect.insert("deps".into(), json!([lower]));
    if kind == "mcp" {
        detect.insert("mcp".into(), json!([lower]));
    }
    if !bins.is_empty() {
        detect.insert("bins".into(), json!(bins));
    }
    let source = https(&body["homepage"]).unwrap_or_else(|| format!("https://www.npmjs.com/package/{name}"));
    Some(draft(name, what(desc, name), kind, Value::Object(detect), source, "npm", date))
}

/// PyPI JSON API document → draft.
pub fn draft_from_pypi(body: &Value, date: &str) -> Option<Value> {
    let info = body.get("info")?;
    let name = info["name"].as_str()?;
    let lower = name.to_ascii_lowercase();
    let source = https(&info["project_urls"]["Homepage"])
        .or_else(|| https(&info["project_urls"]["Source"]))
        .or_else(|| https(&info["home_page"]))
        .unwrap_or_else(|| format!("https://pypi.org/project/{name}/"));
    let kind = guess_kind(name);
    let mut detect = json!({ "pip": [lower], "deps": [lower] });
    if kind == "mcp" {
        detect["mcp"] = json!([lower]);
    }
    Some(draft(name, what(info["summary"].as_str(), name), kind, detect, source, "pypi", date))
}

/// npm documents for popular packages run to tens of MB (every version), so
/// cap the read rather than trusting the server.
const MAX_BODY: u64 = 48 * 1024 * 1024;

fn read_json(resp: ureq::Response) -> Result<Value, String> {
    use std::io::Read;
    serde_json::from_reader(resp.into_reader().take(MAX_BODY)).map_err(|e| e.to_string())
}

/// Ok(Some(json)) on 200, Ok(None) on 404/other status, Err on transport failure.
fn get_json(url: &str) -> Result<Option<Value>, String> {
    match agent().get(url).set("Accept", "application/json").call() {
        Ok(resp) => Ok(read_json(resp).ok()),
        Err(ureq::Error::Status(_, _)) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Look up a tool the catalog doesn't know. Returns a draft CatalogEntry
/// (verified: false, solves: []) for the user to confirm, or {"found":false}.
#[tauri::command(async)]
pub fn catalog_lookup(name: String) -> Result<Value, String> {
    let name = name.trim().to_string();
    if !valid_name(&name) {
        return Err("Tool names can only use letters, numbers and @ / . _ -".into());
    }
    let date = today();
    let enc = url_encode(&name);
    let mut offline = 0;

    // GitHub has no scoped names; search on the part after the scope.
    let gh_query = name.rsplit('/').next().unwrap_or(&name).trim_start_matches('@');
    let sources: [(String, Box<dyn Fn(&Value) -> Option<Value>>); 3] = [
        (
            format!("https://api.github.com/search/repositories?q={}+in:name&per_page=3", url_encode(gh_query)),
            Box::new(|b: &Value| draft_from_github(gh_query, b, &date)),
        ),
        (format!("https://registry.npmjs.org/{enc}"), Box::new(|b: &Value| draft_from_npm(b, &date))),
        (format!("https://pypi.org/pypi/{enc}/json"), Box::new(|b: &Value| draft_from_pypi(b, &date))),
    ];
    for (url, map) in sources.iter() {
        match get_json(url) {
            Ok(Some(body)) => {
                if let Some(d) = map(&body) {
                    return Ok(d);
                }
            }
            Ok(None) => {}
            Err(_) => offline += 1,
        }
    }
    if offline == sources.len() {
        return Err("Couldn't reach GitHub, npm or PyPI".into());
    }
    Ok(json!({ "found": false }))
}

fn relay_base() -> String {
    std::env::var("GRILLME_RELAY_URL")
        .unwrap_or_else(|_| crate::relay::DEFAULT_RELAY.to_string())
        .trim_end_matches('/')
        .to_string()
}

/// A catalog document must be an object with an `entries` array; returns its version.
pub fn validate_remote(doc: &Value) -> Result<String, String> {
    if !doc.is_object() || !doc["entries"].is_array() {
        return Err("relay catalog is malformed".into());
    }
    Ok(doc["version"].as_str().unwrap_or("0").to_string())
}

/// Write via a temp file + rename so a crash never leaves half a catalog.
pub fn save_atomic(path: &std::path::Path, doc: &Value) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(doc).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Fetch the newest catalog from the relay and cache it at ~/.grillme/catalog.json.
/// Returns the remote catalog's version.
#[tauri::command(async)]
pub fn catalog_fetch_remote() -> Result<String, String> {
    let url = format!("{}/v1/catalog", relay_base());
    let resp = agent().get(&url).call().map_err(|e| format!("couldn't fetch the catalog: {e}"))?;
    let doc = read_json(resp).map_err(|e| format!("relay catalog isn't JSON: {e}"))?;
    let version = validate_remote(&doc)?;
    save_atomic(&crate::grillme_root().join("catalog.json"), &doc)?;
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_validation() {
        for ok in ["linear", "@playwright/mcp", "chrome-devtools-mcp", "uv", "my_tool.js", "A1"] {
            assert!(valid_name(ok), "{ok}");
        }
        let long = "a".repeat(81);
        for bad in ["", "a b", "x;rm -rf", "../etc", "q?x=1", "name#frag", "é", long.as_str()] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn encoding_and_ids() {
        assert_eq!(url_encode("@playwright/mcp"), "%40playwright%2Fmcp");
        assert_eq!(url_encode("a b+c"), "a%20b%2Bc");
        assert_eq!(kebab("@playwright/mcp"), "playwright-mcp");
        assert_eq!(kebab("My Tool.JS"), "my-tool-js");
        assert_eq!(kebab("@@"), "tool");
    }

    #[test]
    fn github_draft() {
        let body = json!({ "items": [
            { "name": "lazygit-extras", "html_url": "https://github.com/x/lazygit-extras", "description": "extras" },
            { "name": "lazygit", "html_url": "https://github.com/jesseduffield/lazygit", "description": "simple terminal UI for git commands" }
        ]});
        let d = draft_from_github("LazyGit", &body, "2026-10-01").unwrap();
        assert_eq!(d["id"], "lazygit");
        assert_eq!(d["kind"], "cli");
        assert_eq!(d["what"], "simple terminal UI for git commands");
        assert_eq!(d["detect"]["bins"], json!(["lazygit"]));
        assert_eq!(d["source"], "https://github.com/jesseduffield/lazygit");
        assert_eq!(d["verified"], false);
        assert_eq!(d["agents"], json!(["any"]));
        assert_eq!(d["solves"], json!([]));
        assert_eq!(d["updated"], "2026-10-01");

        let mcp = draft_from_github("x", &json!({ "items": [{ "name": "foo-mcp", "html_url": "https://github.com/a/foo-mcp", "description": null }] }), "d").unwrap();
        assert_eq!(mcp["kind"], "mcp");
        assert_eq!(mcp["detect"]["mcp"], json!(["foo-mcp"]));
        assert_eq!(mcp["what"], "foo-mcp (no description found).");

        assert!(draft_from_github("x", &json!({ "items": [] }), "d").is_none());
        assert!(draft_from_github("x", &json!({ "message": "rate limited" }), "d").is_none());
    }

    #[test]
    fn npm_draft() {
        let body = json!({
            "name": "@playwright/mcp",
            "description": "Playwright Tools for MCP",
            "homepage": "https://github.com/microsoft/playwright-mcp",
            "dist-tags": { "latest": "0.0.40" },
            "versions": { "0.0.40": { "bin": { "mcp-server-playwright": "cli.js" } } }
        });
        let d = draft_from_npm(&body, "2026-10-01").unwrap();
        assert_eq!(d["id"], "playwright-mcp");
        assert_eq!(d["kind"], "mcp");
        assert_eq!(d["detect"]["npm"], json!(["@playwright/mcp"]));
        assert_eq!(d["detect"]["mcp"], json!(["@playwright/mcp"]));
        assert_eq!(d["detect"]["bins"], json!(["mcp-server-playwright"]));
        assert_eq!(d["source"], "https://github.com/microsoft/playwright-mcp");

        // string bin, http homepage falls back to the npm page
        let body = json!({ "name": "vitest", "description": "Next generation testing framework", "homepage": "http://vitest.dev",
            "dist-tags": { "latest": "3.0.0" }, "versions": { "3.0.0": { "bin": "vitest.mjs" } } });
        let d = draft_from_npm(&body, "d").unwrap();
        assert_eq!(d["kind"], "cli");
        assert_eq!(d["detect"]["bins"], json!(["vitest"]));
        assert_eq!(d["source"], "https://www.npmjs.com/package/vitest");

        assert!(draft_from_npm(&json!({ "error": "Not found" }), "d").is_none());
    }

    #[test]
    fn pypi_draft() {
        let body = json!({ "info": {
            "name": "Ruff", "summary": "An extremely fast Python linter and code formatter, written in Rust.",
            "home_page": "", "project_urls": { "Homepage": "https://docs.astral.sh/ruff", "Source": "https://github.com/astral-sh/ruff" }
        }});
        let d = draft_from_pypi(&body, "2026-10-01").unwrap();
        assert_eq!(d["id"], "ruff");
        assert_eq!(d["name"], "Ruff");
        assert_eq!(d["detect"]["pip"], json!(["ruff"]));
        assert_eq!(d["source"], "https://docs.astral.sh/ruff");

        let bare = draft_from_pypi(&json!({ "info": { "name": "mcp-server-fetch", "summary": null } }), "d").unwrap();
        assert_eq!(bare["kind"], "mcp");
        assert_eq!(bare["source"], "https://pypi.org/project/mcp-server-fetch/");
        assert!(draft_from_pypi(&json!({ "message": "Not Found" }), "d").is_none());
    }

    #[test]
    fn remote_validation_and_atomic_save() {
        assert_eq!(validate_remote(&json!({ "version": "2026.10.1", "entries": [] })).unwrap(), "2026.10.1");
        assert!(validate_remote(&json!({ "version": "1" })).is_err());
        assert!(validate_remote(&json!([1, 2])).is_err());

        let dir = std::env::temp_dir().join(format!("grillme-catalog-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("catalog.json");
        save_atomic(&path, &json!({ "version": "1", "entries": [] })).unwrap();
        let back: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(back["version"], "1");
        assert!(!dir.join("catalog.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore] // network
    fn live_lookup() {
        let d = catalog_lookup("lazygit".into()).unwrap();
        assert_eq!(d["id"], "lazygit");
    }
}
