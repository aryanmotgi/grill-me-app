import { useCallback, useEffect, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { ptyIdFor, useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { clampPlayhead, scrubWindow } from "../lib/scrubback";

// How many ring lines to pull and how many to show at the playhead. The ring
// backing pty_screen is byte-capped in Rust (~48k), so this is "recent output",
// not the full session — labelled honestly below.
const PULL_LINES = 2000;
const VIEWPORT = 24;

/**
 * Session timeline scrubber: replay a session's recent terminal output by
 * dragging a playhead over the pty ring buffer. This is line-position
 * scrubbing (no timestamps in the ring) — a scrollback you can scan with a
 * slider — so it is labelled "scroll through recent output", not timed replay.
 * Reuses the existing `pty_screen` command (ANSI-stripped ring lines).
 */
export function SessionScrubber() {
  const open = useApp((s) => s.scrubberOpen);
  const teammates = useApp((s) => s.teammates);
  const activeId = useApp((s) => s.activeId);
  const modalA11y = useModalA11y("Session timeline scrubber", open);

  const [sessionId, setSessionId] = useState(activeId);
  const [lines, setLines] = useState<string[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => useApp.setState({ scrubberOpen: false }), []);

  const load = useCallback(async (id: string) => {
    if (!isTauri()) {
      setLines([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const out = await invoke<string[]>("pty_screen", {
        id: ptyIdFor(id),
        lines: PULL_LINES,
      });
      const clean = out.filter((l, i) => !(i === out.length - 1 && l.trim() === ""));
      setLines(clean);
      setPlayhead(Math.max(0, clean.length - 1)); // newest line at open
    } catch {
      setLines([]);
      setError("no recent output — this session hasn't produced any yet");
    } finally {
      setLoading(false);
    }
  }, []);

  // On open (and whenever the picked session changes) pull that ring buffer.
  // Reset the picker to the active session each time the overlay opens.
  useEffect(() => {
    if (!open) return;
    setSessionId(activeId);
  }, [open, activeId]);

  useEffect(() => {
    if (!open) return;
    void load(sessionId);
  }, [open, sessionId, load]);

  if (!open) return null;

  const max = Math.max(0, lines.length - 1);
  const pos = clampPlayhead(lines, playhead);
  const { top, bottom, window } = scrubWindow(lines, pos, VIEWPORT);
  const atNewest = lines.length === 0 || bottom >= max;

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[6vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[820px] max-w-[92vw] max-h-[84vh] flex flex-col glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-1">
          <span className="font-display font-bold text-[15px]">SESSION TIMELINE</span>
          <span className="text-faint text-[10px]">scroll through recent output</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <label className="panel-label" htmlFor="scrub-session">session</label>
          <select
            id="scrub-session"
            className="btn"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}>
            {teammates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button className="btn" onClick={() => void load(sessionId)} disabled={loading}>
            {loading ? "reading…" : "refresh"}
          </button>
        </div>

        {/* Replay viewport — the terminal state at the current playhead. */}
        <div className="flex-1 min-h-0 rounded-md border border-line bg-term-bg overflow-hidden mb-3">
          {lines.length === 0 ? (
            <div className="h-full min-h-[280px] flex items-center justify-center px-6 text-center">
              <span className="text-faint text-[11px]">
                {!isTauri()
                  ? "the ring buffer is only readable in the native app — run npm run tauri dev"
                  : error ?? "no recent output for this session"}
              </span>
            </div>
          ) : (
            <div className="h-full min-h-[280px] overflow-x-auto">
              <pre className="font-mono text-[11px] leading-[1.4] text-term-ink p-3 whitespace-pre m-0">
                {window.join("\n") || " "}
              </pre>
            </div>
          )}
        </div>

        {/* Scrubber — line position over the recent buffer. Cyan = readout. */}
        <div className="flex items-center gap-3">
          <input
            type="range"
            aria-label="scroll position through recent output"
            className="flex-1 h-1 cursor-pointer"
            style={{ accentColor: "var(--data)" }}
            min={0}
            max={max}
            value={pos}
            disabled={lines.length === 0}
            onChange={(e) => setPlayhead(Number(e.target.value))}
          />
          <span className="font-mono text-[10px] text-data num tabular-nums whitespace-nowrap">
            line {lines.length === 0 ? 0 : bottom + 1} / {lines.length}
          </span>
          <button
            className="btn"
            onClick={() => setPlayhead(max)}
            disabled={lines.length === 0 || atNewest}>
            jump to latest
          </button>
        </div>
        <div className="text-faint text-[10px] mt-2 leading-snug">
          showing lines {lines.length === 0 ? 0 : top + 1}–{lines.length === 0 ? 0 : bottom + 1} of the
          last {lines.length} lines in the ring buffer. drag to scan back through recent output;
          this is scrollback position, not a timestamped replay.
        </div>
      </div>
    </div>
  );
}
