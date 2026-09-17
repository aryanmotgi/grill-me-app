import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useApp, ptyIdFor } from "../store";
import { FEATURE_GROUPS } from "../data/features";
import { fuzzyRank, fuzzySegments } from "../lib/fuzzy";
import type { Teammate } from "../types";

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

/** Unified palette row — a teammate session or a named action. */
type Item =
  | { kind: "session"; key: string; mate: Teammate; positions: number[] }
  | { kind: "action"; key: string; action: Action; positions: number[] };

const itemKey = (i: { kind: "session" | "action"; key: string }) => `${i.kind}:${i.key}`;

/** Highlight the fuzzy-matched characters of a label in cyan (the `data` token). */
function Highlight({ text, positions }: { text: string; positions: number[] }) {
  return (
    <>
      {fuzzySegments(text, positions).map((seg, i) =>
        seg.hit ? <span key={i} className="text-data">{seg.text}</span> : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}

const RECENT_CAP = 5;

export function QuickSwitcher() {
  const {
    teammates, switcherOpen, setSwitcherOpen, setActive,
    shipSession, activeId, setPickerOpen, setSettingsOpen,
    setTheme, themeName, toggleDense, toggleFocus, setMergePilotOpen, setRailTab,
    setView, setDraftReply, patchTeammate, toast, appSettings, setAppSetting,
    setHandoffFor,
  } = useApp();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  /** inline-action index for the focused row: -1 = the row's primary select. */
  const [sub, setSub] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const coreActions: Action[] = useMemo(() => [
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
  ], [activeId, themeName, shipSession, setPickerOpen, setSettingsOpen, setTheme, toggleDense, toggleFocus, setMergePilotOpen, setRailTab]);

  const actionByLabel = useMemo(
    () => new Map(coreActions.map((a) => [a.label, a])),
    [coreActions],
  );

  // RECENT: last few chosen rows, persisted as keys in appSettings.
  const recentKeys = (appSettings.recentCommands as string[] | undefined) ?? [];
  const recordRecent = (key: string) => {
    const next = [key, ...recentKeys.filter((k) => k !== key)].slice(0, RECENT_CAP);
    setAppSetting("recentCommands", next);
  };

  // Build the visible item list. Empty query → recents first, then everything;
  // non-empty → fuzzy-ranked across sessions and actions with highlight spans.
  const { items, recentCount } = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const recent: Item[] = [];
      const seen = new Set<string>();
      for (const key of recentKeys) {
        if (key.startsWith("session:")) {
          const mate = teammates.find((t) => t.id === key.slice("session:".length));
          if (mate && !seen.has(key)) { recent.push({ kind: "session", key: mate.id, mate, positions: [] }); seen.add(key); }
        } else if (key.startsWith("action:")) {
          const action = actionByLabel.get(key.slice("action:".length));
          if (action && !seen.has(key)) { recent.push({ kind: "action", key: action.label, action, positions: [] }); seen.add(key); }
        }
      }
      const restSessions: Item[] = teammates
        .filter((t) => !seen.has(`session:${t.id}`))
        .map((mate) => ({ kind: "session", key: mate.id, mate, positions: [] }));
      const restActions: Item[] = coreActions
        .filter((a) => !seen.has(`action:${a.label}`))
        .map((action) => ({ kind: "action", key: action.label, action, positions: [] }));
      return { items: [...recent, ...restSessions, ...restActions], recentCount: recent.length };
    }

    const rankedMates = fuzzyRank(
      teammates, q, (t) => [t.name, `${t.branch} ${t.taskLabel}`],
    ).map((r): Item => ({
      kind: "session", key: r.item.id, mate: r.item,
      positions: r.fieldIndex === 0 ? r.positions : [],
    }));
    const rankedActions = fuzzyRank(
      coreActions, q, (a) => [a.label, a.hint],
    ).map((r): Item => ({
      kind: "action", key: r.item.label, action: r.item,
      positions: r.fieldIndex === 0 ? r.positions : [],
    }));
    return { items: [...rankedMates, ...rankedActions], recentCount: 0 };
  }, [query, teammates, coreActions, recentKeys, actionByLabel]);

  const total = items.length;
  const focused = items[cursor];

  useEffect(() => {
    if (switcherOpen) {
      setQuery("");
      setCursor(0);
      setSub(-1);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [switcherOpen]);

  if (!switcherOpen) return null;

  const close = () => setSwitcherOpen(false);

  // ---- session inline actions (reuse existing store handlers) --------------
  const togglePause = async (mate: Teammate) => {
    const next = !mate.paused;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("pty_pause", { id: ptyIdFor(mate.id), pause: next });
      patchTeammate(mate.id, { paused: next });
      toast(next ? `${mate.name} paused — state preserved` : `${mate.name} resumed`);
    } catch (e) {
      toast(`Pause failed: ${e}`, "warn");
    }
  };
  const dmTo = (mate: Teammate) => {
    setDraftReply({ to: mate.id, threadId: `dm-${Date.now()}`, mention: mate.id });
    setRailTab("inbox");
    setView("session");
  };
  const inlineActionsFor = (mate: Teammate): { id: string; label: string; run: () => void }[] => [
    { id: "pause", label: mate.paused ? "resume" : "pause", run: () => void togglePause(mate) },
    { id: "ship", label: "review & ship", run: () => shipSession(mate.id) },
    { id: "handoff", label: "hand off", run: () => setHandoffFor(mate.id) },
    { id: "dm", label: "DM", run: () => dmTo(mate) },
  ];

  // ---- activation ----------------------------------------------------------
  const activate = (item: Item, subIdx = -1) => {
    if (item.kind === "session") {
      const actions = inlineActionsFor(item.mate);
      if (subIdx >= 0 && actions[subIdx]) {
        recordRecent(`session:${item.mate.id}`);
        actions[subIdx].run();
        close();
        return;
      }
      recordRecent(`session:${item.mate.id}`);
      setActive(item.mate.id); // sets view + closes switcher
      return;
    }
    recordRecent(`action:${item.action.label}`);
    item.action.run();
    close();
  };

  const moveCursor = (delta: number) => {
    setCursor((c) => Math.min(Math.max(c + delta, 0), Math.max(total - 1, 0)));
    setSub(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // stop here so App's window handler doesn't also close the next overlay
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); moveCursor(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveCursor(-1); return; }
    if (e.key === "ArrowRight") {
      // reveal / step through a session row's inline actions
      if (focused?.kind === "session") {
        e.preventDefault();
        const n = inlineActionsFor(focused.mate).length;
        setSub((s) => Math.min(s + 1, n - 1));
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      if (sub >= 0) { e.preventDefault(); setSub((s) => s - 1); }
      return;
    }
    if (e.key === "Enter") {
      if (focused) activate(focused, sub);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[18vh]"
      onClick={close}
    >
      <div
        className="w-[460px] glass rounded-md shadow-2xl overflow-hidden rise"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full bg-transparent px-4 py-3 text-[13px] outline-none border-b border-line"
          placeholder="Jump to teammate or run an action…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); setSub(-1); }}
          onKeyDown={onKeyDown}
        />
        {recentCount > 0 ? <div className="px-4 pt-2 pb-1 panel-label">recent</div> : null}
        {items.map((item, i) => {
          const active = i === cursor;
          if (item.kind === "session") {
            const mate = item.mate;
            const inline = inlineActionsFor(mate);
            return (
              <div key={itemKey(item)}>
                <div
                  className={`px-4 py-2.5 flex items-center gap-2.5 cursor-pointer text-[12px] ${
                    active ? "bg-raised border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
                  }`}
                  onMouseEnter={() => { setCursor(i); setSub(-1); }}
                  onClick={() => activate(item)}
                >
                  <span className={`status-dot ${mate.status}`} />
                  <span className="font-display font-semibold">
                    <Highlight text={mate.name} positions={item.positions} />
                  </span>
                  <span className="font-mono text-faint text-[10px]"><Icon name="branch" size={10} /> {mate.branch}</span>
                  <span className="flex-1" />
                  {mate.paused ? <span className="tag">paused</span> : null}
                  <span className="text-dim text-[11px] truncate max-w-[140px]">{mate.taskLabel}</span>
                  {active && sub < 0 ? <span className="text-faint text-[10px]" title="Reveal quick actions">→</span> : null}
                </div>
                {active && sub >= 0 ? (
                  <div className="px-4 pb-2 pt-0.5 flex items-center gap-2 text-[11px]" role="group" aria-label={`${mate.name} quick actions`}>
                    <span className="text-faint text-[10px]">quick</span>
                    {inline.map((a, ai) => (
                      <button
                        key={a.id}
                        className={`btn ${ai === sub ? "active" : ""}`}
                        onMouseEnter={() => setSub(ai)}
                        onClick={(ev) => { ev.stopPropagation(); activate(item, ai); }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }
          const a = item.action;
          return (
            <div key={itemKey(item)}
              className={`px-4 py-2 flex items-center gap-2.5 cursor-pointer text-[12px] ${
                active ? "bg-raised border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
              }`}
              onMouseEnter={() => { setCursor(i); setSub(-1); }}
              onClick={() => activate(item)}>
              <span className="text-accent">›</span>
              <span><Highlight text={a.label} positions={item.positions} /></span>
              <span className="flex-1" />
              <span className="text-faint text-[10px] truncate">{a.hint}</span>
            </div>
          );
        })}
        {total === 0 ? (
          <div className="px-4 py-3 text-faint text-[12px]">No matches.</div>
        ) : null}
      </div>
    </div>
  );
}
