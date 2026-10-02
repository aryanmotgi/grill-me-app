// ---------------------------------------------------------------------------
// DNA Sync: writes the key parts of your Coding DNA into the files each AI
// already reads (personal: ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md,
// ~/.gemini/GEMINI.md; project: AGENTS.md, CLAUDE.md, GEMINI.md,
// .cursor/rules/coding-dna.mdc).
//
// Grill Me only ever writes inside its own block:
//   <!-- Coding DNA: managed by Grill Me ... -->  ...  <!-- /Coding DNA -->
// Before writing, it checks that everything OUTSIDE that block is exactly what
// you had (byte for byte) and that the file hasn't changed since you saw the
// preview; otherwise it refuses. Every write is backed up first, so the last
// sync can be undone.
// ---------------------------------------------------------------------------

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const START: &str = "<!-- Coding DNA: managed by Grill Me. Edit it in Grill Me → DNA. -->";
pub const END: &str = "<!-- /Coding DNA -->";

/// The file with Grill Me's block taken out (what's yours).
pub fn strip(text: &str) -> String {
    let Some(s) = text.find("<!-- Coding DNA") else { return text.to_string() };
    let Some(e_rel) = text[s..].find(END) else { return text.to_string() };
    let mut e = s + e_rel + END.len();
    if text[e..].starts_with('\n') { e += 1; }
    // drop the blank line we put before the block when appending
    let mut s2 = s;
    if text[..s].ends_with("\n\n") { s2 -= 1; }
    format!("{}{}", &text[..s2], &text[e..])
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
}

/// Only these files, ever: the agents' personal files, or the known rules
/// files inside a git repo.
pub fn allowed(path: &str) -> bool {
    if !path.starts_with('/') || path.contains("..") || path.contains('\0') { return false; }
    let h = home();
    let personal = [".claude/CLAUDE.md", ".codex/AGENTS.md", ".gemini/GEMINI.md"];
    if personal.iter().any(|p| Path::new(path) == h.join(p)) { return true; }
    for suffix in ["/AGENTS.md", "/CLAUDE.md", "/GEMINI.md", "/.cursor/rules/coding-dna.mdc"] {
        if let Some(repo) = path.strip_suffix(suffix) {
            return !repo.is_empty() && Path::new(repo).join(".git").exists();
        }
    }
    false
}

#[derive(Serialize)]
pub struct Current { path: String, exists: bool, text: String }

/// Read the target files as they are now (missing ones as empty).
#[tauri::command]
pub fn dna_sync_read(paths: Vec<String>) -> Result<Vec<Current>, String> {
    paths.into_iter().take(80).map(|path| {
        if !allowed(&path) { return Err(format!("Not a file DNA Sync writes: {path}")); }
        match std::fs::read_to_string(&path) {
            Ok(text) => Ok(Current { path, exists: true, text }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Current { path, exists: false, text: String::new() }),
            Err(e) => Err(format!("{path}: {e}")),
        }
    }).collect()
}

#[derive(Deserialize)]
pub struct Write { path: String, before: String, after: String }

#[derive(Serialize, Deserialize)]
struct Backup { path: String, existed: bool, file: String }

fn backups_root() -> PathBuf {
    crate::grillme_root().join("dna-sync")
}

/// Check every write, back up, then write. Refuses the whole sync if any file
/// changed since the preview or a write would touch your own content.
#[tauri::command]
pub fn dna_sync_apply(writes: Vec<Write>) -> Result<String, String> {
    for w in &writes {
        if !allowed(&w.path) { return Err(format!("Not a file DNA Sync writes: {}", w.path)); }
        if w.after.len() > 500_000 { return Err(format!("{}: too large", w.path)); }
        let now = std::fs::read_to_string(&w.path).unwrap_or_default();
        if now != w.before { return Err(format!("{} changed since the preview. Open DNA Sync again.", w.path)); }
        // a Cursor rule file of our own: only when it's new or already ours
        if w.path.ends_with("/.cursor/rules/coding-dna.mdc") {
            if !w.before.trim().is_empty() && !w.before.contains("<!-- Coding DNA") { return Err(format!("{}: that file isn't Grill Me's, so nothing was written.", w.path)); }
            continue;
        }
        // your part must be identical (a newline added at the very end is the only allowance)
        if strip(&w.after).trim_end() != strip(&w.before).trim_end() { return Err(format!("{}: that would change your own content, so nothing was written.", w.path)); }
    }
    let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0).to_string();
    let dir = backups_root().join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut manifest = vec![];
    for (i, w) in writes.iter().enumerate() {
        let existed = Path::new(&w.path).exists();
        let file = format!("{i}.bak");
        if existed { std::fs::write(dir.join(&file), &w.before).map_err(|e| e.to_string())?; }
        manifest.push(Backup { path: w.path.clone(), existed, file });
    }
    std::fs::write(dir.join("manifest.json"), serde_json::to_string(&manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    for w in &writes {
        if let Some(parent) = Path::new(&w.path).parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let tmp = format!("{}.grillme-tmp", w.path);
        std::fs::write(&tmp, &w.after).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &w.path).map_err(|e| e.to_string())?;
    }
    prune();
    Ok(id)
}

