import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";

interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened?: number;
  color?: string;
}

interface CardStats {
  tasksInProgress: number;
  unanswered: number;
  lastCommitAgeMin: number | null;
  sessionsAlive: number;
  needsInput: boolean;
}

const ACCENTS = ["#ffb454", "#7fd962", "#73b8ff", "#f07178", "#d2a6ff", "#95e6cb"];

function ago(ts?: number) {
  if (!ts) return null;
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / (60 * 24))}d ago`;
}

const commitAge = (min: number | null) =>
  min === null ? null : min < 60 ? `${min}m` : min < 60 * 24 ? `${Math.floor(min / 60)}h` : `${Math.floor(min / 1440)}d`;

/**
 * Launch screen: pick a project workspace. Every project is fully separate —
 * own team config, board, inbox, activity, sessions. Cards show live stats
 * read from each project's state dir without opening it.
 */
export function ProjectPicker() {
  const { activeProject, pickerOpen, setPickerOpen, setAppSetting, toast } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Record<string, CardStats>>({});
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [color, setColor] = useState(ACCENTS[0]);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);

  const visible = pickerOpen || !activeProject;

  useEffect(() => {
    if (!visible || !isTauri()) return;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string>("projects_list").catch(() => "[]");
      let list: Project[] = [];
      try { list = JSON.parse(raw); } catch { /* fresh */ }
      if (list.length === 0) {
        list = [{ id: "default", name: "grill-me", path: "" }];
        invoke("projects_write", { content: JSON.stringify(list, null, 2) }).catch(() => {});
      }
      list.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
      setProjects(list);
      // live card stats + attention dots
      for (const p of list) {
        invoke<CardStats>("project_card_stats", { id: p.id, path: p.path })
          .then((s) => setStats((prev) => ({ ...prev, [p.id]: s })))
          .catch(() => {});
      }
      invoke<string[]>("discover_repos", { known: list.map((p) => p.path) })
        .then(setDiscovered)
        .catch(() => {});
    })();
  }, [visible]);

  // one-key open: 1-9 jumps, Enter opens most recent
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key >= "1" && e.key <= "9") {
        const p = projects[Number(e.key) - 1];
        if (p) choose(p);
      }
      if (e.key === "Enter" && projects[0]) choose(projects[0]);
      if (e.key === "Escape" && activeProject) setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!visible) return null;

  const choose = async (p: Project) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const stamped = projects.map((x) => (x.id === p.id ? { ...x, lastOpened: Date.now() } : x));
    await invoke("projects_write", { content: JSON.stringify(stamped, null, 2) }).catch(() => {});
    await invoke("set_active_project", { id: p.id });
    setAppSetting("activeProject", p.id);
    setTimeout(() => location.reload(), 150);
  };

  const register = async (projName: string, projPath: string, projColor?: string) => {
    const id = projName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const next = [...projects, { id, name: projName.trim(), path: projPath.trim(), color: projColor }];
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("projects_write", { content: JSON.stringify(next, null, 2) });
    await invoke("set_active_project", { id });
    await invoke("team_config_write", {
      cfg: { teammates: [{ id: "me", name: "Me", repoPath: projPath.trim(), permission: "edit" }] },
    }).catch(() => {});
    setProjects(next);
  };

  const browse = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Pick a project repo" });
    if (typeof dir === "string") {
      setPath(dir);
      if (!name) setName(dir.split("/").pop() ?? "");
    }
  };

  const clone = async () => {
    const url = cloneUrl.trim();
    if (!url) return;
    setCloning(true);
    const repo = url.split("/").pop()?.replace(/\.git$/, "") ?? "cloned";
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // clone next to an existing project; fall back to the home dir
      const sibling = projects.find((p) => p.path)?.path;
      const parent = sibling
        ? sibling.replace(/\/[^/]+$/, "")
        : await import("@tauri-apps/api/path").then(({ homeDir }) => homeDir());
      const dest = `${parent.replace(/\/+$/, "")}/${repo}`;
      await invoke("git_clone", { url, dest });
      await register(repo, dest, ACCENTS[projects.length % ACCENTS.length]);
      setCloneUrl("");
    } catch (e) {
      toast(`Clone failed: ${e}`, "warn");
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-bg flex items-center justify-center overflow-y-auto py-8">
      <div className="w-[560px] flex flex-col gap-5">
        <div className="text-center">
          <div className="font-display font-bold text-[24px] tracking-[0.1em] text-accent">GRILL ME</div>
          <div className="panel-label mt-1">choose a project workspace</div>
        </div>

        <div className="flex flex-col gap-1.5">
          {projects.map((p, i) => {
            const st = stats[p.id];
            return (
              <button key={p.id}
                className="flex items-center gap-3 px-4 py-3 bg-panel hairline rounded-sm cursor-pointer hover:border-accent text-left transition-colors"
                style={p.color ? { borderLeft: `3px solid ${p.color}` } : undefined}
                onClick={() => choose(p)}>
                {i < 9 ? <span className="font-mono text-faint text-[10px] w-3">{i + 1}</span> : null}
                <span className="font-display font-semibold text-[13px]">{p.name}</span>
                {st?.needsInput ? (
                  <span className="status-dot needs-input" title="A session here needs input" />
                ) : null}
                <span className="font-mono text-faint text-[10px] truncate max-w-[150px]">{p.path || "~/.grillme"}</span>
                <span className="flex-1" />
                {st ? (
                  <span className="flex gap-2.5 text-[10px] text-dim tabular-nums">
                    {st.sessionsAlive > 0 ? <span className="text-ok">{st.sessionsAlive} live</span> : null}
                    {st.tasksInProgress > 0 ? <span>{st.tasksInProgress} active</span> : null}
                    {st.unanswered > 0 ? <span className="text-warn">{st.unanswered} unread</span> : null}
                    {commitAge(st.lastCommitAgeMin) ? <span title="Last commit">c {commitAge(st.lastCommitAgeMin)}</span> : null}
                  </span>
                ) : null}
                {ago(p.lastOpened) ? <span className="text-faint text-[10px]">{ago(p.lastOpened)}</span> : null}
                {p.id === activeProject ? <span className="tag ok">current</span> : null}
              </button>
            );
          })}
        </div>

        {discovered.length > 0 ? (
          <div className="flex flex-col gap-1">
            <div className="panel-label">found on disk</div>
            {discovered.map((d) => (
              <div key={d} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                <span className="font-mono text-faint text-[10px] truncate">{d}</span>
                <span className="flex-1" />
                <button className="btn" onClick={() => register(d.split("/").pop() ?? d, d, ACCENTS[projects.length % ACCENTS.length])}>
                  <Icon name="plus" size={9} /> add
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5 border-t border-line pt-4">
          <div className="panel-label">add project</div>
          <div className="flex gap-1.5">
            <input className="flex-1 bg-raised hairline rounded-sm px-3 py-2 text-[12px] outline-none focus:border-accent"
              placeholder="project name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn" onClick={browse}>browse…</button>
          </div>
          <input className="bg-raised hairline rounded-sm px-3 py-2 font-mono text-[11px] outline-none focus:border-accent"
            placeholder="/absolute/path/to/repo" value={path} onChange={(e) => setPath(e.target.value)} />
          <div className="flex items-center gap-2">
            <span className="text-faint text-[10px]">accent</span>
            {ACCENTS.map((c) => (
              <button key={c} className="w-4 h-4 rounded-full cursor-pointer"
                style={{ background: c, outline: color === c ? `2px solid ${c}` : "none", outlineOffset: 2 }}
                onClick={() => setColor(c)} />
            ))}
            <span className="flex-1" />
            <button className="btn primary" disabled={!name.trim() || !path.trim()}
              title={!name.trim() || !path.trim() ? "Enter a project name and path first" : "Add this project"}
              onClick={() => { register(name, path, color); setName(""); setPath(""); }}>
              <Icon name="plus" size={10} /> add
            </button>
          </div>
          <div className="flex gap-1.5 mt-1">
            <input className="flex-1 bg-raised hairline rounded-sm px-3 py-2 font-mono text-[11px] outline-none focus:border-accent"
              placeholder="or clone: https://github.com/org/repo" value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && clone()} />
            <button className="btn" disabled={cloning} onClick={clone}>{cloning ? "cloning…" : "clone"}</button>
          </div>
        </div>

        {activeProject ? (
          <button className="btn self-center" onClick={() => setPickerOpen(false)}>back to workspace</button>
        ) : null}
      </div>
    </div>
  );
}
