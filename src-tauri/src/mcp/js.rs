// ---------------------------------------------------------------------------
// Tiny JavaScript-semantics helpers. The MCP server was a Node script and its
// output text is the contract (hooks paste it into prompts, tests match it),
// so the Rust port reproduces the JS conversions it relied on: String(x),
// truthiness, Number(x), `??`, JSON.stringify spacing and number formatting,
// UTF-16 string lengths for clipping, String.prototype.trim, Date.parse (ISO)
// and Date#toISOString.
// ---------------------------------------------------------------------------

use serde_json::Value;

/// Date.now()
pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Property read: `v.k` (undefined for non-objects and missing keys).
pub fn get<'a>(v: &'a Value, k: &str) -> Option<&'a Value> {
    v.as_object().and_then(|o| o.get(k))
}

/// `a ?? …`: Some only when neither null nor undefined.
pub fn nn(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| !v.is_null())
}

/// Boolean(x)
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(0.0);
            f != 0.0 && !f.is_nan()
        }
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// Number.prototype.toString()
pub fn num_str(f: f64) -> String {
    if f.is_nan() {
        return "NaN".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if f == 0.0 {
        return "0".into();
    }
    let a = f.abs();
    if !(1e-6..1e21).contains(&a) {
        // exponent form: Rust "1.5e-7" / "1e21" → JS "1.5e-7" / "1e+21"
        let s = format!("{f:e}");
        return match s.split_once('e') {
            Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
            _ => s,
        };
    }
    format!("{f}")
}

/// String(x); None = undefined.
pub fn to_str(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => num_str(n.as_f64().unwrap_or(f64::NAN)),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => join(a.iter().map(Some), ","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// Array.prototype.join: null/undefined elements become "".
pub fn join<'a>(items: impl Iterator<Item = Option<&'a Value>>, sep: &str) -> String {
    items
        .map(|v| match v {
            None | Some(Value::Null) => String::new(),
            v => to_str(v),
        })
        .collect::<Vec<_>>()
        .join(sep)
}

fn is_js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
        | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

/// String.prototype.trim()
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `s.replace(/\s+/g, " ")`
pub fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if is_js_space(c) {
            if !in_ws {
                out.push(' ');
            }
            in_ws = true;
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out
}

/// Number(x); None = undefined.
pub fn to_num(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => str_to_num(s),
        Some(Value::Array(a)) => match a.len() {
            0 => 0.0,
            1 => str_to_num(&to_str(a.first())),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// StringToNumber (the grammar Number("…") accepts).
pub fn str_to_num(s: &str) -> f64 {
    let t = trim(s);
    if t.is_empty() {
        return 0.0;
    }
    for (p, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(d) = t.strip_prefix(p) {
            if d.is_empty() || !d.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return d.chars().fold(0.0, |acc, c| acc * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0)));
        }
    }
    let (sign, body) = match t.as_bytes()[0] {
        b'+' => (1.0, &t[1..]),
        b'-' => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    // [digits][.digits][e[+-]digits], at least one digit in the mantissa
    let b = body.as_bytes();
    let mut i = 0;
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i - int_start;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let f = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        digits += i - f;
    }
    if digits == 0 {
        return f64::NAN;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let e = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == e {
            return f64::NAN;
        }
    }
    if i != b.len() {
        return f64::NAN;
    }
    body.parse::<f64>().map(|f| sign * f).unwrap_or(f64::NAN)
}

/// Math.round
pub fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}

// ---- UTF-16 lengths (JS string .length / .slice) ---------------------------

// JS strings can hold lone UTF-16 surrogates (a JSON "\ud83d" escape, or a
// .slice() through an emoji); Rust strings can't. They're carried as
// private-use stand-ins U+F0000 + (unit - 0xD800), count as one unit, print
// back as "\udxxx" in JSON.stringify and as U+FFFD on stdout — exactly what
// Node does with a lone surrogate.
const LONE_BASE: u32 = 0xF0000;

fn lone(unit: u32) -> char {
    char::from_u32(LONE_BASE + (unit - 0xD800)).unwrap_or('\u{FFFD}')
}

fn lone_unit(c: char) -> Option<u32> {
    let u = c as u32;
    (LONE_BASE..LONE_BASE + 0x800).contains(&u).then(|| u - LONE_BASE + 0xD800)
}

fn units(c: char) -> usize {
    if lone_unit(c).is_some() { 1 } else { c.len_utf16() }
}

/// Text for stdout: lone surrogates become U+FFFD (Node's UTF-8 encoder).
pub fn for_stdout(s: &str) -> std::borrow::Cow<'_, str> {
    if !s.chars().any(|c| lone_unit(c).is_some()) {
        return s.into();
    }
    s.chars().map(|c| if lone_unit(c).is_some() { '\u{FFFD}' } else { c }).collect::<String>().into()
}

