import { useEffect, useState } from "react";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { Icon } from "./Icon";
import type { Teammate } from "../types";

const SETUP_LABEL: Record<Teammate["setup"], string> = {
  worktree: "worktree ok",
  env: "env linked",
  ready: "ready",
};

function Sparkline({ id }: { id: string }) {
  const [buckets, setBuckets] = useState<number[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    const load = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const b = await invoke<number[]>("activity_series", { id }).catch(() => []);
      if (live) setBuckets(b);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [id]);
  const max = Math.max(1, ...buckets);
  if (buckets.every((b) => b === 0)) return null;
  return (
    <svg width="60" height="10" className="opacity-70" aria-hidden>
      {buckets.map((b, i) => (
        <rect key={i} x={i * 2} y={10 - (b / max) * 9 - 1} width="1.4" height={(b / max) * 9 + 1}
          fill="currentColor" className={b > 0 ? "text-ok" : "text-line"} />
      ))}
    </svg>
  );
}

function SessionRow({ mate }: { mate: Teammate }) {
  const { activeId, setActive, splitId, setSplit, toggleDnd, toast, members } = useApp();
  const [paused, setPaused] = useState(false);
  const isOwnSession = members[0]?.id === mate.id;
  const res = useApp((s) => s.resources[mate.id] ?? s.resources[`${s.activeProject}:${mate.id}`]);
  const isActive = activeId === mate.id;
  const inSplit = splitId === mate.id;
  const offline = mate.health !== "ok";

  return (
    <div
      className={`group px-3 py-3 cursor-pointer transition-colors ${
        isActive
          ? "bg-raised border-l-2 border-l-accent"
          : "hover:bg-raised/60 border-l-2 border-l-transparent"
      }`}
      onClick={() => setActive(mate.id)}
    >
      {/* primary line: dot (the one status signal) + name + branch */}
      <div className="flex items-center gap-2">
        <span className={`status-dot ${mate.status}`} title={`${mate.status}${offline ? ` · no activity ${mate.lastActiveMin}m` : ""}`} />
        <span className="font-display font-semibold text-[13px]">{mate.name}</span>
        <span className="font-mono text-faint text-[10px] truncate" title={mate.branch}>
          <Icon name="branch" size={11} /> {mate.branch}
        </span>
        <span className="flex-1" />
        {mate.dnd ? <span title="Do not disturb" className="text-faint"><Icon name="bellOff" size={11} /></span> : null}
      </div>

      {/* secondary line: task label + quiet metadata */}
      <div className="mt-1 flex items-center gap-2 pl-4">
        <span className="text-dim text-[11px] truncate" title={mate.taskLabel}>
          {mate.taskLabel}
        </span>
        <span className="flex-1" />
        {res && res.cpu >= 3 ? (
          <span className={`font-mono text-[9px] tabular-nums ${res.cpu > 80 ? "text-danger" : "text-faint"}`}
            title="Live CPU / memory for this session's process tree">
            {res.cpu.toFixed(0)}% · {res.memMb >= 1024 ? `${(res.memMb / 1024).toFixed(1)}G` : `${res.memMb.toFixed(0)}M`}
          </span>
        ) : null}
        {mate.paused ? <span className="tag" title="Auto-paused while idle — opens instantly when you view or type">paused · zzz</span> : null}
        {mate.setup !== "ready" ? <span className="tag">{SETUP_LABEL[mate.setup]}</span> : null}
        {offline ? (
          <span
            className={`text-[10px] ${mate.health === "disconnected" ? "text-danger" : "text-warn"}`}
            title={`No activity for ${mate.lastActiveMin}m`}
          >
            {mate.health === "disconnected" ? "offline" : `quiet ${mate.lastActiveMin}m`}
          </span>
        ) : null}
      </div>

      <div className="mt-0.5 pl-4 text-ok"><Sparkline id={mate.id} /></div>

      {/* live presence — only when we actually know the file */}
      {mate.currentFile && mate.currentFile !== "—" ? (
        <div className="mt-0.5 pl-4 font-mono text-[10px] text-faint truncate" title={`Currently touching ${mate.currentFile}`}>
          <Icon name="file" size={10} /> {mate.currentFile}
        </div>
      ) : null}

      {/* row actions — active row always, others on hover; keeps the list quiet */}
      <div className={`mt-1.5 pl-4 gap-1.5 items-center demo-hide ${isActive ? "flex" : "hidden group-hover:flex"}`}>
        <button
          className={`btn ${inSplit ? "active" : ""}`}
          onClick={(e) => { e.stopPropagation(); setSplit(inSplit ? null : mate.id); }}
          title="View side-by-side with active pane"
        >
          split
        </button>
        <button
          className={`btn ${mate.dnd ? "active" : ""}`}
          onClick={(e) => { e.stopPropagation(); toggleDnd(mate.id); }}
          title="Silence notifications from this session"
        >
          dnd
        </button>
        {isOwnSession ? <button
          className={`btn ${paused ? "active" : ""}`}
          title={paused ? "Resume: continues exactly where it stopped" : "Pause: freezes the process, preserves all context. Only the session owner can pause."}
          onClick={async (e) => {
            e.stopPropagation();
            const { invoke } = await import("@tauri-apps/api/core");
            const { ptyIdFor } = await import("../store");
            try {
              await invoke("pty_pause", { id: ptyIdFor(mate.id), pause: !paused });
              setPaused(!paused);
              toast(paused ? `${mate.name} resumed` : `${mate.name} paused — state preserved`);
            } catch (err) {
              toast(`Pause failed: ${err}`, "warn");
            }
          }}
        >
          {paused ? "resume" : "pause"}
        </button> : null}
        <span className="text-faint text-[10px]" title={mate.permission === "edit" ? "You can jump into this session" : "View-only for you"}>
          {mate.permission === "edit" ? <><Icon name="swap" size={10} /> can jump in</> : <><Icon name="eye" size={10} /> view-only</>}
        </span>
      </div>
    </div>
  );
}

export function SessionList() {
  const teammates = useApp((s) => s.teammates);
  const width = useApp((s) => s.panelSizes.left);
  return (
    <aside style={{ width }} className="flex-none border-r border-line bg-panel flex flex-col overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="panel-label">sessions</span>
        <span className="text-faint text-[10px]">{teammates.length} on vm</span>
      </div>
      <div className="overflow-y-auto">
        {teammates.map((mate) => (
          <SessionRow key={mate.id} mate={mate} />
        ))}
      </div>
      <Spawner />
    </aside>
  );
}

function Spawner() {
  const spawnSession = useApp((s) => s.spawnSession);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [branch, setBranch] = useState("");
  if (!open) {
    return (
      <button className="btn m-2 demo-hide" onClick={() => setOpen(true)}>+ new session</button>
    );
  }
  return (
    <div className="p-2 border-t border-line flex flex-col gap-1.5 demo-hide">
      <input className="bg-raised hairline rounded-sm px-2 py-1 text-[11px] outline-none focus:border-accent"
        placeholder="member id (e.g. mei)" value={id} onChange={(e) => setId(e.target.value)} />
      <input className="bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
        placeholder="branch (e.g. feature/inbox)" value={branch} onChange={(e) => setBranch(e.target.value)} />
      <div className="flex gap-1.5">
        <button className="btn primary" onClick={() => { if (id && branch) { spawnSession(id, id, branch); setOpen(false); } }}>
          create worktree + spawn
        </button>
        <button className="btn" onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
  );
}
