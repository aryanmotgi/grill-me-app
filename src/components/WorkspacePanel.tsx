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
      <div className="flex items-center gap-1 px-2 pt-2 pb-1 flex-none">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`px-2.5 py-1 rounded-md text-[11px] cursor-pointer transition-colors ${
              tab === t.id ? "bg-raised text-ink" : "text-dim hover:text-ink"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span className="ml-1 text-data num">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      <div key={tab} className="tab-fade flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === "sessions" ? <SessionList /> : null}

        {tab === "explorer" ? (
          root ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-3 py-1.5 flex items-center justify-between sticky top-0 bg-panel z-10">
                <span className="panel-label truncate" title={root}>{root.split("/").pop()}</span>
                <button className="text-faint hover:text-ink cursor-pointer" title="Refresh tree"
                  onClick={() => setTreeKey((k) => k + 1)}>
                  <Icon name="swap" size={11} />
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
          <div className="flex-1 min-h-0 overflow-y-auto py-1">
            {changes.length === 0 ? (
              <p className="p-3 text-[11px] text-faint">Working tree clean.</p>
            ) : (
              changes.map((c) => (
                <button
                  key={c.file}
                  className={`flex items-center gap-2 w-full text-left px-3 py-1 cursor-pointer transition-colors ${
                    activeFile === c.file ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"
                  }`}
                  title={`${c.file} — ${c.summary}; opens in the editor pane`}
                  onClick={() => openFile(c.file)}
                >
                  <span className="font-mono text-[9px] w-3 flex-none text-warn">M</span>
                  <span className="font-mono text-[10.5px] truncate flex-1">{c.file}</span>
                  <span className="font-mono text-[9px] text-faint flex-none">{c.summary}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
