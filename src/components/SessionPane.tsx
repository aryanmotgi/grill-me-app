import { useState } from "react";
import { Icon } from "./Icon";
import { useApp } from "../store";
import type { Teammate } from "../types";
import { XtermPane } from "./XtermPane";

type PaneTab = "terminal" | "changes";

export function SessionPane({ mate }: { mate: Teammate }) {
  const { toggleRecording, revertChange, quickCommit, members, themeName } = useApp();
  const [tab, setTab] = useState<PaneTab>("terminal");
  const member = members.find((m) => m.id === mate.id);

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-term-bg">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-line bg-panel flex-none">
        <span className={`status-dot ${mate.status}`} />
        <span className="font-display font-semibold text-[12px]">{mate.name}</span>
        <span className="font-mono text-faint text-[10px]"><Icon name="branch" size={11} /> {mate.branch}</span>
        {mate.recording ? <span className="tag danger"><Icon name="record" size={9} /> rec</span> : null}
        <span className="flex-1" />
        <div className="flex demo-hide">
          <button className={`btn ${tab === "terminal" ? "active" : ""}`} onClick={() => setTab("terminal")}>
            terminal
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

      {tab === "terminal" ? (
        member ? (
          <div className="flex-1 min-h-0">
            <XtermPane id={mate.id} cwd={member.repoPath} themeName={themeName} />
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
          <button className="btn primary mt-3" onClick={() => quickCommit(mate.id)}>
            commit + push all
          </button>
        </div>
      )}
    </section>
  );
}
