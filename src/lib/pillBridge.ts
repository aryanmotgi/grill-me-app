// ---------------------------------------------------------------------------
// The main window's side of the pill. It already knows every session, test
// result, limit and task, so it works out the pill's snapshot (lib/pill.ts),
// sends it to the pill window whenever it changes, and carries out what the
// pill asks for (open a session, undo, next step, focus hour...). It also
// watches sessions finish, for the done glow, the next-step offer, spoken
// updates and the "while you were away" recap.
// ---------------------------------------------------------------------------

import { ptyIdFor, useApp } from "../store";
import { useTests } from "./testsStore";
import { useActivity } from "./activity";
import { sessionTitle } from "./sessionTitle";
import { sessionSentence } from "./sessionSentence";
import { visibleSessions } from "./sessionNav";
import { sessionStats, turnCost } from "./coach";
import { mvpOf } from "./brainPlan";
import { sendToSession } from "./ptyReady";
import { goBack, listSavePoints } from "./savepoints";
import type { AgentUsage } from "./limits";
import {
  DEFAULT_PREFS, NEXT_PROMPTS, focusLeft, glowOf, nextSteps, peekLine, recapLine, spendOf, spokenDone,
  type NextStep, type PillAction, type PillApp, type PillCommand, type PillOutside, type PillPrefs, type PillSession, type PillState,
} from "./pill";

const native = () => "__TAURI_INTERNALS__" in window;
const CONTEXT_WINDOW = 200_000;
const DONE_GLOW_MS = 2 * 60_000;

interface Server { port: number; pid: number; command: string; cwd: string }
interface Outside { id: string; cwd: string; ask: string; status: "working" | "needs" | "done"; at: number }

let started = false;

/** Live data the store doesn't keep: polled here while the pill is open. */
const live = {
  servers: [] as Server[],
  outside: [] as Outside[],
  spend: null as number | null,
  limits: [] as { label: string; pct: number }[],
  next: null as NextStep | null,
  recap: null as string | null,
  lastDoneAt: 0,
  /** what happened, for the away recap */
  log: [] as { at: number; kind: "done" | "needs" | "stuck"; title: string }[],
};

function prefsOf(): PillPrefs {
  const p = useApp.getState().appSettings.pillPrefs as Partial<PillPrefs> | undefined;
  return { ...DEFAULT_PREFS, ...p };
}

function mates() {
  const st = useApp.getState();
  return visibleSessions(st.teammates, st.appMode, st.members.map((m) => m.id)).filter((t) => !t.missing);
}

function folders(): string[] {
  return useApp.getState().members.map((m) => m.repoPath).filter(Boolean);
}

const inFolders = (cwd: string) => folders().some((f) => { const r = f.replace(/\/+$/, ""); return cwd === r || cwd.startsWith(`${r}/`); });

function commands(): PillCommand[] {
  const st = useApp.getState();
  const titles = st.appSettings.sessionTitles;
  return [
    ...mates().map((t) => ({ id: `session:${t.id}`, label: sessionTitle(t, titles), hint: "Go to session" })),
    { id: "view:new", label: "New session", hint: "Start an agent" },
    { id: "view:home", label: "Overview" },
    { id: "view:brain", label: "Brain", hint: "Goal, MVP, plan" },
    { id: "view:flow", label: "Flow" },
    { id: "view:dna", label: "Coding DNA" },
    { id: "view:automations", label: "Automations" },
    ...st.projects.filter((p) => p.id !== st.activeProject).map((p) => ({ id: `project:${p.id}`, label: p.name, hint: "Switch project" })),
    { id: "focus:60", label: "Focus for an hour", hint: "Silence everything that can wait" },
    { id: "focus:0", label: "End focus" },
    { id: "pill:hide", label: "Hide the pill", hint: "⌃⌥P brings it back" },
  ];
}

