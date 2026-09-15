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
  return (
    <div className="rounded-sm bg-raised p-2.5 mb-3">
      <div className="panel-label mb-1.5">standup — auto-stitched</div>
      {teammates.map((t) => (
        <div key={t.id} className="text-[11px] leading-relaxed">
          <span className="text-accent font-semibold">{t.name}:</span>{" "}
          <span className="text-dim">{t.standupNote}</span>
        </div>
      ))}
    </div>
  );
}

export function ActivityTimeline() {
  const activity = useApp((s) => s.activity);
  const teammates = useApp((s) => s.teammates);
  const name = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="p-3 overflow-y-auto">
      <StandupSummary />
      <div className="panel-label mb-2">timeline</div>
      {activity.map((e) => (
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
