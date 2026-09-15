import { useState } from "react";
import { useApp, type RailTab } from "../store";
import { TaskBoard } from "./TaskBoard";
import { Inbox } from "./Inbox";
import { ActivityTimeline } from "./ActivityTimeline";
import { PreviewPane, TeamPanel } from "./TeamPanel";

const PRIMARY_TABS: { id: RailTab; label: string }[] = [
  { id: "tasks", label: "tasks" },
  { id: "inbox", label: "inbox" },
  { id: "activity", label: "feed" },
];
const MORE_TABS: { id: RailTab; label: string; hint: string }[] = [
  { id: "team", label: "team", hint: "usage · health · CI · checklist" },
  { id: "preview", label: "dev preview", hint: "your project's running app" },
];

function MoreMenu({ tabs, active, onPick }: {
  tabs: { id: RailTab; label: string; hint: string }[];
  active: RailTab | null;
  onPick: (t: RailTab) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`panel-label px-3 py-2.5 cursor-pointer transition-colors ${active ? "text-accent" : "hover:text-dim"}`}
        onClick={() => setOpen(!open)}>
        more ▾
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 w-56 bg-overlay hairline rounded-md shadow-2xl py-1 rise">
            {tabs.map((t) => (
              <button key={t.id}
                className="flex flex-col w-full px-3 py-2 text-left hover:bg-raised cursor-pointer transition-colors"
                onClick={() => { onPick(t.id); setOpen(false); }}>
                <span className="text-[11px] text-ink">{t.label}</span>
                <span className="text-[9px] text-faint">{t.hint}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

export function RightRail() {
  const { railTab, setRailTab, messages, appSettings } = useApp();
  const width = useApp((s) => s.panelSizes.right);
  const moreTabs = MORE_TABS.filter((t) => t.id !== "preview" || appSettings.showPreview !== false);
  const unanswered = messages.filter((m) => !m.answered).length;
  const inMore = moreTabs.some((t) => t.id === railTab);

  return (
    <aside style={{ width }} className="flex-none border-l border-line bg-panel flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-line flex-none">
        {PRIMARY_TABS.map((t) => (
          <button
            key={t.id}
            className={`panel-label px-3 py-2.5 cursor-pointer border-b-2 -mb-px transition-colors ${
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
        <div className="relative ml-auto demo-hide">
          <MoreMenu tabs={moreTabs} active={inMore ? railTab : null} onPick={setRailTab} />
        </div>
      </div>
      {inMore ? (
        <div className="px-3 py-1.5 border-b border-line panel-label text-accent flex-none">
          {MORE_TABS.find((t) => t.id === railTab)?.label}
        </div>
      ) : null}
      <div key={railTab} className="tab-fade flex-1 min-h-0 overflow-hidden flex flex-col">
        {railTab === "tasks" ? <TaskBoard /> : null}
        {railTab === "inbox" ? <Inbox /> : null}
        {railTab === "activity" ? <ActivityTimeline /> : null}
        {railTab === "team" ? <TeamPanel /> : null}
        {railTab === "preview" ? <PreviewPane /> : null}
      </div>
    </aside>
  );
}
