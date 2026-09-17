import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { themes, ember } from "../theme/themes";
import { TERM_FONTS, TERM_PALETTES, hexWithOpacity } from "../theme/termPalettes";
import { isTauri, fetchGitState, type TeamMemberConfig } from "../data/sources/git";
import { SHORTCUT_GROUPS } from "../data/shortcuts";
import { CHECKPOINT_MIN_MINUTES, checkpointIntervalMinutes, clampCheckpointInterval } from "../lib/checkpoint";

// ---------------------------------------------------------------------------
// Settings — icon-rail modal, centered + glass. Plain-language, preset-first;
// raw power stays behind "advanced" disclosures. Reorganized + restyled in the
// Phase 2 Settings redesign; every prior toggle/action is preserved.
// ---------------------------------------------------------------------------

type Tab = "team" | "appearance" | "terminal" | "notifications" | "safety" | "checkpoints" | "panels" | "shortcuts";

const TABS: { id: Tab; label: string; blurb: string; icon: string }[] = [
  { id: "team", label: "Team", blurb: "Who's on this project and where their code lives", icon: "team" },
  { id: "appearance", label: "Appearance", blurb: "App-wide colors and density", icon: "palette" },
  { id: "terminal", label: "Terminal", blurb: "How the embedded Claude terminals look", icon: "terminal" },
  { id: "notifications", label: "Notifications", blurb: "What interrupts you, and how", icon: "bell" },
  { id: "safety", label: "Safety", blurb: "Commands that always require confirmation", icon: "lock" },
  { id: "checkpoints", label: "Checkpoints", blurb: "Periodic local snapshot commits so work is never lost", icon: "commit" },
  { id: "panels", label: "Panels", blurb: "Show or hide parts of the app", icon: "layout" },
  { id: "shortcuts", label: "Shortcuts", blurb: "Keyboard reference", icon: "keyboard" },
];

// Searchable keywords per tab — powers the rail match indicator and the
// "no matches here" hint. Row-level filtering below is automatic via context.
const SEARCH_INDEX: Record<Tab, string[]> = {
  team: ["team", "member", "worktree", "repo", "path", "ssh", "remote", "tmux", "role", "permission"],
  appearance: ["theme", "color", "density", "compact", "backup", "restore", "export", "import"],
  terminal: ["font", "size", "line spacing", "color scheme", "palette", "text color", "background", "cursor", "blink", "ansi"],
  notifications: ["message", "input", "digest", "auto-pause", "idle", "self-healing", "mute", "sound", "mention", "conflict", "stall", "stalled", "loop", "looping", "stuck", "silent", "repeat", "budget", "token", "rate", "limit", "cap"],
  safety: ["delete", "force push", "reset", "clean", "database", "drop", "disk", "system", "blocklist", "regex", "pattern"],
  checkpoints: ["checkpoint", "snapshot", "auto", "commit", "backup", "interval", "minutes", "periodic", "save", "recover", "lost work"],
  panels: ["preview", "dev", "tour", "onboarding", "inbox", "clear"],
  shortcuts: ["command palette", "home", "ship", "focus", "shortcut", "keyboard", "esc", "cheatsheet", "navigation", "jump", "session", "search"],
};

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

// Current settings-search query, lowercased. Rows self-filter against it so
// every Row-based control across all tabs filters with zero per-call wiring.
const SearchContext = createContext("");

