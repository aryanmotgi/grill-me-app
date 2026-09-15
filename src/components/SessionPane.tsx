import { useMemo, useState } from "react";
import { useApp } from "../store";
import type { Teammate } from "../types";

function highlight(text: string, query: string) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

type PaneTab = "output" | "changes";

export function SessionPane({ mate }: { mate: Teammate }) {
  const { searchQuery, toggleRecording, revertChange, quickCommit } = useApp();
  const [tab, setTab] = useState<PaneTab>("output");
  /** scrollback: 0 = live tail; >0 = replaying older output */
  const [scrollback, setScrollback] = useState(0);

  const visible = useMemo(
    () =>
      scrollback > 0
        ? mate.terminal.slice(0, Math.max(1, mate.terminal.length - scrollback))
        : mate.terminal,
    [mate.terminal, scrollback],
  );

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-term-bg">
      {/* pane header */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-line bg-panel flex-none">
        <span className={`status-dot ${mate.status}`} />
        <span className="font-display font-semibold text-[12px]">{mate.name}</span>
        <span className="font-mono text-faint text-[10px]">⎇ {mate.branch}</span>
        <span className="tag">{mate.usage.model}</span>
        {mate.recording ? <span className="tag danger">● rec</span> : null}
        <span className="flex-1" />
        <div className="flex demo-hide">
          <button className={`btn ${tab === "output" ? "active" : ""}`} onClick={() => setTab("output")}>output</button>
          <button className={`btn ${tab === "changes" ? "active" : ""} ml-1`} onClick={() => setTab("changes")}>
            changes {mate.changes.length}
          </button>
          <button
            className={`btn ml-1 ${mate.recording ? "active" : ""}`}
            onClick={() => toggleRecording(mate.id)}
            title="Log full session output to file"
          >
            {mate.recording ? "stop rec" : "rec"}
          </button>
        </div>
      </div>

      {tab === "output" ? (
        <>
          <div className="term flex-1 overflow-y-auto px-4 py-3">
            {visible.map((line, i) => (
              <div key={i} className={`line ${line.kind}`}>
                {highlight(line.text, searchQuery)}
              </div>
            ))}
            {scrollback === 0 && mate.status === "working" ? (
              <div className="line caret" />
            ) : null}
            {scrollback > 0 ? (
              <div className="text-faint text-[11px] mt-2">
                — replaying, {scrollback} line(s) behind live —
              </div>
            ) : null}
          </div>
          {/* scrollback / replay controls */}
          <div className="flex items-center gap-2 px-3 h-8 border-t border-line bg-panel flex-none demo-hide">
            <span className="panel-label">scrollback</span>
            <input
              type="range"
              min={0}
              max={mate.terminal.length - 1}
              value={scrollback}
              onChange={(e) => setScrollback(Number(e.target.value))}
              className="w-40 accent-(--accent)"
              style={{ direction: "rtl" }}
            />
            <span className="text-faint text-[10px]">
              {scrollback === 0 ? "live" : `-${scrollback}`}
            </span>
            <span className="flex-1" />
            <span className="text-faint text-[10px]">{mate.usage.permissionMode}</span>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="panel-label mb-2">rollback log — {mate.branch}</div>
          {mate.changes.length === 0 ? (
            <div className="text-faint text-[11px]">No uncommitted changes.</div>
          ) : (
            mate.changes.map((c) => (
              <div key={c.file} className="flex items-center gap-2 py-1.5 text-[11px]">
                <span className="font-mono text-ink text-[10px] truncate">{c.file}</span>
                <span className="text-faint truncate">{c.summary}</span>
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
