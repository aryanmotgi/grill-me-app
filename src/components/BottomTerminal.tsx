import { useApp, ptyIdFor } from "../store";
import { XtermPane } from "./XtermPane";
import type { Teammate } from "../types";

/** Monocode-style bottom terminal: a plain shell in the ACTIVE session's
 *  worktree (own pty id — never fights the SessionPane shell tab over a
 *  stream). ⌘` or the header button toggles it. Shared by both layouts. */
export function BottomTerminal({ active }: { active: Teammate | undefined }) {
  const open = useApp((s) => s.bottomTermOpen);
  const members = useApp((s) => s.members);
  const themeName = useApp((s) => s.themeName);
  const toggle = useApp((s) => s.toggleBottomTerm);
  const member = active ? members.find((m) => m.id === active.id) : undefined;
  if (!open || !active || !member) return null;
  return (
    <div className="h-[30%] flex-none border-t border-line flex flex-col">
      <div className="flex items-center px-3 h-7 bg-panel border-b border-line">
        <span className="panel-label">terminal — {member.repoPath}</span>
        <span className="flex-1" />
        <button className="btn" onClick={toggle}>close (⌘`)</button>
      </div>
      <div className="flex-1 min-h-0">
        <XtermPane id={`${ptyIdFor(active.id)}:termpanel`} cwd={member.repoPath ?? "."} themeName={themeName} shell />
      </div>
    </div>
  );
}
