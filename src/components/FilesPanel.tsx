import { useCallback, useEffect, useState } from "react";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { Icon } from "./Icon";
import { EmptyState } from "./EmptyState";

// ---------------------------------------------------------------------------
// Files rail tab (Monocode-style right panel): a lazy file tree over the
// active member's worktree, plus an inline viewer / editor / per-file diff.
// All fs access goes through the Rust fs_* commands, which canonicalize and
// confine every path to a configured workspace root.
// ---------------------------------------------------------------------------

interface FsEntry {
  name: string;
  dir: boolean;
}

/** One directory node. Children load on first expand and stay cached until
 *  the tree refreshes (root change or manual refresh). */
function DirNode({ root, rel, name, depth, onOpenFile, openRel }: {
  root: string;
  rel: string;
  name: string;
  depth: number;
  onOpenFile: (rel: string) => void;
  openRel: string | null;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || entries !== null || !isTauri()) return;
    let alive = true;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const list = await invoke<FsEntry[]>("fs_list_dir", { root, rel });
        if (alive) setEntries(list);
      } catch (e) {
        if (alive) setErr(String(e));
      }
    })();
    return () => { alive = false; };
  }, [open, entries, root, rel]);

  return (
    <div>
      {depth > 0 ? (
        <button
          className="flex items-center gap-1 w-full text-left px-2 py-0.5 text-[11px] text-dim hover:text-ink hover:bg-raised cursor-pointer transition-colors"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen(!open)}
        >
          <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
            <Icon name="chevron" size={10} />
          </span>
          <span className="truncate">{name}</span>
        </button>
      ) : null}
      {open && err ? (
        <div className="px-2 py-1 text-[10px] text-warn" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>{err}</div>
      ) : null}
      {open && entries
        ? entries.map((e) => {
            const childRel = rel ? `${rel}/${e.name}` : e.name;
            return e.dir ? (
              <DirNode key={childRel} root={root} rel={childRel} name={e.name} depth={depth + 1}
                onOpenFile={onOpenFile} openRel={openRel} />
            ) : (
              <button
                key={childRel}
                className={`flex items-center gap-1.5 w-full text-left px-2 py-0.5 text-[11px] cursor-pointer transition-colors truncate ${
                  openRel === childRel ? "text-accent bg-raised" : "text-ink hover:bg-raised"
                }`}
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
                title={childRel}
                onClick={() => onOpenFile(childRel)}
              >
                <Icon name="file" size={10} />
                <span className="truncate">{e.name}</span>
              </button>
            );
          })
        : null}
    </div>
  );
}

type FileMode = "view" | "edit" | "diff";

