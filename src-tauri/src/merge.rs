// ---------------------------------------------------------------------------
// Merge my sessions: bring parallel sessions' branches into the project's
// main session, in one go.
//
//   merge_preview   what each branch brings (commits, files, +/- lines) and
//                   which files would conflict, merged one after another.
//                   Read-only: it builds throwaway merge objects with
//                   `git merge-tree` and never touches your files or branch.
//   merge_branches  when nothing conflicts: a save point first (so it can be
//                   undone), then `git merge` each branch. Stops cleanly
//                   (merge --abort) at the first surprise conflict.
// Conflicts are left to an agent: the UI hands them to the main session.
// ---------------------------------------------------------------------------

use serde::Serialize;
use std::process::Command;

fn git(repo: &str, args: &[&str]) -> Result<(bool, String), String> {
    let out = Command::new("git").arg("-C").arg(repo).args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "Grill Me").env("GIT_AUTHOR_EMAIL", "merge@grillme.local")
        .env("GIT_COMMITTER_NAME", "Grill Me").env("GIT_COMMITTER_EMAIL", "merge@grillme.local")
        .output().map_err(|e| e.to_string())?;
    Ok((out.status.success(), String::from_utf8_lossy(&out.stdout).to_string()))
}

fn ok(repo: &str, args: &[&str]) -> Result<String, String> {
    match git(repo, args)? {
        (true, out) => Ok(out),
        (false, _) => Err(format!("git {} failed", args.first().unwrap_or(&""))),
    }
}

/// A branch name we're willing to pass to git: no options, no ranges.
pub fn valid_branch(b: &str) -> bool {
    !b.is_empty() && b.len() < 200 && !b.starts_with('-') && !b.contains("..")
        && b.chars().all(|c| c.is_ascii_alphanumeric() || "/-_.".contains(c))
}

#[derive(Serialize, Debug, PartialEq)]
pub struct FileStat { pub file: String, pub adds: u32, pub dels: u32 }

#[derive(Serialize, Debug)]
pub struct BranchPreview {
    pub branch: String,
    pub commits: Vec<String>,
    pub files: Vec<FileStat>,
    /// files that conflict when this branch is merged after the ones before it
    pub conflicts: Vec<String>,
}

/// `git diff --numstat` lines → per-file +/- (binary files count as 0).
pub fn parse_numstat(raw: &str) -> Vec<FileStat> {
    raw.lines().filter_map(|l| {
        let mut it = l.splitn(3, '\t');
        let adds = it.next()?.parse().unwrap_or(0);
        let dels = it.next()?.parse().unwrap_or(0);
        let file = it.next()?.to_string();
        Some(FileStat { file, adds, dels })
    }).collect()
}

/// `git merge-tree --write-tree --name-only` output: the tree id, then the
/// conflicted files, then a blank line and messages.
pub fn parse_merge_tree(raw: &str) -> (String, Vec<String>) {
    let mut lines = raw.lines();
    let tree = lines.next().unwrap_or("").trim().to_string();
    let files = lines.take_while(|l| !l.trim().is_empty()).map(|l| l.trim().to_string()).collect();
    (tree, files)
}

#[tauri::command(async)]
pub fn merge_preview(repo_path: String, target: String, branches: Vec<String>) -> Result<Vec<BranchPreview>, String> {
    if !valid_branch(&target) || !branches.iter().all(|b| valid_branch(b)) {
        return Err("Unexpected branch name".into());
    }
    let repo = repo_path.as_str();
    // the merged result so far, as a commit object nobody points at
    let mut acc = ok(repo, &["rev-parse", "--verify", &format!("{target}^{{commit}}")])?.trim().to_string();
    let mut out = vec![];
    for b in &branches {
        let head = ok(repo, &["rev-parse", "--verify", &format!("{b}^{{commit}}")])?.trim().to_string();
        let commits = ok(repo, &["log", "--format=%s", &format!("{target}..{head}")])?
            .lines().map(str::to_string).collect::<Vec<_>>();
        let files = parse_numstat(&ok(repo, &["diff", "--numstat", &format!("{target}...{head}")])?);
        let (clean, raw) = git(repo, &["merge-tree", "--write-tree", "--name-only", &acc, &head])?;
        let (tree, conflicted) = parse_merge_tree(&raw);
        let conflicts = if clean { vec![] } else { conflicted };
        if clean && !tree.is_empty() {
            // carry the merge forward so the next branch is checked against it
            if let Ok(c) = ok(repo, &["commit-tree", &tree, "-p", &acc, "-p", &head, "-m", "preview"]) {
                acc = c.trim().to_string();
            }
        }
        out.push(BranchPreview { branch: b.clone(), commits, files, conflicts });
    }
    Ok(out)
}

