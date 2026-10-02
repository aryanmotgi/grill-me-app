import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { Icon } from "./Icon";
import { highlightLine, langForFile } from "../lib/highlight";

// Rendering N thousand highlighted rows is heavy; above this a file falls back
// to a plain (still line-numbered) view so a giant generated file can't jank.
const HIGHLIGHT_LINE_CAP = 4000;

/** Read-only code view: a line-number gutter + syntax-highlighted rows. */
function CodeView({ content, filename }: { content: string; filename: string }) {
  const rows = useMemo(() => {
    const lines = content.split("\n");
    const lang = lines.length > HIGHLIGHT_LINE_CAP ? null : langForFile(filename);
    return lines.map((line) => (line.length ? highlightLine(line, lang) : "&nbsp;"));
  }, [content, filename]);

  return (
    <div className="codeview font-mono text-[11px] leading-[1.5]">
      {rows.map((html, i) => (
        <div key={i} className="codeview-row">
          <span className="codeview-ln num">{i + 1}</span>
          <code className="codeview-code hljs" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monocode-style right editor pane: files opened from the Explorer / Changes
// tabs appear here as tabs, with a viewer, whole-file editor, and per-file
// diff underneath, and the file path in a footer strip. Reads/writes go
// through the workspace-confined fs_* commands.
// ---------------------------------------------------------------------------

type FileMode = "view" | "edit" | "diff";

/** `embedded`: fill the parent (the simple layout's Changes tab) instead of
 *  being its own fixed-width column. */
export function EditorPane({ embedded = false }: { embedded?: boolean } = {}) {
  const paneWidth = useApp((s) => s.panelSizes.right);
  const width = embedded ? undefined : paneWidth;
  const frame = embedded ? "flex-1 min-h-0" : "flex-none border-l border-line";
  const openFiles = useApp((s) => s.openFiles);
  const activeFile = useApp((s) => s.activeFile);
  const openFileTab = useApp((s) => s.openFile);
  const closeFile = useApp((s) => s.closeFile);
  const activeId = useApp((s) => s.activeId);
  const members = useApp((s) => s.members);
  const toast = useApp((s) => s.toast);

  const member = members.find((m) => m.id === activeId) ?? members[0];
  const root = member?.repoPath ?? null;

  const [content, setContent] = useState("");
  const [buffer, setBuffer] = useState("");
  const [mode, setMode] = useState<FileMode>("view");
  const [diff, setDiff] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const diffRequest = useApp((s) => s.diffRequest);

  // load the active file whenever it (or the workspace root) changes; a
  // pending "Review" request lands the pane straight on the diff view
  useEffect(() => {
    if (!root || !activeFile || !isTauri()) return;
    let alive = true;
    const wantDiff = diffRequest === activeFile;
    setMode("view");
    setLoadErr(null);
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const text = await invoke<string>("fs_read_file", { root, rel: activeFile });
        if (!alive) return;
        setContent(text);
        setBuffer(text);
      } catch (e) {
        if (!alive) return;
        setContent("");
        setBuffer("");
        setLoadErr(String(e));
      }
      if (wantDiff && alive) {
        try {
          const d = await invoke<string>("git_diff_file", { repoPath: root, file: activeFile });
          if (!alive) return;
          setDiff(d.trim() ? d : "(no working-tree changes for this file)");
          setMode("diff");
        } catch { /* stay on view */ }
        useApp.setState({ diffRequest: null });
      }
    })();
    return () => { alive = false; };
  }, [root, activeFile, diffRequest]);

  const showDiff = useCallback(async () => {
    if (!root || !activeFile || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const d = await invoke<string>("git_diff_file", { repoPath: root, file: activeFile });
      setDiff(d.trim() ? d : "(no working-tree changes for this file)");
    } catch (e) {
      setDiff(String(e));
    }
    setMode("diff");
  }, [root, activeFile]);

  const save = useCallback(async () => {
    if (!root || !activeFile || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("fs_write_file", { root, rel: activeFile, content: buffer });
      setContent(buffer);
      setMode("view");
      toast(`Saved ${activeFile}`);
    } catch (e) {
      toast(`Save failed: ${e}`, "warn");
    }
  }, [root, activeFile, buffer, toast]);

  const dirty = mode === "edit" && buffer !== content;

  if (openFiles.length === 0) {
    return (
      <aside style={{ width }} className={`${frame} bg-panel flex flex-col items-center justify-center gap-2`}>
        <Icon name="file" size={26} className="text-faint" />
        <p className="text-[11px] text-faint text-center px-6">
          Open a file from the Explorer or Changes tab — it shows up here.
        </p>
      </aside>
    );
  }

  return (
    <aside style={{ width }} className={`${frame} bg-panel flex flex-col overflow-hidden`}>
      {/* file tabs */}
      <div className="flex items-stretch h-8 flex-none border-b border-line overflow-x-auto">
        {openFiles.map((f) => {
          const active = f === activeFile;
          const name = f.split("/").pop();
          return (
            <div
              key={f}
              className={`group flex items-center gap-1 px-2.5 min-w-0 max-w-[160px] border-r border-line cursor-pointer transition-colors ${
                active ? "bg-bg text-ink" : "text-dim hover:text-ink hover:bg-raised"
              }`}
              title={f}
              onClick={() => openFileTab(f)}
            >
              <Icon name="file" size={10} />
              <span className="text-[11px] truncate">{name}</span>
              <button
                className="opacity-0 group-hover:opacity-100 text-faint hover:text-ink cursor-pointer flex-none"
                title={`Close ${name}`}
                onClick={(e) => { e.stopPropagation(); closeFile(f); }}
              >
                <Icon name="cross" size={9} />
              </button>
            </div>
          );
        })}
      </div>

      {/* mode strip */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-line flex-none">
        <button className={`btn ${mode === "view" ? "primary" : ""}`} onClick={() => setMode("view")}>view</button>
        <button className={`btn ${mode === "edit" ? "primary" : ""}`} disabled={!!loadErr}
          onClick={() => { setBuffer(content); setMode("edit"); }}>edit</button>
        <button className={`btn ${mode === "diff" ? "primary" : ""}`} onClick={showDiff}>diff</button>
        {mode === "edit" ? (
          <button className="btn primary" disabled={!dirty} title={dirty ? "Write the buffer to disk" : "No changes"}
            onClick={save}>save</button>
        ) : null}
      </div>

      {/* content */}
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
          <CodeView content={content} filename={activeFile ?? ""} />
        )}
      </div>

      {/* footer path — like Monocode's file footer */}
      <div className="flex-none px-2.5 py-1 border-t border-line">
        <span className="font-mono text-[9.5px] text-faint truncate block">{activeFile}</span>
      </div>
    </aside>
  );
}