export function FilesPanel() {
  const activeId = useApp((s) => s.activeId);
  const members = useApp((s) => s.members);
  const teammates = useApp((s) => s.teammates);
  const toast = useApp((s) => s.toast);
  const member = members.find((m) => m.id === activeId) ?? members[0];
  const mate = teammates.find((t) => t.id === member?.id);
  const root = member?.repoPath ?? null;

  const [openRel, setOpenRel] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [buffer, setBuffer] = useState<string>("");
  const [mode, setMode] = useState<FileMode>("view");
  const [diff, setDiff] = useState<string>("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);

  // switching sessions switches workspace root — close the open file
  useEffect(() => {
    setOpenRel(null);
    setMode("view");
    setTreeKey((k) => k + 1);
  }, [root]);

  const openFile = useCallback(async (rel: string) => {
    if (!root || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    setOpenRel(rel);
    setMode("view");
    setLoadErr(null);
    try {
      const text = await invoke<string>("fs_read_file", { root, rel });
      setContent(text);
      setBuffer(text);
    } catch (e) {
      setContent("");
      setBuffer("");
      setLoadErr(String(e));
    }
  }, [root]);

  const showDiff = useCallback(async () => {
    if (!root || !openRel || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const d = await invoke<string>("git_diff_file", { repoPath: root, file: openRel });
      setDiff(d.trim() ? d : "(no working-tree changes for this file)");
    } catch (e) {
      setDiff(String(e));
    }
    setMode("diff");
  }, [root, openRel]);

  const save = useCallback(async () => {
    if (!root || !openRel || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("fs_write_file", { root, rel: openRel, content: buffer });
      setContent(buffer);
      setMode("view");
      toast(`Saved ${openRel}`);
    } catch (e) {
      toast(`Save failed: ${e}`, "warn");
    }
  }, [root, openRel, buffer, toast]);

  // changed files (from the git feed) get a dot in the header strip
  const changedSet = new Set((mate?.changes ?? []).map((c) => c.file));

  if (!root) {
    return <EmptyState icon="folder" title="No workspace" hint="Pick or spawn a session — its worktree shows up here." compact />;
  }
  if (!isTauri()) {
    return <EmptyState icon="folder" title="Files need the native app" hint="The file explorer reads the worktree through Tauri." compact />;
  }

  const dirty = mode === "edit" && buffer !== content;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* explorer */}
      <div className={`${openRel ? "h-[38%]" : "flex-1"} min-h-0 overflow-y-auto border-b border-line`}>
        <div className="px-2 py-1.5 flex items-center justify-between sticky top-0 bg-panel z-10">
          <span className="panel-label truncate" title={root}>{root.split("/").pop()}</span>
          <button className="text-faint hover:text-ink cursor-pointer" title="Refresh tree"
            onClick={() => setTreeKey((k) => k + 1)}>
            <Icon name="swap" size={11} />
          </button>
        </div>
        <DirNode key={treeKey} root={root} rel="" name="" depth={0} onOpenFile={openFile} openRel={openRel} />
      </div>

      {/* viewer / editor / diff */}
      {openRel ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-1 px-2 py-1 border-b border-line flex-none">
            <span className="font-mono text-[10px] text-dim truncate flex-1" title={openRel}>
              {changedSet.has(openRel) ? <span className="text-warn mr-1" title="Has uncommitted changes">●</span> : null}
              {openRel}
            </span>
            <button className={`btn ${mode === "view" ? "primary" : ""}`} onClick={() => setMode("view")}>view</button>
            <button className={`btn ${mode === "edit" ? "primary" : ""}`} disabled={!!loadErr}
              onClick={() => { setBuffer(content); setMode("edit"); }}>edit</button>
            <button className={`btn ${mode === "diff" ? "primary" : ""}`} onClick={showDiff}>diff</button>
            {mode === "edit" ? (
              <button className="btn primary" disabled={!dirty} title={dirty ? "Write the buffer to disk" : "No changes"}
                onClick={save}>save</button>
            ) : null}
            <button className="text-faint hover:text-ink cursor-pointer ml-1" title="Close file"
              onClick={() => setOpenRel(null)}>
              <Icon name="cross" size={11} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {loadErr ? (
              <div className="p-3 text-[11px] text-warn">{loadErr}</div>
            ) : mode === "edit" ? (
              <textarea
                className="w-full h-full bg-term-bg text-term-ink font-mono text-[11px] leading-relaxed p-2 outline-none resize-none"
                value={buffer}
                onChange={(e) => setBuffer(e.target.value)}
                spellCheck={false}
              />
            ) : mode === "diff" ? (
              <pre className="p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre">
                {diff.split("\n").map((line, i) => (
                  <div key={i} className={
                    line.startsWith("+") && !line.startsWith("+++") ? "text-ok"
                      : line.startsWith("-") && !line.startsWith("---") ? "text-danger"
                      : line.startsWith("@@") ? "text-data"
                      : "text-dim"
                  }>{line || " "}</div>
                ))}
              </pre>
            ) : (
              <pre className="p-2 font-mono text-[11px] leading-relaxed text-ink whitespace-pre">{content}</pre>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
