import { useEffect, useRef, useState } from "react";
import { fileConflicts, fileLocks, predictedConflicts, useApp } from "../store";
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
            ⏱ {elapsed(task.startedAt, now)}
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
            ⛔ blocked → {blocker!.title}
          </span>
        ) : null}
      </div>
      {task.status !== "done" ? (
        <div className="mt-1 font-mono text-[10px] text-faint leading-relaxed">
          {task.files.map((f) => (
            <span key={f} className={conflictFiles.has(f) ? "text-danger" : ""}>
              {conflictFiles.has(f) ? "⚠ " : ""}{f}{"  "}
            </span>
          ))}
        </div>
      ) : null}
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
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} now={now} />
      ))}

      {predicted.length > 0 ? (
        <div className="mt-4 demo-hide">
          <div className="panel-label mb-1.5">predicted overlap</div>
          {predicted.map((p) => (
            <div key={p.a.id + p.b.id} className="text-[10px] text-warn leading-relaxed">
              ⚠ “{p.a.title}” ({name(p.a.owner)}) ↔ “{p.b.title}” ({name(p.b.owner)}) — shared: {p.words.join(", ")}
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
            <div
              key={l.file + l.owner}
              className={`font-mono text-[10px] text-dim leading-relaxed truncate px-1 -mx-1 rounded-sm ${
                highlightFiles.includes(l.file) ? "flash" : ""
              }`}
            >
              🔒 {l.file} <span className="text-faint font-sans">— {name(l.owner)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
