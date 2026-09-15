import { useApp, type RailTab } from "../store";
import { TaskBoard } from "./TaskBoard";
import { Inbox } from "./Inbox";
import { ActivityTimeline } from "./ActivityTimeline";
import { PreviewPane, TeamPanel } from "./TeamPanel";

const TABS: { id: RailTab; label: string; demoHidden?: boolean }[] = [
  { id: "tasks", label: "tasks" },
  { id: "inbox", label: "inbox" },
  { id: "activity", label: "activity" },
  { id: "team", label: "team", demoHidden: true },
  { id: "preview", label: "preview", demoHidden: true },
];

export function RightRail() {
  const { railTab, setRailTab, messages } = useApp();
  const unanswered = messages.filter((m) => !m.answered).length;

  return (
    <aside className="w-[338px] flex-none border-l border-line bg-panel flex flex-col overflow-hidden">
      <div className="flex border-b border-line flex-none">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`panel-label px-3 py-2.5 cursor-pointer border-b-2 -mb-px transition-colors ${
              t.demoHidden ? "demo-hide" : ""
            } ${
              railTab === t.id
                ? "border-accent text-accent"
                : "border-transparent hover:text-dim"
            }`}
            onClick={() => setRailTab(t.id)}
          >
            {t.label}
            {t.id === "inbox" && unanswered > 0 ? (
              <span className="ml-1 text-warn">{unanswered}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {railTab === "tasks" ? <TaskBoard /> : null}
        {railTab === "inbox" ? <Inbox /> : null}
        {railTab === "activity" ? <ActivityTimeline /> : null}
        {railTab === "team" ? <TeamPanel /> : null}
        {railTab === "preview" ? <PreviewPane /> : null}
      </div>
    </aside>
  );
}