export function buildState(): PillState {
  const st = useApp.getState();
  const titles = st.appSettings.sessionTitles;
  const tests = useTests.getState().results;
  const pinned = (st.appSettings.pillPinned as string[] | undefined) ?? [];
  const focusUntil = (st.appSettings.pillFocusUntil as number | undefined) ?? null;
  const sessions: PillSession[] = mates().map((t) => {
    const r = tests[t.id];
    const ok = r && !r.running ? r.ok : null;
    const stats = sessionStats(t);
    return {
      id: t.id,
      title: sessionTitle(t, titles),
      status: t.trustPrompt ? "needs-input" : t.status,
      peek: peekLine({ sentence: sessionSentence(t, ok).text, file: t.currentFile, working: t.status === "working", tests: ok }),
      stuck: !!t.flag,
      pinned: pinned.includes(t.id),
      context: stats ? Math.min(1, stats.perTurn / CONTEXT_WINDOW) : null,
    };
  });
  const outside: PillOutside[] = live.outside.map((o) => ({ id: o.id, folder: o.cwd.split("/").filter(Boolean).pop() ?? o.cwd, ask: o.ask, status: o.status }));
  const focus = focusLeft(focusUntil) > 0;
  const apps: PillApp[] = live.servers.filter((s) => inFolders(s.cwd)).map((s) => ({ port: s.port, url: `http://localhost:${s.port}`, name: s.cwd.split("/").pop() ?? `:${s.port}` }));
  const m = mvpOf(st.tasks);
  const project = st.projects.find((p) => p.id === st.activeProject)?.name ?? "Grill Me";
  const last = [...mates()].sort((a, b) => a.lastActiveMin - b.lastActiveMin)[0];
  return {
    project,
    glow: glowOf({ sessions, outside, justDone: Date.now() - live.lastDoneAt < DONE_GLOW_MS, focus }),
    sessions,
    outside,
    team: st.teamSessions.slice(0, 6).map((d) => ({
      name: d.memberName, initials: d.memberName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(), status: d.status, doing: d.sentence || d.title,
    })),
    mvp: m.total ? { done: m.done, total: m.total } : null,
    spend: live.spend,
    limits: live.limits,
    inbox: useActivity.getState().items.filter((i) => !i.read).length,
    focusUntil: focus ? focusUntil : null,
    apps,
    next: live.next,
    recap: live.recap,
    undo: last && last.changes.length ? { sessionId: last.id, title: sessionTitle(last, titles) } : null,
    prefs: prefsOf(),
    commands: commands(),
  };
}

async function emitState() {
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("pill", "pill-state", buildState()).catch(() => {});
}

let pending: ReturnType<typeof setTimeout> | null = null;
function schedule() {
  if (pending) return;
  pending = setTimeout(() => { pending = null; void emitState(); }, 300);
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function showMain() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await w.show().catch(() => {});
  await w.unminimize().catch(() => {});
  await w.setFocus().catch(() => {});
}

async function send(sessionId: string, text: string) {
  const member = useApp.getState().members.find((m) => m.id === sessionId);
  if (!member) return;
  await sendToSession(member, ptyIdFor(member.id), text);
}

async function act(a: PillAction) {
  const st = useApp.getState();
  switch (a.kind) {
    case "open":
      await showMain();
      if (a.sessionId) { st.setView("session"); st.setActive(a.sessionId); }
      else if (a.view) st.setView(a.view as Parameters<typeof st.setView>[0]);
      break;
    case "next": {
      live.next = null;
      if (a.step === "open-app") {
        const app = buildState().apps[0];
        if (app) { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(app.url).catch(() => {}); }
      } else {
        await send(a.sessionId, NEXT_PROMPTS[a.step]);
      }
      break;
    }
    case "undo": {
      const member = st.members.find((m) => m.id === a.sessionId);
      if (!member) break;
      const points = await listSavePoints(member.repoPath);
      const newest = points[0];
      if (newest) await goBack(member.repoPath, newest.id).then((m) => st.toast(m), (e) => st.toast(`Couldn't undo: ${e}`, "warn"));
      break;
    }
    case "focus":
      st.setAppSetting("pillFocusUntil", a.minutes > 0 ? Date.now() + a.minutes * 60_000 : 0);
      break;
    case "pin": {
      const pinned = (st.appSettings.pillPinned as string[] | undefined) ?? [];
      st.setAppSetting("pillPinned", pinned.includes(a.sessionId) ? pinned.filter((x) => x !== a.sessionId) : [...pinned, a.sessionId]);
      break;
    }
    case "send":
      if (a.text.trim()) await send(a.sessionId, a.text.trim());
      break;
    case "drop":
      if (a.paths.length) await send(a.sessionId, `Take a look at ${a.paths.length === 1 ? "this file" : "these files"}:\n${a.paths.join("\n")}`);
      break;
    case "command": {
      const [kind, arg] = a.id.split(/:(.*)/s);
      if (kind === "session") return act({ kind: "open", sessionId: arg });
      if (kind === "view") return act({ kind: "open", view: arg });
      if (kind === "project") { const { switchProject } = await import("./switchProject"); await showMain(); await switchProject(arg); }
      if (kind === "focus") return act({ kind: "focus", minutes: Number(arg) });
      if (kind === "pill" && arg === "hide") await invoke("pill_visible", { on: false });
      break;
    }
    case "prefs":
      st.setAppSetting("pillPrefs", { ...prefsOf(), ...a.prefs });
      break;
    case "dismiss":
      if (a.what === "recap") live.recap = null;
      else live.next = null;
      break;
    case "hide":
      await invoke("pill_visible", { on: false });
      break;
  }
  schedule();
}

