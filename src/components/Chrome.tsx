import { fileConflicts, useApp } from "../store";

/** Banner shown only when two people's claimed files actually overlap. */
export function ConflictBanner() {
  const tasks = useApp((s) => s.tasks);
  const teammates = useApp((s) => s.teammates);
  const conflicts = fileConflicts(tasks);
  if (conflicts.length === 0) return null;

  const name = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="flex-none px-4 py-1.5 bg-warn/10 border-b border-warn/40 text-warn text-[11px] flex items-center gap-3">
      <span className="font-display font-bold">⚠ FILE CONFLICT</span>
      {conflicts.map((c) => (
        <span key={c.file}>
          {c.file} — claimed by {c.owners.map(name).join(" and ")}
        </span>
      ))}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[300px]">
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
