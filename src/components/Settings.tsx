import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useApp } from "../store";
import { themes } from "../theme/themes";
import { isTauri, type TeamMemberConfig } from "../data/sources/git";

const SHORTCUTS: [string, string][] = [
  ["⌘K", "Quick switcher — jump to any teammate"],
  ["⌘S", "Quick commit + push active worktree"],
  ["⌘.", "Focus mode — collapse to your pane"],
  ["⌘1–5", "Right rail tabs: tasks / inbox / activity / team / preview"],
  ["Esc", "Close overlays"],
];

export function SettingsModal() {
  const {
    settingsOpen, setSettingsOpen, members, applyTeamConfig,
    themeName, setTheme, appSettings, setAppSetting, toast,
  } = useApp();
  const [draft, setDraft] = useState<TeamMemberConfig[]>([]);

  useEffect(() => {
    if (settingsOpen) setDraft(members.map((m) => ({ ...m })));
  }, [settingsOpen, members]);

  if (!settingsOpen) return null;

  const saveTeam = async () => {
    const cleaned = draft.filter((m) => m.id.trim() && m.repoPath.trim());
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("team_config_write", { cfg: { teammates: cleaned } });
      applyTeamConfig(cleaned);
      toast("Team config saved — new sessions spawn on next poll");
    } catch (e) {
      toast(`Save failed: ${e}`, "warn");
    }
  };

  const edit = (i: number, key: keyof TeamMemberConfig, val: string) =>
    setDraft((d) => d.map((m, j) => (j === i ? { ...m, [key]: val } : m)));

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-start justify-center pt-[8vh]" onClick={() => setSettingsOpen(false)}>
      <div
        className="w-[620px] max-h-[80vh] overflow-y-auto bg-overlay hairline rounded-md shadow-2xl rise p-5 flex flex-col gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          <span className="font-display font-bold text-[14px] tracking-wide">SETTINGS</span>
          <span className="flex-1" />
          <button className="btn" onClick={() => setSettingsOpen(false)}>close</button>
        </div>

        {/* team */}
        <section>
          <div className="panel-label mb-2">team · worktrees</div>
          <div className="text-faint text-[10px] mb-2">
            One row per session. repoPath must exist on this machine (or the shared VM).
            Permission "edit" lets others type into that session.
          </div>
          {draft.map((m, i) => (
            <div key={i} className="flex gap-1.5 mb-1.5 items-center">
              <input className="w-16 bg-raised hairline rounded-sm px-2 py-1 text-[11px] outline-none focus:border-accent"
                value={m.id} placeholder="id" onChange={(e) => edit(i, "id", e.target.value)} />
              <input className="w-24 bg-raised hairline rounded-sm px-2 py-1 text-[11px] outline-none focus:border-accent"
                value={m.name} placeholder="name" onChange={(e) => edit(i, "name", e.target.value)} />
              <input className="flex-1 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
                value={m.repoPath} placeholder="/path/to/worktree" onChange={(e) => edit(i, "repoPath", e.target.value)} />
              <select className="btn" value={m.permission ?? "view"} onChange={(e) => edit(i, "permission", e.target.value)}>
                <option value="edit">edit</option>
                <option value="view">view</option>
              </select>
              <button className="btn" title="Remove" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                <Icon name="cross" size={9} />
              </button>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <button className="btn" onClick={() => setDraft((d) => [...d, { id: "", name: "", repoPath: "", permission: "view" }])}>
              <Icon name="plus" size={10} /> add member
            </button>
            <button className="btn primary" onClick={saveTeam}>save team</button>
          </div>
        </section>

        {/* appearance */}
        <section>
          <div className="panel-label mb-2">appearance</div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-dim">Theme</span>
            <select className="btn" value={themeName}
              onChange={(e) => { setTheme(e.target.value); setAppSetting("theme", e.target.value); }}>
              {Object.keys(themes).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="text-faint text-[10px]">All colors flow from one theme object — add more in themes.ts</span>
          </div>
        </section>

        {/* notifications */}
        <section>
          <div className="panel-label mb-2">notifications</div>
          {([
            ["notifyMessages", "OS notification on new inbox message"],
            ["notifyNeedsInput", "OS notification when a session needs input"],
            ["muteAll", "Mute everything (overrides the two above)"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 py-1 text-[11px] cursor-pointer">
              <input type="checkbox" className="accent-(--accent)"
                checked={Boolean(appSettings[key] ?? (key !== "muteAll"))}
                onChange={(e) => setAppSetting(key, e.target.checked)} />
              <span className="text-dim">{label}</span>
            </label>
          ))}
        </section>

        {/* shortcuts */}
        <section>
          <div className="panel-label mb-2">keyboard</div>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex gap-3 py-0.5 text-[11px]">
              <span className="font-mono text-accent w-14">{keys}</span>
              <span className="text-dim">{what}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
