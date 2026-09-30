import { useApp } from "../store";
import { GrillFlame } from "./GrillMark";

// First-run consent: before Grill Me writes anything into a repo, say in
// plain words what it adds and what it reads. Hooks install only after
// "Got it" (feeds.ts).

const native = () => "__TAURI_INTERNALS__" in window;

const ITEMS: { title: string; detail: string; file: string }[] = [
  {
    title: "Watches your sessions",
    detail: "So you can see when each one is working, waiting, or done. Grill Me adds one small settings file to each project. It stays on this Mac, never in git.",
    file: ".claude/settings.local.json",
  },
  {
    title: "Adds a /ship shortcut",
    detail: "One click to test, commit, and open a pull request. Also stays out of git.",
    file: ".claude/commands/ship.md",
  },
  {
    title: "Reads your Claude Code chats",
    detail: "That's how sessions show up as chat here. Nothing leaves this Mac unless you turn on the claude.ai link, a team room, or phone pings.",
    file: "~/.claude/projects",
  },
];

export function InstallConsent() {
  const consent = useApp((s) => s.appSettings.installConsent === true);
  const activeProject = useApp((s) => s.activeProject);
  const pickerOpen = useApp((s) => s.pickerOpen);
  const setAppSetting = useApp((s) => s.setAppSetting);
  if (!native() || consent || !activeProject || pickerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 scrim flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="What Grill Me adds" className="w-[460px] max-w-[92vw] glass solid rounded-lg shadow-2xl rise p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <GrillFlame px={3} />
          <div className="font-display font-semibold text-[15px]">Before we start</div>
        </div>
        <div className="text-dim text-[12.5px]">Grill Me does three things to work. That's all:</div>
        <div className="flex flex-col gap-2">
          {ITEMS.map((it) => (
            <div key={it.title} className="bg-raised/60 hairline rounded-md px-3 py-2.5">
              <div className="text-[12.5px] font-semibold">{it.title}</div>
              <div className="text-dim text-[11.5px] mt-1 leading-relaxed">{it.detail}</div>
              <div className="text-faint font-mono text-[10px] mt-1.5">{it.file}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-faint text-[10.5px] flex-1">Change your mind later: Settings → Setup check → Remove from my repos.</span>
          <button className="btn primary flex-none" autoFocus onClick={() => setAppSetting("installConsent", true)}>Got it</button>
        </div>
      </div>
    </div>
  );
}
