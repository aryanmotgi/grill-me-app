import { useState } from "react";
import { Icon } from "./Icon";
import { ptyIdFor, useApp } from "../store";
import { deliverBriefWhenReady } from "../lib/ptyReady";
import { isTauri } from "../data/sources/git";
import type { Task } from "../types";

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3));
}

/**
 * Paste a checklist → independent tasks spawn their own worktree + session
 * in parallel; dependent tasks (shared wording = likely same area) wait and
 * auto-start when their dependency is marked done. Coordination runs on the
 * existing board / locks / inbox — no separate system.
 */
export function FanOut() {
  const { tasks, setShared, members, applyTeamConfig, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const parse = (): { title: string; dependsOn: number | null }[] => {
    const lines = text.split("\n")
      .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)]|\[[ x]\])\s*/i, "").trim())
      .filter(Boolean);
    return lines.map((title, i) => {
      // dependency: shares 2+ meaningful words with an EARLIER item
      for (let j = 0; j < i; j++) {
        const shared = [...words(title)].filter((w) => words(lines[j]).has(w));
        if (shared.length >= 2) return { title, dependsOn: j };
      }
      return { title, dependsOn: null };
    });
  };

  const run = async () => {
    if (!isTauri()) { toast("Fan-out needs the native app to spawn sessions", "warn"); return; }
    setBusy(true);
    const { invoke } = await import("@tauri-apps/api/core");
    const items = parse();
    const base = members[0];
    if (!base || items.length === 0) { setBusy(false); return; }
    const stamp = Date.now();
    const ids = items.map((_, i) => `fan-${stamp}-${i}`);
    const newTasks: Task[] = items.map((it, i) => ({
      id: ids[i],
      title: it.title,
      desc: "fan-out",
      owner: it.dependsOn === null ? `agent-${stamp % 1000}-${i}` : "pending",
      status: "not-started",
      files: [],
      blockedBy: it.dependsOn !== null ? ids[it.dependsOn] : undefined,
    }));
    const merged = [...tasks, ...newTasks];
    setShared({ tasks: merged });
    // delta upsert: only the new tasks are sent, so a concurrent writer's
    // entries can never be clobbered by this snapshot
    invoke("shared_upsert", { name: "tasks.json", itemsJson: JSON.stringify(newTasks), removedIds: [] }).catch(console.error);

    let spawned = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].dependsOn !== null) continue; // dependents wait for done-click on blocker
      const sid = `agent-${stamp % 1000}-${i}`;
      const parent = base.repoPath.replace(/\/[^/]+$/, "");
      const path = `${parent}/worktrees-${sid}`;
      const branch = `fan/${sid}`;
      try {
        await invoke("worktree_add", { baseRepo: base.repoPath, branch, path });
        const nextMembers = [...useApp.getState().members, { id: sid, name: sid, repoPath: path, permission: "edit" }];
        await invoke("team_config_write", { cfg: { teammates: nextMembers } });
        applyTeamConfig(nextMembers);
        await invoke("pty_ensure", { id: ptyIdFor(sid), cwd: path, shell: false, remote: null, tmux: null });
        // brief for the agent — delivered once the session is actually at an
        // idle claude prompt (poll every 1s, up to 30s), not on a blind timer
        const title = items[i].title;
        deliverBriefWhenReady(
          ptyIdFor(sid),
          `Work on this task: ${title}. When done, tell the user and stop.\n`,
        ).then((delivered) => {
          if (!delivered) {
            useApp.getState().toast(
              `Brief NOT delivered to ${sid} — session never became ready. Paste "${title}" into its pane manually.`,
              "warn",
            );
          }
        });
        spawned++;
      } catch (e) {
        toast(`Spawn failed for "${items[i].title}": ${e}`, "warn");
      }
    }
    const waiting = items.filter((i) => i.dependsOn !== null).length;
    toast(`Fan-out: ${spawned} session${spawned === 1 ? "" : "s"} running in parallel${waiting ? `, ${waiting} waiting on dependencies` : ""}`);
    setBusy(false);
    setOpen(false);
    setText("");
  };

  if (!open) {
    return (
      <button className="btn mt-1 demo-hide" title="Paste a checklist — independent items run in parallel sessions"
        onClick={() => setOpen(true)}>
        <Icon name="branch" size={10} /> fan out
      </button>
    );
  }
  return (
    <div className="mt-1 flex flex-col gap-1.5 demo-hide">
      <textarea className="w-full h-28 bg-raised hairline rounded-sm p-2 text-[11px] resize-none outline-none focus:border-accent"
        placeholder={"Paste a task list, one per line:\n- add login page\n- add signup page\n- style login page (depends on first)"}
        value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="text-faint text-[10px]">
        Items sharing wording with an earlier item are treated as dependent — they
        auto-start when the earlier task is marked done on the board.
      </div>
      <div className="flex gap-1.5">
        <button className="btn primary" disabled={busy} onClick={run}>
          {busy ? "spawning…" : "analyze & spawn"}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
  );
}
