import { useState } from "react";
import { Icon } from "./Icon";
import { ptyIdFor, useApp } from "../store";

async function shipRaw(memberId: string, data: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  invoke("pty_write", { id: ptyIdFor(memberId), data }).catch(() => {});
}
import type { Teammate } from "../types";
import { XtermPane } from "./XtermPane";
import { useState as usePrState } from "react";
import { isTauri } from "../data/sources/git";

function PrDraft({ repoPath }: { repoPath?: string }) {
  const [busy, setBusy] = usePrState(false);
  const [draft, setDraft] = usePrState("");
  const run = async () => {
    if (!repoPath || !isTauri()) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setDraft(await invoke<string>("pr_draft", { repoPath }));
    } catch (e) {
      setDraft(`draft failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn" disabled={busy} onClick={run}>
        {busy ? "drafting…" : "draft PR body"}
      </button>
      {draft ? (
        <textarea
          readOnly
          className="w-full h-40 mt-2 bg-raised hairline rounded-sm p-2 font-mono text-[10px] outline-none"
          value={draft}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
    </>
  );
}

type PaneTab = "terminal" | "shell" | "changes" | "audit";

function ChangeRow({ file, summary, repoPath, onRevert }: {
  file: string; summary: string; repoPath?: string; onRevert: () => void;
}) {
  const [diff, setDiff] = usePrState<string | null>(null);
  const peek = async () => {
    if (diff !== null) return setDiff(null);
    if (!repoPath || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const d = await invoke<string>("git_diff_file", { repoPath, file }).catch((e) => `diff failed: ${e}`);
    setDiff(d || "(new file or no diff)");
  };
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 text-[11px]">
        <button className="font-mono text-ink text-[10px] truncate cursor-pointer hover:text-accent text-left"
          onClick={peek} title="Click for inline diff">
          {file}
        </button>
        <span className="text-faint">{summary}</span>
        <span className="flex-1" />
        <button className="btn" onClick={onRevert}>revert</button>
      </div>
      {diff !== null ? (
        <pre className="mt-1 max-h-56 overflow-auto bg-term-bg rounded-sm p-2 font-mono text-[9px] text-term-ink whitespace-pre-wrap">{diff}</pre>
      ) : null}
    </div>
  );
}

function AuditView({ memberId }: { memberId: string }) {
  const [lines, setLines] = usePrState<{ ts: number; tool: string; detail: string }[]>([]);
  const load = async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string[]>("audit_tail", { member: memberId }).catch(() => [] as string[]);
    setLines(raw.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
  };
  useAuditEffect(load, memberId);
  return (
    <div className="flex-1 overflow-y-auto p-3 bg-panel">
      <div className="panel-label mb-2">audit log — every executed tool call</div>
      {lines.length === 0 ? (
        <div className="text-faint text-[11px]">No tool calls recorded yet for this session.</div>
      ) : (
        lines.slice().reverse().map((l, i) => (
          <div key={i} className="flex gap-2 py-1 text-[10px] font-mono">
            <span className="text-faint tabular-nums flex-none">
              {new Date(l.ts * 1000).toTimeString().slice(0, 8)}
            </span>
            <span className="text-accent flex-none w-14">{l.tool}</span>
            <span className="text-dim truncate">{l.detail}</span>
          </div>
        ))
      )}
    </div>
  );
}

import { useEffect as useAuditEffectBase } from "react";
function useAuditEffect(load: () => void, memberId: string) {
  useAuditEffectBase(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);
}

export function SessionPane({ mate }: { mate: Teammate }) {
  const { toggleRecording, revertChange, shipSession, members, themeName } = useApp();
  const [tab, setTab] = useState<PaneTab>("terminal");
  const member = members.find((m) => m.id === mate.id);

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-term-bg">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-line bg-panel flex-none">
        <span className={`status-dot ${mate.status}`} />
        <span className="font-display font-semibold text-[12px]">{mate.name}</span>
        <span className="font-mono text-faint text-[10px]"><Icon name="branch" size={11} /> {mate.branch}</span>
        {mate.recording ? <span className="tag danger"><Icon name="record" size={9} /> rec</span> : null}
        {mate.terminal.some((l) => l.text.includes("need authentication")) ? (
          <button className="tag warn cursor-pointer" title="MCP servers need auth — click to run /mcp in this session"
            onClick={() => shipRaw(mate.id, "/mcp\n")}>
            <Icon name="warn" size={9} /> mcp auth
          </button>
        ) : null}
        <span className="flex-1" />
        <div className="flex demo-hide">
          <button className={`btn ${tab === "terminal" ? "active" : ""}`} onClick={() => setTab("terminal")}>
            terminal
          </button>
          <button className={`btn ${tab === "shell" ? "active" : ""} ml-1`} onClick={() => setTab("shell")}>
            shell
          </button>
          <button className={`btn ${tab === "changes" ? "active" : ""} ml-1`} onClick={() => setTab("changes")}>
            changes {mate.changes.length}
          </button>
          <button className={`btn ${tab === "audit" ? "active" : ""} ml-1`} onClick={() => setTab("audit")}>
            audit
          </button>
          <button
            className={`btn ml-1 ${mate.recording ? "active" : ""}`}
            onClick={() => toggleRecording(mate.id)}
            title="Log raw session output to ~/.grillme/recordings"
          >
            {mate.recording ? "stop rec" : "rec"}
          </button>
        </div>
      </div>

      {tab === "terminal" || tab === "shell" ? (
        member ? (
          <div className="flex-1 min-h-0">
            <XtermPane
              key={tab}
              id={tab === "shell" ? `${ptyIdFor(mate.id)}:shell` : ptyIdFor(mate.id)}
              cwd={member.repoPath}
              themeName={themeName}
              shell={tab === "shell"}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-faint text-[11px]">
            no worktree configured for this session
          </div>
        )
      ) : tab === "audit" ? (
        <AuditView memberId={mate.id} />
      ) : (
        <div className="flex-1 overflow-y-auto p-3 bg-panel">
          <div className="panel-label mb-2">working tree — {mate.branch}</div>
          {mate.changes.length === 0 ? (
            <div className="text-faint text-[11px]">No uncommitted changes.</div>
          ) : (
            mate.changes.map((c) => (
              <ChangeRow key={c.file} file={c.file} summary={c.summary}
                repoPath={member?.repoPath} onRevert={() => revertChange(mate.id, c.file)} />
            ))
          )}
          <div className="flex gap-2 mt-3">
            <button className="btn primary" title="Runs the team workflow: tests, review, push — inside this session"
              onClick={() => shipSession(mate.id)}>
              /ship
            </button>
            <PrDraft repoPath={member?.repoPath} />
          </div>
        </div>
      )}
    </section>
  );
}
