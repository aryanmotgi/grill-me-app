import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useApp } from "../store";
import { themes } from "../theme/themes";
import { TERM_FONTS, TERM_PALETTES } from "../theme/termPalettes";
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
    termSettings, setTermSetting,
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

        {/* terminal customization */}
        <section>
          <div className="panel-label mb-2">terminal</div>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <label className="flex items-center gap-2">
              <span className="text-dim w-16">font</span>
              <select className="btn flex-1" value={termSettings.font}
                onChange={(e) => setTermSetting("font", e.target.value)}>
                {TERM_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-dim w-16">size {termSettings.fontSize}px</span>
              <input type="range" min={9} max={20} value={termSettings.fontSize} className="flex-1 accent-(--accent)"
                onChange={(e) => setTermSetting("fontSize", Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-dim w-16">line {termSettings.lineHeight.toFixed(1)}</span>
              <input type="range" min={1} max={2} step={0.1} value={termSettings.lineHeight} className="flex-1 accent-(--accent)"
                onChange={(e) => setTermSetting("lineHeight", Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-dim w-16">opacity {Math.round(termSettings.bgOpacity * 100)}%</span>
              <input type="range" min={0.5} max={1} step={0.05} value={termSettings.bgOpacity} className="flex-1 accent-(--accent)"
                onChange={(e) => setTermSetting("bgOpacity", Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-dim w-16">cursor</span>
              <select className="btn" value={termSettings.cursorStyle}
                onChange={(e) => setTermSetting("cursorStyle", e.target.value as "block" | "underline" | "bar")}>
                <option value="block">block</option>
                <option value="underline">underline</option>
                <option value="bar">bar</option>
              </select>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" className="accent-(--accent)" checked={termSettings.cursorBlink}
                  onChange={(e) => setTermSetting("cursorBlink", e.target.checked)} />
                blink
              </label>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-dim w-16">background</span>
              <input type="color" value={termSettings.bgOverride ?? "#0a0c0b"}
                onChange={(e) => setTermSetting("bgOverride", e.target.value)} />
              {termSettings.bgOverride ? (
                <button className="btn" onClick={() => setTermSetting("bgOverride", null)}>reset</button>
              ) : <span className="text-faint text-[10px]">theme default</span>}
            </label>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-dim text-[11px]">palette</span>
            {Object.entries(TERM_PALETTES).map(([key, p]) => (
              <button key={key}
                className={`btn ${termSettings.palette === key && !termSettings.customAnsi ? "active" : ""}`}
                onClick={() => { setTermSetting("customAnsi", null); setTermSetting("palette", key); }}>
                <span className="inline-flex gap-0.5 mr-1 align-middle">
                  {p.ansi.slice(1, 7).map((c) => (
                    <span key={c} className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
                  ))}
                </span>
                {p.name}
              </button>
            ))}
          </div>

          <details className="mt-2">
            <summary className="text-faint text-[10px] cursor-pointer">custom ANSI colors (overrides palette)</summary>
            <div className="grid grid-cols-8 gap-1.5 mt-2">
              {(termSettings.customAnsi ?? TERM_PALETTES[termSettings.palette]?.ansi ?? TERM_PALETTES.ember.ansi).map((c, i) => (
                <input key={i} type="color" value={c} title={`ANSI ${i}`}
                  onChange={(e) => {
                    const base = termSettings.customAnsi ?? [...(TERM_PALETTES[termSettings.palette]?.ansi ?? TERM_PALETTES.ember.ansi)];
                    const next = [...base];
                    next[i] = e.target.value;
                    setTermSetting("customAnsi", next);
                  }} />
              ))}
            </div>
          </details>

          <label className="flex items-center gap-2 mt-3 text-[11px] cursor-pointer">
            <input type="checkbox" className="accent-(--accent)" checked={termSettings.skipBanner}
              onChange={(e) => setTermSetting("skipBanner", e.target.checked)} />
            <span className="text-dim">Collapse the Claude Code intro banner after it renders</span>
          </label>
          <div className="text-faint text-[10px] mt-1">
            Terminal styling is independent of the app theme — "ember" tracks it, everything else diverges.
          </div>
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