pub fn len16(s: &str) -> usize {
    s.chars().map(units).sum()
}

/// `s.slice(0, n)` in UTF-16 units (a cut through a pair keeps the lone
/// high surrogate, like JS).
pub fn head16(s: &str, n: usize) -> String {
    let mut out = String::new();
    let mut used = 0;
    for c in s.chars() {
        let l = units(c);
        if used + l > n {
            if used < n {
                out.push(lone(0xD800 + ((c as u32 - 0x10000) >> 10)));
            }
            break;
        }
        out.push(c);
        used += l;
    }
    out
}

/// `s.length > n ? `${s.slice(0, n)}…` : s`
pub fn clip(s: &str, n: usize) -> String {
    if len16(s) > n {
        format!("{}…", head16(s, n))
    } else {
        s.to_string()
    }
}

// ---- arrays ---------------------------------------------------------------

/// `a.slice(-n)` (n > 0)
pub fn tail<T>(a: &[T], n: usize) -> &[T] {
    &a[a.len().saturating_sub(n)..]
}

/// `a.slice(0, n)`
pub fn head<T>(a: &[T], n: usize) -> &[T] {
    &a[..a.len().min(n)]
}

// ---- JSON.stringify ---------------------------------------------------------

fn quote_into(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => match lone_unit(c) {
                Some(u) => out.push_str(&format!("\\u{u:04x}")),
                None => out.push(c),
            },
        }
    }
    out.push('"');
}

fn write_json(out: &mut String, v: &Value, indent: usize, depth: usize) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            let f = n.as_f64().unwrap_or(f64::NAN);
            out.push_str(&if f.is_finite() { num_str(f) } else { "null".into() });
        }
        Value::String(s) => quote_into(out, s),
        Value::Array(a) => {
            if a.is_empty() {
                return out.push_str("[]");
            }
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, indent, depth + 1);
                write_json(out, x, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push(']');
        }
        Value::Object(o) => {
            if o.is_empty() {
                return out.push_str("{}");
            }
            out.push('{');
            for (i, (k, x)) in o.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, indent, depth + 1);
                quote_into(out, k);
                out.push(':');
                if indent > 0 {
                    out.push(' ');
                }
                write_json(out, x, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push('}');
        }
    }
}

fn newline(out: &mut String, indent: usize, depth: usize) {
    if indent > 0 {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', indent * depth));
    }
}

/// JSON.stringify(v, null, indent)
pub fn stringify(v: &Value, indent: usize) -> String {
    let mut out = String::new();
    write_json(&mut out, v, indent, 0);
    out
}

/// JSON.parse, tolerant of lone UTF-16 surrogate escapes (JS accepts them,
/// serde_json doesn't): they become lone-surrogate stand-ins.
pub fn parse(text: &str) -> Option<Value> {
    match serde_json::from_str(text) {
        Ok(v) => Some(v),
        Err(_) if text.contains("\\u") || text.contains("\\U") => serde_json::from_str(&fix_surrogates(text)).ok(),
        Err(_) => None,
    }
}

fn fix_surrogates(text: &str) -> String {
    let b = text.as_bytes();
    let hex4 = |i: usize| -> Option<u32> {
        let h = text.get(i..i + 4)?;
        h.bytes().all(|c| c.is_ascii_hexdigit()).then(|| u32::from_str_radix(h, 16).ok()).flatten()
    };
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut last = 0;
    while i < b.len() {
        if b[i] != b'\\' {
            i += 1;
            continue;
        }
        if b.get(i + 1) != Some(&b'u') {
            i += 2;
            continue;
        }
        let Some(u) = hex4(i + 2) else {
            i += 2;
            continue;
        };
        if (0xD800..0xDC00).contains(&u) {
            let low = (b.get(i + 6) == Some(&b'\\') && b.get(i + 7) == Some(&b'u'))
                .then(|| hex4(i + 8))
                .flatten()
                .filter(|l| (0xDC00..0xE000).contains(l));
            if low.is_some() {
                i += 12;
                continue;
            }
        } else if !(0xDC00..0xE000).contains(&u) {
            i += 6;
            continue;
        }
        out.push_str(&text[last..i]);
        out.push(lone(u));
        i += 6;
        last = i;
    }
    out.push_str(&text[last..]);
    out
}

