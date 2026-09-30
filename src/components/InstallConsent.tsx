import { useApp } from "../store";
import { GrillFlame } from "./GrillMark";

// First-run consent: before Grill Me writes anything into a repo, say exactly
// what it adds and what it reads. Hooks install only after "Got it" (feeds.ts).

const native = () => "__TAURI_INTERNALS__" in window;

const ITEMS: [string, string][] = [
  ["Hooks in .claude/settings.local.json", "So each session reports when it's working, waiting or done, and the shared brain reaches it. Per-machine file, kept out of git."],
  ["A /ship command in .claude/commands", "The review screen's “approve & ship” runs it. Also kept out of git."],
  ["Reads your Claude Code chats", "From ~/.claude/projects, to show sessions as chat and catch Claude up. Nothing leaves this Mac unless you turn on the claude.ai connection, a team room or phone pings."],
];

export function InstallConsent() {
  const consent = useApp((s) => s.appSettings.installConsent === true);
  const activeProject = useApp((s) => s.activeProject);
  const pickerOpen = useApp((s) => s.pickerOpen);
  const setAppSetting = useApp((s) => s.setAppSetting);
  if (!native() || consent || !activeProject || pickerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 scrim flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="What Grill Me adds" className="w-[520px] max-w-[92vw] glass rounded-lg shadow-2xl rise p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <GrillFlame px={3} />
          <div className="font-display font-semibold text-[15px]">Before we start</div>
        </div>
        <div className="text-dim text-[12px]">Grill Me adds two small things to each project repo and reads your Claude Code chats. That's all:</div>
        <div className="flex flex-col gap-2.5">
          {ITEMS.map(([title, detail]) => (
            <div key={title} className="hairline rounded-md px-3 py-2">
              <div className="text-[12px] font-semibold">{title}</div>
              <div className="text-dim text-[11px] mt-0.5">{detail}</div>
            </div>
          ))}
        </div>
        <div className="text-faint text-[10.5px]">Undo any time: Settings → Setup check → Remove from my repos.</div>
        <button className="btn primary self-end" autoFocus onClick={() => setAppSetting("installConsent", true)}>Got it</button>
      </div>
    </div>
  );
}
