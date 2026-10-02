import { useState } from "react";
import { useApp } from "../../store";
import { useBridge } from "../BridgePanel";
import { pendingCount } from "../../lib/bridge";
import { Icon } from "../Icon";
import type { Teammate } from "../../types";

// ---------------------------------------------------------------------------
// Simple layout, top of the center column: the team goal, always visible —
// it's what every agent is told to stay on — plus the active session's
// one primary action (Review & ship) and the right-panel toggle.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

export function GoalBar({ active, rightOpen, onToggleRight }: {
  active: Teammate | undefined;
  rightOpen: boolean;
  onToggleRight: () => void;
}) {
  const goal = useBridge((b) => b.state.goal ?? "");
  const view = useApp((s) => s.view);
  const shipSession = useApp((s) => s.shipSession);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<string | null>(null);
  const waiting = useBridge((b) => pendingCount(b.state));
  const bridgeOpen = useBridge((b) => b.open);
  const setBridgeOpen = useBridge((b) => b.setOpen);

  const save = async () => {
    const g = (draft ?? "").trim();
    setDraft(null);
    if (g === goal) return;
    if (native()) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("bridge_set_goal", { goal: g });
      } catch (e) {
        toast(`Couldn't save the goal: ${e}`, "warn");
        return;
      }
    }
    useBridge.setState((b) => ({ state: { ...b.state, goal: g } }));
  };

  return (
    <div data-tauri-drag-region className="h-12 flex-none border-b border-line flex items-center gap-2 pl-3 pr-2">
      <Icon name="spark" size={13} className="text-faint flex-none" />
      {draft !== null ? (
        <input
          autoFocus
          className="flex-1 min-w-0 bg-raised hairline rounded-md px-2 py-1 text-[13px] outline-none focus:border-accent"
          placeholder="e.g. Ship login + feed by 6pm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setDraft(null);
          }}
          aria-label="Team goal"
        />
      ) : (
        <button
          className={`flex-1 min-w-0 text-left truncate text-[13px] cursor-text rounded-md px-1 py-1 hover:bg-raised/60 ${goal ? "text-ink" : "text-faint"}`}
          title={goal ? "Team goal: every agent is told to stay on this. Click to edit." : "Set a goal so every agent stays on the same track"}
          onClick={() => setDraft(goal)}
        >
          {goal ? <><span className="text-faint">Goal · </span>{goal}</> : "Set a team goal so every agent stays on track…"}
        </button>
      )}
      <button
        className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] cursor-pointer flex-none whitespace-nowrap ${waiting ? "text-warn bg-warn/10" : bridgeOpen ? "text-ink bg-raised" : "text-dim hover:text-ink hover:bg-raised"}`}
        title="The Bridge: plans, hand-offs and questions between the Claude app, your sessions and teammates"
        onClick={() => setBridgeOpen(!bridgeOpen)}
      >
        <Icon name="swap" size={12} /> Bridge{waiting ? <span className="num">{waiting}</span> : null}
      </button>
      {active && view === "session" ? (
        <button
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-ink text-[12.5px] font-medium cursor-pointer hover:brightness-110 flex-none whitespace-nowrap"
          title="Review this session's changes, then ship them (⌘S)"
          onClick={() => shipSession(active.id)}
        >
          <Icon name="push" size={12} /> Review & ship
        </button>
      ) : null}
      <button
        className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer flex-none ${rightOpen ? "text-ink bg-raised" : "text-dim hover:text-ink hover:bg-raised"}`}
        title={rightOpen ? "Hide the side panel" : "Show changes, plan and team"}
        aria-pressed={rightOpen}
        onClick={onToggleRight}
      >
        <Icon name="layout" size={14} />
      </button>
    </div>
  );
}
