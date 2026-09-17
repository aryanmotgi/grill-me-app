import { ptyIdFor, useApp } from "../store";
import type { Teammate } from "../types";
import { XtermPane } from "./XtermPane";

/**
 * Cinema mode — full immersion. The active session's live terminal fills the
 * whole window; every chrome surface (top bar, session list, right rail,
 * attention rail) is gone. A subtle accent/lineglow rim frames the pane and a
 * small "esc to exit cinema" pill floats top-right, fading after a beat.
 *
 * This renders in place of the normal shell (App returns it early when
 * cinemaOpen), so the ordinary SessionPane terminal is unmounted while cinema
 * is up — only one XtermPane is ever attached to a given pty, and each mount
 * fits fresh to its container (the pty cols/rows resize on enter and exit).
 */
export function CinemaMode({ mate, themeName }: { mate: Teammate; themeName: string }) {
  const member = useApp((s) => s.members.find((m) => m.id === mate.id));
  const setCinemaOpen = useApp((s) => s.setCinemaOpen);

  return (
    <div className="fixed inset-0 z-30 bg-term-bg">
      <div className="absolute inset-0">
        {member ? (
          <XtermPane
            id={ptyIdFor(mate.id)}
            cwd={member.repoPath}
            themeName={themeName}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-faint text-[11px]">
            no worktree configured for this session
          </div>
        )}
      </div>
      {/* ambient glow rim — sits above the terminal but never eats its input */}
      <div className="cinema-glow absolute inset-0 pointer-events-none" aria-hidden />
      <button
        className="cinema-exit"
        onClick={() => setCinemaOpen(false)}
        title="Leave cinema mode"
      >
        <span className="cinema-kbd">esc</span> to exit cinema
      </button>
    </div>
  );
}
