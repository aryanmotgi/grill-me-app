import { useState } from "react";
import { useApp } from "../store";
import { SessionList } from "./SessionList";
import { DirNode } from "./FilesPanel";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Monocode-style workspace panel (second column): three tabs —
//   Sessions  — the session list (rows, reorder, spawner)
//   Explorer  — file tree over the active member's worktree; click a file
//               and it opens as a tab in the right editor pane
//   Changes   — the working-tree change list; click opens the file's diff
// ---------------------------------------------------------------------------

type WsTab = "sessions" | "explorer" | "changes";

/** Monocode-style Changes panel: commit box up top (message + ✨ AI draft +
 *  Commit — commit only, push stays a separate act), then the change list
 *  with per-file Review (diff in the editor pane) and Undo (git checkout --). */
function ChangesTab({ root, changes, activeFile, openFile }: {
  root: string | null;
  changes: { file: string; summary: string }[];
  activeFile: string | null;
  openFile: (rel: string, opts?: { diff?: boolean }) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<"" | "ai" | "commit">("");

  const run = async (what: "ai" | "commit") => {
    if (!root) return;
    setBusy(what);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (what === "ai") {
        setMsg(await invoke<string>("commit_message_ai", { repoPath: root }));
      } else {
        const out = await invoke<string>("git_commit_only", { repoPath: root, message: msg.trim() });
        setMsg("");
        toast(out);
      }
    } catch (e) {
      toast(`${what === "ai" ? "Draft" : "Commit"} failed: ${e}`, "warn");
    } finally {
      setBusy("");
    }
  };

  const undo = async (file: string) => {
    if (!root) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("git_revert_file", { repoPath: root, file });
      toast(`Reverted ${file}`);
    } catch (e) {
      toast(`Undo failed: ${e}`, "warn");
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-none px-2 pt-1 pb-2 border-b border-line flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <input
            className="flex-1 bg-raised hairline rounded-md px-2 py-1.5 text-[11px] outline-none focus:border-accent placeholder:text-faint"
            placeholder="Commit message (↵ to commit)"
            value={msg}
            disabled={busy !== ""}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && msg.trim()) run("commit"); }}
          />
          <button className="btn" disabled={busy !== "" || changes.length === 0}
            title="Draft a commit message from the diff with AI"
            onClick={() => run("ai")}>
            {busy === "ai" ? "…" : "✨"}
          </button>
        </div>
        <button
          className="w-full py-1.5 rounded-md bg-accent text-accent-ink text-[11px] font-semibold cursor-pointer hover:brightness-110 disabled:opacity-40"
          disabled={busy !== "" || !msg.trim() || changes.length === 0}
          title="git add -A && git commit (no push — ship handles that)"
          onClick={() => run("commit")}
        >
          {busy === "commit" ? "committing…" : `Commit${changes.length ? ` · ${changes.length}` : ""}`}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {changes.length === 0 ? (
          <p className="p-3 text-[11px] text-faint">Working tree clean.</p>
        ) : (
          changes.map((c) => (
            <div
              key={c.file}
              className={`group flex items-center gap-2 w-full px-3 py-1 transition-colors ${
                activeFile === c.file ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"
              }`}
            >
              <span className="font-mono text-[9px] w-3 flex-none text-warn">M</span>
              <button className="font-mono text-[10.5px] truncate flex-1 text-left cursor-pointer"
                title={`${c.file} — ${c.summary}; click to open`}
                onClick={() => openFile(c.file)}>
                {c.file}
              </button>
              <span className="font-mono text-[9px] text-faint flex-none group-hover:hidden">{c.summary}</span>
              <span className="hidden group-hover:flex items-center gap-1 flex-none">
                <button className="btn" title="Open this file's diff in the editor pane"
                  onClick={() => openFile(c.file, { diff: true })}>review</button>
                <button className="btn" title="Discard this file's working-tree changes (git checkout --)"
                  onClick={() => undo(c.file)}>undo</button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function WorkspacePanel() {
  const width = useApp((s) => s.panelSizes.left);
  const [tab, setTab] = useState<WsTab>("sessions");
  const activeId = useApp((s) => s.activeId);
  const members = useApp((s) => s.members);
  const teammates = useApp((s) => s.teammates);
  const openFile = useApp((s) => s.openFile);
  const activeFile = useApp((s) => s.activeFile);
  const [treeKey, setTreeKey] = useState(0);

  const member = members.find((m) => m.id === activeId) ?? members[0];
  const mate = teammates.find((t) => t.id === member?.id);
  const root = member?.repoPath ?? null;
  const changes = mate?.changes ?? [];

  const TABS: { id: WsTab; label: string; badge?: number }[] = [
    { id: "sessions", label: "Sessions" },
    { id: "explorer", label: "Explorer" },
    { id: "changes", label: "Changes", badge: changes.length || undefined },
  ];

  return (
    <aside style={{ width }} className="flex-none border-r border-line bg-panel flex flex-col overflow-hidden">
      <div data-tauri-drag-region className="flex items-center gap-1 h-12 pl-4 pr-2 flex-none border-b border-line">
        <span data-tauri-drag-region className="text-[15px] font-semibold text-ink flex-1">Workspace</span>
        <button className="w-8 h-8 rounded-lg flex items-center justify-center text-dim hover:text-ink hover:bg-raised cursor-pointer"
          title="Search sessions"
          onClick={() => { setTab("sessions"); requestAnimationFrame(() => document.getElementById("session-search")?.focus()); }}>
          <Icon name="search" size={15} />
        </button>
        <button className="w-8 h-8 rounded-lg flex items-center justify-center text-dim hover:text-ink hover:bg-raised cursor-pointer"
          title="New session"
          onClick={() => useApp.getState().setView("new")}>
          <Icon name="plus" size={15} />
        </button>
      </div>
      <div className="flex items-center gap-1 px-2 py-2 flex-none border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`flex-1 h-8 rounded-lg text-[13px] cursor-pointer transition-colors ${
              tab === t.id ? "bg-raised text-ink" : "text-dim hover:text-ink"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span className="ml-1.5 text-faint num">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      <div key={tab} className="tab-fade flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === "sessions" ? <SessionList /> : null}

        {tab === "explorer" ? (
          root ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-4 pt-3 pb-1.5 flex items-center justify-between sticky top-0 bg-panel z-10">
                <span className="text-[11px] tracking-[0.12em] uppercase text-faint font-semibold truncate" title={root}>{root.split("/").pop()}</span>
                <button className="w-7 h-7 rounded-md flex items-center justify-center text-faint hover:text-ink hover:bg-raised cursor-pointer"
                  title="Collapse all + refresh"
                  onClick={() => setTreeKey((k) => k + 1)}>
                  <Icon name="swap" size={13} />
                </button>
              </div>
              <DirNode key={treeKey} root={root} rel="" name="" depth={0}
                onOpenFile={(rel) => openFile(rel)} openRel={activeFile} />
            </div>
          ) : (
            <p className="p-3 text-[11px] text-faint">No workspace — pick or spawn a session.</p>
          )
        ) : null}

        {tab === "changes" ? (
          <ChangesTab root={root} changes={changes} activeFile={activeFile} openFile={openFile} />
        ) : null}
      </div>
    </aside>
  );
}