#[derive(Serialize, Debug)]
pub struct MergeResult { pub merged: Vec<String>, pub conflict: Option<String> }

/// Merge the branches into the current branch of `repo_path`, in order.
/// Needs a clean working folder; a save point is taken first.
#[tauri::command(async)]
pub fn merge_branches(repo_path: String, branches: Vec<String>) -> Result<MergeResult, String> {
    if !branches.iter().all(|b| valid_branch(b)) {
        return Err("Unexpected branch name".into());
    }
    let repo = repo_path.as_str();
    if !ok(repo, &["status", "--porcelain"])?.trim().is_empty() {
        return Err("This folder has unsaved changes. Commit them (or ask the agent to) before merging.".into());
    }
    let _ = crate::savepoint::savepoint_create(repo_path.clone(), "Before merging sessions".into());
    let mut merged = vec![];
    for b in &branches {
        let (clean, _) = git(repo, &["merge", "--no-edit", "--no-ff", "-m", &format!("Merge {b}"), b])?;
        if !clean {
            let _ = git(repo, &["merge", "--abort"]);
            return Ok(MergeResult { merged, conflict: Some(b.clone()) });
        }
        crate::impact::log("merge", b);
        merged.push(b.clone());
    }
    Ok(MergeResult { merged, conflict: None })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn sh(repo: &str, args: &[&str]) { assert!(git(repo, args).unwrap().0, "git {args:?}"); }

    fn repo() -> String {
        let d = std::env::temp_dir().join(format!("grillme-merge-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&d).unwrap();
        let r = d.to_string_lossy().into_owned();
        sh(&r, &["init", "-q", "-b", "main"]);
        std::fs::write(d.join("game.js"), "a\nb\nc\n").unwrap();
        sh(&r, &["add", "-A"]); sh(&r, &["commit", "-qm", "init"]);
        r
    }

    fn branch(r: &str, name: &str, file: &str, body: &str) {
        sh(r, &["checkout", "-q", "-b", name, "main"]);
        std::fs::write(Path::new(r).join(file), body).unwrap();
        sh(r, &["add", "-A"]); sh(r, &["commit", "-qm", &format!("work on {name}")]);
        sh(r, &["checkout", "-q", "main"]);
    }

    #[test]
    fn parsers() {
        assert_eq!(parse_numstat("3\t1\tgame.js\n-\t-\timg.png\n"), vec![
            FileStat { file: "game.js".into(), adds: 3, dels: 1 },
            FileStat { file: "img.png".into(), adds: 0, dels: 0 },
        ]);
        assert_eq!(parse_merge_tree("abc123\nindex.html\nstyle.css\n\nAuto-merging…"), ("abc123".into(), vec!["index.html".into(), "style.css".into()]));
        assert!(valid_branch("feat/seasons"));
        assert!(!valid_branch("--force"));
        assert!(!valid_branch("main..evil"));
    }

    #[test]
    fn previews_conflicts_without_touching_files_then_merges_clean_ones() {
        let r = repo();
        branch(&r, "feat/a", "a.txt", "new file\n");
        branch(&r, "feat/b", "game.js", "a\nB\nc\n");
        branch(&r, "feat/c", "game.js", "a\nC\nc\n");
        let p = merge_preview(r.clone(), "main".into(), vec!["feat/a".into(), "feat/b".into(), "feat/c".into()]).unwrap();
        assert_eq!(p[0].commits, vec!["work on feat/a"]);
        assert_eq!(p[0].files[0].file, "a.txt");
        assert!(p[0].conflicts.is_empty() && p[1].conflicts.is_empty());
        // c conflicts with b, which comes before it
        assert_eq!(p[2].conflicts, vec!["game.js"]);
        // the preview left everything as it was
        assert_eq!(ok(&r, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap().trim(), "main");
        assert!(ok(&r, &["status", "--porcelain"]).unwrap().trim().is_empty());
        // merging stops cleanly at the conflict
        let m = merge_branches(r.clone(), vec!["feat/a".into(), "feat/b".into(), "feat/c".into()]).unwrap();
        assert_eq!(m.merged, vec!["feat/a", "feat/b"]);
        assert_eq!(m.conflict.as_deref(), Some("feat/c"));
        assert!(ok(&r, &["status", "--porcelain"]).unwrap().trim().is_empty());
        assert!(Path::new(&r).join("a.txt").exists());
        let _ = std::fs::remove_dir_all(&r);
    }
}