function rowMatches(query: string, label: string, hint?: string) {
  if (!query) return true;
  return `${label} ${hint ?? ""}`.toLowerCase().includes(query);
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const query = useContext(SearchContext);
  if (!rowMatches(query, label, hint)) return null;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-line/50 last:border-0">
      <div className="w-44 flex-none">
        <div className="text-[11px] text-ink">{label}</div>
        {hint ? <div className="text-[10px] text-faint leading-snug mt-0.5">{hint}</div> : null}
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
  const [query, setQuery] = useState("");
  const modalA11y = useModalA11y("Settings", settingsOpen);

  useEffect(() => {
    if (settingsOpen) setDraft(members.map((m) => ({ ...m })));
  }, [settingsOpen, members]);

  // reset the search each time the modal opens so it never re-opens pre-filtered
  useEffect(() => {
    if (settingsOpen) setQuery("");
  }, [settingsOpen]);

  // Deep link: openers can request a specific tab via setSettingsOpen(true, tab).
  useEffect(() => {
    if (settingsOpen && settingsTab && TABS.some((t) => t.id === settingsTab)) {
      setTab(settingsTab as Tab);
    }
  }, [settingsOpen, settingsTab]);

  const q = query.trim().toLowerCase();
  const tabHasMatch = useMemo(
    () => (id: Tab) => {
      if (!q) return false;
      const meta = TABS.find((t) => t.id === id)!;
      return (
        meta.label.toLowerCase().includes(q) ||
        SEARCH_INDEX[id].some((k) => k.includes(q))
      );
    },
    [q],
  );

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

  const cancelTeam = () => {
    setDraft(members.map((m) => ({ ...m })));
    toast("Team changes discarded", "warn");
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
    <div className="fixed inset-0 z-40 scrim flex items-center justify-center p-4" onClick={() => setSettingsOpen(false)}>
      <div
        {...modalA11y}
        className="w-[880px] max-w-[90vw] h-[620px] max-h-[85vh] glass rounded-lg shadow-2xl rise flex overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* icon rail: brand, search, tabs */}
        <nav className="w-[200px] flex-none border-r border-line bg-panel/60 flex flex-col">
          <div className="font-display font-bold text-[13px] tracking-wide px-3 pt-3 pb-2">SETTINGS</div>
          <div className="px-2 pb-2">
            <label className="flex items-center gap-1.5 bg-raised hairline rounded-sm px-2 py-1.5 focus-within:border-accent">
              <Icon name="search" size={11} className="text-faint" />
              <input
                className="flex-1 min-w-0 bg-transparent text-[11px] outline-none placeholder:text-faint"
                placeholder="find a setting…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button className="text-faint hover:text-ink" title="Clear search" onClick={() => setQuery("")}>
                  <Icon name="cross" size={9} />
                </button>
              ) : null}
            </label>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
            {TABS.map((t) => {
              const activeTab = tab === t.id;
              return (
                <button
                  key={t.id}
                  className={`relative flex items-center gap-2.5 text-left pl-3 pr-2 py-2 rounded-sm text-[11px] cursor-pointer transition-colors ${
                    activeTab ? "bg-raised text-accent" : "text-dim hover:text-ink hover:bg-raised/50"
                  }`}
                  onClick={() => setTab(t.id)}
                >
                  {activeTab ? <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" /> : null}
                  <Icon name={t.icon} size={14} className={activeTab ? "text-accent" : "text-faint"} />
                  <span className="flex-1">{t.label}</span>
                  {!activeTab && tabHasMatch(t.id) ? (
                    <span className="status-dot working w-1.5 h-1.5" title="matches your search" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </nav>

        {/* content column: header, scroll, per-tab sticky footer */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line/60">
            <div>
              <div className="font-display font-semibold text-[15px]">{active.label}</div>
              <div className="text-faint text-[10px] mt-0.5">{active.blurb}</div>
            </div>
            <button className="btn flex-none -mr-1" title="Close settings (Esc)" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
              <Icon name="cross" size={12} />
            </button>
          </div>

          <SearchContext.Provider value={q}>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {q && !tabHasMatch(tab) ? (
                <div className="text-faint text-[10px] mb-3">
                  No matches for “{query.trim()}” in {active.label}. Tabs with a dot in the rail match your search.
                </div>
              ) : null}

              {tab === "team" ? (
                <TeamTab
                  draft={draft}
                  setDraft={setDraft}
                  edit={edit}
                  teammates={teammates}
                  saveTeam={saveTeam}
                  cancelTeam={cancelTeam}
                />
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
                  {!q ? <ThemePreview themeName={themeName} /> : null}
                </>
              ) : null}

              {tab === "terminal" ? (
                <>
                  <Row label="Font">
                    <select className="btn" value={termSettings.font} onChange={(e) => setTermSetting("font", e.target.value)}>
                      {TERM_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <span className="text-dim text-[10px]">size <span className="num">{termSettings.fontSize}</span>px</span>
                    <input type="range" min={9} max={20} value={termSettings.fontSize} className="w-24 accent-(--accent)"
                      onChange={(e) => setTermSetting("fontSize", Number(e.target.value))} />
                  </Row>
                  <Row label="Line spacing">
                    <input type="range" min={1} max={2} step={0.1} value={termSettings.lineHeight} className="w-32 accent-(--accent)"
                      onChange={(e) => setTermSetting("lineHeight", Number(e.target.value))} />
                    <span className="text-dim text-[10px] num">{termSettings.lineHeight.toFixed(1)}</span>
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
                    <span className="text-dim text-[10px] ml-2">opacity <span className="num">{Math.round(termSettings.bgOpacity * 100)}</span>%</span>
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
                  {!q ? <TerminalPreview termSettings={termSettings} /> : null}
                  <details className="mt-3">
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
                  <Row label="Token budget cap" hint="Hard-stop a session that blows its token budget — auto-pauses it (never one waiting on you). Resume grants another cap's worth.">
                    <select className="btn" value={String(appSettings.sessionTokenCap ?? 0)}
                      onChange={(e) => setAppSetting("sessionTokenCap", Number(e.target.value))}>
                      <option value="0">off</option>
                      <option value="100000">100k tokens</option>
                      <option value="200000">200k tokens</option>
                      <option value="500000">500k tokens</option>
                      <option value="1000000">1M tokens</option>
                    </select>
                  </Row>
                  <Row label="Self-healing sessions" hint="Auto-restart crashed sessions (max 3/10min); flag stuck ones; ride out rate limits">
                    <Toggle checked={appSettings.selfHeal !== false} onChange={(v) => setAppSetting("selfHeal", v)} />
                  </Row>
                  <Row label="Stall & loop detection" hint="Flag a session that goes silent, or whose output keeps repeating, so it surfaces in Needs-you">
                    <Toggle checked={appSettings.stallDetect !== false} onChange={(v) => setAppSetting("stallDetect", v)} />
                    <select className="btn" value={String(appSettings.stallThresholdMin ?? 5)}
                      onChange={(e) => setAppSetting("stallThresholdMin", Number(e.target.value))}>
                      <option value="3">silent 3 min</option>
                      <option value="5">silent 5 min</option>
                      <option value="10">silent 10 min</option>
                      <option value="15">silent 15 min</option>
                    </select>
                  </Row>
                  <Row label="Mute everything" hint="Silences all notifications and sounds">
                    <Toggle checked={Boolean(appSettings.muteAll)} onChange={(v) => setAppSetting("muteAll", v)} />
                  </Row>
                  <Row label="Team token budget" hint="Soft daily cap across all sessions — the home meter warns at 50/80/100% and chimes at 80/100. Never blocks anything.">
                    <input type="number" min={0} step={0.5}
                      value={(typeof appSettings.tokenBudget === "number" ? appSettings.tokenBudget : 5_000_000) / 1_000_000}
                      className="w-20 bg-raised hairline rounded-md px-2 py-1 text-[11px] num"
                      onChange={(e) => {
                        const m = Number(e.target.value);
                        setAppSetting("tokenBudget", Number.isFinite(m) && m > 0 ? Math.round(m * 1_000_000) : 5_000_000);
                      }} />
                    <span className="text-dim text-[10px]">million tokens</span>
                  </Row>
                  {(() => {
                    const qh = (appSettings.quietHours as { enabled?: boolean; start?: string; end?: string }) ?? {};
                    const start = typeof qh.start === "string" ? qh.start : "22:00";
                    const end = typeof qh.end === "string" ? qh.end : "07:00";
                    const set = (patch: Partial<typeof qh>) => setAppSetting("quietHours", { enabled: qh.enabled, start, end, ...patch });
                    return (
                      <Row label="Quiet hours" hint="Suppress alert sounds during a nightly window — the test button still previews">
                        <Toggle checked={Boolean(qh.enabled)} onChange={(v) => set({ enabled: v })} />
                        <input type="time" className="btn num" value={start} disabled={!qh.enabled}
                          aria-label="Quiet hours start" onChange={(e) => set({ start: e.target.value })} />
                        <span className="text-faint text-[10px]">to</span>
                        <input type="time" className="btn num" value={end} disabled={!qh.enabled}
                          aria-label="Quiet hours end" onChange={(e) => set({ end: e.target.value })} />
                      </Row>
                    );
                  })()}
                  {!q ? <div className="panel-label mt-4 mb-1">sounds</div> : null}
                  <Row label="Master volume" hint="Scales every notification sound; mute stays independent">
                    <input type="range" min={0} max={1} step={0.05}
                      value={typeof appSettings.soundVolume === "number" ? appSettings.soundVolume : 0.7}
                      className="w-32 accent-(--accent)"
                      onChange={(e) => setAppSetting("soundVolume", Number(e.target.value))} />
                    <span className="text-dim text-[10px] num">
                      {Math.round((typeof appSettings.soundVolume === "number" ? appSettings.soundVolume : 0.7) * 100)}%
                    </span>
                  </Row>
                  {([
                    ["message", "New message / FYI", "soft rising blip"],
                    ["mention", "@mention", "insistent three-tone"],
                    ["needs-input", "Needs input", "ascending attention rise"],
                    ["conflict", "File conflict", "urgent low dissonance"],
                    ["merge-turn", "Your merge turn", "bright ready chime"],
                    ["budget-warn", "Token budget 80%", "two-tone budget warning"],
                    ["budget-max", "Token budget hit", "urgent budget alert"],
                  ] as const).map(([key, label, hint]) => (
                    <Row key={key} label={label} hint={hint}>
                      <Toggle
                        checked={((appSettings.sounds as Record<string, boolean>) ?? {})[key] !== false}
                        onChange={(v) => setAppSetting("sounds", {
                          ...((appSettings.sounds as Record<string, boolean>) ?? {}), [key]: v,
                        })} />
                      <button className="btn" onClick={() =>
                        // preview bypasses the per-kind mute but honors master volume
                        import("../data/sounds").then(({ playAlert }) =>
                          playAlert(key, { sounds: {}, soundVolume: appSettings.soundVolume }))
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

              {tab === "safety" ? <SafetyTab toast={toast} query={q} /> : null}

              {tab === "checkpoints" ? <CheckpointsTab query={q} /> : null}

              {tab === "panels" ? (
                <>
                  <Row label="Dev preview tab" hint="Live dev server of the project being built — hide if this project has no web UI">
                    <Toggle checked={appSettings.showPreview !== false} onChange={(v) => setAppSetting("showPreview", v)} />
                  </Row>
                  {!q ? <div className="panel-label mt-4 mb-1">housekeeping</div> : null}
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
                  {!q ? (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-faint text-[10px] leading-relaxed flex-1">
                        Press <span className="font-mono text-data">?</span> anywhere to open this cheatsheet as an overlay.
                      </span>
                      <button
                        className="btn flex-none"
                        onClick={() => { setSettingsOpen(false); useApp.setState({ cheatsheetOpen: true }); }}
                      >
                        open cheatsheet
                      </button>
                    </div>
                  ) : null}
                  {SHORTCUT_GROUPS.map(([group, shortcuts]) => {
                    const rows = shortcuts.filter((s) => !q || `${s.keys} ${s.what}`.toLowerCase().includes(q));
                    if (rows.length === 0) return null;
                    return (
                      <div key={group} className="mb-3 last:mb-0">
                        <div className="panel-label mb-1.5">{group}</div>
                        {rows.map((s) => (
                          <div key={s.keys} className="flex gap-3 py-1.5 border-b border-line/50 last:border-0 text-[11px]">
                            <span className="font-mono text-data w-20 flex-none">{s.keys}</span>
                            <span className="text-dim">{s.what}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              ) : null}
            </div>
          </SearchContext.Provider>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team tab — an aligned CSS-grid table with a live path-validity dot per row,
// a native folder picker on the path field, and a sticky Save/Cancel footer.
// ---------------------------------------------------------------------------

const TEAM_COLS = "14px 110px minmax(0,1fr) 132px 96px 116px 26px";

function TeamTab({
  draft, setDraft, edit, teammates, saveTeam, cancelTeam,
}: {
  draft: TeamMemberConfig[];
  setDraft: React.Dispatch<React.SetStateAction<TeamMemberConfig[]>>;
  edit: (i: number, key: keyof TeamMemberConfig, val: string) => void;
  teammates: { id: string; health?: string }[];
  saveTeam: () => void;
  cancelTeam: () => void;
}) {
  // Live path validity — reuses the existing git_state command (ok === true
  // means the path exists AND is a real git worktree). Debounced per keystroke.
  const [validity, setValidity] = useState<Record<number, "ok" | "bad" | "checking" | null>>({});
  const pathsKey = draft.map((m) => m.repoPath).join("|");

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const timers = draft.map((m, i) => {
      if (!m.repoPath.trim()) {
        setValidity((v) => ({ ...v, [i]: null }));
        return null;
      }
      setValidity((v) => ({ ...v, [i]: "checking" }));
      return setTimeout(async () => {
        try {
          const st = await fetchGitState(m.repoPath);
          if (!cancelled) setValidity((v) => ({ ...v, [i]: st.ok ? "ok" : "bad" }));
        } catch {
          if (!cancelled) setValidity((v) => ({ ...v, [i]: "bad" }));
        }
      }, 400);
    });
    return () => {
      cancelled = true;
      timers.forEach((t) => t && clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  const pickFolder = async (i: number) => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Pick this member's worktree" });
    if (typeof dir === "string") edit(i, "repoPath", dir);
  };

  const dotFor = (i: number, m: TeamMemberConfig) => {
    let state: "ok" | "bad" | "checking" | null;
    if (isTauri()) {
      state = validity[i] ?? (m.repoPath.trim() ? "checking" : null);
    } else {
      // browser dev: fall back to the git-feed health of the matching teammate
      const mate = teammates.find((t) => t.id === m.id);
      state = !m.repoPath.trim() ? null : mate?.health === "disconnected" ? "bad" : "ok";
    }
    const title =
      state === "ok" ? "Worktree found" :
      state === "bad" ? "Path not found or not a git repo on this machine" :
      state === "checking" ? "Checking path…" : "No path set";
    return (
      <span
        role="img"
        aria-label={title}
        title={title}
        className={`status-dot flex-none ${state === "ok" ? "working" : ""}`}
        style={
          state === "bad" ? { background: "var(--danger)" } :
          state === "checking" || state === null ? { background: "transparent", border: "1.5px solid var(--idle)" } :
          undefined
        }
      />
    );
  };

  return (
    <>
      {/* column header */}
      <div className="grid items-center gap-2 pb-1.5 mb-1 border-b border-line/60" style={{ gridTemplateColumns: TEAM_COLS }}>
        <span />
        <span className="panel-label">name</span>
        <span className="panel-label">repo path</span>
        <span className="panel-label">ssh</span>
        <span className="panel-label">tmux</span>
        <span className="panel-label">role</span>
        <span />
      </div>

      {draft.map((m, i) => (
        <div key={i} className="grid items-center gap-2 py-1" style={{ gridTemplateColumns: TEAM_COLS }}>
          {dotFor(i, m)}
          <input className="w-full min-w-0 bg-raised hairline rounded-sm px-2 py-1 text-[11px] outline-none focus:border-accent"
            value={m.name} placeholder={i === 0 ? "you" : "name"} onChange={(e) => edit(i, "name", e.target.value)} />
          <div className="flex items-center gap-1 min-w-0">
            <input className="flex-1 min-w-0 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
              value={m.repoPath} placeholder="/path/to/worktree" onChange={(e) => edit(i, "repoPath", e.target.value)} />
            <button className="btn px-1.5 py-1 flex-none" title="Pick a folder" onClick={() => pickFolder(i)}>
              <Icon name="folder" size={11} />
            </button>
          </div>
          <input className="w-full min-w-0 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
            value={m.remote ?? ""} placeholder="ssh user@host" title="Optional: SSH target — attaches to the shared VM instead of spawning locally"
            onChange={(e) => edit(i, "remote", e.target.value)} />
          <input className="w-full min-w-0 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
            value={m.tmuxSession ?? ""} placeholder="tmux name" title="Optional: tmux session to attach (remote via ssh, or local)"
            onChange={(e) => edit(i, "tmuxSession", e.target.value)} />
          <select className="btn w-full" value={m.permission ?? "view"} title="edit: others can type into their session. view: watch only."
            onChange={(e) => edit(i, "permission", e.target.value)}>
            <option value="edit">can type</option>
            <option value="view">view only</option>
          </select>
          <button className="btn px-1.5 py-1 flex-none" title="Remove from team" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
            <Icon name="cross" size={9} />
          </button>
        </div>
      ))}

      <div className="text-faint text-[10px] my-2 leading-relaxed">
        Each row is one live Claude Code session. The first row is you. A red dot means the folder
        doesn't exist (or isn't a git repo) on this machine yet — sessions for it stay offline until it does.
      </div>
      <button className="btn"
        onClick={() => setDraft((d) => [...d, { id: `member-${d.length}`, name: "", repoPath: "", permission: "view" }])}>
        <Icon name="plus" size={10} /> add member
      </button>

      {/* sticky footer — stays put while the row list scrolls */}
      <div className="sticky bottom-0 -mx-5 mt-3 px-5 pt-3 pb-1 bg-panel/85 backdrop-blur-sm border-t border-line/60 flex items-center justify-end gap-2">
        <button className="btn" onClick={cancelTeam}>cancel</button>
        <button className="btn primary" onClick={saveTeam}>save team</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Live previews
// ---------------------------------------------------------------------------

function ThemePreview({ themeName }: { themeName: string }) {
  const t = themes[themeName] ?? ember;
  const swatches: { color: string; label: string }[] = [
    { color: t.bg, label: "bg" },
    { color: t.panel, label: "panel" },
    { color: t.accent, label: "accent" },
    { color: t.data, label: "data" },
  ];
  return (
    <div className="mt-4">
      <div className="panel-label mb-1.5">preview</div>
      <div className="rounded-md hairline p-4" style={{ background: t.bg }}>
        <div className="font-display font-bold tracking-[0.14em] text-[15px]" style={{ color: t.accent }}>GRILL ME</div>
        <div className="text-[10px] mt-0.5" style={{ color: t.faint }}>mission control · <span style={{ color: t.data }}>4 sessions</span></div>
        <div className="flex gap-3 mt-3">
          {swatches.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <span className="w-9 h-9 rounded-md" style={{ background: s.color, border: `1px solid ${t.line}` }} />
              <span className="text-[10px]" style={{ color: t.dim }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TerminalPreview({ termSettings }: { termSettings: import("../theme/termPalettes").TermSettings }) {
  const pal = TERM_PALETTES[termSettings.palette] ?? TERM_PALETTES.ember;
  const ansi = termSettings.customAnsi ?? pal.ansi;
  const rawBg = termSettings.bgOverride ?? pal.background;
  const bg = hexWithOpacity(rawBg, termSettings.bgOpacity);
  const fg = termSettings.fgOverride ?? pal.foreground;
  return (
    <div className="mt-4">
      <div className="panel-label mb-1.5">preview</div>
      <div
        className="rounded-md hairline p-3 overflow-x-auto"
        style={{
          background: bg,
          color: fg,
          fontFamily: `"${termSettings.font}", ui-monospace, monospace`,
          fontSize: `${termSettings.fontSize}px`,
          lineHeight: termSettings.lineHeight,
        }}
      >
        <div style={{ color: ansi[10] ?? ansi[2] }} className="whitespace-pre">
          <span style={{ color: ansi[2] }}>❯</span> npm run build
        </div>
        <div className="whitespace-pre">vite v8.0.16 building for production…</div>
        <div style={{ color: ansi[6] ?? fg }} className="whitespace-pre">✓ 42 modules transformed</div>
        <div style={{ color: ansi[2] }} className="whitespace-pre">✓ built in 1.24s</div>
      </div>
    </div>
  );
}

function SafetyPreview({ patterns }: { patterns: string[] }) {
  const samples = ["git status", "npm run build", "rm -rf /", "git push --force origin main"];
  const blocked = (cmd: string) =>
    patterns.some((p) => {
      try { return new RegExp(p, "i").test(cmd); } catch { return false; }
    });
  return (
    <div className="mt-4">
      <div className="panel-label mb-1.5">how commands are judged now</div>
      <div className="rounded-md hairline p-3 flex flex-col gap-1.5">
        {samples.map((cmd) => {
          const isBlocked = blocked(cmd);
          return (
            <div key={cmd} className="flex items-center gap-2">
              <Icon name={isBlocked ? "block" : "check"} size={12} className={isBlocked ? "text-danger" : "text-ok"} />
              <code className="font-mono text-[11px] flex-1 text-dim">{cmd}</code>
              <span className={isBlocked ? "text-danger text-[10px]" : "text-ok text-[10px]"}>
                {isBlocked ? "asks first" : "allowed"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CheckpointsTab({ query }: { query: string }) {
  const { appSettings, setAppSetting, checkpointNow, members } = useApp();
  const enabled = appSettings.autoCheckpoint === true;
  const stored = checkpointIntervalMinutes(appSettings);
  const [draft, setDraft] = useState(String(stored));
  const [running, setRunning] = useState(false);

  // keep the input in sync if the stored value changes elsewhere
  useEffect(() => setDraft(String(stored)), [stored]);

  const commitInterval = () => {
    const next = clampCheckpointInterval(draft);
    setAppSetting("autoCheckpointMinutes", next);
    setDraft(String(next));
  };

  const doNow = async () => {
    setRunning(true);
    try {
      await checkpointNow();
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      {!query ? (
        <div className="text-faint text-[10px] mb-3 leading-relaxed">
          A checkpoint stages everything and commits it on each session's current branch with a
          timestamped message — a local snapshot only, never pushed and never on main or master.
          A clean tree is a no-op.
        </div>
      ) : null}
      <Row label="Auto-checkpoint" hint="Periodically snapshot every session so work is never lost">
        <Toggle checked={enabled} onChange={(v) => setAppSetting("autoCheckpoint", v)} />
      </Row>
      <Row label="Interval" hint="Minutes between snapshots — 5 minute minimum">
        <input
          type="number"
          min={CHECKPOINT_MIN_MINUTES}
          className="w-16 bg-raised hairline rounded-sm px-2 py-1 num text-[11px] outline-none focus:border-accent disabled:opacity-50"
          value={draft}
          disabled={!enabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitInterval}
          onKeyDown={(e) => { if (e.key === "Enter") commitInterval(); }}
        />
        <span className="text-faint text-[10px]">minutes</span>
      </Row>
      <Row
        label="Checkpoint now"
        hint={members.length ? `Snapshot all ${members.length} session${members.length === 1 ? "" : "s"} immediately` : "Add a session first"}
      >
        <button className="btn" onClick={doNow} disabled={running || members.length === 0}>
          {running ? "checkpointing…" : "checkpoint now"}
        </button>
      </Row>
    </>
  );
}

function SafetyTab({ toast, query }: { toast: (t: string, k?: "info" | "warn") => void; query: string }) {
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
      {!query ? (
        <div className="text-faint text-[10px] mb-3 leading-relaxed">
          Sessions run without permission prompts for speed — these rules are the exception.
          A matching command is stopped and Claude must ask you explicitly first, every time.
        </div>
      ) : null}
      {SAFETY_PRESETS.map((p) => (
        <Row key={p.key} label={p.label} hint={p.detail}>
          <Toggle checked={presetOn(p)} onChange={(v) => togglePreset(p, v)} />
        </Row>
      ))}
      {!query ? <SafetyPreview patterns={patterns} /> : null}
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
