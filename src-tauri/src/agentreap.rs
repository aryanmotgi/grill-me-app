// ---------------------------------------------------------------------------
// Agents left behind by a force-quit. Quitting normally reaps every session
// (kill_all_ptys), but `pkill` (what `grill update` / `grill restart` use)
// or a crash skips that, and the agents live on, reparented to launchd.
// Paused ones stay frozen forever. So every agent's pid is written down when
// it starts, and on the next launch any of them still alive and orphaned
// (parent pid 1) is stopped, with everything it started.
// ---------------------------------------------------------------------------

use std::path::{Path, PathBuf};
use std::process::Command;

fn file() -> PathBuf {
    crate::grillme_root().join("agents.pid")
}

/// Note a session's agent pid.
pub fn remember(pid: u32) {
    use std::io::Write as _;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file()) {
        let _ = writeln!(f, "{pid}");
    }
}

/// pids from the file, ignoring junk.
pub fn parse(text: &str) -> Vec<u32> {
    let mut v: Vec<u32> = text.lines().filter_map(|l| l.trim().parse().ok()).filter(|p| *p > 1).collect();
    v.sort_unstable();
    v.dedup();
    v
}

/// (pid, ppid, command) for every process.
fn table() -> Vec<(u32, u32, String)> {
    let Ok(out) = Command::new("ps").args(["-axo", "pid=,ppid=,command="]).output() else { return vec![] };
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| {
        let mut it = l.split_whitespace();
        let pid = it.next()?.parse().ok()?;
        let ppid = it.next()?.parse().ok()?;
        Some((pid, ppid, it.collect::<Vec<_>>().join(" ")))
    }).collect()
}

/// The agents to stop: remembered, still alive, orphaned, and still an agent
/// CLI (a reused pid belonging to something else is left alone).
pub fn orphans(remembered: &[u32], procs: &[(u32, u32, String)]) -> Vec<u32> {
    const AGENTS: [&str; 4] = ["claude", "codex", "cursor-agent", "gemini"];
    procs.iter().filter(|(pid, ppid, cmd)| {
        *ppid == 1 && remembered.contains(pid) && {
            let prog = cmd.split_whitespace().next().unwrap_or("");
            let name = Path::new(prog).file_name().and_then(|n| n.to_str()).unwrap_or(prog);
            AGENTS.iter().any(|a| name == *a || cmd.contains(&format!("/{a} ")) || cmd.starts_with(&format!("{a} ")))
        }
    }).map(|(pid, _, _)| *pid).collect()
}

/// Every descendant of `pid`, deepest first.
pub fn descendants(pid: u32, procs: &[(u32, u32, String)]) -> Vec<u32> {
    let mut out = vec![];
    for (c, p, _) in procs {
        if *p == pid {
            out.extend(descendants(*c, procs));
            out.push(*c);
        }
    }
    out
}

/// On launch: stop what a force-quit left running, then start a fresh list.
pub fn reap_on_launch() -> usize {
    let remembered = parse(&std::fs::read_to_string(file()).unwrap_or_default());
    let _ = std::fs::write(file(), "");
    if remembered.is_empty() {
        return 0;
    }
    let procs = table();
    let found = orphans(&remembered, &procs);
    for pid in &found {
        let mut all = descendants(*pid, &procs);
        all.push(*pid);
        for p in all {
            let p = p.to_string();
            // a paused agent ignores everything but SIGKILL until resumed
            let _ = Command::new("kill").args(["-CONT", &p]).status();
            let _ = Command::new("kill").args(["-KILL", &p]).status();
        }
    }
    found.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn procs() -> Vec<(u32, u32, String)> {
        vec![
            (100, 1, "claude --dangerously-skip-permissions".into()),
            (101, 100, "node /opt/mcp/server.js".into()),
            (102, 101, "sleep 5".into()),
            (200, 1, "/Users/me/.local/bin/claude --resume".into()),
            (300, 1, "python3 -m http.server".into()),
            (400, 555, "claude --dangerously-skip-permissions".into()),
        ]
    }

    #[test]
    fn reads_the_pid_list() {
        assert_eq!(parse("100\n\njunk\n100\n1\n200\n"), vec![100, 200]);
    }

    #[test]
    fn only_stops_remembered_orphaned_agents() {
        // 300: remembered but not an agent (pid reused); 400: still has a live parent
        assert_eq!(orphans(&[100, 200, 300, 400], &procs()), vec![100, 200]);
        assert!(orphans(&[], &procs()).is_empty());
    }

    #[test]
    fn stops_children_before_their_parent() {
        assert_eq!(descendants(100, &procs()), vec![102, 101]);
    }
}
