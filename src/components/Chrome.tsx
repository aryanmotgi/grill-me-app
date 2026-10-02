import { fileConflicts, useApp } from "../store";
import { teamOverlaps } from "../lib/overlap";
import { sessionTitle } from "../lib/sessionTitle";
import { Icon } from "./Icon";

/** Banner shown only when files actually overlap: two of this Mac's
 *  sessions on one file, or one of mine and a teammate's on another Mac. */
export function ConflictBanner() {
  const tasks = useApp((s) => s.tasks);
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const flashFiles = useApp((s) => s.flashFiles);
  const teamSessions = useApp((s) => s.teamSessions);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const machine = useApp((s) => (typeof s.appSettings.installId === "string" ? s.appSettings.installId : undefined));
  const selfMember = useApp((s) => s.roomSelf?.memberId);
  const conflicts = fileConflicts(tasks);
  const fresh = teamSessions.filter((d) => Date.now() - d.ts < 90_000);
  const mine = members
    .map((m) => teammates.find((t) => t.id === m.id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({ title: sessionTitle(t, titles), files: (t.changes ?? []).map((c) => c.file) }));
  const shared = teamOverlaps(mine, fresh, { machine, member: selfMember });
  if (conflicts.length === 0 && shared.length === 0) return null;

  const name = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  return (
    <button
      className="flex-none pl-[84px] pr-4 py-1.5 bg-warn/10 border-b border-warn/40 text-warn text-[11px] flex flex-wrap items-center gap-x-3 gap-y-1 cursor-pointer text-left hover:bg-warn/15 transition-colors"
      title="Two agents are changing the same files. Agree who owns them before both change them."
      onClick={() => flashFiles([...conflicts.map((c) => c.file), ...shared.map((c) => c.file)])}
    >
      <span className="font-display font-bold flex items-center gap-1.5"><Icon name="warn" size={12} /> SAME FILES</span>
      {conflicts.map((c) => (
        <span key={c.file}>
          <span className="font-mono">{c.file}</span> — {c.owners.map(name).join(" and ")}
        </span>
      ))}
      {shared.map((c) => (
        <span key={`team-${c.file}`}>
          <span className="font-mono">{c.file}</span> — your {c.mine.join(", ")} and {c.theirs.join(", ")}
        </span>
      ))}
      <span className="ml-auto text-warn/70">{shared.length ? "your agents get this warning too" : "show below"}</span>
    </button>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  // bottom-centre: bottom-right is where the native claude.ai view sits, and it draws above the page
  return (
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[340px] max-w-[90vw]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind} bg-overlay hairline rounded-sm px-3 py-2 text-[11px] shadow-xl cursor-pointer`}
          onClick={() => dismissToast(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
