import { useState } from "react";
import { useApp } from "../store";

const STEPS: [string, string][] = [
  ["Sessions", "Left panel: one row per teammate. Status dot = idle / working / needs-input. Click a row to view; hover for split, DND, pause. + new session spawns a real worktree with a live Claude Code terminal."],
  ["Terminal", "Center: a real Claude Code process — type straight into it. Tabs: shell (plain zsh in the same worktree), changes (working tree + inline diffs + /ship), audit (every tool call the session ran)."],
  ["Right rail", "Tasks (shared board with blocking chains + claimed files), Inbox (async messages, @mentions), Activity (commits + standup), Team (usage, health, CI), Preview (the project's dev server). ⌘1-5 jumps between them."],
  ["Coordination", "The amber banner appears when two people touch the same file. Merge turn lives in the top bar — click when it's yours. Alerts + sounds fire when a session needs input."],
  ["Command palette", "⌘K finds teammates AND runs actions (ship, settings, project switch). ⌘P switches projects. ⌘S ships the active session. Everything's in Settings, including safety blocklist and terminal themes."],
];

export function Onboarding() {
  const { appSettings, setAppSetting } = useApp();
  const [step, setStep] = useState(0);
  if (appSettings.onboarded) return null;
  const done = () => setAppSetting("onboarded", true);
  const [title, body] = STEPS[step];
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="w-[440px] bg-overlay hairline rounded-md shadow-2xl p-5 rise">
        <div className="panel-label mb-1">welcome — {step + 1} / {STEPS.length}</div>
        <div className="font-display font-bold text-[16px] mb-2">{title}</div>
        <p className="text-dim text-[12px] leading-relaxed">{body}</p>
        <div className="flex gap-2 mt-4">
          <button className="btn" onClick={done}>skip tour</button>
          <span className="flex-1" />
          {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}>back</button> : null}
          {step < STEPS.length - 1 ? (
            <button className="btn primary" onClick={() => setStep(step + 1)}>next</button>
          ) : (
            <button className="btn primary" onClick={done}>start working</button>
          )}
        </div>
      </div>
    </div>
  );
}
