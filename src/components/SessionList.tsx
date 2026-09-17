import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { surfaceVisible } from "../lib/soloVisibility";
import { visibleSessions } from "../lib/sessionNav";
import { applySessionOrder, moveId, reorderByDrop } from "../lib/sessionOrder";
import { isTauri } from "../data/sources/git";
import { Icon } from "./Icon";
import { EmptyState } from "./EmptyState";
import type { Teammate } from "../types";
import { fmtMem } from "../lib/format";

/** Everything a SessionRow needs to be a drag handle + keyboard-movable item.
 *  Absent (undefined) when there's nothing to reorder (a single visible row). */
interface RowReorder {
  isDragging: boolean;
  isDropTarget: boolean;
  position: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragEnterRow: () => void;
  onDropRow: () => void;
  onMove: (dir: 1 | -1) => void;
}

const SETUP_LABEL: Record<Teammate["setup"], string> = {
  worktree: "worktree ok",
  env: "env linked",
  ready: "ready",
};

const STATUS_LABEL: Record<Teammate["status"], string> = {
  working: "working",
  "needs-input": "needs input",
  idle: "idle",
};

export function Sparkline({ id }: { id: string }) {
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
  if (buckets.length === 0 || buckets.every((b) => b === 0)) return null;
  const W = 60, H = 10, pad = 1;
  const n = buckets.length;
  const stepX = n > 1 ? W / (n - 1) : 0;
  const yOf = (b: number) => H - pad - (b / max) * (H - pad * 2);
  const pts = buckets.map((b, i) => [i * stepX, yOf(b)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${((n - 1) * stepX).toFixed(1)},${H} L0,${H} Z`;
  const [lastX, lastY] = pts[pts.length - 1];
  const gid = `spark-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width={W} height={H} className="text-data overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1"
        strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
      <circle cx={lastX} cy={lastY} r="1.5" fill="currentColor" />
    </svg>
  );
}

function SessionRow({ mate, reorder }: { mate: Teammate; reorder?: RowReorder }) {
  const { activeId, setActive, splitId, setSplit, toggleDnd, toast, members, setWatchOpen, clearCap, patchTeammate } = useApp();
  const navSelId = useApp((s) => s.navSelId);
  // authoritative on the real process state so the button can also resume a
  // session the feed paused (idle auto-pause or a cost-cap stop)
  const paused = mate.paused ?? false;
  const rowRef = useRef<HTMLDivElement>(null);
  const isOwnSession = members[0]?.id === mate.id;
  const res = useApp((s) => s.resources[mate.id] ?? s.resources[`${s.activeProject}:${mate.id}`]);
  const isActive = activeId === mate.id;
  const inSplit = splitId === mate.id;
  const offline = mate.health !== "ok";
  // the keyboard cursor (j/k) — a distinct, secondary-state highlight (cyan)
  // that only shows while it has stepped off the open session
  const isCursor = navSelId !== null && navSelId === mate.id && !isActive;

  useEffect(() => {
    if (isCursor) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isCursor]);

  return (
    <div
      ref={rowRef}
      className={`group relative px-3 py-3 cursor-pointer transition-colors ${
        isActive
          ? "bg-raised border-l-2 border-l-accent"
          : isCursor
            ? "bg-raised/60 border-l-2 border-l-data"
            : "hover:bg-raised/60 border-l-2 border-l-transparent"
      } ${reorder?.isDragging ? "opacity-40" : ""} ${
        reorder?.isDropTarget ? "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-data" : ""
      }`}
      role="button"
      tabIndex={0}
      aria-current={isActive ? "true" : undefined}
      {...(reorder ? { "aria-roledescription": "sortable session", "aria-label": `${mate.name}, ${reorder.position}. Alt+ArrowUp or Alt+ArrowDown to reorder.` } : {})}
      onClick={() => setActive(mate.id)}
      onDragOver={reorder ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
      onDragEnter={reorder ? (e) => { e.preventDefault(); reorder.onDragEnterRow(); } : undefined}
      onDrop={reorder ? (e) => { e.preventDefault(); reorder.onDropRow(); } : undefined}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (reorder && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          reorder.onMove(e.key === "ArrowUp" ? -1 : 1);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setActive(mate.id);
        }
      }}
    >
      {/* primary line: optional drag grip + dot (the one status signal) + name + branch */}
      <div className="flex items-center gap-2">
        {reorder ? (
          <span
            draggable
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) => { e.dataTransfer.setData("text/plain", mate.id); e.dataTransfer.effectAllowed = "move"; reorder.onDragStart(); }}
            onDragEnd={reorder.onDragEnd}
            className="flex-none text-faint/60 hover:text-data cursor-grab active:cursor-grabbing -ml-1"
            title="Drag to reorder — or focus this row and press Alt+↑ / Alt+↓"
            aria-hidden
          >
            <Icon name="grip" size={12} />
          </span>
        ) : null}
        <span className={`status-dot ${mate.status}`} role="img"
          aria-label={STATUS_LABEL[mate.status]}
          title={`${mate.status}${offline ? ` · no activity ${mate.lastActiveMin}m` : ""}`} />
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
          <span className={`font-mono text-[9px] num ${res.cpu > 80 ? "text-danger" : "text-data"}`}
            title="Live CPU / memory for this session's process tree">
            {res.cpu.toFixed(0)}% · {fmtMem(res.memMb)}
          </span>
        ) : null}
        {mate.capReached ? (
          <span className="tag text-warn" title="Paused — hit its token budget cap. Resume to grant another cap's worth.">cap reached</span>
        ) : mate.paused ? (
          <span className="tag" title="Auto-paused while idle — opens instantly when you view or type">paused</span>
        ) : null}
        {mate.flag ? (
          <span className="tag warn"
            title={mate.flag === "looping"
              ? "Recent output keeps repeating — this session may be stuck in a loop"
              : "No output for a while — this session may be stalled"}>
            {mate.flag}
          </span>
        ) : null}
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

      <div className="mt-0.5 pl-4"><Sparkline id={mate.id} /></div>

      {/* live presence — only when we actually know the file */}
      {mate.currentFile && mate.currentFile !== "—" ? (
        <div className="mt-0.5 pl-4 font-mono text-[10px] text-faint truncate" title={`Currently touching ${mate.currentFile}`}>
          <Icon name="file" size={10} /> {mate.currentFile}
        </div>
      ) : null}

      {/* row actions — active row always, others on hover; keeps the list quiet */}
      <div className={`mt-1.5 pl-4 gap-1.5 items-center demo-hide ${isActive ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`}>
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
        {!isOwnSession ? (
          <button
            className="btn"
            onClick={(e) => { e.stopPropagation(); setWatchOpen(true, mate.id); }}
            title="Watch this session live, read-only — input stays disabled"
          >
            watch
          </button>
        ) : null}
        {isOwnSession ? <button
          className={`btn ${paused ? "active" : ""}`}
          title={paused ? "Resume: continues exactly where it stopped" : "Pause: freezes the process, preserves all context. Only the session owner can pause."}
          onClick={async (e) => {
            e.stopPropagation();
            const { invoke } = await import("@tauri-apps/api/core");
            const { ptyIdFor } = await import("../store");
            try {
              await invoke("pty_pause", { id: ptyIdFor(mate.id), pause: !paused });
              patchTeammate(mate.id, { paused: !paused });
              // resuming a cap-paused session clears the flag and rebaselines
              // the cap, so it runs until it burns another cap's worth
              if (paused) clearCap(mate.id);
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
  const appMode = useApp((s) => s.appMode);
  const ownId = useApp((s) => s.members[0]?.id);
  const sessionOrder = useApp((s) => s.sessionOrder);
  const setSessionOrder = useApp((s) => s.setSessionOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // apply the persisted user order first, then the solo/team visibility filter
  // so the keyboard-nav source (visibleSessions) and this render stay identical.
  const ordered = applySessionOrder(teammates, sessionOrder);
  const orderedIds = ordered.map((t) => t.id);
  // solo: only the own session row (members[0]; first fake row in browser dev)
  const shown = visibleSessions(ordered, appMode, ownId);
  // reorder only makes sense with more than one draggable row on screen
  const canReorder = shown.length > 1;

  const commitOrder = (ids: string[]) => {
    if (ids !== orderedIds) setSessionOrder(ids);
  };

  return (
    <aside data-tour="sessions" style={{ width }} className="flex-none border-r border-line bg-panel flex flex-col overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="panel-label">sessions</span>
        {surfaceVisible(appMode, "session-count") ? (
          <span className="text-data text-[10px] num">{teammates.length} on vm</span>
        ) : null}
      </div>
      <div className="overflow-y-auto flex-1">
        {shown.length === 0 ? (
          <EmptyState
            icon="terminal"
            title="No sessions yet"
            hint="Each session is a claude running in its own git worktree. Spin one up below to get started."
            compact
          />
        ) : (
          shown.map((mate, i) => (
            <SessionRow
              key={mate.id}
              mate={mate}
              reorder={
                canReorder
                  ? {
                      isDragging: dragId === mate.id,
                      isDropTarget: overId === mate.id && dragId !== null && dragId !== mate.id,
                      position: `${i + 1} of ${shown.length}`,
                      onDragStart: () => setDragId(mate.id),
                      onDragEnd: () => { setDragId(null); setOverId(null); },
                      onDragEnterRow: () => setOverId(mate.id),
                      onDropRow: () => {
                        if (dragId) commitOrder(reorderByDrop(orderedIds, dragId, mate.id));
                        setDragId(null);
                        setOverId(null);
                      },
                      onMove: (dir) => commitOrder(moveId(orderedIds, mate.id, dir)),
                    }
                  : undefined
              }
            />
          ))
        )}
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
      <div className="m-2 flex gap-1.5 demo-hide">
        <button className="btn" onClick={() => setOpen(true)}>+ new session</button>
        <button className="btn" title="Spawn from a template: branch prefix + a starting prompt briefed in"
          onClick={() => useApp.setState({ sessionTemplatesOpen: true })}>
          from template
        </button>
      </div>
    );
  }
  return (
    <div className="p-2 border-t border-line flex flex-col gap-1.5 demo-hide">
      <input className="bg-raised hairline rounded-sm px-2 py-1 text-[11px] outline-none focus:border-accent"
        placeholder="member id (e.g. mei)" value={id} onChange={(e) => setId(e.target.value)} />
      <input className="bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
        placeholder="branch (e.g. feature/inbox)" value={branch} onChange={(e) => setBranch(e.target.value)} />
      <div className="flex gap-1.5">
        <button className="btn primary" disabled={!id.trim() || !branch.trim()}
          title={!id.trim() || !branch.trim() ? "Enter a member id and branch first" : "Create the worktree and spawn a session"}
          onClick={() => { spawnSession(id, id, branch); setOpen(false); }}>
          create worktree + spawn
        </button>
        <button className="btn" onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
  );
}
