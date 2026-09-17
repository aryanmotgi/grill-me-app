import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { themes } from "../theme/themes";
import { TERM_FONTS, TERM_PALETTES } from "../theme/termPalettes";
import { isTauri, type TeamMemberConfig } from "../data/sources/git";

// ---------------------------------------------------------------------------
// Settings — tabbed, plain-language, preset-first. Raw power stays available
// behind "advanced" disclosures.
// ---------------------------------------------------------------------------

type Tab = "team" | "appearance" | "terminal" | "notifications" | "safety" | "panels" | "shortcuts";

const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: "team", label: "Team", blurb: "Who's on this project and where their code lives" },
  { id: "appearance", label: "Appearance", blurb: "App-wide colors and density" },
  { id: "terminal", label: "Terminal", blurb: "How the embedded Claude terminals look" },
  { id: "notifications", label: "Notifications", blurb: "What interrupts you, and how" },
  { id: "safety", label: "Safety", blurb: "Commands that always require confirmation" },
  { id: "panels", label: "Panels", blurb: "Show or hide parts of the app" },
  { id: "shortcuts", label: "Shortcuts", blurb: "Keyboard reference" },
];

const SAFETY_PRESETS: { key: string; label: string; detail: string; patterns: string[] }[] = [
  {
    key: "delete",
    label: "Recursive deletes of important paths",
    detail: "rm -rf on /, ~, *, or $HOME",
    patterns: ["rm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\\s+(/|~|\\*|\\$HOME)"],
  },
  {
    key: "forcepush",
    label: "Force-push to main/master",
    detail: "git push --force to a protected branch",
    patterns: [
      "git\\s+push\\s+[^|;]*(--force|-f)\\b[^|;]*\\b(main|master)",
      "git\\s+push\\s+[^|;]*\\b(main|master)\\b[^|;]*(--force|-f)",
    ],
  },
  {
    key: "reset",
    label: "Hard reset to origin",
    detail: "git reset --hard origin — throws away local work",
    patterns: ["git\\s+reset\\s+--hard\\s+origin"],
  },
  {
    key: "clean",
    label: "Delete untracked files",
    detail: "git clean -fd wipes files git doesn't know about",
    patterns: ["git\\s+clean\\s+-[a-z]*f[a-z]*d"],
  },
  {
    key: "db",
    label: "Database drops",
    detail: "DROP TABLE / DROP DATABASE",
    patterns: ["DROP\\s+(TABLE|DATABASE)"],
  },
  {
    key: "disk",
    label: "Disk and device operations",
    detail: "mkfs, writing to /dev disks",
    patterns: ["mkfs", ">\\s*/dev/(sd|disk)"],
  },
  {
    key: "system",
    label: "System-wide changes",
    detail: "chmod 777 on /, shutdown, reboot",
    patterns: ["chmod\\s+-R\\s+777\\s+/", "shutdown|reboot\\b"],
  },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-line/50 last:border-0">
      <div className="w-44 flex-none">
        <div className="text-[11px] text-ink">{label}</div>
        {hint ? <div className="text-[9px] text-faint leading-snug mt-0.5">{hint}</div> : null}
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`w-8 h-[18px] rounded-full flex-none transition-colors cursor-pointer ${checked ? "bg-accent" : "bg-line"}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={`block w-3.5 h-3.5 rounded-full bg-bg transition-transform mt-[2px] ${checked ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

export function SettingsModal() {
  const {
    settingsOpen, settingsTab, setSettingsOpen, members, applyTeamConfig, teammates,
    themeName, setTheme, appSettings, setAppSetting, toast,
    termSettings, setTermSetting, dense, toggleDense, setShared,
  } = useApp();
  const [tab, setTab] = useState<Tab>("team");
  const [draft, setDraft] = useState<TeamMemberConfig[]>([]);
  const modalA11y = useModalA11y("Settings", settingsOpen);

  useEffect(() => {
    if (settingsOpen) setDraft(members.map((m) => ({ ...m })));
  }, [settingsOpen, members]);

  // Deep link: openers can request a specific tab via setSettingsOpen(true, tab).
  useEffect(() => {
    if (settingsOpen && settingsTab && TABS.some((t) => t.id === settingsTab)) {
      setTab(settingsTab as Tab);
    }
  }, [settingsOpen, settingsTab]);

  if (!settingsOpen) return null;

  const saveTeam = async () => {
    const cleaned = draft
      .filter((m) => m.id.trim() && m.repoPath.trim())
      .map((m) => ({
        ...m,
        remote: m.remote?.trim() || undefined,
        tmuxSession: m.tmuxSession?.trim() || undefined,
      }));
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("team_config_write", { cfg: { teammates: cleaned } });
      applyTeamConfig(cleaned);
      toast("Team saved — new sessions spawn automatically");
    } catch (e) {
      toast(`Save failed: ${e}`, "warn");
    }
  };

  const edit = (i: number, key: keyof TeamMemberConfig, val: string) =>
    setDraft((d) => d.map((m, j) => (j === i ? { ...m, [key]: val } : m)));

  const exportSettings = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(appSettings, null, 2)], { type: "application/json" }));
    a.download = "grillme-settings.json";
    a.click();
    toast("Settings exported");
  };

  const importSettings = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result));
        for (const [k, v] of Object.entries(imported)) setAppSetting(k, v);
        toast("Settings imported — some changes apply after relaunch");
      } catch {
        toast("Import failed: not valid JSON", "warn");
      }
    };
    reader.readAsText(file);
  };

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[6vh]" onClick={() => setSettingsOpen(false)}>
      <div
        {...modalA11y}
        className="w-[720px] max-h-[84vh] glass rounded-md shadow-2xl rise flex overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* tab rail */}
        <nav className="w-40 flex-none border-r border-line bg-panel p-2 flex flex-col">
          <div className="font-display font-bold text-[13px] tracking-wide px-2 py-2">SETTINGS</div>
          {TABS.map((t) => (
            <button key={t.id}
              className={`text-left px-2 py-1.5 rounded-sm text-[11px] cursor-pointer transition-colors ${
                tab === t.id ? "bg-raised text-accent" : "text-dim hover:text-ink"
              }`}
              onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          <button className="btn m-2" onClick={() => setSettingsOpen(false)}>close</button>
        </nav>

        {/* content */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4">
            <div className="font-display font-semibold text-[15px]">{active.label}</div>
            <div className="text-faint text-[10px] mt-0.5">{active.blurb}</div>
          </div>

          {tab === "team" ? (
            <>
              {draft.map((m, i) => {
                const mate = teammates.find((t) => t.id === m.id);
                const missing = mate?.health === "disconnected";
                return (
                  <div key={i} className="flex gap-1.5 mb-1.5 items-center">
                    <span title={missing ? "Worktree path not found on this machine" : "Worktree found"}
                      role="img" aria-label={missing ? "worktree missing" : "worktree found"}
                      className={`status-dot flex-none ${missing ? "" : "working"}`}
                      style={missing ? { background: "var(--danger)" } : undefined} />
                    <input className="w-24 bg-raised hairline rounded-sm px-2 py-1 text-[11px] outline-none focus:border-accent"
                      value={m.name} placeholder="name" onChange={(e) => edit(i, "name", e.target.value)} />
                    <input className="flex-1 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
                      value={m.repoPath} placeholder="/path/to/worktree" onChange={(e) => edit(i, "repoPath", e.target.value)} />
                    <input className="w-28 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
                      value={m.remote ?? ""} placeholder="ssh user@host" title="Optional: SSH target — attaches to the shared VM instead of spawning locally"
                      onChange={(e) => edit(i, "remote", e.target.value)} />
                    <input className="w-20 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
                      value={m.tmuxSession ?? ""} placeholder="tmux name" title="Optional: tmux session to attach (remote via ssh, or local)"
                      onChange={(e) => edit(i, "tmuxSession", e.target.value)} />
                    <select className="btn" value={m.permission ?? "view"} title="edit: others can type into their session. view: watch only."
                      onChange={(e) => edit(i, "permission", e.target.value)}>
                      <option value="edit">others can type</option>
                      <option value="view">view only</option>
                    </select>
                    <button className="btn" title="Remove from team" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                      <Icon name="cross" size={9} />
                    </button>
                  </div>
                );
              })}
              <div className="text-faint text-[10px] my-2 leading-relaxed">
                Each row is one live Claude Code session. The first row is you. A red dot means
                the folder doesn't exist on this machine yet — sessions for it stay offline until it does.
              </div>
              <div className="flex gap-2">
                <button className="btn" onClick={() => setDraft((d) => [...d, { id: `member-${d.length}`, name: "", repoPath: "", permission: "view" }])}>
                  <Icon name="plus" size={10} /> add member
                </button>
                <button className="btn primary" onClick={saveTeam}>save team</button>
              </div>
            </>
          ) : null}

          {tab === "appearance" ? (
            <>
              <Row label="App theme" hint="Every color in the app follows this">
                <select className="btn" value={themeName}
                  onChange={(e) => { setTheme(e.target.value); setAppSetting("theme", e.target.value); }}>
                  {Object.keys(themes).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Row>
              <Row label="Compact density" hint="Tighter spacing — useful with 6+ sessions">
                <Toggle checked={dense} onChange={() => toggleDense()} />
              </Row>
              <Row label="Backup & restore" hint="Move your preferences to another machine">
                <button className="btn" onClick={exportSettings}><Icon name="download" size={10} /> export</button>
                <label className="btn cursor-pointer">
                  import
                  <input type="file" accept=".json" className="hidden"
                    onChange={(e) => e.target.files?.[0] && importSettings(e.target.files[0])} />
                </label>
              </Row>
            </>
          ) : null}

          {tab === "terminal" ? (
            <>
              <Row label="Font">
                <select className="btn" value={termSettings.font} onChange={(e) => setTermSetting("font", e.target.value)}>
                  {TERM_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <span className="text-dim text-[10px]">size {termSettings.fontSize}px</span>
                <input type="range" min={9} max={20} value={termSettings.fontSize} className="w-24 accent-(--accent)"
                  onChange={(e) => setTermSetting("fontSize", Number(e.target.value))} />
              </Row>
              <Row label="Line spacing">
                <input type="range" min={1} max={2} step={0.1} value={termSettings.lineHeight} className="w-32 accent-(--accent)"
                  onChange={(e) => setTermSetting("lineHeight", Number(e.target.value))} />
                <span className="text-dim text-[10px]">{termSettings.lineHeight.toFixed(1)}</span>
              </Row>
              <Row label="Color scheme" hint="ember follows the app theme; others make the terminal its own thing">
                <div className="flex gap-1.5 flex-wrap">
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
              </Row>
              <Row label="Text color" hint="Overrides the scheme's default text color">
                <input type="color" value={termSettings.fgOverride ?? "#cfd6cf"}
                  onChange={(e) => setTermSetting("fgOverride", e.target.value)} />
                {termSettings.fgOverride ? (
                  <button className="btn" onClick={() => setTermSetting("fgOverride", null)}>reset</button>
                ) : <span className="text-faint text-[10px]">scheme default</span>}
              </Row>
              <Row label="Background">
                <input type="color" value={termSettings.bgOverride ?? "#0a0c0b"}
                  onChange={(e) => setTermSetting("bgOverride", e.target.value)} />
                {termSettings.bgOverride ? (
                  <button className="btn" onClick={() => setTermSetting("bgOverride", null)}>reset</button>
                ) : <span className="text-faint text-[10px]">scheme default</span>}
                <span className="text-dim text-[10px] ml-2">opacity {Math.round(termSettings.bgOpacity * 100)}%</span>
                <input type="range" min={0.5} max={1} step={0.05} value={termSettings.bgOpacity} className="w-24 accent-(--accent)"
                  onChange={(e) => setTermSetting("bgOpacity", Number(e.target.value))} />
              </Row>
              <Row label="Cursor">
                <select className="btn" value={termSettings.cursorStyle}
                  onChange={(e) => setTermSetting("cursorStyle", e.target.value as "block" | "underline" | "bar")}>
                  <option value="block">block</option>
                  <option value="underline">underline</option>
                  <option value="bar">bar</option>
                </select>
                <span className="text-dim text-[10px]">blink</span>
                <Toggle checked={termSettings.cursorBlink} onChange={(v) => setTermSetting("cursorBlink", v)} />
              </Row>
              <details className="mt-2">
                <summary className="text-faint text-[10px] cursor-pointer">advanced: per-color ANSI overrides</summary>
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
              <div className="mt-3">
                <button className="btn" onClick={() => {
                  import("../theme/termPalettes").then(({ DEFAULT_TERM_SETTINGS }) => {
                    for (const [k, v] of Object.entries(DEFAULT_TERM_SETTINGS)) {
                      setTermSetting(k as keyof typeof DEFAULT_TERM_SETTINGS, v as never);
                    }
                    toast("Terminal reset to defaults");
                  });
                }}>reset terminal to defaults</button>
              </div>
            </>
          ) : null}

          {tab === "notifications" ? (
            <>
              <Row label="New message" hint="OS notification when someone messages you">
                <Toggle checked={appSettings.notifyMessages !== false} onChange={(v) => setAppSetting("notifyMessages", v)} />
              </Row>
              <Row label="Session needs input" hint="When a teammate's Claude is waiting on a decision">
                <Toggle checked={appSettings.notifyNeedsInput !== false} onChange={(v) => setAppSetting("notifyNeedsInput", v)} />
              </Row>
              <Row label="FYI digest" hint="Low-priority FYIs batch into one summary instead of interrupting">
                <select className="btn" value={String(appSettings.fyiDigestMin ?? 15)}
                  onChange={(e) => setAppSetting("fyiDigestMin", Number(e.target.value))}>
                  <option value="5">every 5 min</option>
                  <option value="15">every 15 min</option>
                  <option value="30">every 30 min</option>
                  <option value="60">every hour</option>
                </select>
                <span className="text-faint text-[10px]">blocking / questions / @mentions are always instant</span>
              </Row>
              <Row label="Auto-pause idle sessions" hint="Idle Claude terminals burn CPU repainting — freeze after quiet period, instant resume on view/type">
                <Toggle checked={appSettings.autoPauseIdle !== false} onChange={(v) => setAppSetting("autoPauseIdle", v)} />
                <select className="btn" value={String(appSettings.autoPauseIdleMin ?? 5)}
                  onChange={(e) => setAppSetting("autoPauseIdleMin", Number(e.target.value))}>
                  <option value="5">after 5 min</option>
                  <option value="10">after 10 min</option>
                  <option value="20">after 20 min</option>
                </select>
              </Row>
              <Row label="Self-healing sessions" hint="Auto-restart crashed sessions (max 3/10min); flag stuck ones; ride out rate limits">
                <Toggle checked={appSettings.selfHeal !== false} onChange={(v) => setAppSetting("selfHeal", v)} />
              </Row>
              <Row label="Mute everything" hint="Silences all notifications and sounds">
                <Toggle checked={Boolean(appSettings.muteAll)} onChange={(v) => setAppSetting("muteAll", v)} />
              </Row>
              <div className="panel-label mt-4 mb-1">sounds</div>
              {([
                ["message", "New message", "soft two-tone"],
                ["mention", "@mention", "insistent three-tone"],
                ["needs-input", "Needs input", "rising triple"],
                ["conflict", "File conflict", "low buzz"],
              ] as const).map(([key, label, hint]) => (
                <Row key={key} label={label} hint={hint}>
                  <Toggle
                    checked={((appSettings.sounds as Record<string, boolean>) ?? {})[key] !== false}
                    onChange={(v) => setAppSetting("sounds", {
                      ...((appSettings.sounds as Record<string, boolean>) ?? {}), [key]: v,
                    })} />
                  <button className="btn" onClick={() =>
                    import("../data/sounds").then(({ playAlert }) => playAlert(key, { sounds: {} }))
                  }>test</button>
                </Row>
              ))}
              <div className="mt-3">
                <button className="btn" onClick={async () => {
                  if (!isTauri()) { toast("Notifications need the native app", "warn"); return; }
                  const notif = await import("@tauri-apps/plugin-notification");
                  notif.sendNotification({ title: "Grill Me test", body: "Notifications are working." });
                }}>send test notification</button>
              </div>
            </>
          ) : null}

          {tab === "safety" ? (
            <SafetyTab toast={toast} />
          ) : null}

          {tab === "panels" ? (
            <>
              <Row label="Dev preview tab" hint="Live dev server of the project being built — hide if this project has no web UI">
                <Toggle checked={appSettings.showPreview !== false} onChange={(v) => setAppSetting("showPreview", v)} />
              </Row>
              <div className="panel-label mt-4 mb-1">housekeeping</div>
              <Row label="Replay onboarding tour" hint="Shows the 5-step walkthrough again on next view">
                <button className="btn" onClick={() => { setAppSetting("onboarded", false); toast("Tour will replay"); }}>replay</button>
              </Row>
              <Row label="Clear all inbox messages" hint="Empties the shared inbox for this project — cannot be undone">
                <button className="btn" onClick={async () => {
                  // capture BEFORE clearing local state — these are the ids we delete
                  const clearedIds = useApp.getState().messages.map((m) => m.id);
                  setShared({ messages: [] });
                  if (isTauri()) {
                    const { invoke } = await import("@tauri-apps/api/core");
                    // removed_ids delete only what this user saw; a message
                    // arriving concurrently from another writer survives
                    invoke("shared_upsert", { name: "messages.json", itemsJson: "[]", removedIds: clearedIds }).catch(console.error);
                  }
                  toast("Inbox cleared", "warn");
                }}>clear inbox</button>
              </Row>
            </>
          ) : null}

          {tab === "shortcuts" ? (
            <>
              {([
                ["⌘K", "Command palette — jump to teammates or run actions"],
                ["⌘H", "Home — mission control dashboard"],
                ["⌘/", "Everything Grill Me can do — full feature index"],
                ["⌘P", "Switch project workspace"],
                ["⌘S", "Ship the active session (runs /ship — tests before push)"],
                ["⌘.", "Focus mode — collapse to just your pane"],
                ["⌘1–5", "Right rail tabs: tasks / inbox / activity / team / preview"],
                ["Esc", "Close any overlay"],
                ["1–9 / Enter", "On the project screen: quick-open a project"],
              ] as const).map(([keys, what]) => (
                <div key={keys} className="flex gap-3 py-1.5 border-b border-line/50 last:border-0 text-[11px]">
                  <span className="font-mono text-accent w-20 flex-none">{keys}</span>
                  <span className="text-dim">{what}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SafetyTab({ toast }: { toast: (t: string, k?: "info" | "warn") => void }) {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<string>("blocklist_read").then((raw) => {
        try { setPatterns(JSON.parse(raw)); } catch { setPatterns([]); }
      }).catch(() => {}),
    );
  }, []);

  const presetOn = (p: (typeof SAFETY_PRESETS)[number]) =>
    p.patterns.every((pat) => patterns.includes(pat));
  const knownPatterns = new Set(SAFETY_PRESETS.flatMap((p) => p.patterns));
  const customPatterns = patterns.filter((p) => !knownPatterns.has(p));

  const save = async (next: string[]) => {
    setPatterns(next);
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("blocklist_write", { content: JSON.stringify(next, null, 2) });
      toast("Safety rules updated — applies to every session immediately");
    } catch (e) {
      toast(`Save failed: ${e}`, "warn");
    }
  };

  const togglePreset = (p: (typeof SAFETY_PRESETS)[number], on: boolean) => {
    const without = patterns.filter((pat) => !p.patterns.includes(pat));
    save(on ? [...without, ...p.patterns] : without);
  };

  return (
    <>
      <div className="text-faint text-[10px] mb-3 leading-relaxed">
        Sessions run without permission prompts for speed — these rules are the exception.
        A matching command is stopped and Claude must ask you explicitly first, every time.
      </div>
      {SAFETY_PRESETS.map((p) => (
        <Row key={p.key} label={p.label} hint={p.detail}>
          <Toggle checked={presetOn(p)} onChange={(v) => togglePreset(p, v)} />
        </Row>
      ))}
      <details className="mt-3">
        <summary className="text-faint text-[10px] cursor-pointer">
          advanced: custom patterns (regex){customPatterns.length ? ` — ${customPatterns.length} active` : ""}
        </summary>
        {customPatterns.map((pat) => (
          <div key={pat} className="flex items-center gap-2 mt-1.5">
            <code className="font-mono text-[10px] text-dim flex-1 truncate">{pat}</code>
            <button className="btn" onClick={() => save(patterns.filter((x) => x !== pat))}>
              <Icon name="cross" size={9} />
            </button>
          </div>
        ))}
        <div className="flex gap-1.5 mt-2">
          <input className="flex-1 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
            placeholder="e.g. terraform\\s+destroy" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="btn" onClick={() => { if (custom.trim()) { save([...patterns, custom.trim()]); setCustom(""); } }}>
            add
          </button>
        </div>
      </details>
    </>
  );
}
