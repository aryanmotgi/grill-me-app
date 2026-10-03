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
  // "—" is the placeholder for "no task yet", never a title
  const label = mate.taskLabel && !/^[\s—–-]*$/.test(mate.taskLabel) ? mate.taskLabel : "";
  return (typeof custom === "string" && custom.trim()) || label || mate.name;
}

/** Next titles map after a rename; blank or unchanged-from-default clears it. */
export function withTitle(titles: unknown, id: string, title: string, fallback: string): SessionTitles {
  const next: SessionTitles = { ...((titles && typeof titles === "object" ? titles : {}) as SessionTitles) };
  const t = title.trim().slice(0, 80);
  if (!t || t === fallback) delete next[id];
  else next[id] = t;
  return next;
}

/** Openers that say nothing about the work ("go ahead with it, but…"). */
const FILLER = /^(go ahead( with it)?|yes|yep|sure|ok(ay)?|do it|sounds good|great|perfect|thanks|thank you|next|also|and|but|then)\b[\s,.:;!-]*/i;
/** Headings that introduce a list instead of naming the work. */
const META = /^((two|three|four|a few|some|couple of) things|small (polish|fixes|changes)|quick (fix|fixes|changes|ones?)|follow[- ]?ups?|todo|tasks?)\b/i;

/** A short title from what you asked: "can you please add seasons to the
 *  farm, cycling every 60s" → "Add seasons to the farm". Skips go-aheads and
 *  list headings ("two things:") in favour of the first real task. */
export function titleFromAsk(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items = lines.filter((l) => /^(\d+[.)]|[-*•])\s/.test(l)).map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, ""));
  const clean = (raw: string) => {
    let t = raw;
    for (let i = 0; i < 3; i++) {
      t = t.replace(/^(hey|hi|so|now|please|pls|can you|could you|would you|i want you to|i'd like you to|let's|lets)[\s,:]+/i, "").replace(FILLER, "");
    }
    return t.split(/(?<=[.!?])\s|[,:;]\s| and then /i)[0].replace(/[.!?:]+$/, "").trim();
  };
  const head = lines.find((l) => !/^(\d+[.)]|[-*•])\s/.test(l)) ?? "";
  let t = clean(head);
  // a heading for a list ("…:"), a list heading word, or nothing left after
  // the go-ahead: name it after the first task
  if ((!t || /:\s*$/.test(head) || META.test(t) || t.split(/\s+/).length < 2) && items[0]) t = clean(items[0]);
  if (t.length > 42) t = t.slice(0, 42).replace(/\s+\S*$/, "") + "…";
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
