import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useApp } from "../store";
import { FEATURE_GROUPS } from "../data/features";

interface Action {
  label: string;
  hint: string;
  run: () => void;
}

/** Catalog entries already covered by a core action above (dedupe by label). */
const COVERED = new Set([
  "review & ship",     // ship active session
  "projects",          // switch project
  "inbox + threads",   // go to inbox
  "standup log",       // go to activity
  "merge rotation",    // merge pilot
  "command palette",   // this palette
]);

const CATALOG_ACTIONS: Action[] = FEATURE_GROUPS
  .flatMap(([, feats]) => feats)
  .filter((f) => f.go && !COVERED.has(f.name.toLowerCase()))
  .map((f) => ({ label: f.name.toLowerCase(), hint: f.what.toLowerCase(), run: f.go! }));

export function QuickSwitcher() {
  const {
    teammates, switcherOpen, setSwitcherOpen, setActive,
    shipSession, activeId, setPickerOpen, setSettingsOpen,
    setTheme, themeName, toggleDense, toggleFocus, setMergePilotOpen, setRailTab,
  } = useApp();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = teammates.filter((t) =>
    `${t.name} ${t.branch} ${t.taskLabel}`.toLowerCase().includes(query.toLowerCase()),
  );

  const actions: Action[] = [
    { label: "ship active session", hint: "runs /ship — tests before push", run: () => shipSession(activeId) },
    { label: "switch project", hint: "open the project picker", run: () => setPickerOpen(true) },
    { label: "open settings", hint: "team, terminal, safety, sounds", run: () => setSettingsOpen(true) },
    { label: "toggle theme", hint: "ember / paperwhite", run: () => setTheme(themeName === "ember" ? "paperwhite" : "ember") },
    { label: "toggle dense mode", hint: "compact layout", run: toggleDense },
    { label: "focus mode", hint: "collapse to your pane", run: toggleFocus },
    { label: "merge pilot", hint: "run the merge in a terminal", run: () => setMergePilotOpen(true) },
    { label: "go to inbox", hint: "right rail", run: () => setRailTab("inbox") },
    { label: "go to activity", hint: "right rail", run: () => setRailTab("activity") },
    ...CATALOG_ACTIONS,
  ].filter((a) => a.label.includes(query.toLowerCase()) || a.hint.includes(query.toLowerCase()));

  const total = hits.length + actions.length;

  useEffect(() => {
    if (switcherOpen) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [switcherOpen]);

  if (!switcherOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-start justify-center pt-[18vh]"
      onClick={() => setSwitcherOpen(false)}
    >
      <div
        className="w-[420px] bg-overlay hairline rounded-md shadow-2xl overflow-hidden rise"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full bg-transparent px-4 py-3 text-[13px] outline-none border-b border-line"
          placeholder="Jump to teammate or run an action…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // stop here so App's window handler doesn't also close the next overlay
              e.stopPropagation();
              setSwitcherOpen(false);
            }
            if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, total - 1));
            if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
            if (e.key === "Enter") {
              if (cursor < hits.length && hits[cursor]) setActive(hits[cursor].id);
              else if (actions[cursor - hits.length]) {
                actions[cursor - hits.length].run();
                setSwitcherOpen(false);
              }
            }
          }}
        />
        {hits.map((t, i) => (
          <div
            key={t.id}
            className={`px-4 py-2.5 flex items-center gap-2.5 cursor-pointer text-[12px] ${
              i === cursor ? "bg-raised border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
            }`}
            onMouseEnter={() => setCursor(i)}
            onClick={() => setActive(t.id)}
          >
            <span className={`status-dot ${t.status}`} />
            <span className="font-display font-semibold">{t.name}</span>
            <span className="font-mono text-faint text-[10px]"><Icon name="branch" size={10} /> {t.branch}</span>
            <span className="flex-1" />
            <span className="text-dim text-[11px] truncate">{t.taskLabel}</span>
          </div>
        ))}
        {actions.length > 0 ? (
          <div className="px-4 pt-2 pb-1 panel-label">actions</div>
        ) : null}
        {actions.map((a, i) => (
          <div key={a.label}
            className={`px-4 py-2 flex items-center gap-2.5 cursor-pointer text-[12px] ${
              hits.length + i === cursor ? "bg-raised border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
            }`}
            onMouseEnter={() => setCursor(hits.length + i)}
            onClick={() => { a.run(); setSwitcherOpen(false); }}>
            <span className="text-accent">›</span>
            <span>{a.label}</span>
            <span className="flex-1" />
            <span className="text-faint text-[10px] truncate">{a.hint}</span>
          </div>
        ))}
        {total === 0 ? (
          <div className="px-4 py-3 text-faint text-[12px]">No matches.</div>
        ) : null}
      </div>
    </div>
  );
}
