// ---------------------------------------------------------------------------
// Real loading progress for the launch animation. The main window starts
// hidden; this tells the splash window (src/splash) how far boot has got, so
// the glass box fills with actual progress, and how many teammates are
// online for "Welcome back". The splash opens the app when it reaches 100%.
// ---------------------------------------------------------------------------

import { memberStatus } from "./roomStatus";

export type BootStep = "start" | "settings" | "restore";

// No "painted" step: WebKit doesn't render a hidden window at all, so the
// app draws only once it's shown. The splash shows it under the box as the
// box starts opening, which gives it the expand (~0.5 s) to paint.
const STEPS: Record<BootStep, { value: number; label: string }> = {
  start: { value: 0.15, label: "Starting" },
  settings: { value: 0.5, label: "Reading your projects" },
  restore: { value: 1, label: "Ready" },
};

/** Progress from the steps done so far: "Ready" once settings and the
 *  restore (projects, team room) have both landed. */
export function progressOf(done: ReadonlySet<BootStep>): { value: number; label: string } {
  if (done.has("settings") && done.has("restore")) return STEPS.restore;
  if (done.has("settings")) return STEPS.settings;
  return STEPS.start;
}

/** Teammates online right now (not counting me). */
export function matesOnline(members: { id: string; lastSeen: number }[], selfId: string | undefined, now: number): number {
  return members.filter((m) => m.id !== selfId && memberStatus(m.lastSeen, now) === "joined").length;
}

const done = new Set<BootStep>(["start"]);
let mates: number | null = null;
const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function send() {
  if (!native()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("splash", "boot-progress", progressOf(done)).catch(() => {});
  if (mates !== null) await emitTo("splash", "splash-info", { mates }).catch(() => {});
}

export function bootStep(step: BootStep) {
  if (done.has(step)) return;
  done.add(step);
  void send();
}

export function bootMates(n: number) {
  if (n === mates) return;
  mates = n;
  void send();
}

// the splash may load after some steps were sent: it asks, we repeat
if (native()) {
  void import("@tauri-apps/api/event").then(({ listen }) => listen("splash-ready", () => void send()));
}
