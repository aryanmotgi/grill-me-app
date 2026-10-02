import { useApp } from "../../store";
import { CenterStage, Overlays } from "../ShellParts";
import { BottomTerminal } from "../BottomTerminal";
import { DragHandle } from "../DragHandle";
import { ConflictBanner } from "../Chrome";
import { SimpleSidebar } from "./SimpleSidebar";
import { GoalBar } from "./GoalBar";
import { RightPanel } from "./RightPanel";
import type { Teammate } from "../../types";

// ---------------------------------------------------------------------------
// The simple layout: sessions on the left, the agent in the middle with the
// team goal on top, Changes / Plan / Team on the right. Same shape as the
// multi-agent tools developers already know. Classic stays one toggle away
// (Settings → Appearance → Layout, or ⌘K).
// ---------------------------------------------------------------------------

export function SimpleShell({ active, split }: { active: Teammate | undefined; split: Teammate | undefined }) {
  const dense = useApp((s) => s.dense);
  const focusMode = useApp((s) => s.focusMode);
  const width = useApp((s) => s.panelSizes.right);
  const setPanelSize = useApp((s) => s.setPanelSize);
  const rightOpen = useApp((s) => s.appSettings.rightOpen !== false);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const onPage = view !== "session" && view !== "new";

  return (
    <div className={`h-full flex flex-col ${dense ? "dense" : ""}`}>
      <ConflictBanner />
      <div className="flex-1 min-h-0 flex">
        {focusMode ? null : <SimpleSidebar />}
        <main className="flex-1 min-w-0 flex flex-col">
          {focusMode ? null : (
            <GoalBar active={active} rightOpen={rightOpen} onToggleRight={() => setAppSetting("rightOpen", !rightOpen)} />
          )}
          {onPage ? (
            <button className="flex-none flex items-center gap-1.5 h-8 px-3 text-[12px] text-dim hover:text-ink border-b border-line cursor-pointer"
              onClick={() => setView(active ? "session" : "new")}>
              ← Back to {active ? "your session" : "new session"}
            </button>
          ) : null}
          <CenterStage active={active} split={split} />
          <BottomTerminal active={active} />
        </main>
        {rightOpen && !focusMode ? (
          <>
            <DragHandle onDrag={(dx) => setPanelSize("right", Math.min(680, Math.max(280, width - dx)))}
              onDone={() => setPanelSize("right", width, true)} />
            <RightPanel active={active} width={width} />
          </>
        ) : null}
      </div>
      <Overlays />
    </div>
  );
}
