import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { useModalA11y } from "../hooks/useModalA11y";
import { searchSessions, splitMatch, totalMatches } from "../lib/crossSearch";
import { Icon } from "./Icon";

/** A single terminal line with the query runs highlighted in cyan. */
function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatch(text, query).map((seg, i) =>
        seg.hit ? (
          <span key={i} className="text-data">{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Cross-session search: one query box over every live session's terminal tail
 * (the same stripped output the pty feed keeps in `teammate.terminal` — no
 * refetch). Results group per session with the matching line + one line of
 * context each way; clicking a hit activates that session and closes.
 */
export function CrossSessionSearch() {
  const open = useApp((s) => s.crossSearchOpen);
  const teammates = useApp((s) => s.teammates);
  const setActive = useApp((s) => s.setActive);
  const modalA11y = useModalA11y("Search across all sessions", open);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const groups = useMemo(() => searchSessions(teammates, query), [teammates, query]);
  const total = totalMatches(groups);

  if (!open) return null;
  const close = () => useApp.setState({ crossSearchOpen: false });
  const jump = (id: string) => { setActive(id); close(); };

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[720px] max-h-[82vh] flex flex-col glass rounded-md shadow-2xl rise outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 pt-4 pb-3">
          <span className="font-display font-bold text-[15px]">SEARCH ALL SESSIONS</span>
          {query.trim() ? (
            <span className="text-[11px] text-dim">
              <span className="num text-data">{total}</span> match{total === 1 ? "" : "es"} in{" "}
              <span className="num text-data">{groups.length}</span> session{groups.length === 1 ? "" : "s"}
            </span>
          ) : null}
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        <div className="flex items-center gap-2 px-5 pb-3">
          <span className="text-faint"><Icon name="search" size={13} /></span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint border-b border-line py-1.5"
            placeholder="Search every session's terminal output…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); close(); }
            }}
          />
        </div>

        <div className="min-h-0 overflow-y-auto px-5 pb-4">
          {!query.trim() ? (
            <div className="py-10 text-center text-[12px] text-faint">
              Type to search across every session's terminal output at once.
            </div>
          ) : groups.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-faint">
              No matches for “{query.trim()}” in any session.
            </div>
          ) : (
            groups.map(({ mate, hits }) => (
              <section key={mate.id} className="mb-4 last:mb-0">
                <button
                  className="flex items-center gap-2 w-full text-left mb-1.5 group"
                  onClick={() => jump(mate.id)}>
                  <span className={`status-dot ${mate.status}`} />
                  <span className="font-display font-semibold text-[12px] group-hover:text-accent">{mate.name}</span>
                  <span className="font-mono text-faint text-[10px]"><Icon name="branch" size={10} /> {mate.branch}</span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-dim">
                    <span className="num text-data">{hits.length}</span> hit{hits.length === 1 ? "" : "s"}
                  </span>
                </button>
                <div className="border-l border-line/60 pl-3 space-y-1.5">
                  {hits.map((h) => (
                    <button
                      key={h.index}
                      title={`Open ${mate.name}`}
                      onClick={() => jump(mate.id)}
                      className="block w-full text-left font-mono text-[11px] leading-snug border-l-2 border-l-transparent hover:border-l-accent hover:bg-raised/60 pl-2 -ml-2 py-0.5 rounded-sm transition-colors">
                      {h.before !== undefined ? (
                        <div className="text-faint truncate">{h.before}</div>
                      ) : null}
                      <div className="text-dim truncate">
                        <Highlighted text={h.text} query={query} />
                      </div>
                      {h.after !== undefined ? (
                        <div className="text-faint truncate">{h.after}</div>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