/** Watch sessions change state: finished turns, new waits, getting stuck. */
function watchTransitions() {
  const prev = new Map<string, { status: string; flag?: string }>();
  useApp.subscribe((s) => {
    if (!s.teammates) return;
    const titles = s.appSettings.sessionTitles;
    for (const t of s.teammates) {
      const was = prev.get(t.id);
      prev.set(t.id, { status: t.status, flag: t.flag });
      if (!was || t.missing) continue;
      const title = sessionTitle(t, titles);
      if (was.status === "working" && t.status === "idle") {
        live.lastDoneAt = Date.now();
        live.log.push({ at: Date.now(), kind: "done", title });
        const r = useTests.getState().results[t.id];
        const ok = r && !r.running ? r.ok : null;
        const options = nextSteps({ tests: ok, changed: t.changes.length, app: buildState().apps.length > 0, onBranch: !!t.branch && !/^(main|master)$/.test(t.branch) });
        live.next = options.length ? { sessionId: t.id, title, options } : null;
        const quiet = focusLeft((s.appSettings.pillFocusUntil as number | undefined) ?? null) > 0;
        if (!quiet && prefsOf().voice) void invoke("pill_say", { text: spokenDone(title, t.changes.length, ok) }).catch(() => {});
        if (!quiet && prefsOf().sound) void import("@tauri-apps/api/event").then(({ emitTo }) => emitTo("pill", "pill-chime", null)).catch(() => {});
      }
      if (was.status !== "needs-input" && t.status === "needs-input") live.log.push({ at: Date.now(), kind: "needs", title });
      if (!was.flag && t.flag) live.log.push({ at: Date.now(), kind: "stuck", title });
    }
    live.log = live.log.filter((e) => Date.now() - e.at < 24 * 3_600_000).slice(-200);
    schedule();
  });
}

function poll() {
  const loadServers = () => void invoke<Server[]>("dev_servers").then((s) => { live.servers = s; schedule(); }).catch(() => {});
  const loadOutside = () => void invoke<Outside[]>("outside_sessions", { known: folders() }).then((o) => { live.outside = o.filter((x) => !inFolders(x.cwd)); schedule(); }).catch(() => {});
  const loadSpend = () => {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    void invoke<Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>>("spend_since", { since: day.getTime() })
      .then((by) => { live.spend = spendOf(by, (t, model) => turnCost(t, model) ?? 0); schedule(); }).catch(() => {});
  };
  const loadLimits = () => void invoke<[AgentUsage[], string | null]>("agent_usage", { claudeLiveOk: useApp.getState().appSettings.claudeUsageLive === true })
    .then(([u]) => { live.limits = (u.find((x) => x.agent === "claude")?.windows ?? []).map((w) => ({ label: w.label, pct: w.pct })); schedule(); }).catch(() => {});
  loadServers(); loadOutside(); loadSpend(); loadLimits();
  setInterval(loadServers, 10_000);
  setInterval(loadOutside, 5_000);
  setInterval(loadSpend, 60_000);
  setInterval(loadLimits, 60_000);
}

/** Start the pill (unless it's turned off) and keep it fed. Main window only. */
export async function startPill() {
  if (started || !native()) return;
  started = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<PillAction>("pill-action", (e) => void act(e.payload));
  await listen("pill-ready", () => void emitState());
  await listen<{ awaySecs: number; since: number }>("pill-back", (e) => {
    live.recap = recapLine(e.payload.awaySecs, live.log.filter((x) => x.at >= e.payload.since));
    schedule();
  });
  watchTransitions();
  useActivity.subscribe(schedule);
  useTests.subscribe(schedule);
  poll();
  setInterval(schedule, 30_000);
  if (useApp.getState().appSettings.pill !== false) await invoke("pill_open").catch(() => {});
}

/** Settings switch: show or close the pill. */
export async function setPillOn(on: boolean) {
  useApp.getState().setAppSetting("pill", on);
  await invoke(on ? "pill_open" : "pill_close").catch(() => {});
  if (on) schedule();
}