/// Keep the last 10 syncs' backups.
fn prune() {
    let Ok(rd) = std::fs::read_dir(backups_root()) else { return };
    let mut ids: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    ids.sort();
    while ids.len() > 10 { let _ = std::fs::remove_dir_all(ids.remove(0)); }
}

/// Undo the most recent sync: put every file back exactly as it was.
#[tauri::command]
pub fn dna_sync_undo() -> Result<u32, String> {
    let rd = std::fs::read_dir(backups_root()).map_err(|_| "Nothing to undo".to_string())?;
    let mut ids: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.join("manifest.json").exists()).collect();
    ids.sort();
    let dir = ids.pop().ok_or("Nothing to undo")?;
    let manifest: Vec<Backup> = serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut n = 0;
    for b in &manifest {
        if !allowed(&b.path) { continue; }
        if b.existed {
            std::fs::write(&b.path, std::fs::read_to_string(dir.join(&b.file)).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        } else {
            let _ = std::fs::remove_file(&b.path);
        }
        n += 1;
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(n)
}

/// When the last sync happened (ms), if there's one to undo.
#[tauri::command]
pub fn dna_sync_last() -> Option<u64> {
    let rd = std::fs::read_dir(backups_root()).ok()?;
    rd.flatten().filter(|e| e.path().join("manifest.json").exists()).filter_map(|e| e.file_name().to_string_lossy().parse::<u64>().ok()).max()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_takes_out_only_our_block() {
        let mine = "# My rules\n- Never push to main.\n";
        let ours = format!("{START}\n## My Coding DNA\n- Small diffs\n{END}\n");
        assert_eq!(strip(&format!("{mine}\n{ours}")), mine);
        assert_eq!(strip(&format!("{ours}{mine}")), mine);
        assert_eq!(strip(mine), mine);
        // an unterminated block is left alone (and so can't be "yours" vs ours)
        assert_eq!(strip(&format!("{mine}{START}\noops")), format!("{mine}{START}\noops"));
    }

    #[test]
    fn only_known_files() {
        let h = home();
        assert!(allowed(&h.join(".claude/CLAUDE.md").to_string_lossy()));
        assert!(!allowed(&h.join(".claude/settings.json").to_string_lossy()));
        assert!(!allowed("/etc/AGENTS.md")); // not a git repo
        assert!(!allowed("relative/AGENTS.md"));
        let repo = env!("CARGO_MANIFEST_DIR").trim_end_matches("/src-tauri");
        assert!(allowed(&format!("{repo}/AGENTS.md")));
        assert!(allowed(&format!("{repo}/.cursor/rules/coding-dna.mdc")));
        assert!(!allowed(&format!("{repo}/src/AGENTS.md"))); // only at the repo root
        assert!(!allowed(&format!("{repo}/../x/AGENTS.md")));
    }

    #[test]
    fn refuses_to_touch_your_content() {
        let dir = std::env::temp_dir().join(format!("grillme-sync-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        let path = dir.join("AGENTS.md").to_string_lossy().into_owned();
        std::fs::write(&path, "mine\n").unwrap();
        let bad = Write { path: path.clone(), before: "mine\n".into(), after: "changed\n".into() };
        assert!(dna_sync_apply(vec![bad]).unwrap_err().contains("your own content"));
        let stale = Write { path: path.clone(), before: "older\n".into(), after: format!("older\n\n{START}\nx\n{END}\n") };
        assert!(dna_sync_apply(vec![stale]).unwrap_err().contains("changed since the preview"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "mine\n");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
