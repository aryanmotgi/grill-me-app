import { useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { fmtFullTime, fmtRelTime } from "../lib/format";
import { dedupeDecisions } from "../lib/decisions";

/** Shared team decisions log — what we decided and why. An append-only,
 *  newest-first feed backed by decisions.json, written through the merge-safe
 *  id-keyed shared_upsert path so concurrent teammates never clobber. */
export function DecisionsLog() {
  const open = useApp((s) => s.decisionsOpen);
  const decisions = useApp((s) => s.decisions);
  const teammates = useApp((s) => s.teammates);
  const addDecision = useApp((s) => s.addDecision);
  const modalA11y = useModalA11y("Team decisions log", open);
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");

  if (!open) return null;
  const close = () => useApp.setState({ decisionsOpen: false });
  const authorName = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
  // dedupeDecisions guards against any raw/legacy ordering slipping through.
  const list = dedupeDecisions(decisions);

  const canLog = text.trim().length > 0;
  const log = () => {
    if (!canLog) return;
    addDecision(text, tag);
    setText("");
    setTag("");
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    // ⌘/Ctrl+Enter logs from the text field without leaving the keyboard.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); log(); }
  };

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[6vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[620px] max-w-[94vw] max-h-[86vh] flex flex-col glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">DECISIONS LOG</span>
          <span className="text-faint text-[10px]">what we decided and why — shared with the team</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        {/* composer — one primary action per surface (log) */}
        <textarea
          className="w-full h-20 bg-raised hairline rounded-sm p-2 text-[12px] resize-none outline-none focus:border-accent mb-2"
          placeholder="what did we decide, and why? e.g. Chose SQLite over Postgres — single-file, no server to run in dev"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <div className="flex items-center gap-2 mb-5">
          <input
            className="bg-raised hairline rounded-sm px-2 py-1 text-[11px] font-mono outline-none focus:border-accent w-40"
            placeholder="tag (optional)"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="flex-1" />
          <span className="text-faint text-[10px]">⌘↵ to log</span>
          <button className="btn primary" disabled={!canLog} onClick={log}>log decision</button>
        </div>

        {/* newest-first feed */}
        <div className="panel-label mb-2">
          {list.length > 0 ? `${list.length} decision${list.length === 1 ? "" : "s"}` : "log"}
        </div>
        {list.length === 0 ? (
          <div className="text-faint text-[11px] leading-relaxed py-8 text-center">
            No decisions logged yet. The first one you log is shared with the whole team.
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-0.5">
            {list.map((d) => (
              <div key={d.id} className="hairline rounded-md bg-panel/60 p-2.5">
                <div className="text-[12px] leading-snug whitespace-pre-wrap">{d.text}</div>
                <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                  <span className="text-data font-semibold">{authorName(d.author)}</span>
                  {d.tag ? <span className="tag">{d.tag}</span> : null}
                  <span className="flex-1" />
                  <span className="text-faint tabular-nums" title={fmtFullTime(d.epochMs)}>
                    {fmtRelTime(d.epochMs)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
