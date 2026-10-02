// ---------------------------------------------------------------------------
// Save points: undo for whatever an agent did to your files.
//
// A save point is a snapshot of the working folder (tracked files and new
// untracked ones, minus .gitignored) stored as a private git ref under
// refs/grillme/save/. Making one never touches your branch, your commits,
// your staging area or your files: it hashes the folder into a commit object
// through a throwaway index. Works on any branch, main included.
//
// Going back first saves where you are now (so going back is undoable too),
// then makes the folder match the save point: files that didn't exist then
// are removed, everything else is restored. Your commits and staged index
// stay as they were; the difference simply shows up as changes.
// ---------------------------------------------------------------------------

use serde::Serialize;
use std::path::Path;
use std::process::Command;

const PREFIX: &str = "refs/grillme/save/";
/// Oldest save points beyond this many are dropped.
const KEEP: usize = 60;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SavePoint {
    pub id: String,
    pub label: String,
    /// unix seconds
    pub at: i64,
}

fn run(repo: &str, args: &[&str], index: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        // a private ref needs no real identity; don't fail where none is set
        .env("GIT_AUTHOR_NAME", "Grill Me").env("GIT_AUTHOR_EMAIL", "savepoint@grillme.local")
        .env("GIT_COMMITTER_NAME", "Grill Me").env("GIT_COMMITTER_EMAIL", "savepoint@grillme.local");
    if let Some(i) = index {
        cmd.env("GIT_INDEX_FILE", i);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// A save point id is a full or short hex object name, nothing else.
pub fn valid_id(id: &str) -> bool {
    (7..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// One line of the label: no newlines, at most 120 characters.
pub fn clean_label(label: &str) -> String {
    let one = label.split_whitespace().collect::<Vec<_>>().join(" ");
    let t: String = one.chars().take(120).collect();
    if t.is_empty() { "Save point".into() } else { t }
}

/// The folder's current state as a tree, through a throwaway copy of the index.
fn snapshot_tree(repo: &str) -> Result<String, String> {
    let git_index = run(repo, &["rev-parse", "--git-path", "index"], None)?;
    let git_index = git_index.trim();
    let real = if Path::new(git_index).is_absolute() { Path::new(git_index).to_path_buf() } else { Path::new(repo).join(git_index) };
    let tmp = std::env::temp_dir().join(format!("grillme-save-{}-{}.index", std::process::id(), now_nanos()));
    // start from the real index so unchanged files aren't rehashed
    if real.exists() {
        std::fs::copy(&real, &tmp).map_err(|e| e.to_string())?;
    }
    let tree = run(repo, &["add", "-A", "."], Some(&tmp)).and_then(|_| run(repo, &["write-tree"], Some(&tmp)));
    let _ = std::fs::remove_file(&tmp);
    Ok(tree?.trim().to_string())
}

fn now_nanos() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

/// Parse `for-each-ref` lines: "<oid> <unix> <subject>".
pub fn parse_list(raw: &str) -> Vec<SavePoint> {
    raw.lines().filter_map(|l| {
        let mut it = l.splitn(3, ' ');
        let id = it.next()?.to_string();
        let at = it.next()?.parse().ok()?;
        let label = it.next().unwrap_or("").to_string();
        valid_id(&id).then_some(SavePoint { id, label, at })
    }).collect()
}

fn list(repo: &str) -> Result<Vec<SavePoint>, String> {
    let raw = run(repo, &["for-each-ref", "--sort=-refname", "--format=%(objectname) %(committerdate:unix) %(subject)", PREFIX], None)?;
    Ok(parse_list(&raw))
}

fn create(repo: &str, label: &str) -> Result<SavePoint, String> {
    let tree = snapshot_tree(repo)?;
    // nothing changed since the last save point: that one already covers it
    if let Some(last) = list(repo)?.into_iter().next() {
        if run(repo, &["rev-parse", &format!("{}^{{tree}}", last.id)], None).map(|t| t.trim() == tree).unwrap_or(false) {
            return Ok(last);
        }
    }
    let label = clean_label(label);
    let mut args = vec!["commit-tree", tree.as_str(), "-m", label.as_str()];
    let head = run(repo, &["rev-parse", "--verify", "--quiet", "HEAD"], None).ok().map(|h| h.trim().to_string());
    if let Some(h) = head.as_deref() {
        args.extend(["-p", h]);
    }
    let id = run(repo, &args, None)?.trim().to_string();
    let r = format!("{PREFIX}{}-{}", now_nanos(), &id[..12.min(id.len())]);
    run(repo, &["update-ref", &r, &id], None)?;
    prune(repo)?;
    let at = run(repo, &["log", "-1", "--format=%ct", &id], None)?.trim().parse().unwrap_or(0);
    Ok(SavePoint { id, label, at })
}

fn prune(repo: &str) -> Result<(), String> {
    let refs = run(repo, &["for-each-ref", "--sort=-refname", "--format=%(refname)", PREFIX], None)?;
    for r in refs.lines().skip(KEEP) {
        let _ = run(repo, &["update-ref", "-d", r], None);
    }
    Ok(())
}

/// Files in `now` that `then` doesn't have: the ones going back removes.
pub fn added_since(then: &str, now: &str) -> Vec<String> {
    let keep: std::collections::HashSet<&str> = then.lines().filter(|l| !l.is_empty()).collect();
    now.lines().filter(|l| !l.is_empty() && !keep.contains(l)).map(str::to_string).collect()
}

fn restore(repo: &str, id: &str) -> Result<String, String> {
    if !valid_id(id) {
        return Err("not a save point".into());
    }
    // only our own save points, never an arbitrary commit
    let target = list(repo)?.into_iter().find(|s| s.id.starts_with(id) || id.starts_with(&s.id))
        .ok_or_else(|| "that save point no longer exists".to_string())?;
    let current = create(repo, "Before going back")?;
    let then = run(repo, &["ls-tree", "-r", "--name-only", &target.id], None)?;
    let now = run(repo, &["ls-tree", "-r", "--name-only", &current.id], None)?;
    for f in added_since(&then, &now) {
        let p = Path::new(repo).join(&f);
        if p.starts_with(repo) {
            let _ = std::fs::remove_file(p);
        }
    }
    run(repo, &["restore", &format!("--source={}", target.id), "--worktree", "--", "."], None)?;
    Ok(format!("Back to “{}”. Where you were is saved as a save point too.", target.label))
}

fn repo_ok(repo: &str) -> Result<(), String> {
    if repo.trim().is_empty() || !Path::new(repo).is_dir() {
        return Err("no project folder".into());
    }
    run(repo, &["rev-parse", "--is-inside-work-tree"], None).map(|_| ()).map_err(|_| "not a git repository".into())
}

#[tauri::command]
pub fn savepoint_create(repo_path: String, label: String) -> Result<SavePoint, String> {
    repo_ok(&repo_path)?;
    create(&repo_path, &label)
}

#[tauri::command]
pub fn savepoint_list(repo_path: String) -> Result<Vec<SavePoint>, String> {
    repo_ok(&repo_path)?;
    list(&repo_path)
}

#[tauri::command]
pub fn savepoint_restore(repo_path: String, id: String) -> Result<String, String> {
    repo_ok(&repo_path)?;
    restore(&repo_path, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> String {
        let d = std::env::temp_dir().join(format!("grillme-sp-test-{}", now_nanos()));
        std::fs::create_dir_all(&d).unwrap();
        let r = d.to_string_lossy().into_owned();
        run(&r, &["init", "-q", "-b", "main"], None).unwrap();
        std::fs::write(d.join("a.txt"), "one\n").unwrap();
        std::fs::write(d.join(".gitignore"), "secret.env\n").unwrap();
        run(&r, &["add", "-A"], None).unwrap();
        run(&r, &["commit", "-qm", "init"], None).unwrap();
        r
    }

    #[test]
    fn ids_and_labels_are_checked() {
        assert!(valid_id("0123abcdef"));
        assert!(!valid_id("HEAD"));
        assert!(!valid_id("abc"));
        assert!(!valid_id("--source=x"));
        assert_eq!(clean_label("  fix\nthe   bug "), "fix the bug");
        assert_eq!(clean_label(""), "Save point");
        assert_eq!(added_since("a\nb\n", "a\nb\nc\n"), vec!["c".to_string()]);
        assert_eq!(parse_list("deadbeef12 1700000000 Before: add login\nbad line\n").len(), 1);
    }

    #[test]
    fn save_and_go_back_on_main_without_touching_history() {
        let r = repo();
        let p = Path::new(&r);
        let head = run(&r, &["rev-parse", "HEAD"], None).unwrap();
        std::fs::write(p.join("a.txt"), "two\n").unwrap();
        std::fs::write(p.join("new.txt"), "fresh\n").unwrap();
        std::fs::write(p.join("secret.env"), "KEY=1\n").unwrap();
        let sp = create(&r, "after the agent's first change").unwrap();
        // nothing changed: same save point back
        assert_eq!(create(&r, "again").unwrap().id, sp.id);
        // the agent keeps going
        std::fs::write(p.join("a.txt"), "three\n").unwrap();
        std::fs::remove_file(p.join("new.txt")).unwrap();
        std::fs::write(p.join("later.txt"), "later\n").unwrap();
        restore(&r, &sp.id).unwrap();
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "two\n");
        assert_eq!(std::fs::read_to_string(p.join("new.txt")).unwrap(), "fresh\n");
        assert!(!p.join("later.txt").exists());
        // ignored files are never snapshotted or removed
        assert!(p.join("secret.env").exists());
        // branch, commits untouched
        assert_eq!(run(&r, &["rev-parse", "HEAD"], None).unwrap(), head);
        assert_eq!(run(&r, &["rev-parse", "--abbrev-ref", "HEAD"], None).unwrap().trim(), "main");
        // going back is undoable: "Before going back" is the newest
        let all = list(&r).unwrap();
        assert_eq!(all[0].label, "Before going back");
        restore(&r, &all[0].id).unwrap();
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "three\n");
        assert!(p.join("later.txt").exists());
        // only our own save points can be restored
        assert!(restore(&r, head.trim()).is_err());
        let _ = std::fs::remove_dir_all(p);
    }
}
