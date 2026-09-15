import { useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";
import type { ActivityEvent } from "../types";

const ICON: Record<ActivityEvent["kind"], string> = {
  commit: "commit",
  merge: "merge",
  message: "mail",
  status: "bellOff",
};

/** AI standup summarizer — stitches the per-session standup notes each
 *  session appends to the shared log. No API calls; pure aggregation. */
function StandupSummary() {
  const teammates = useApp((s) => s.teammates);
  const standupLines = useApp((s) => s.standupLines);
  const name = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
  return (
    <div className="rounded-sm bg-raised p-2.5 mb-3">
      <div className="panel-label mb-1.5">standup — from shared log</div>
      {standupLines.length === 0 ? (
        <div className="text-faint text-[10px]">
          Nothing logged yet — lines land here as tasks finish.
        </div>
      ) : (
        standupLines.slice(-8).map((line, i) => {
          const [ts, id, ...rest] = line.split("\t");
          const when = new Date(Number(ts) * 1000).toTimeString().slice(0, 5);
          return (
            <div key={i} className="text-[11px] leading-relaxed">
              <span className="text-faint tabular-nums">{when}</span>{" "}
              <span className="text-accent font-semibold">{name(id)}:</span>{" "}
              <span className="text-dim">{rest.join(" ")}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

export function ActivityTimeline() {
  const activity = useApp((s) => s.activity);
  const teammates = useApp((s) => s.teammates);
  const [filter, setFilter] = useState<"all" | ActivityEvent["kind"]>("all");
  const name = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
  const shown = activity.filter((e) => filter === "all" || e.kind === filter);

  return (
    <div className="p-3 overflow-y-auto">
      <StandupSummary />
      <div className="flex items-center gap-1.5 mb-2">
        <span className="panel-label">timeline</span>
        <span className="flex-1" />
        {(["all", "commit", "merge", "message"] as const).map((f) => (
          <button key={f} className={`btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      {shown.map((e) => (
        <div key={e.id} className="flex gap-2 py-1.5 text-[11px]">
          <span className={e.kind === "merge" ? "text-ok" : e.kind === "status" ? "text-warn" : "text-faint"}>
            <Icon name={ICON[e.kind]} size={11} />
          </span>
          <span className="text-accent">{name(e.actor)}</span>
          <span className="text-dim flex-1 leading-relaxed">{e.text}</span>
          <span className="text-faint tabular-nums flex-none">{e.ts}</span>
        </div>
      ))}
    </div>
  );
}
