import { projectColor, projectHash } from "../lib/projectColor";

// ---------------------------------------------------------------------------
// Project icon: a thin line glyph in the same style as the app's own icons
// (16px grid, 1.4 stroke, round ends), softly tinted. Each project gets one
// glyph and one quiet color from its id (same project → same icon); a chosen
// color overrides the tint.
// ---------------------------------------------------------------------------

export const PROJECT_GLYPHS: { name: string; d: React.ReactNode }[] = [
  { name: "spark", d: <path d="M8 2.5c.55 2.9 1.6 3.95 4.5 4.5-2.9.55-3.95 1.6-4.5 4.5-.55-2.9-1.6-3.95-4.5-4.5 2.9-.55 3.95-1.6 4.5-4.5Z" /> },
  { name: "orbit", d: <><circle cx="8" cy="8" r="1.6" /><ellipse cx="8" cy="8" rx="5.6" ry="2.6" transform="rotate(-28 8 8)" /></> },
  { name: "hex", d: <path d="M8 2.2 13 5.1v5.8L8 13.8 3 10.9V5.1Z" /> },
  { name: "wave", d: <><path d="M2.5 6.2c1.4-1.6 2.7-1.6 4 0s2.6 1.6 4 0 2-1 3 0" /><path d="M2.5 10.2c1.4-1.6 2.7-1.6 4 0s2.6 1.6 4 0 2-1 3 0" /></> },
  { name: "leaf", d: <><path d="M3.2 12.8C3 7 6.5 3.4 12.8 3.2 12.6 9.5 9 13 3.2 12.8Z" /><path d="M3.2 12.8 9 7" /></> },
  { name: "cube", d: <><path d="M8 2.4 13 5v6L8 13.6 3 11V5Z" /><path d="M3 5l5 2.6L13 5M8 7.6v6" /></> },
  { name: "rings", d: <><circle cx="6.2" cy="8" r="3.4" /><circle cx="9.8" cy="8" r="3.4" /></> },
  { name: "peak", d: <path d="M2 12.8 6.3 5.2l2.4 4 1.6-2.4 3.7 6Z" /> },
  { name: "compass", d: <><circle cx="8" cy="8" r="5.6" /><path d="M10.2 5.8 9 9 5.8 10.2 7 7Z" /></> },
  { name: "layers", d: <><path d="M8 2.8 13.2 5.6 8 8.4 2.8 5.6Z" /><path d="M2.8 8.4 8 11.2l5.2-2.8M2.8 11 8 13.8l5.2-2.8" /></> },
  { name: "drop", d: <path d="M8 2.4c2.4 3 4 5.1 4 7.1a4 4 0 0 1-8 0c0-2 1.6-4.1 4-7.1Z" /> },
  { name: "nodes", d: <><circle cx="4" cy="11.5" r="1.6" /><circle cx="12" cy="11.5" r="1.6" /><circle cx="8" cy="4.2" r="1.6" /><path d="M7.2 5.6 4.8 10M8.8 5.6l2.4 4.4M5.6 11.5h4.8" /></> },
];

export function projectGlyphIndex(id: string): number {
  return projectHash(id) % PROJECT_GLYPHS.length;
}

export function ProjectIcon({ id, color, size = 16 }: { id: string; name?: string; color?: string; size?: number }) {
  const tint = color ?? projectColor(id);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="flex-none"
      fill="none" stroke={tint} strokeWidth={size >= 20 ? 1.2 : 1.4} strokeLinecap="round" strokeLinejoin="round">
      {PROJECT_GLYPHS[projectGlyphIndex(id)].d}
    </svg>
  );
}
