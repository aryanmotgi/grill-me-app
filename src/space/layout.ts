// ---------------------------------------------------------------------------
// Where everything sits in Code Space. Pure, so it's tested without a GPU.
//
// A folder's sub-folders spread on a ring around it, a level lower, each
// getting a slice of the circle sized to how much is inside it (so a big
// folder gets room). Its files hang just under it in small rings, like
// pages around a binder. The top level (your projects, or every repo found)
// is a slow spiral, so many of them fit without overlapping.
// Inspired by the spatial view in extend-hq/jevbox (MIT); our own layout.
// ---------------------------------------------------------------------------

export interface SpaceEntry {
  path: string;
  parent: string | null;
  name: string;
  kind: "folder" | "file";
  ext?: string;
  repo?: boolean;
  count?: number;
  size?: number;
  mtime?: number;
}

export interface Placed extends SpaceEntry {
  pos: [number, number, number];
  depth: number;
  /** things inside it that are shown */
  weight: number;
}

const LEVEL_DROP = 7;
const FILE_DROP = 2.6;
const FILE_GAP = 1.5;
const FIRST_FILE_RING = 1.4;
const MIN_RING = 7;

/** How far out a folder's file rings reach. */
export function fileReach(n: number): number {
  if (n <= 1) return 0;
  let left = n, k = 0;
  while (left > 0) {
    const r = FIRST_FILE_RING + k * FILE_GAP;
    left -= Math.max(4, Math.floor((2 * Math.PI * r) / FILE_GAP));
    k++;
  }
  return FIRST_FILE_RING + (k - 1) * FILE_GAP;
}

/** Files on rings under (cx, cy, cz): first ring small, outer rings wider. */
export function fileRings(n: number, cx: number, cy: number, cz: number): [number, number, number][] {
  if (n === 1) return [[cx, cy - FILE_DROP, cz]];
  const out: [number, number, number][] = [];
  let k = 0;
  while (out.length < n) {
    const r = FIRST_FILE_RING + k * FILE_GAP;
    const cap = Math.max(4, Math.floor((2 * Math.PI * r) / FILE_GAP));
    const take = Math.min(cap, n - out.length);
    for (let i = 0; i < take; i++) {
      const a = (i / take) * Math.PI * 2 + k * 0.5;
      out.push([cx + Math.cos(a) * r, cy - FILE_DROP - k * 0.45, cz + Math.sin(a) * r]);
    }
    k++;
  }
  return out;
}

/** Lay out a tree rooted at `root` (its path). Entries whose parent isn't
 *  in the list hang off the root. */
export function layoutTree(entries: SpaceEntry[], root: string): Placed[] {
  const byParent = new Map<string, SpaceEntry[]>();
  const self = entries.find((e) => e.path === root);
  const known = new Set(entries.map((e) => e.path));
  for (const e of entries) {
    if (e.path === root) continue;
    const p = e.parent && (e.parent === root || known.has(e.parent)) ? e.parent : root;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(e);
  }
  const weight = new Map<string, number>();
  const weigh = (path: string): number => {
    const kids = byParent.get(path) ?? [];
    const w = 1 + kids.reduce((s, k) => s + (k.kind === "folder" ? weigh(k.path) : 0.35), 0);
    weight.set(path, w);
    return w;
  };
  weigh(root);
  const out: Placed[] = [];
  const place = (e: SpaceEntry, pos: [number, number, number], depth: number, span: number, angle: number) => {
    out.push({ ...e, pos, depth, weight: weight.get(e.path) ?? 1 });
    const kids = byParent.get(e.path) ?? [];
    const folders = kids.filter((k) => k.kind === "folder");
    const files = kids.filter((k) => k.kind === "file");
    fileRings(files.length, pos[0], pos[1], pos[2]).forEach((p, i) => out.push({ ...files[i], pos: p, depth: depth + 1, weight: 0.35 }));
    if (!folders.length) return;
    const total = folders.reduce((s, f) => s + (weight.get(f.path) ?? 1), 0);
    const arc = depth === 0 ? Math.PI * 2 : Math.min(Math.PI * 2, span);
    // the ring sits outside this folder's own files, grows with what hangs
    // on it, and leaves room between neighbours on the arc
    const radius = Math.max(
      MIN_RING,
      fileReach(files.length) + 5,
      Math.sqrt(total) * (depth === 0 ? 4.2 : 3.4),
      (folders.length * 6.5) / arc,
    );
    let a = angle - arc / 2;
    for (const f of folders) {
      const share = ((weight.get(f.path) ?? 1) / total) * arc;
      const mid = a + share / 2;
      place(f, [pos[0] + Math.cos(mid) * radius, pos[1] - LEVEL_DROP, pos[2] + Math.sin(mid) * radius], depth + 1, Math.max(share * 1.6, Math.PI / 2), mid);
      a += share;
    }
  };
  place(self ?? { path: root, parent: null, name: root.split("/").pop() || root, kind: "folder" }, [0, 0, 0], 0, Math.PI * 2, 0);
  return out;
}

/** Many top-level folders (projects or repos) on a flat, slow spiral. */
export function layoutGalaxy(entries: SpaceEntry[]): Placed[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return entries.map((e, i) => {
    const r = 9 * Math.sqrt(i + 0.6);
    const a = i * golden;
    return { ...e, pos: [Math.cos(a) * r, Math.sin(i * 1.7) * 2.2, Math.sin(a) * r], depth: 0, weight: Math.max(1, Math.log2(2 + (e.count ?? 1))) };
  });
}

/** The point to look at and where to put the camera to see `p` and what's
 *  under it. */
export function viewOf(p: Placed): { target: [number, number, number]; camera: [number, number, number] } {
  const d = p.kind === "file" ? 7 : 14 + Math.sqrt(p.weight) * 5;
  return {
    target: [p.pos[0], p.pos[1] - (p.kind === "file" ? 0 : 3), p.pos[2]],
    camera: [p.pos[0] + d * 0.55, p.pos[1] + d * 0.6, p.pos[2] + d * 0.85],
  };
}

/** Is `path` inside folder `dir` (or the same)? */
export function inside(path: string, dir: string): boolean {
  const d = dir.replace(/\/+$/, "");
  return path === d || path.startsWith(`${d}/`);
}
