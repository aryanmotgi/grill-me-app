import { useState } from "react";
import { useApp } from "../store";
import { sessionTitle, withTitle } from "../lib/sessionTitle";

// ---------------------------------------------------------------------------
// A session's title, renamable in place: double-click to edit, Enter/blur
// saves, Esc cancels. Clearing it restores the default (branch label / name). Saved per project in appSettings.sessionTitles.
// ---------------------------------------------------------------------------

export function EditableTitle({ mate, className = "" }: {
  mate: { id: string; name: string; taskLabel?: string };
  className?: string;
}) {
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const title = sessionTitle(mate, titles);
  const fallback = sessionTitle(mate, {});

  const start = () => { setDraft(title); setEditing(true); };
  const save = () => {
    setEditing(false);
    const cur = useApp.getState().appSettings.sessionTitles;
    setAppSetting("sessionTitles", withTitle(cur, mate.id, draft, fallback));
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={80}
        aria-label="Session name"
        className={`${className} bg-raised rounded px-1 -mx-1 outline-none ring-1 ring-line focus:ring-accent min-w-0 w-full`}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={save}
      />
    );
  }
  return (
    <span
      className={`${className} truncate`}
      title={`${title} — double-click to rename`}
      onDoubleClick={(e) => { e.stopPropagation(); start(); }}
    >
      {title}
    </span>
  );
}
