import { useEffect, useMemo, useRef, useState } from "react";
import { ptyIdFor, useApp } from "../store";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { fuzzyRank } from "../lib/fuzzy";
import { openProjectAt } from "../lib/addProject";
import { sendToSession } from "../lib/ptyReady";
import { sessionTitle } from "../lib/sessionTitle";
import { visibleSessions } from "../lib/sessionNav";
import { inside, layoutGalaxy, layoutTree, viewOf, type Placed, type SpaceEntry } from "./layout";
import { PART_COLORS, partOf, readArchMap, type ArchMap } from "./archify";
import { live, meter, meterLine, readState, type LiveSession } from "./lenses";
import { SpaceScene, type Glow, type Hub, type Marker } from "./scene";
import "./space.css";

// ---------------------------------------------------------------------------
// Code Space: your project's living map. It opens on the project you're in
// and answers four questions, one lens each:
//   Live           where are my agents right now, what has each changed, and
//                  where could their work collide?
//   Changes        what changed today?
//   Understanding  of what my agents changed this week, what have I actually
//                  read? (Explain next walks you through the rest)
//   Architecture   how does the app fit together? (the Archify map)
// Click a file to read it, explain it, mark it read, or tell a session about
// it. "All projects" and "My computer" fly between repos.
// ---------------------------------------------------------------------------

type Scope = "project" | "projects" | "computer";
type Lens = "live" | "changes" | "understand" | "arch";
interface Scan { root: string; nodes: (SpaceEntry & { size: number; mtime: number; repo: boolean; count: number })[]; truncated: boolean }
interface FileText { text: string; truncated: boolean; binary: boolean }

const native = () => "__TAURI_INTERNALS__" in window;
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const EMBER = "#e0793a";
const GOLD = "#f2c14e";
const RED = "#f7768e";
const GREEN = "#4fbf87";
const DIM = "#4a4760";
const LENSES: { id: Lens; label: string; hint: string }[] = [
  { id: "live", label: "Live", hint: "Where your sessions are and what each changed" },
  { id: "changes", label: "Changes", hint: "What changed today" },
  { id: "understand", label: "Understanding", hint: "What your agents changed this week, and what you've read" },
  { id: "arch", label: "Architecture", hint: "How the app fits together, from its Archify map" },
];
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const trim = (p: string) => p.replace(/\/+$/, "");

