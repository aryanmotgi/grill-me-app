import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { fuzzyRank } from "../lib/fuzzy";
import { openProjectAt } from "../lib/addProject";
import { inside, layoutGalaxy, layoutTree, viewOf, type Placed, type SpaceEntry } from "./layout";
import { PART_COLORS, partOf, readArchMap, type ArchMap } from "./archify";
import { SpaceScene, type Glow, type Hub } from "./scene";
import "./space.css";

// ---------------------------------------------------------------------------
// Code Space: fly through the folders on your Mac and see the code in them.
//   Projects   your Grill Me projects as a galaxy (no new permissions)
//   Computer   every git repo under the folders you pick
// Click a repo or folder to fly to it; open it to see its tree. Click a file
// to read it, and Explain / Teach me. Changed today lights up what changed;
// Architecture groups the files by the part of the app they're in, from the
// repo's Archify map. Sessions glow where they work.
// ---------------------------------------------------------------------------

type Scope = "projects" | "computer";
interface Scan { root: string; nodes: (SpaceEntry & { size: number; mtime: number; repo: boolean; count: number })[]; truncated: boolean }
interface FileText { text: string; truncated: boolean; binary: boolean }

const native = () => "__TAURI_INTERNALS__" in window;
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const EMBER = "#e0793a";
const GOLD = "#f2c14e";
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function SpacePage() {
  const projects = useApp((s) => s.projects);
  const members = useApp((s) => s.members);
  const teammates = useApp((s) => s.teammates);
  const savedRoots = useApp((s) => s.appSettings.spaceRoots as string[] | undefined);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const toast = useApp((s) => s.toast);

  const [scope, setScope] = useState<Scope>("projects");
  const [root, setRoot] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [repos, setRepos] = useState<{ path: string; name: string; mtime: number }[] | null>(null);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [picking, setPicking] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Placed | null>(null);
  const [hover, setHover] = useState<Placed | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [showChanged, setShowChanged] = useState(true);
  const [arch, setArch] = useState<ArchMap | null>(null);
  const [archOn, setArchOn] = useState(false);
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<FileText | null>(null);
  const [explained, setExplained] = useState<{ mode: string; text: string } | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<SpaceScene | null>(null);

  // the scene lives as long as the page
  useEffect(() => {
    if (!host.current || !labels.current) return;
    const s = new SpaceScene(host.current, labels.current);
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
  }, []);

  // where sessions are working, and what each is waiting on
  const sessionGlow = useMemo(() => {
    const out: { path: string; glow: Glow; file?: string }[] = [];
    for (const t of teammates) {
      const m = members.find((x) => x.id === t.id);
      if (!m?.repoPath || t.missing) continue;
      const glow: Glow = t.status === "needs-input" ? "needs" : t.status === "working" ? "working" : "done";
      const f = t.currentFile && t.currentFile !== "—" ? (t.currentFile.startsWith("/") ? t.currentFile : `${m.repoPath.replace(/\/+$/, "")}/${t.currentFile}`) : undefined;
      out.push({ path: m.repoPath.replace(/\/+$/, ""), glow, file: f });
    }
    return out;
  }, [teammates, members]);
  const glowKey = sessionGlow.map((g) => `${g.path}:${g.glow}:${g.file ?? ""}`).join("|");

  // Computer: the folders to look in (asked once), then every repo in them
  useEffect(() => {
    if (scope !== "computer" || !native()) return;
    if (!savedRoots?.length) {
      void call<string[]>("space_roots").then((r) => { setSuggested(r); setPicking(r.filter((p) => !/\/(Desktop|Documents)$/.test(p))); });
      return;
    }
    setLoading(true);
    void call<{ path: string; name: string; mtime: number }[]>("space_find_repos", { roots: savedRoots })
      .then(setRepos).catch((e) => toast(`Couldn't look through your folders: ${e}`, "warn")).finally(() => setLoading(false));
  }, [scope, savedRoots, toast]);

  // a folder's tree, what changed in it today, and its Archify map
  useEffect(() => {
    setScan(null); setChanged(new Set()); setArch(null); setArchOn(false); setSel(null); setFile(null); setExplained(null);
    if (!root || !native()) return;
    setLoading(true);
    void call<Scan>("space_scan", { root, depth: 3, limit: 2500 })
      .then(setScan).catch((e) => toast(`Couldn't open that folder: ${e}`, "warn")).finally(() => setLoading(false));
    void call<string[]>("space_changes", { repo: root }).then((c) => setChanged(new Set(c))).catch(() => {});
    void call<unknown>("space_archify", { repo: root }).then((v) => setArch(readArchMap(v))).catch(() => {});
  }, [root, toast]);

  // the galaxy (projects or repos) or a folder's tree, laid out
  const placed: Placed[] = useMemo(() => {
    if (root && scan) return layoutTree(scan.nodes, scan.root);
    if (root) return [];
    const tops: SpaceEntry[] = scope === "projects"
      ? projects.map((p) => ({ path: p.path.replace(/\/+$/, ""), parent: null, name: p.name, kind: "folder" as const, repo: true }))
      : (repos ?? []).map((r) => ({ path: r.path, parent: null, name: r.name, kind: "folder" as const, repo: true, mtime: r.mtime }));
    return layoutGalaxy(tops);
  }, [root, scan, scope, projects, repos]);

  // Architecture: each file's part, and a hub above each part's files
  const parts = useMemo(() => {
    if (!archOn || !arch || !root) return null;
    const of = new Map<string, string>();
    const files = new Map<string, Placed[]>();
    for (const p of placed) {
      if (p.kind !== "file" || !inside(p.path, root)) continue;
      const id = partOf(p.path.slice(root.length + 1), arch);
      if (!id) continue;
      of.set(p.path, id);
      if (!files.has(id)) files.set(id, []);
      files.get(id)!.push(p);
    }
    const hubs: Hub[] = arch.parts.map((part, i) => {
      const fs = files.get(part.id) ?? [];
      const c = fs.length ? fs.reduce((a, f) => [a[0] + f.pos[0], a[1] + f.pos[1], a[2] + f.pos[2]], [0, 0, 0]).map((n) => n / fs.length) : [Math.cos(i) * 30, 12, Math.sin(i) * 30];
      return { id: part.id, label: part.label, color: PART_COLORS[i % PART_COLORS.length], pos: [c[0], Math.max(c[1] + 10, 8), c[2]] as [number, number, number], files: fs.map((f) => f.pos) };
    }).filter((h) => h.files.length);
    const color = new Map(hubs.map((h) => [h.id, h.color]));
    return { of, hubs, color };
  }, [archOn, arch, root, placed]);

  // hand everything to the scene
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const glow = new Map<string, Glow>();
    const editing = new Set<string>();
    for (const g of sessionGlow) {
      if (g.file) editing.add(g.file);
      // in the galaxy: the project/repo it works in; in a tree: the root and
      // the folder of the file it's on
      const target = !root ? placed.find((p) => inside(g.path, p.path))?.path : inside(g.path, root) || inside(root, g.path) ? (g.file ? g.file.split("/").slice(0, -1).join("/") : root) : undefined;
      if (target && (glow.get(target) !== "needs")) glow.set(target, g.glow);
    }
    s.setData(placed, (p) => {
      if (parts) { const id = parts.of.get(p.path); return id ? parts.color.get(id) ?? null : "#4a4658"; }
      if (editing.has(p.path)) return GOLD;
      if (showChanged && changed.has(p.path)) return EMBER;
      return null;
    }, glow);
    s.setHubs(parts?.hubs ?? [], (arch?.links ?? []).map((l) => [l.from, l.to]));
    // frame the whole thing
    const first = placed[0];
    if (first) {
      const spread = Math.max(20, ...placed.map((p) => Math.hypot(p.pos[0], p.pos[2])));
      const low = Math.min(0, ...placed.map((p) => p.pos[1]));
      s.flyTo([0, low / 2, 0], [spread * 0.7, spread * 0.75 - low * 0.2, spread * 1.05], 1100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, parts, changed, showChanged, glowKey]);

  // hover and click from the scene
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.onHover = setHover;
    s.onPick = (p) => pick(p);
  });

  const pick = (p: Placed) => {
    setSel(p);
    setFile(null);
    setExplained(null);
    scene.current?.select(p.path);
    const v = viewOf(p);
    scene.current?.flyTo(v.target, v.camera);
    if (p.kind === "file" && native()) void call<FileText>("space_read", { path: p.path }).then(setFile).catch((e) => toast(`Couldn't read it: ${e}`, "warn"));
  };

  const explain = (mode: "explain" | "teach") => {
    if (!sel) return;
    setExplaining(mode);
    void call<string>("space_explain", { path: sel.path, mode })
      .then((text) => setExplained({ mode, text }))
      .catch((e) => toast(/not found|command -v/i.test(String(e)) ? "Claude Code isn't installed, so this can't be explained." : `${e}`, "warn"))
      .finally(() => setExplaining(null));
  };

  const reveal = async (path: string) => {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path).catch(() => {});
  };

  const results = useMemo(() => (query.trim() ? fuzzyRank(placed, query, (p) => [p.name]).slice(0, 8).map((r) => r.item) : []), [placed, query]);

  // breadcrumbs: the galaxy, then each folder down to where you are
  const crumbs = useMemo(() => {
    if (!root) return [];
    const top = scope === "projects" ? projects.map((p) => p.path.replace(/\/+$/, "")) : (repos ?? []).map((r) => r.path);
    const base = top.find((t) => inside(root, t)) ?? root;
    const rest = root.slice(base.length).split("/").filter(Boolean);
    const out = [{ name: base.split("/").pop() || base, path: base }];
    rest.forEach((seg, i) => out.push({ name: seg, path: `${base}/${rest.slice(0, i + 1).join("/")}` }));
    return out;
  }, [root, scope, projects, repos]);

  const rel = (p: string) => (root && inside(p, root) ? p.slice(root.length + 1) || p.split("/").pop()! : p.replace(/^\/Users\/[^/]+/, "~"));
  const changedHere = sel?.kind === "folder" ? [...changed].filter((c) => inside(c, sel.path)).length : 0;
  const needsRoots = scope === "computer" && !savedRoots?.length;

  return (
    <div className="space-page">
      <div ref={host} className="space-canvas" />
      <div ref={labels} className="space-labels" aria-hidden />

      <header className="space-bar">
        <div className="seg">
          {(["projects", "computer"] as const).map((s) => (
            <button key={s} className={scope === s ? "on" : ""} onClick={() => { setScope(s); setRoot(null); setRepos(null); }}>
              {s === "projects" ? "Projects" : "My computer"}
            </button>
          ))}
        </div>
        <nav className="crumbs" aria-label="Where you are">
          <button onClick={() => setRoot(null)}>{scope === "projects" ? "All projects" : "All repos"}</button>
          {crumbs.map((c) => (
            <span key={c.path}><Icon name="chevron" size={9} /><button onClick={() => setRoot(c.path)}>{c.name}</button></span>
          ))}
        </nav>
        <span className="grow" />
        {root ? (
          <>
            <button className={`toggle ${showChanged ? "on" : ""}`} onClick={() => setShowChanged(!showChanged)} title="Light up the files that changed today">
              <span className="swatch" style={{ background: EMBER }} /> Changed today{changed.size ? ` · ${changed.size}` : ""}
            </button>
            <button className={`toggle ${archOn ? "on" : ""}`} disabled={!arch}
              title={arch ? "Group the files by the part of the app they belong to (from the Archify map)" : "Draw the project map on Overview first, then come back"}
              onClick={() => setArchOn(!archOn)}>
              <Icon name="layout" size={12} /> Architecture
            </button>
          </>
        ) : null}
        <div className="search">
          <Icon name="search" size={12} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Fly to…"
            onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { pick(results[0]); setQuery(""); } if (e.key === "Escape") setQuery(""); }} />
          {results.length ? (
            <div className="results">
              {results.map((r) => (
                <button key={r.path} onClick={() => { pick(r); setQuery(""); }}>
                  <Icon name={r.kind === "folder" ? "folder" : "file"} size={11} /> <span>{r.name}</span><span className="dim">{rel(r.path)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {needsRoots ? (
        <div className="space-center">
          <div className="space-card">
            <h2>Which folders hold your code?</h2>
            <p className="dim">Grill Me finds every git project in them and lays them out as a map. It only reads; nothing leaves your Mac. macOS may ask once before Grill Me can look in Desktop or Documents.</p>
            <div className="roots">
              {suggested.map((r) => (
                <label key={r}><input type="checkbox" checked={picking.includes(r)} onChange={(e) => setPicking(e.target.checked ? [...picking, r] : picking.filter((x) => x !== r))} /> {r.replace(/^\/Users\/[^/]+/, "~")}</label>
              ))}
              {picking.filter((p) => !suggested.includes(p)).map((r) => <label key={r}><input type="checkbox" checked readOnly /> {r.replace(/^\/Users\/[^/]+/, "~")}</label>)}
            </div>
            <div className="row">
              <button className="ghost" onClick={async () => {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const dir = await open({ directory: true, multiple: false }).catch(() => null);
                if (typeof dir === "string" && !picking.includes(dir)) setPicking([...picking, dir]);
              }}>Add a folder…</button>
              <span className="grow" />
              <button className="go" disabled={!picking.length} onClick={() => setAppSetting("spaceRoots", picking)}>Show my code</button>
            </div>
          </div>
        </div>
      ) : null}

      {!needsRoots && !placed.length && !loading ? (
        <div className="space-center"><p className="dim">{scope === "projects" ? "No projects yet." : root ? "Nothing to show in this folder." : "No git projects found in those folders."}</p></div>
      ) : null}
      {loading ? <div className="space-loading">Mapping…</div> : null}
      {scan?.truncated ? <div className="space-note">Showing the first {scan.nodes.length} items. Open a folder to see deeper.</div> : null}

      {hover && hover !== sel ? (
        <div className="space-hint">{hover.kind === "folder" ? (hover.repo ? "Project" : "Folder") : "File"} · {rel(hover.path)}</div>
      ) : null}

      {scope === "computer" && savedRoots?.length && !root ? (
        <button className="space-edit" onClick={() => { setPicking(savedRoots); setAppSetting("spaceRoots", []); }}>Change folders</button>
      ) : null}

      {parts ? (
        <div className="space-legend">
          {parts.hubs.map((h) => <span key={h.id}><i style={{ background: h.color }} />{h.label}</span>)}
        </div>
      ) : null}

      {sel ? (
        <aside className="space-panel">
          <div className="head">
            <Icon name={sel.kind === "folder" ? "folder" : "file"} size={14} />
            <div className="grow">
              <div className="title">{sel.name}</div>
              <div className="dim small">{rel(sel.path)}</div>
            </div>
            <button className="x" aria-label="Close" onClick={() => { setSel(null); scene.current?.select(null); }}>×</button>
          </div>
          {sel.kind === "folder" ? (
            <>
              <div className="facts">
                {sel.repo ? <span>Git project</span> : null}
                {sel.count ? <span>{sel.count} items</span> : null}
                {changedHere ? <span className="ember">{changedHere} changed today</span> : null}
                {sel.mtime ? <span>edited {ago(sel.mtime)}</span> : null}
              </div>
              <div className="actions">
                {sel.path !== root ? <button className="go" onClick={() => setRoot(sel.path)}><Icon name="folder" size={12} /> Open this folder</button> : null}
                <button onClick={() => void openProjectAt(sel.path, (m) => toast(m, "warn"))} title="Make it a Grill Me project and start a session in it"><Icon name="terminal" size={12} /> Start a session here</button>
                <button onClick={() => void reveal(sel.path)}><Icon name="eye" size={12} /> Show in Finder</button>
              </div>
            </>
          ) : (
            <>
              <div className="facts">
                {sel.size !== undefined ? <span>{size(sel.size)}</span> : null}
                {sel.mtime ? <span>edited {ago(sel.mtime)}</span> : null}
                {changed.has(sel.path) ? <span className="ember">changed today</span> : null}
                {parts?.of.get(sel.path) ? <span>{arch?.parts.find((p) => p.id === parts.of.get(sel.path))?.label}</span> : null}
              </div>
              <div className="actions">
                <button className="go" disabled={!!explaining || !file || file.binary} onClick={() => explain("explain")}><Icon name="spark" size={12} /> {explaining === "explain" ? "Reading…" : "Explain this"}</button>
                <button disabled={!!explaining || !file || file.binary} onClick={() => explain("teach")}><Icon name="bulb" size={12} /> {explaining === "teach" ? "Writing…" : "Teach me"}</button>
                <button onClick={() => void reveal(sel.path)}><Icon name="eye" size={12} /> Finder</button>
              </div>
              {explained ? <div className="explained"><Markdown text={explained.text} /></div> : null}
              {file ? (
                file.binary ? <p className="dim small pad">Not a text file.</p> : (
                  <pre className="code">
                    {file.text.split("\n").slice(0, 600).map((l, i) => <div key={i}><span className="ln">{i + 1}</span>{l || " "}</div>)}
                    {file.truncated || file.text.split("\n").length > 600 ? <div className="dim">…</div> : null}
                  </pre>
                )
              ) : <p className="dim small pad">Loading…</p>}
            </>
          )}
        </aside>
      ) : null}
    </div>
  );
}
