// ---------------------------------------------------------------------------
// Archify's map in Code Space: which part of the app (screens, API, data,
// background jobs...) each file belongs to. Archify names the source files
// behind each part; every other file joins the part whose files share the
// most of its folder path. Pure, so it's tested.
// ---------------------------------------------------------------------------

export interface ArchPart { id: string; label: string; type: string; sources: string[] }
export interface ArchLink { from: string; to: string; label?: string }
export interface ArchMap { title?: string; parts: ArchPart[]; links: ArchLink[] }

/** Parts get calm, distinct colors (ember stays the "activity" color). */
export const PART_COLORS = ["#7aa2f7", "#9ece6a", "#bb9af7", "#2ac3de", "#e0af68", "#f7768e", "#73daca", "#c0caf5", "#ff9e64", "#b4f9f8"];

/** Archify's candidate JSON → parts and links (repo-relative paths). */
export function readArchMap(raw: unknown): ArchMap | null {
  const v = raw as { title?: string; components?: unknown[]; connections?: unknown[] } | null;
  if (!v || !Array.isArray(v.components)) return null;
  const parts: ArchPart[] = v.components.flatMap((c) => {
    const x = c as { id?: string; label?: string; type?: string; sources?: { path?: string }[] };
    if (!x.id) return [];
    const sources = (x.sources ?? []).map((s) => (s.path ?? "").replace(/^\.\//, "")).filter(Boolean);
    return [{ id: x.id, label: x.label ?? x.id, type: x.type ?? "", sources }];
  });
  const links: ArchLink[] = (v.connections ?? []).flatMap((c) => {
    const x = c as { from?: string; to?: string; label?: string };
    return x.from && x.to ? [{ from: x.from, to: x.to, label: x.label }] : [];
  });
  return parts.length ? { title: v.title, parts, links } : null;
}

const dirOf = (p: string) => p.split("/").slice(0, -1);

/** The part a file belongs to: named as a source, or sharing the longest
 *  folder path with one. Files at the top (nothing in common) get none. */
export function partOf(file: string, map: ArchMap): string | null {
  let best: string | null = null;
  let bestScore = 0;
  const fd = dirOf(file);
  for (const part of map.parts) {
    for (const src of part.sources) {
      if (src === file) return part.id;
      const sd = dirOf(src);
      let n = 0;
      while (n < fd.length && n < sd.length && fd[n] === sd[n]) n++;
      if (n > bestScore) { bestScore = n; best = part.id; }
    }
  }
  return best;
}
