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

type PaneTab = "terminal" | "shell" | "changes";

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
      ) : (
        <div className="flex-1 overflow-y-auto p-3 bg-panel">
          <div className="panel-label mb-2">working tree — {mate.branch}</div>
          {mate.changes.length === 0 ? (
            <div className="text-faint text-[11px]">No uncommitted changes.</div>
          ) : (
            mate.changes.map((c) => (
              <div key={c.file} className="flex items-center gap-2 py-1.5 text-[11px]">
                <span className="font-mono text-ink text-[10px] truncate">{c.file}</span>
                <span className="text-faint">{c.summary}</span>
                <span className="flex-1" />
                <button className="btn" onClick={() => revertChange(mate.id, c.file)}>revert</button>
              </div>
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
