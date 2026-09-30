import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { ProjectIcon } from "./ProjectIcon";
import { GrillFlame } from "./GrillMark";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { addProjectFromFinder, openProjectAt } from "../lib/addProject";

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
      // Escape is handled by App's single Esc chain (topmost-first) to avoid double-close
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

  const warn = (msg: string) => toast(msg, "warn");

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
      setCloneUrl("");
      await openProjectAt(dest, warn);
    } catch (e) {
      toast(`Clone failed: ${e}`, "warn");
    } finally {
      setCloning(false);
    }
  };

  const first = projects.length === 0;

  return (
    <div className="fixed inset-0 z-50 ground flex flex-col overflow-y-auto">
      {/* drag strip under the traffic lights — a full-screen cover must not trap the window */}
      <div data-tauri-drag-region className="h-12 flex-none" />
      <div className="flex-1 flex items-start justify-center px-6 pb-12">
        <div className="w-[600px] max-w-full flex flex-col gap-7 pt-[6vh]">
          <div className="flex flex-col items-center gap-3 text-center">
            <GrillFlame px={4} />
            <div>
              <div className="text-[22px] font-semibold text-ink tracking-tight">{first ? "Welcome to Grill Me" : "Pick a project"}</div>
              <div className="text-[13px] text-dim mt-1">
                {first
                  ? "One window for every Claude Code session on a project. Start by opening its folder."
                  : "Each project keeps its own sessions, brain, board and bridge."}
              </div>
            </div>
          </div>

          {first ? null : (
            <div className="flex flex-col gap-2">
              {projects.map((p, i) => {
                const st = stats[p.id];
                const current = p.id === activeProject;
                return (
                  <button key={p.id}
                    className={`composer-card group/proj flex items-center gap-3.5 px-4 py-3.5 rounded-xl cursor-pointer text-left transition-colors hover:border-white/20 ${current ? "border-white/20" : ""}`}
                    onClick={() => choose(p)}>
                    <ProjectIcon id={p.id} color={p.color} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-ink truncate">{p.name}</span>
                        {st?.needsInput ? <span className="status-dot needs-input" title="A session here needs you" /> : null}
                        {current ? <span className="text-[11px] text-faint">open</span> : null}
                      </span>
                      <span className="block font-mono text-[11px] text-faint truncate mt-0.5">{(p.path || "~/.grillme").replace(/^\/Users\/[^/]+/, "~")}</span>
                    </span>
                    {st ? (
                      <span className="flex gap-3 text-[11px] text-dim tabular-nums flex-none">
                        {st.sessionsAlive > 0 ? <span className="text-ok">{st.sessionsAlive} live</span> : null}
                        {st.tasksInProgress > 0 ? <span>{st.tasksInProgress} active</span> : null}
                        {st.unanswered > 0 ? <span className="text-warn">{st.unanswered} unread</span> : null}
                        {commitAge(st.lastCommitAgeMin) ? <span title="Last commit">committed {commitAge(st.lastCommitAgeMin)} ago</span> : null}
                      </span>
                    ) : null}
                    {!st && ago(p.lastOpened) ? <span className="text-faint text-[11px] flex-none">{ago(p.lastOpened)}</span> : null}
                    {i < 9 ? <span className="font-mono text-faint text-[11px] w-4 text-right flex-none opacity-0 group-hover/proj:opacity-100" title={`Press ${i + 1}`}>{i + 1}</span> : null}
                  </button>
                );
              })}
            </div>
          )}

          {discovered.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="panel-label">found on this Mac</div>
              {discovered.map((d) => (
                <div key={d} className="flex items-center gap-2 px-1 text-[12px]">
                  <span className="font-mono text-dim text-[11px] truncate">{d.replace(/^\/Users\/[^/]+/, "~")}</span>
                  <span className="flex-1" />
                  <button className="composer-btn h-7 text-[11.5px]" onClick={() => void openProjectAt(d, warn)}>
                    <Icon name="plus" size={10} /> Add
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className={`flex flex-col gap-2.5 ${first ? "" : "border-t border-line pt-5"}`}>
            {first ? null : <div className="panel-label">add a project</div>}
            <button
              className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl cursor-pointer text-left transition-colors ${first ? "bg-accent text-accent-ink hover:brightness-110" : "composer-card hover:border-white/20"}`}
              title="Opens Finder — pick an existing folder, or use New Folder to start fresh"
              onClick={() => void addProjectFromFinder(warn)}
            >
              <Icon name="folder" size={18} />
              <span className="flex flex-col">
                <span className="text-[14px] font-medium">Open a folder…</span>
                <span className={`text-[12px] ${first ? "opacity-80" : "text-faint"}`}>Pick one in Finder, or make a new one. The project sticks to it.</span>
              </span>
            </button>
            <div className="flex gap-2">
              <input className="flex-1 bg-raised/60 hairline rounded-lg px-3 h-9 font-mono text-[12px] outline-none focus:border-white/20"
                placeholder="or clone a repo: https://github.com/org/repo" value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && clone()} />
              <button className="composer-btn h-9" disabled={cloning || !cloneUrl.trim()} onClick={clone}>{cloning ? <><span className="spinner" /> Cloning…</> : "Clone"}</button>
            </div>
          </div>

          {activeProject ? (
            <button className="text-[12px] text-faint hover:text-dim cursor-pointer self-center" onClick={() => setPickerOpen(false)}>← Back to workspace</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
