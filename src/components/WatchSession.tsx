import { useEffect, useMemo, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { ptyIdFor, useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { Icon } from "./Icon";
import { XtermPane } from "./XtermPane";
import { defaultWatchTarget, watchTargets } from "../lib/watch";
import type { PtyStatus } from "../lib/ptyReady";

type Phase = "checking" | "running" | "stopped";

/**
 * Watch overlay — shoulder-surf a teammate's live session, read-only. Pick a
 * teammate and their session streams here through the very same per-session
 * pty channel + scrollback the owner sees, but the pane is view-only: keystrokes
 * are never forwarded (XtermPane readOnly → no pty_write) regardless of the
 * teammate's permission.
 *
 * We poll pty_status to know whether their session is actually running, and only
 * mount the terminal once it's alive — so watching never spawns a session that
 * wasn't there, and a session that ends drops back to an honest empty state.
 */
export function WatchSession() {
  const open = useApp((s) => s.watchOpen);
  const watchFor = useApp((s) => s.watchFor);
  const members = useApp((s) => s.members);
  const ownId = useApp((s) => s.members[0]?.id);
  const teammates = useApp((s) => s.teammates);
  const themeName = useApp((s) => s.themeName);
  const setWatchOpen = useApp((s) => s.setWatchOpen);
  const modalA11y = useModalA11y("Watch a teammate's session", open);

  const targets = useMemo(() => watchTargets(members, ownId), [members, ownId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");

  // (Re)seed the selection whenever the overlay opens or the launcher names a
  // teammate — prefer the requested member, else the first watchable session.
  useEffect(() => {
    if (open) setSelected(defaultWatchTarget(members, ownId, watchFor));
  }, [open, watchFor, members, ownId]);

  const member = members.find((m) => m.id === selected);
  const mate = teammates.find((t) => t.id === selected);
  const ptyId = selected ? ptyIdFor(selected) : null;

  // Liveness poll: flip between running / stopped so the terminal only mounts
  // for an actually-running session (mounting XtermPane would otherwise spawn).
  useEffect(() => {
    if (!open || !ptyId || !isTauri()) return;
    let live = true;
    setPhase("checking");
    const check = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const statuses = await invoke<PtyStatus[]>("pty_status");
        if (!live) return;
        const st = statuses.find((s) => s.id === ptyId);
        setPhase(st?.alive ? "running" : "stopped");
      } catch {
        if (live) setPhase("stopped");
      }
    };
    void check();
    const t = setInterval(check, 2500);
    return () => { live = false; clearInterval(t); };
  }, [open, ptyId]);

  // xterm can capture Escape when the pane is clicked into; a capture-phase
  // listener guarantees Esc always closes the overlay (mirrors CinemaMode).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setWatchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setWatchOpen]);

  if (!open) return null;
  const close = () => setWatchOpen(false);

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[6vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[860px] max-w-[94vw] h-[80vh] flex flex-col glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-3">
          <span className="font-display font-bold text-[15px]">WATCH A SESSION</span>
          <span className="text-faint text-[10px] flex items-center gap-1">
            <Icon name="eye" size={10} /> live &amp; read-only — input is disabled
          </span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        {targets.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-faint text-[12px]">
            No teammate sessions to watch — you're the only one configured.
          </div>
        ) : (
          <>
            {/* teammate picker */}
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              {targets.map((t) => {
                const tm = teammates.find((x) => x.id === t.id);
                const on = t.id === selected;
                return (
                  <button key={t.id}
                    className={`btn ${on ? "active" : ""}`}
                    onClick={() => setSelected(t.id)}
                    title={`Watch ${t.name}'s session`}>
                    {tm ? <span className={`status-dot ${tm.status}`} /> : null}
                    {t.name}
                  </button>
                );
              })}
            </div>

            {/* terminal / state */}
            <div className="flex-1 min-h-0 rounded-sm overflow-hidden hairline bg-term-bg relative">
              {!isTauri() ? (
                <CenterNote>watching a live session needs the native app — run npm run tauri dev</CenterNote>
              ) : !member || !ptyId ? (
                <CenterNote>pick a teammate above to watch their session</CenterNote>
              ) : phase === "checking" ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center rise">
                    <div className="status-dot working mx-auto mb-2" style={{ width: 10, height: 10 }} />
                    <div className="text-dim text-[11px]">checking {mate?.name ?? member.name}'s session…</div>
                  </div>
                </div>
              ) : phase === "stopped" ? (
                <CenterNote>
                  <div className="text-dim text-[12px] mb-1">{mate?.name ?? member.name}'s session isn't running</div>
                  <div className="text-faint text-[10px]">nothing to watch yet — this updates the moment they start it</div>
                </CenterNote>
              ) : (
                // key by pty id → switching teammates remounts a fresh viewer
                <XtermPane key={ptyId} id={ptyId} cwd={member.repoPath} themeName={themeName} readOnly />
              )}
            </div>
            {member && phase === "running" ? (
              <div className="mt-2 font-mono text-[10px] text-faint flex items-center gap-2">
                <Icon name="lock" size={9} /> view-only mirror of {mate?.name ?? member.name} · {member.repoPath}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div className="text-center text-faint text-[11px]">{children}</div>
    </div>
  );
}
