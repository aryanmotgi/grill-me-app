// ---------------------------------------------------------------------------
// Session titles: a user rename (appSettings.sessionTitles, per project) wins
// over the label derived from the branch, which wins over the member name.
// Kept out of the Rust team config so renames need no backend change.
// ---------------------------------------------------------------------------

export type SessionTitles = Record<string, string>;

export function sessionTitle(
  mate: { id: string; name: string; taskLabel?: string },
  titles: unknown,
): string {
  const custom = titles && typeof titles === "object" ? (titles as SessionTitles)[mate.id] : undefined;
  return (typeof custom === "string" && custom.trim()) || mate.taskLabel || mate.name;
}

/** Next titles map after a rename; blank or unchanged-from-default clears it. */
export function withTitle(titles: unknown, id: string, title: string, fallback: string): SessionTitles {
  const next: SessionTitles = { ...((titles && typeof titles === "object" ? titles : {}) as SessionTitles) };
  const t = title.trim().slice(0, 80);
  if (!t || t === fallback) delete next[id];
  else next[id] = t;
  return next;
}
