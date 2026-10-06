import { useApp } from "../../store";
import { CenterStage, Overlays } from "../ShellParts";
import { BottomTerminal } from "../BottomTerminal";
import { OverlapWatch } from "../Chrome";
import { SimpleSidebar } from "./SimpleSidebar";
import { TopBar } from "./TopBar";
import type { Teammate } from "../../types";

// ---------------------------------------------------------------------------
// The simple layout: sessions on the left, the conversation in the middle.
// Every finished turn ends with a receipt (files, tests, cost, undo), and
// the top bar carries the session's totals, so the Peek panel (changes,
// preview, plan, team) stays closed until you want it. Classic stays one
// toggle away (Settings → Appearance → Layout, or ⌘K).
// ---------------------------------------------------------------------------

export function SimpleShell({ active, split }: { active: Teammate | undefined; split: Teammate | undefined }) {
  const dense = useApp((s) => s.dense);
  const focusMode = useApp((s) => s.focusMode);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const onPage = view !== "session" && view !== "new";

  return (
    <div className={`h-full flex flex-col ${dense ? "dense" : ""}`}>
      {/* overlaps go to the Activity bell, with "Merge now", not an orange bar */}
      <OverlapWatch />
      <div className="flex-1 min-h-0 flex">
        {focusMode ? null : <SimpleSidebar />}
        <main className="flex-1 min-w-0 flex flex-col">
          {focusMode ? null : <TopBar active={active} />}
          {onPage ? (
            <button className="flex-none flex items-center gap-1.5 h-8 px-3 text-[12px] text-dim hover:text-ink border-b border-line cursor-pointer"
              onClick={() => setView(active ? "session" : "new")}>
              ← Back to {active ? "your session" : "new session"}
            </button>
          ) : null}
          <CenterStage active={active} split={split} />
          <BottomTerminal active={active} />
        </main>
      </div>
      <Overlays />
    </div>
  );
}