// ---- dates ------------------------------------------------------------------

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// `new Date(ms).toISOString()`; None where JS throws RangeError.
pub fn iso_string(ms: f64) -> Option<String> {
    if !ms.is_finite() || ms.abs() > 8.64e15 {
        return None;
    }
    let t = ms.trunc() as i64;
    let days = t.div_euclid(86_400_000);
    let rem = t.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else if y < 0 {
        format!("-{:06}", -y)
    } else {
        format!("+{y:06}")
    };
    Some(format!(
        "{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    ))
}

/// Date.parse for the ISO-8601 forms (what transcripts and the app write).
/// Offset-less date-times are read as UTC (JS reads them as local time).
pub fn date_parse(s: &str) -> f64 {
    parse_iso(s).unwrap_or(f64::NAN)
}

fn parse_iso(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let mut i = 0;
    let num = |i: &mut usize, n: usize| -> Option<i64> {
        let d = s.get(*i..*i + n)?;
        if !d.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        *i += n;
        d.parse().ok()
    };
    let year = match b.first()? {
        b'+' | b'-' => {
            let neg = b[0] == b'-';
            i = 1;
            let y = num(&mut i, 6)?;
            if neg && y == 0 {
                return None;
            }
            if neg { -y } else { y }
        }
        _ => num(&mut i, 4)?,
    };
    let (mut month, mut day) = (1, 1);
    if b.get(i) == Some(&b'-') {
        i += 1;
        month = num(&mut i, 2)?;
        if b.get(i) == Some(&b'-') {
            i += 1;
            day = num(&mut i, 2)?;
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (mut h, mut mi, mut sec, mut ms) = (0, 0, 0, 0.0);
    let mut offset_min = 0;
    if b.get(i) == Some(&b'T') {
        i += 1;
        h = num(&mut i, 2)?;
        if b.get(i) != Some(&b':') {
            return None;
        }
        i += 1;
        mi = num(&mut i, 2)?;
        if b.get(i) == Some(&b':') {
            i += 1;
            sec = num(&mut i, 2)?;
            if b.get(i) == Some(&b'.') {
                i += 1;
                let start = i;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if i == start {
                    return None;
                }
                let frac = &s[start..i.min(start + 3)];
                ms = format!("{frac:0<3}").parse::<f64>().ok()?;
            }
        }
        if h > 24 || mi > 59 || sec > 59 || (h == 24 && (mi > 0 || sec > 0 || ms > 0.0)) {
            return None;
        }
        match b.get(i) {
            Some(b'Z') => i += 1,
            Some(&c) if c == b'+' || c == b'-' => {
                i += 1;
                let oh = num(&mut i, 2)?;
                if b.get(i) != Some(&b':') {
                    return None;
                }
                i += 1;
                let om = num(&mut i, 2)?;
                if oh > 23 || om > 59 {
                    return None;
                }
                offset_min = (oh * 60 + om) * if c == b'+' { 1 } else { -1 };
            }
            _ => {}
        }
    }
    if i != b.len() {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let t = days as f64 * 86_400_000.0 + ((h * 60 + mi - offset_min) * 60 + sec) as f64 * 1000.0 + ms;
    (t.abs() <= 8.64e15).then_some(t)
}

// ---- paths (node:path, posix) ---------------------------------------------

/// path.normalize
pub fn normalize(p: &str) -> String {
    if p.is_empty() {
        return ".".into();
    }
    let abs = p.starts_with('/');
    let trailing = p.ends_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|l| *l != "..") {
                    parts.pop();
                } else if !abs {
                    parts.push("..");
                }
            }
            s => parts.push(s),
        }
    }
    let mut out = parts.join("/");
    if out.is_empty() && !abs {
        out = ".".into();
    }
    if !out.is_empty() && trailing {
        out.push('/');
    }
    if abs {
        format!("/{out}")
    } else {
        out
    }
}

/// path.resolve(cwd, p)
pub fn resolve(cwd: &str, p: &str) -> String {
    let joined = if p.starts_with('/') { p.to_string() } else { format!("{cwd}/{p}") };
    let n = normalize(&joined);
    if n.len() > 1 && n.ends_with('/') {
        n[..n.len() - 1].to_string()
    } else {
        n
    }
}

/// path.basename
pub fn basename(p: &str) -> String {
    let t = p.trim_end_matches('/');
    if t.is_empty() {
        return String::new();
    }
    t.rsplit('/').next().unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_print_like_js() {
        assert_eq!(num_str(3.0), "3");
        assert_eq!(num_str(-0.0), "0");
        assert_eq!(num_str(2.5), "2.5");
        assert_eq!(num_str(1e21), "1e+21");
        assert_eq!(num_str(1.5e-7), "1.5e-7");
        assert_eq!(num_str(1e20), "100000000000000000000");
        assert_eq!(num_str(0.000001), "0.000001");
        assert_eq!(str_to_num(" 12 "), 12.0);
        assert_eq!(str_to_num(""), 0.0);
        assert!(str_to_num("12px").is_nan());
        assert!(str_to_num("inf").is_nan());
        assert_eq!(str_to_num("0x1f"), 31.0);
        assert_eq!(str_to_num("-Infinity"), f64::NEG_INFINITY);
        assert_eq!(str_to_num(".5"), 0.5);
    }

    #[test]
    fn strings_convert_like_js() {
        assert_eq!(to_str(None), "undefined");
        assert_eq!(to_str(Some(&json!(null))), "null");
        assert_eq!(to_str(Some(&json!([1, null, "a"]))), "1,,a");
        assert_eq!(to_str(Some(&json!({}))), "[object Object]");
        assert_eq!(to_str(Some(&json!(1.0))), "1");
    }

    #[test]
    fn stringify_matches_js_spacing() {
        let v = json!({ "a": 1, "b": [1, "x"], "c": [], "d": {}, "e": "q\"\n\u{1}" });
        assert_eq!(stringify(&v, 0), r#"{"a":1,"b":[1,"x"],"c":[],"d":{},"e":"q\"\n\u0001"}"#);
        assert_eq!(stringify(&json!({ "a": [1] }), 1), "{\n \"a\": [\n  1\n ]\n}");
    }

    #[test]
    fn clip_counts_utf16() {
        assert_eq!(clip("abcdef", 3), "abc…");
        assert_eq!(clip("abc", 3), "abc");
        assert_eq!(clip("😀b", 3), "😀b");
        // a cut through a pair keeps the lone high surrogate, like JS
        let cut = clip("a😀b", 2);
        assert_eq!(len16(&cut), 3);
        assert_eq!(stringify(&json!(cut), 0), "\"a\\ud83d…\"");
        assert_eq!(for_stdout(&cut), "a\u{FFFD}…");
    }

    #[test]
    fn dates_round_trip() {
        assert_eq!(date_parse("2025-01-02T03:04:05.678Z"), 1735787045678.0);
        assert_eq!(date_parse("2025-01-02"), 1735776000000.0);
        assert_eq!(date_parse("2025-01-02T03:04:05+01:00"), 1735783445000.0);
        assert!(date_parse("yesterday").is_nan());
        assert!(date_parse("").is_nan());
        assert_eq!(iso_string(1735787045678.0).unwrap(), "2025-01-02T03:04:05.678Z");
        assert_eq!(iso_string(0.0).unwrap(), "1970-01-01T00:00:00.000Z");
        assert!(iso_string(f64::NAN).is_none());
    }

    #[test]
    fn parse_tolerates_lone_surrogates() {
        let v = parse(r#"{"a":"x\ud83d","b":"\udc00y"}"#).unwrap();
        assert_eq!(stringify(&v, 0), r#"{"a":"x\ud83d","b":"\udc00y"}"#);
        assert_eq!(len16(v["a"].as_str().unwrap()), 2);
        assert_eq!(parse(r#"{"a":"😀"}"#).unwrap()["a"], "😀");
        assert_eq!(parse(r#"{"a":"\\ud83d"}"#).unwrap()["a"], "\\ud83d");
    }

    #[test]
    fn paths_like_node() {
        assert_eq!(normalize("/a//b/../c/"), "/a/c/");
        assert_eq!(resolve("/x/y", "../z/"), "/x/z");
        assert_eq!(basename("/a/b/"), "b");
        assert_eq!(basename(""), "");
        assert_eq!(trim("\u{FEFF} a \u{A0}"), "a");
        assert_eq!(collapse_ws("a \n\t b"), "a b");
    }
}