export function SpacePage() {
  const projects = useApp((s) => s.projects);
  const activeProject = useApp((s) => s.activeProject);
  const members = useApp((s) => s.members);
  const teammates = useApp((s) => s.teammates);
  const appMode = useApp((s) => s.appMode);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const savedRoots = useApp((s) => s.appSettings.spaceRoots as string[] | undefined);
  const understoodAll = useApp((s) => s.appSettings.understood as Record<string, Record<string, number>> | undefined);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const toast = useApp((s) => s.toast);

  // the project you're in: its folder, or the main session's
  const home = useMemo(() => {
    const p = projects.find((x) => x.id === activeProject);
    return trim(p?.path ?? members[0]?.repoPath ?? "");
  }, [projects, activeProject, members]);

  const [scope, setScope] = useState<Scope>("project");
  const [root, setRoot] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("live");
  const [scan, setScan] = useState<Scan | null>(null);
  const [repos, setRepos] = useState<{ path: string; name: string; mtime: number }[] | null>(null);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [picking, setPicking] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Placed | null>(null);
  const [hover, setHover] = useState<Placed | null>(null);
  const [today, setToday] = useState<Set<string>>(new Set());
  const [week, setWeek] = useState<string[]>([]);
  const [arch, setArch] = useState<ArchMap | null>(null);
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<FileText | null>(null);
  const [explained, setExplained] = useState<{ mode: string; text: string } | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteTo, setNoteTo] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<SpaceScene | null>(null);
  const framed = useRef("");

  // this project opens right away
  useEffect(() => { if (scope === "project" && home) setRoot(home); }, [scope, home]);

  // the scene lives as long as the page
  useEffect(() => {
    if (!host.current || !labels.current) return;
    const s = new SpaceScene(host.current, labels.current);
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
  }, []);

  // sessions of this project, as the Live lens sees them
  const sessions: LiveSession[] = useMemo(() => {
    const ids = members.map((m) => m.id);
    return visibleSessions(teammates, appMode, ids).filter((t) => !t.missing).flatMap((t) => {
      const m = members.find((x) => x.id === t.id);
      if (!m?.repoPath) return [];
      return [{ id: t.id, title: sessionTitle(t, titles), status: t.status, folder: trim(m.repoPath), current: t.currentFile, changed: t.changes.map((c) => c.file) }];
    });
  }, [teammates, members, appMode, titles]);
  const liveView = useMemo(() => live(sessions), [sessions]);
  const liveKey = sessions.map((s) => `${s.id}:${s.status}:${s.current}:${s.changed.length}`).join("|");

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

  // a folder's tree, its changes today and this week, and its Archify map
  useEffect(() => {
    setScan(null); setToday(new Set()); setWeek([]); setArch(null); setSel(null); setFile(null); setExplained(null);
    if (!root || !native()) return;
    setLoading(true);
    void call<Scan>("space_scan", { root, depth: 4, limit: 3000 })
      .then(setScan).catch((e) => toast(`Couldn't open that folder: ${e}`, "warn")).finally(() => setLoading(false));
    const loadChanges = () => {
      void call<string[]>("space_changes", { repo: root, days: 0 }).then((c) => setToday(new Set(c))).catch(() => {});
      void call<string[]>("space_changes", { repo: root, days: 7 }).then(setWeek).catch(() => {});
    };
    loadChanges();
    void call<unknown>("space_archify", { repo: root }).then((v) => setArch(readArchMap(v))).catch(() => {});
    // what changed keeps changing while agents work
    const t = setInterval(loadChanges, 20_000);
    return () => clearInterval(t);
  }, [root, toast]);

  // the galaxy (projects or repos) or a folder's tree, laid out
  const placed: Placed[] = useMemo(() => {
    if (root && scan) return layoutTree(scan.nodes, scan.root);
    if (root) return [];
    const tops: SpaceEntry[] = scope === "computer"
      ? (repos ?? []).map((r) => ({ path: r.path, parent: null, name: r.name, kind: "folder" as const, repo: true, mtime: r.mtime }))
      : projects.map((p) => ({ path: trim(p.path), parent: null, name: p.name, kind: "folder" as const, repo: true }));
    return layoutGalaxy(tops);
  }, [root, scan, scope, projects, repos]);
  const byPath = useMemo(() => new Map(placed.map((p) => [p.path, p])), [placed]);
  /** the shown node for a path, or its closest shown folder */
  const nodeFor = (abs: string): Placed | undefined => {
    for (let p = abs; p && p !== "/"; p = p.slice(0, p.lastIndexOf("/"))) { const n = byPath.get(p); if (n) return n; }
    return undefined;
  };

  // what you've read in this project (path relative to it → when)
  const understood = useMemo(() => (root ? understoodAll?.[root] ?? {} : {}), [understoodAll, root]);
  const markRead = (abs: string) => {
    if (!root || !inside(abs, root)) return;
    const rel = abs.slice(root.length + 1);
    setAppSetting("understood", { ...(understoodAll ?? {}), [root]: { ...understood, [rel]: Date.now() } });
  };
  const weekFiles = useMemo(() => week.filter((f) => byPath.get(f)?.kind === "file" || !byPath.has(f)).map((f) => ({ abs: f, rel: root ? f.slice(root.length + 1) : f, mtime: byPath.get(f)?.mtime })), [week, byPath, root]);
  const progress = useMemo(() => meter(weekFiles, understood), [weekFiles, understood]);

  // Architecture: each file's part, and a hub above each part's files
  const parts = useMemo(() => {
    if (lens !== "arch" || !arch || !root) return null;
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
      const c = fs.length ? fs.reduce((a, f) => [a[0] + f.pos[0], a[1] + f.pos[1], a[2] + f.pos[2]], [0, 0, 0]).map((n) => n / fs.length) : [0, 0, 0];
      return { id: part.id, label: part.label, color: PART_COLORS[i % PART_COLORS.length], pos: [c[0], Math.max(c[1] + 10, 8), c[2]] as [number, number, number], files: fs.map((f) => f.pos) };
    }).filter((h) => h.files.length);
    return { of, hubs, color: new Map(hubs.map((h) => [h.id, h.color])) };
  }, [lens, arch, root, placed]);

  // hand everything to the scene
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const rel = (abs: string) => (root && inside(abs, root) ? abs.slice(root.length + 1) : null);
    const weekSet = new Set(week);
    const glow = new Map<string, Glow>();
    if (!root) {
      // the galaxy: projects where sessions are working
      for (const ss of sessions) {
        const p = placed.find((x) => inside(ss.folder, x.path) || inside(x.path, ss.folder));
        if (p && glow.get(p.path) !== "needs") glow.set(p.path, ss.status === "needs-input" ? "needs" : ss.status === "working" ? "working" : "done");
      }
    }
    s.setData(placed, (p) => {
      const r = rel(p.path);
      if (lens === "arch") { const id = parts?.of.get(p.path); return id ? parts?.color.get(id) ?? DIM : DIM; }
      if (lens === "changes") return today.has(p.path) ? EMBER : DIM;
      if (lens === "understand") {
        if (!weekSet.has(p.path) || !r) return DIM;
        const st = readState(understood[r], p.mtime);
        return st === "read" ? GREEN : st === "stale" ? GOLD : RED;
      }
      // live
      if (!r) return null;
      if (liveView.overlaps.includes(r)) return RED;
      const who = liveView.touched.get(r);
      return who ? liveView.colors.get(who[0]) ?? null : DIM;
    }, glow);
    s.setHubs(parts?.hubs ?? [], (arch?.links ?? []).map((l) => [l.from, l.to]));
    // Live: an orb over what each session is on, rings where work could collide
    const markers: Marker[] = [];
    const rings: [number, number, number][] = [];
    if (lens === "live" && root) {
      for (const ss of sessions) {
        const on = liveView.on.get(ss.id);
        const target = on ? nodeFor(`${root}/${on}`) : inside(ss.folder, root) ? nodeFor(ss.folder) : byPath.get(root);
        if (!target) continue;
        markers.push({ id: ss.id, label: `${ss.title}${on ? ` · ${on.split("/").pop()}` : ""}`, color: liveView.colors.get(ss.id) ?? EMBER, at: target.pos, working: ss.status === "working", needs: ss.status === "needs-input" });
      }
      for (const f of liveView.overlaps) { const n = nodeFor(`${root}/${f}`); if (n) rings.push(n.pos); }
    }
    s.setMarkers(markers);
    s.setRings(rings);
    // keep what you had selected
    if (sel && byPath.has(sel.path)) s.select(sel.path);
    // frame the whole thing only when what's shown is new, never on updates
    const key = `${scope}|${root}|${placed.length}`;
    if (placed.length && framed.current !== key) {
      framed.current = key;
      const spread = Math.max(20, ...placed.map((p) => Math.hypot(p.pos[0], p.pos[2])));
      const low = Math.min(0, ...placed.map((p) => p.pos[1]));
      s.flyTo([0, low / 2, 0], [spread * 0.7, spread * 0.75 - low * 0.2, spread * 1.05], 1100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, parts, today, week, lens, liveKey, understood]);

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
    // a galaxy entry opens straight into its tree
    if (!root && p.kind === "folder") setRoot(p.path);
  };

  const explain = (mode: "explain" | "teach", target = sel) => {
    if (!target) return;
    setExplaining(mode);
    void call<string>("space_explain", { path: target.path, mode })
      .then((text) => { setExplained({ mode, text }); markRead(target.path); })
      .catch((e) => toast(/not found|command -v/i.test(String(e)) ? "Claude Code isn't installed, so this can't be explained." : `${e}`, "warn"))
      .finally(() => setExplaining(null));
  };

  const explainNext = () => {
    const rel = progress.unread[0];
    if (!rel || !root) return;
    const n = byPath.get(`${root}/${rel}`);
    if (!n) { toast("That file is deeper than the map shows. Open its folder first.", "warn"); return; }
    pick(n);
    explain("explain", n);
  };

  const reveal = async (path: string) => {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path).catch(() => {});
  };

  const tellSession = async () => {
    const to = noteTo ?? sessions[0]?.id;
    const m = members.find((x) => x.id === to);
    if (!sel || !m || !note.trim() || !root) return;
    const relPath = inside(sel.path, root) ? sel.path.slice(root.length + 1) : sel.path;
    const ok = await sendToSession(m, ptyIdFor(m.id), `${note.trim()}\n\n(About ${sel.kind === "folder" ? "the folder" : "the file"} ${relPath})`);
    toast(ok ? `Sent to ${sessions.find((x) => x.id === to)?.title ?? "the session"}` : "Couldn't reach that session", ok ? "info" : "warn");
    if (ok) setNote("");
  };

  const results = useMemo(() => (query.trim() ? fuzzyRank(placed, query, (p) => [p.name]).slice(0, 8).map((r) => r.item) : []), [placed, query]);

  // breadcrumbs: the top, then each folder down to where you are
  const crumbs = useMemo(() => {
    if (!root) return [];
    const top = scope === "computer" ? (repos ?? []).map((r) => r.path) : projects.map((p) => trim(p.path));
    const base = (scope === "project" ? home : top.find((t) => inside(root, t))) || root;
    const rest = inside(root, base) ? root.slice(base.length).split("/").filter(Boolean) : [];
    const out = [{ name: base.split("/").pop() || base, path: base }];
    rest.forEach((seg, i) => out.push({ name: seg, path: `${base}/${rest.slice(0, i + 1).join("/")}` }));
    return out;
  }, [root, scope, projects, repos, home]);

  const relOf = (p: string) => (root && inside(p, root) ? p.slice(root.length + 1) || p.split("/").pop()! : p.replace(/^\/Users\/[^/]+/, "~"));
  const selRel = sel && root && inside(sel.path, root) ? sel.path.slice(root.length + 1) : null;
  const selWho = selRel ? liveView.touched.get(selRel) ?? [] : [];
  const selRead = sel?.kind === "file" && selRel ? readState(understood[selRel], sel.mtime) : null;
  const changedHere = sel?.kind === "folder" ? [...today].filter((c) => inside(c, sel.path)).length : 0;
  const needsRoots = scope === "computer" && !savedRoots?.length;
  const titleOf = (id: string) => sessions.find((x) => x.id === id)?.title ?? id;

  return (
    <div className="space-page">
      <div ref={host} className="space-canvas" />
      <div ref={labels} className="space-labels" aria-hidden />

      <header className="space-bar">
        <div className="seg">
          {([["project", "This project"], ["projects", "All projects"], ["computer", "My computer"]] as const).map(([s, label]) => (
            <button key={s} className={scope === s ? "on" : ""} onClick={() => { setScope(s); setRoot(s === "project" ? home : null); setRepos(null); framed.current = ""; }}>{label}</button>
          ))}
        </div>
        <nav className="crumbs" aria-label="Where you are">
          {scope !== "project" ? <button onClick={() => setRoot(null)}>{scope === "projects" ? "All projects" : "All repos"}</button> : null}
          {crumbs.map((c, i) => (
            <span key={c.path}>{i || scope !== "project" ? <Icon name="chevron" size={9} /> : null}<button onClick={() => setRoot(c.path)}>{c.name}</button></span>
          ))}
        </nav>
        <span className="grow" />
        <div className="search">
          <Icon name="search" size={12} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Fly to…"
            onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { pick(results[0]); setQuery(""); } if (e.key === "Escape") setQuery(""); }} />
          {results.length ? (
            <div className="results">
              {results.map((r) => (
                <button key={r.path} onClick={() => { pick(r); setQuery(""); }}>
                  <Icon name={r.kind === "folder" ? "folder" : "file"} size={11} /> <span>{r.name}</span><span className="dim">{relOf(r.path)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {root ? (
        <div className="space-lenses" role="tablist" aria-label="What to show">
          {LENSES.map((l) => (
            <button key={l.id} role="tab" aria-selected={lens === l.id} className={lens === l.id ? "on" : ""} title={l.hint}
              disabled={l.id === "arch" && !arch} onClick={() => setLens(l.id)}>
              {l.label}
              {l.id === "live" && liveView.overlaps.length ? <span className="badge red">{liveView.overlaps.length}</span> : null}
              {l.id === "changes" && today.size ? <span className="badge">{today.size}</span> : null}
              {l.id === "understand" && progress.total ? <span className="badge">{progress.read}/{progress.total}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* what each lens means, and what to do */}
      {root && lens === "live" ? (
        <aside className="space-side">
          <div className="label">Sessions</div>
          {sessions.length ? sessions.map((ss) => {
            const on = liveView.on.get(ss.id);
            return (
              <button key={ss.id} className="srow" onClick={() => { const n = on ? nodeFor(`${root}/${on}`) : byPath.get(root); if (n) pick(n); }}>
                <i style={{ background: liveView.colors.get(ss.id) }} className={ss.status} />
                <span className="grow"><b>{ss.title}</b><span className="dim">{ss.status === "needs-input" ? "Needs you" : ss.status === "working" ? (on ? `Editing ${on.split("/").pop()}` : "Working") : `${ss.changed.length} file${ss.changed.length === 1 ? "" : "s"} changed`}</span></span>
              </button>
            );
          }) : <p className="dim small">No sessions in this project yet.</p>}
          {liveView.overlaps.length ? (
            <>
              <div className="label red">Could collide</div>
              {liveView.overlaps.slice(0, 6).map((f) => (
                <button key={f} className="srow warn" onClick={() => { const n = nodeFor(`${root}/${f}`); if (n) pick(n); }}>
                  <Icon name="warn" size={12} />
                  <span className="grow"><b>{f.split("/").pop()}</b><span className="dim">{(liveView.touched.get(f) ?? []).map(titleOf).join(" and ")} both changed it</span></span>
                </button>
              ))}
            </>
          ) : null}
        </aside>
      ) : null}

      {root && lens === "understand" ? (
        <div className="space-meter">
          <div className="line">{meterLine(progress)}</div>
          <div className="bar"><i style={{ width: `${progress.total ? (progress.read / progress.total) * 100 : 0}%` }} /></div>
          <div className="row">
            <span className="key"><i style={{ background: GREEN }} />Read</span>
            <span className="key"><i style={{ background: GOLD }} />Changed since</span>
            <span className="key"><i style={{ background: RED }} />Not read</span>
            <span className="grow" />
            {progress.unread.length ? <button className="go" disabled={!!explaining} onClick={explainNext}><Icon name="spark" size={12} /> {explaining ? "Explaining…" : "Explain next"}</button> : null}
          </div>
        </div>
      ) : null}

      {parts ? (
        <div className="space-legend">
          {parts.hubs.map((h) => <span key={h.id}><i style={{ background: h.color }} />{h.label}</span>)}
        </div>
      ) : null}

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
        <div className="space-center"><p className="dim">{scope === "project" && !root ? "Open a project to see its map." : scope === "projects" ? "No projects yet." : root ? "Nothing to show in this folder." : "No git projects found in those folders."}</p></div>
      ) : null}
      {loading ? <div className="space-loading">Mapping…</div> : null}
      {scan?.truncated ? <div className="space-note">Showing the first {scan.nodes.length} items. Open a folder to see deeper.</div> : null}
      {hover && hover !== sel ? <div className="space-hint">{hover.kind === "folder" ? (hover.repo ? "Project" : "Folder") : "File"} · {relOf(hover.path)}</div> : null}
      {scope === "computer" && savedRoots?.length && !root ? (
        <button className="space-edit" onClick={() => { setPicking(savedRoots); setAppSetting("spaceRoots", []); }}>Change folders</button>
      ) : null}

      {sel ? (
        <aside className="space-panel">
          <div className="head">
            <Icon name={sel.kind === "folder" ? "folder" : "file"} size={14} />
            <div className="grow">
              <div className="title">{sel.name}</div>
              <div className="dim small">{relOf(sel.path)}</div>
            </div>
            <button className="x" aria-label="Close" onClick={() => { setSel(null); scene.current?.select(null); }}>×</button>
          </div>
          <div className="facts">
            {sel.kind === "folder" && sel.repo ? <span>Git project</span> : null}
            {sel.kind === "folder" && sel.count ? <span>{sel.count} items</span> : null}
            {sel.kind === "file" && sel.size !== undefined ? <span>{size(sel.size)}</span> : null}
            {sel.mtime ? <span>edited {ago(sel.mtime)}</span> : null}
            {changedHere ? <span className="ember">{changedHere} changed today</span> : null}
            {sel.kind === "file" && today.has(sel.path) ? <span className="ember">changed today</span> : null}
            {selWho.map((id) => <span key={id} className="who"><i style={{ background: liveView.colors.get(id) }} />{titleOf(id)}</span>)}
            {selRead === "read" ? <span className="green">You've read it</span> : selRead === "stale" ? <span className="gold">Changed since you read it</span> : null}
            {parts?.of.get(sel.path) ? <span>{arch?.parts.find((p) => p.id === parts.of.get(sel.path))?.label}</span> : null}
          </div>
          {selRel && liveView.overlaps.includes(selRel) ? (
            <div className="alert"><Icon name="warn" size={12} /> {selWho.map(titleOf).join(" and ")} both changed this file. Merge one before the other keeps going.</div>
          ) : null}
          <div className="actions">
            {sel.kind === "folder" ? (
              <>
                {sel.path !== root ? <button className="go" onClick={() => setRoot(sel.path)}><Icon name="folder" size={12} /> Open this folder</button> : null}
                {!inside(sel.path, home) ? <button onClick={() => void openProjectAt(sel.path, (m) => toast(m, "warn"))} title="Make it a Grill Me project and start a session in it"><Icon name="terminal" size={12} /> Start a session here</button> : null}
              </>
            ) : (
              <>
                <button className="go" disabled={!!explaining || !file || file.binary} onClick={() => explain("explain")}><Icon name="spark" size={12} /> {explaining === "explain" ? "Reading…" : "Explain this"}</button>
                <button disabled={!!explaining || !file || file.binary} onClick={() => explain("teach")}><Icon name="bulb" size={12} /> {explaining === "teach" ? "Writing…" : "Teach me"}</button>
                {selRead !== "read" && selRel ? <button onClick={() => markRead(sel.path)} title="You've looked at it and get what it does"><Icon name="check" size={12} /> Mark as read</button> : null}
              </>
            )}
            <button onClick={() => void reveal(sel.path)}><Icon name="eye" size={12} /> Finder</button>
          </div>
          {sessions.length && root && inside(sel.path, root) ? (
            <div className="tell">
              <div className="targets">
                {sessions.slice(0, 5).map((ss) => (
                  <button key={ss.id} className={(noteTo ?? sessions[0].id) === ss.id ? "on" : ""} onClick={() => setNoteTo(ss.id)}>
                    <i style={{ background: liveView.colors.get(ss.id) }} />{ss.title}
                  </button>
                ))}
              </div>
              <div className="msg">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Tell a session about this ${sel.kind}…`}
                  onKeyDown={(e) => { if (e.key === "Enter") void tellSession(); }} />
                <button disabled={!note.trim()} onClick={() => void tellSession()} aria-label="Send"><Icon name="up" size={12} className="rotate-90" /></button>
              </div>
            </div>
          ) : null}
          {explained ? <div className="explained"><Markdown text={explained.text} /></div> : null}
          {sel.kind === "file" ? (
            file ? (
              file.binary ? <p className="dim small pad">Not a text file.</p> : (
                <pre className="code">
                  {file.text.split("\n").slice(0, 600).map((l, i) => <div key={i}><span className="ln">{i + 1}</span>{l || " "}</div>)}
                  {file.truncated || file.text.split("\n").length > 600 ? <div className="dim">…</div> : null}
                </pre>
              )
            ) : <p className="dim small pad">Loading…</p>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
