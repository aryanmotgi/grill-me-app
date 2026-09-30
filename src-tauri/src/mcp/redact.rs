// ---------------------------------------------------------------------------
// Credential scrubbing for the remote (claude.ai) connection, and the
// secret-file name test that keeps .env & co out of diffs.
//
// The patterns are the JS ones, spelled for the `regex` crate with JS
// semantics kept: `\s` is the JS whitespace set, `\b`/`\w`/`\d` are ASCII,
// and the /i flag is ASCII-only case folding (JS non-unicode mode). The two
// backreference patterns (`\2`, `\3` = "the same quote, or none") are
// expanded into one alternative per quote — identical matches, since the
// value classes can't contain a quote.
// ---------------------------------------------------------------------------

use regex::{Captures, Regex};
use std::sync::OnceLock;

/// JS `\s` (WhiteSpace + LineTerminator), for use inside a character class.
const WS: &str = r"\t\n\x0B\x0C\r \xA0\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

struct Patterns {
    private_key: Regex,
    tokens: Regex,
    url_creds: Regex,
    auth_header: Regex,
    curl_user: Regex,
    named: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| {
        let re = |s: String| Regex::new(&s).expect("redact pattern");
        // the value's {6,} counts UTF-16 units in JS: matched as 1+ chars
        // here and length-checked in redact() (see replace_named)
        let value = format!(r#"([^{WS}"'`,;]+)"#);
        let user = format!(r#"[^{WS}:"']+:[^{WS}"']+"#);
        Patterns {
            private_key: re(r"-----BEGIN [A-Z ]*PRIVATE KEY-----(?s:.)*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)".into()),
            tokens: re(concat!(
                r"(?-u:\b)(?:sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}",
                r"|whsec_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{15,}",
                r"|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}",
                r"|xapp-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}",
                r"|AC[a-f0-9]{32}|SK[a-f0-9]{32}|[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}",
                r"|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,})(?-u:\b)"
            ).into()),
            url_creds: re(format!(r"(?-u:\b)([a-zA-Z][a-zA-Z0-9+.-]*://[^:{WS}/@]+):[^@{WS}/]+@")),
            auth_header: re(format!(r"(?-u:\b)(Bearer|Basic|Token)[{WS}]+[A-Za-z0-9._~+/=-]{{8,}}")),
            curl_user: re(format!(r#"([{WS}]-u[{WS}]+|[{WS}]--user[{WS}]+)(?:(")"#)
                + &format!(r#"{user}"|(')"#) + &format!(r#"{user}'|{user})"#)),
            named: re(format!(
                r#"(?-u:\b)([A-Za-z0-9_.-]*(?i-u:key|secret|token|passw(?:or)?d|pwd|credential|auth)[A-Za-z0-9_.-]*)(["']?[{WS}]*(?:[=:]|[{WS}]+(?i-u:is)[{WS}]+)[{WS}]*)(?:(")"#
            ) + &format!(r#"{value}"|(')"#) + &format!(r#"{value}'|{value})"#)),
        }
    })
}

fn group<'a>(c: &'a Captures, i: usize) -> &'a str {
    c.get(i).map(|m| m.as_str()).unwrap_or("")
}

/// Strip anything that looks like a credential before it leaves the Mac.
pub fn redact(text: &str) -> String {
    let p = patterns();
    let s = p.private_key.replace_all(text, "[redacted private key]");
    let s = p.tokens.replace_all(&s, "[redacted]");
    let s = p.url_creds.replace_all(&s, |c: &Captures| format!("{}:[redacted]@", group(c, 1)));
    let s = p.auth_header.replace_all(&s, |c: &Captures| format!("{} [redacted]", group(c, 1)));
    let s = p.curl_user.replace_all(&s, |c: &Captures| {
        let q = if c.get(2).is_some() { group(c, 2) } else { group(c, 3) };
        format!("{}{q}[redacted]{q}", group(c, 1))
    });
    replace_named(&p.named, &s)
}

/// The NAME=value pattern, scanning like a JS global replace: a match whose
/// value is under 6 UTF-16 units fails at that start, and the search resumes
/// one character later. Groups: 1 name, 2 separator, 3/5 opening quote,
/// 4/6/7 value.
fn replace_named(re: &Regex, s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let (mut last, mut pos) = (0, 0);
    while pos <= s.len() {
        let Some(c) = re.captures_at(s, pos) else { break };
        let m = c.get(0).expect("match");
        let value = [4, 6, 7].iter().find_map(|&i| c.get(i)).map(|v| v.as_str()).unwrap_or("");
        if super::js::len16(value) < 6 {
            pos = m.start() + s[m.start()..].chars().next().map(char::len_utf8).unwrap_or(1);
            continue;
        }
        let q = if c.get(3).is_some() { group(&c, 3) } else { group(&c, 5) };
        out.push_str(&s[last..m.start()]);
        out.push_str(&format!("{}{}{q}[redacted]{q}", group(&c, 1), group(&c, 2)));
        last = m.end();
        pos = m.end();
    }
    out.push_str(&s[last..]);
    out
}

/// Secret-bearing file names (never shown in a diff, stat or preview).
pub fn secret_file(name: &str) -> bool {
    static P: OnceLock<regex::bytes::Regex> = OnceLock::new();
    P.get_or_init(|| {
        regex::bytes::Regex::new(concat!(
            r"(?i-u)(^|/)(\.env[^/]*|\.dev\.vars|[^/]*\.(pem|key|p12|pfx|keystore|jks|tfvars|tfstate)|id_[a-z0-9]+[^/]*",
            r"|\.(npmrc|pypirc|netrc|git-credentials|htpasswd)|credentials[^/]*|[^/]*service[-_]?account[^/]*\.json",
            r"|secrets?\.[^/]*|[^/]*\.secret[^/]*)$"
        ))
        .expect("secret file pattern")
    })
    .is_match(name.as_bytes())
}

/// `!!f && !SECRET_FILE.test(f)`
pub fn safe_name(f: &str) -> bool {
    !f.is_empty() && !secret_file(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_keys() {
        let t = "a\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\nxyz\n-----END RSA PRIVATE KEY-----\nb";
        assert_eq!(redact(t), "a\n[redacted private key]\nb");
        assert_eq!(redact("x -----BEGIN PRIVATE KEY-----\nabc"), "x [redacted private key]");
    }

    #[test]
    fn token_shapes() {
        for tok in [
            "sk-abcdefghijklmnop1234",
            "sk-ant-api03-abcdefghijklmnop",
            "sk_live_abcdefghij12",
            "whsec_abcdefghij12",
            "ghp_abcdefghijklmnopqrst1234",
            "github_pat_abcdefghijklmnopqrst_123",
            "glpat-abcdefghijklmnop",
            "hf_abcdefghijklmnopqrstu",
            "npm_abcdefghijklmnopqrstu",
            "AKIAABCDEFGHIJKLMNOP",
            "xoxb-1234567890-abc",
            "AIzaSyA1234567890abcdefghijklmnopqrs",
            "ya29.abcdefghijklmnopqrstuv",
            "SG.abcdefghijklmnop.abcdefghijklmnop",
            "AC0123456789abcdef0123456789abcdef",
            "eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4",
        ] {
            assert_eq!(redact(&format!("use {tok} now")), "use [redacted] now", "{tok}");
        }
        // too short / glued to a word: left alone
        assert_eq!(redact("sk-short"), "sk-short");
        assert_eq!(redact("xAKIAABCDEFGHIJKLMNOP"), "xAKIAABCDEFGHIJKLMNOP");
    }

    #[test]
    fn url_credentials_and_headers() {
        assert_eq!(redact("postgres://bob:hunter2@db:5432/x"), "postgres://bob:[redacted]@db:5432/x");
        assert_eq!(redact("HTTPS://u:p@h"), "HTTPS://u:[redacted]@h");
        assert_eq!(redact("send Bearer abcdefgh.ijk"), "send Bearer [redacted]");
        // the header name itself trips the NAME: value rule too (same in JS)
        assert_eq!(redact("Authorization: Bearer abcdefgh.ijk"), "Authorization: [redacted] [redacted]");
        assert_eq!(redact("Basic abc"), "Basic abc");
    }

    #[test]
    fn curl_user_backreference() {
        assert_eq!(redact("curl -u bob:hunter22 x"), "curl -u [redacted] x");
        assert_eq!(redact("curl -u \"bob:hunter22\" x"), "curl -u \"[redacted]\" x");
        assert_eq!(redact("curl --user 'bob:hunter22' x"), "curl --user '[redacted]' x");
        // mismatched quotes: the backreference fails, nothing is replaced
        assert_eq!(redact("curl -u \"bob:hunter22' x"), "curl -u \"bob:hunter22' x");
    }

    #[test]
    fn named_secrets_backreference() {
        assert_eq!(redact("API_KEY=abcdef123"), "API_KEY=[redacted]");
        assert_eq!(redact("\"apiKey\": \"abcdef123\""), "\"apiKey\": \"[redacted]\"");
        assert_eq!(redact("password is hunter22"), "password is [redacted]");
        assert_eq!(redact("my_Secret: 'abcdef12'"), "my_Secret: '[redacted]'");
        assert_eq!(redact("TOKEN=short"), "TOKEN=short");
        // opening quote without its closing twin: quote-less form still applies
        assert_eq!(redact("token=\"abcdefgh"), "token=\"abcdefgh");
        assert_eq!(redact("AUTH_TOKEN=abcdefgh,next"), "AUTH_TOKEN=[redacted],next");
        // ASCII-only case folding, like JS without the u flag (U+212A Kelvin)
        assert_eq!(redact("\u{212A}EY=abcdefgh"), "\u{212A}EY=abcdefgh");
        // {6,} counts UTF-16 units: three emoji are six
        assert_eq!(redact("key=😀😀😀"), "key=[redacted]");
        assert_eq!(redact("key=😀😀"), "key=😀😀");
        // a too-short value at one start doesn't hide a later match
        assert_eq!(redact("token=ab api_key=abcdefgh"), "token=ab api_key=[redacted]");
    }

    #[test]
    fn secret_files() {
        for f in [".env", "app/.env.local", "id_rsa", "x/server.PEM", "creds/credentials.json", "gcp-service_account.json", "secrets.yaml", "a/b.secret.txt", ".npmrc"] {
            assert!(secret_file(f), "{f}");
        }
        for f in ["src/main.rs", "environment.ts", "keys.md", "docs/secretive/x.md"] {
            assert!(!secret_file(f), "{f}");
        }
        assert!(!safe_name(""));
    }
}
