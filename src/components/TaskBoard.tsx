import { useEffect, useState } from "react";
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
  done: { label: "done", cls: "ok" },
};

function elapsed(startedAt: number, now: number) {
  const m = Math.floor((now - startedAt) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function TaskCard({ task, now }: { task: Task; now: number }) {
  const { teammates, tasks, setTaskStatus } = useApp();
  const owner = teammates.find((t) => t.id === task.owner);
  const blocker = task.blockedBy ? tasks.find((t) => t.id === task.blockedBy) : undefined;
  const blocked = blocker && blocker.status !== "done";
  const conflictFiles = new Set(fileConflicts(tasks).map((c) => c.file));
  const tag = STATUS_TAG[task.status];

  return (
    <div className={`hairline rounded-sm bg-raised p-2.5 mb-2 ${task.status === "done" ? "opacity-55" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold truncate">{task.title}</span>
        <span className="flex-1" />
        {task.status === "in-progress" && task.startedAt ? (
          <span className="text-accent text-[10px] tabular-nums" title="Time on task">
            ⏱ {elapsed(task.startedAt, now)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <span className="tag">{owner?.name ?? task.owner}</span>
        <button className={`tag ${tag.cls} cursor-pointer demo-hide`} title="Click to advance status"
          onClick={() => setTaskStatus(task.id, NEXT[task.status])}>
          {tag.label}
        </button>
        {blocked ? (
          <span className="tag warn" title={`Waiting on: ${blocker!.title}`}>⛔ blocked → {blocker!.title}</span>
        ) : null}
      </div>
      <div className="mt-1.5 text-[10px] text-faint leading-relaxed">
        {task.files.map((f) => (
          <span key={f} className={conflictFiles.has(f) ? "text-danger" : ""}>
            {conflictFiles.has(f) ? "⚠ " : ""}{f}{"  "}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TaskBoard() {
  const tasks = useApp((s) => s.tasks);
  const teammates = useApp((s) => s.teammates);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const locks = fileLocks(tasks);
  const predicted = predictedConflicts(tasks);
  const name = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="p-3 overflow-y-auto">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} now={now} />
      ))}

      {/* keyword-match conflict prediction */}
      {predicted.length > 0 ? (
        <div className="mt-3 demo-hide">
          <div className="panel-label mb-1.5">predicted overlap</div>
          {predicted.map((p) => (
            <div key={p.a.id + p.b.id} className="text-[10px] text-warn leading-relaxed">
              ⚠ “{p.a.title}” ({name(p.a.owner)}) ↔ “{p.b.title}” ({name(p.b.owner)}) — shared: {p.words.join(", ")}
            </div>
          ))}
        </div>
      ) : null}

      {/* file locks */}
      <div className="mt-3">
        <div className="panel-label mb-1.5">claimed files</div>
        {locks.map((l) => (
          <div key={l.file + l.owner} className="text-[10px] text-dim leading-relaxed truncate">
            🔒 {l.file} <span className="text-faint">— {name(l.owner)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
