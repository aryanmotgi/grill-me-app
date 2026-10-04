import { useEffect } from "react";
import { fileConflicts, useApp } from "../store";
import { teamOverlaps } from "../lib/overlap";
import { localOverlaps, note, overlapLine } from "../lib/activity";
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

/** Overlaps already in the Activity log (so an unchanged one isn't repeated). */
const noted = new Set<string>();

/** The simple layout's quiet version of the banner above: overlaps become one
 *  Activity line each. Your own sessions' get "Merge now" (Merge my sessions);
 *  a teammate's is a heads-up, and their agents are warned too. */
export function OverlapWatch() {
  const tasks = useApp((s) => s.tasks);
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const teamSessions = useApp((s) => s.teamSessions);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const machine = useApp((s) => (typeof s.appSettings.installId === "string" ? s.appSettings.installId : undefined));
  const selfMember = useApp((s) => s.roomSelf?.memberId);
  const mine = members
    .map((m) => teammates.find((t) => t.id === m.id))
    .filter((t): t is NonNullable<typeof t> => !!t && !t.missing)
    .map((t) => ({ title: sessionTitle(t, titles), files: (t.changes ?? []).map((c) => c.file) }));
  const local = localOverlaps(mine);
  const localFiles = new Set(local.map((o) => o.file));
  const nameOf = (id: string) => { const t = teammates.find((x) => x.id === id); return t ? sessionTitle(t, titles) : id; };
  const lines: { text: string; local: boolean }[] = [
    ...local.map((o) => ({ text: overlapLine(o.file, o.who), local: true })),
    ...teamOverlaps(mine, teamSessions.filter((d) => Date.now() - d.ts < 90_000), { machine, member: selfMember })
      .map((c) => ({ text: `${c.theirs.join(", ")} (a teammate) and your ${c.mine.join(", ")} are both changing ${c.file.split("/").pop()}`, local: false })),
    // the same file already reported above: don't say it twice
    ...fileConflicts(tasks).filter((c) => !localFiles.has(c.file))
      .map((c) => ({ text: `${c.owners.map(nameOf).join(" and ")} both have ${c.file.split("/").pop()} in their tasks`, local: false })),
  ];
  const sig = lines.map((l) => l.text).join("|");
  useEffect(() => {
    // say each overlap once; it can come back after it has cleared
    const now = new Set(lines.map((l) => l.text));
    for (const l of lines) if (!noted.has(l.text)) note(l.text, "warn", l.local ? "merge-sessions" : undefined);
    noted.clear();
    for (const t of now) noted.add(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
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
