import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { fileConflicts, fileLocks, predictedConflicts, useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { FanOut } from "./FanOut";
import type { Task, TaskStatus } from "../types";

const NEXT: Record<TaskStatus, TaskStatus> = {
  "not-started": "in-progress",
  "in-progress": "done",
  done: "not-started",
};

const STATUS_TAG: Record<TaskStatus, { label: string; cls: string }> = {
  "not-started": { label: "not started", cls: "" },
  "in-progress": { label: "in progress", cls: "ok" },
  done: { label: "done", cls: "" },
};

function elapsed(startedAt: number, now: number) {
  const m = Math.floor((now - startedAt) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** Urgency tiers: blocked outranks active outranks queued; done recedes. */
function cardClass(task: Task, blocked: boolean) {
  if (blocked) return "card-blocked";
  if (task.status === "in-progress") return "card-active";
  if (task.status === "done") return "card-done";
  return "card-quiet";
}

/** Walk blockedBy links upward to render sequential chains as one path. */
function chainFor(task: Task, tasks: Task[]): string[] {
  const chain: string[] = [];
  let cur: Task | undefined = task;
  const seen = new Set<string>();
  while (cur?.blockedBy && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = tasks.find((t) => t.id === cur!.blockedBy);
    if (!parent || parent.status === "done") break;
    chain.unshift(parent.title);
    cur = parent;
  }
  return chain;
}

const EXT_BADGE: Record<string, { label: string; cls: string }> = {
  ts: { label: "TS", cls: "text-[#73b8ff]" },
  tsx: { label: "TX", cls: "text-[#73b8ff]" },
  rs: { label: "RS", cls: "text-[#ffb454]" },
  json: { label: "{}", cls: "text-[#ffd580]" },
  css: { label: "#", cls: "text-[#d2a6ff]" },
  md: { label: "MD", cls: "text-faint" },
  html: { label: "<>", cls: "text-[#f07178]" },
  toml: { label: "TL", cls: "text-[#95e6cb]" },
  lock: { label: "LK", cls: "text-faint" },
};

export function FileBadge({ file }: { file: string }) {
  const ext = file.split(".").pop() ?? "";
  const b = EXT_BADGE[ext];
  return b ? (
    <span className={`font-mono text-[8px] font-bold w-5 inline-block ${b.cls}`}>{b.label}</span>
  ) : (
    <Icon name="file" size={9} className="text-faint mr-1" />
  );
}

function TaskCard({ task, now }: { task: Task; now: number }) {
  const { teammates, tasks, setTaskStatus } = useApp();
  const owner = teammates.find((t) => t.id === task.owner);
  const blocker = task.blockedBy ? tasks.find((t) => t.id === task.blockedBy) : undefined;
  const blocked = Boolean(blocker && blocker.status !== "done");
  const conflictFiles = new Set(fileConflicts(tasks).map((c) => c.file));
  const tag = STATUS_TAG[task.status];

  return (
    <div className={`${cardClass(task, blocked)} mb-1.5`}>
      <div className="flex items-center gap-2">
        <span className={`text-[12px] font-medium truncate ${task.status === "done" ? "line-through" : ""}`}>
          {task.title}
        </span>
        <span className="flex-1" />
        {task.status === "in-progress" && task.startedAt ? (
          <span className="text-accent text-[10px] tabular-nums" title="Time on task">
            <Icon name="clock" size={10} /> {elapsed(task.startedAt, now)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <span className="text-dim text-[10px]">{owner?.name ?? task.owner}</span>
        <button
          className={`tag ${tag.cls} cursor-pointer demo-hide`}
          title="Click to advance status"
          onClick={() => setTaskStatus(task.id, NEXT[task.status])}
        >
          {tag.label}
        </button>
        {blocked ? (
          <span className="tag warn" title={`Waiting on: ${blocker!.title}`}>
            <Icon name="block" size={10} />{" "}
            {chainFor(task, tasks).length > 1
              ? `chain: ${chainFor(task, tasks).join(" → ")} → this`
              : `blocked · waiting on ${blocker!.title}`}
          </span>
        ) : null}
      </div>
      {task.status !== "done" ? (
        <div className="mt-1 font-mono text-[10px] text-faint leading-relaxed">
          {task.files.map((f) => (
            <span key={f} className={conflictFiles.has(f) ? "text-danger" : ""}>
              {conflictFiles.has(f) ? <Icon name="warn" size={9} className="text-danger mr-0.5" /> : null}{f}{"  "}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiffPeekRow({ file, owner, ownerId, flash }: { file: string; owner: string; ownerId: string; flash: boolean }) {
  const members = useApp((s) => s.members);
  const [diff, setDiff] = useState<string | null>(null);
  const peek = async () => {
    if (diff !== null) return setDiff(null);
    const m = members.find((mm) => mm.id === ownerId);
    if (!m || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const d = await invoke<string>("git_diff_file", { repoPath: m.repoPath, file }).catch((e) => `diff failed: ${e}`);
    setDiff(d || "(no diff — file is new or unchanged)");
  };
  return (
    <div className={`px-1 -mx-1 rounded-sm ${flash ? "flash" : ""}`}>
      <button className="font-mono text-[10px] text-dim leading-relaxed truncate cursor-pointer text-left w-full hover:text-ink"
        onClick={peek} title="Click for diff">
        <Icon name="lock" size={10} className="mr-1 text-faint" /><FileBadge file={file} />{file} <span className="text-faint font-sans">— {owner}</span>
      </button>
      {diff !== null ? (
        <pre className="mt-1 mb-2 max-h-48 overflow-auto bg-term-bg rounded-sm p-2 font-mono text-[9px] text-term-ink whitespace-pre-wrap">{diff}</pre>
      ) : null}
    </div>
  );
}

function taskWords(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3));
}

function TaskCreate() {
  const { tasks, teammates, setShared, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const dupe = title.length > 6
    ? tasks.find((t) => {
        const a = taskWords(title);
        const b = taskWords(`${t.title} ${t.desc}`);
        return [...a].filter((w) => b.has(w)).length >= 2 && t.status !== "done";
      })
    : undefined;
  const create = async () => {
    if (!title.trim()) return;
    const next = [...tasks, {
      id: `t${Date.now()}`,
      title: title.trim(),
      desc: "",
      owner: owner || teammates[0]?.id || "me",
      status: "not-started" as const,
      files: [],
    }];
    setShared({ tasks: next });
    const { invoke } = await import("@tauri-apps/api/core");
    invoke("shared_write", { name: "tasks.json", content: JSON.stringify(next, null, 2) }).catch(console.error);
    toast(`Task added${dupe ? " (possible duplicate flagged)" : ""}`);
    setTitle(""); setOpen(false);
  };
  if (!open) {
    return <button className="btn mt-1 demo-hide" onClick={() => setOpen(true)}>+ task</button>;
  }
  return (
    <div className="mt-1 flex flex-col gap-1.5 demo-hide">
      <input className="bg-raised hairline rounded-sm px-2 py-1.5 text-[11px] outline-none focus:border-accent"
        placeholder="task title" value={title} autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()} />
      {dupe ? (
        <div className="text-warn text-[10px] leading-relaxed">
          <Icon name="warn" size={9} /> possible duplicate of “{dupe.title}” ({dupe.owner}) — same wording
        </div>
      ) : null}
      <div className="flex gap-1.5">
        <select className="btn" value={owner} onChange={(e) => setOwner(e.target.value)}>
          {teammates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn primary" onClick={create}>add</button>
        <button className="btn" onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
  );
}

export function TaskBoard() {
  const tasks = useApp((s) => s.tasks);
  const teammates = useApp((s) => s.teammates);
  const highlightFiles = useApp((s) => s.highlightFiles);
  const [now, setNow] = useState(() => Date.now());
  const locksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Conflict-banner click: scroll the claimed list into view while it flashes
  useEffect(() => {
    if (highlightFiles.length > 0) {
      locksRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [highlightFiles]);

  const locks = fileLocks(tasks);
  const predicted = predictedConflicts(tasks);
  const name = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="p-3 overflow-y-auto">
      {tasks.length === 0 ? (
        <div className="text-faint text-[11px] leading-relaxed py-4 text-center">
          No tasks yet.<br />Add one below, or paste a checklist into fan-out to
          spawn parallel sessions.
        </div>
      ) : null}
      {(() => {
        const blockedIds = new Set(
          tasks.filter((t) => {
            const b = t.blockedBy ? tasks.find((x) => x.id === t.blockedBy) : undefined;
            return b && b.status !== "done";
          }).map((t) => t.id),
        );
        const groups: [string, typeof tasks][] = [
          ["blocked", tasks.filter((t) => blockedIds.has(t.id) && t.status !== "done")],
          ["in progress", tasks.filter((t) => t.status === "in-progress" && !blockedIds.has(t.id))],
          ["queued", tasks.filter((t) => t.status === "not-started" && !blockedIds.has(t.id))],
        ];
        const done = tasks.filter((t) => t.status === "done");
        return (
          <>
            {groups.map(([label, list]) =>
              list.length > 0 ? (
                <div key={label} className="mb-2">
                  <div className="panel-label mb-1">{label} · {list.length}</div>
                  {list.map((task) => <TaskCard key={task.id} task={task} now={now} />)}
                </div>
              ) : null,
            )}
            {done.length > 0 ? (
              <details className="mb-2">
                <summary className="panel-label cursor-pointer">done · {done.length}</summary>
                {done.map((task) => <TaskCard key={task.id} task={task} now={now} />)}
              </details>
            ) : null}
          </>
        );
      })()}
      <TaskCreate />
      <FanOut />

      {predicted.length > 0 ? (
        <div className="mt-4 demo-hide">
          <div className="panel-label mb-1.5">predicted overlap</div>
          {predicted.map((p) => (
            <div key={p.a.id + p.b.id} className="text-[10px] text-warn leading-relaxed">
              <Icon name="warn" size={10} /> “{p.a.title}” ({name(p.a.owner)}) and “{p.b.title}” ({name(p.b.owner)}) — shared: {p.words.join(", ")}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4" ref={locksRef}>
        <div className="panel-label mb-1.5">claimed files</div>
        {locks.length === 0 ? (
          <div className="text-faint text-[10px]">No active claims.</div>
        ) : (
          locks.map((l) => (
            <DiffPeekRow key={l.file + l.owner} file={l.file} owner={name(l.owner)}
              flash={highlightFiles.includes(l.file)} ownerId={l.owner} />
          ))
        )}
      </div>
    </div>
  );
}
