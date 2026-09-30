import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { placeCoachmark, type Placed } from "../lib/spotlight";

/**
 * Spotlight tour: a dark overlay with a cut-out highlight around the REAL UI
 * element each step describes, plus a coachmark with back / next / skip.
 * Targets are found by `data-tour="…"` attributes (see SessionList, NavRail,
 * HomeDashboard) and positioned via getBoundingClientRect — so the tour tracks
 * the live layout and re-measures on resize / scroll. If a step's element is
 * not mounted (focus mode, demo mode, wrong view) that step is skipped rather
 * than pointing at nothing.
 */
type Step = { key: string; sel: string; title: string; body: string };

const STEPS: Step[] = [
  {
    key: "sessions",
    sel: '[data-tour="sessions"]',
    title: "Sessions",
    body: "Every Claude Code session in this project. The dot means idle / working / needs you — click one to open it as a chat. Double-click a name to rename it.",
  },
  {
    key: "new-session",
    sel: '[data-tour="new-session"]',
    title: "Start something",
    body: "“+” opens “What are we grilling?” — type a task and Grill Me spins up a session on its own branch. Or “Start a hackathon” to plan the whole build at once.",
  },
  {
    key: "flow",
    sel: '[data-tour="flow"]',
    title: "Flow",
    body: "The whole picture: Claude proposes, you approve, sessions build. Every task, plan or question in flight is a wire here with its one button — and teammates' sessions sit below.",
  },
  {
    key: "brain",
    sel: '[data-tour="brain"]',
    title: "Brain",
    body: "The project's shared notebook: goal, “where was I?”, deadline, pitch, and a code quiz. Every session and Claude read it automatically.",
  },
  {
    key: "claude",
    sel: '[data-tour="claude"]',
    title: "Claude, beside your code",
    body: "⌘J opens Claude next to your sessions — your claude.ai chats, and (once connected) it can see what your sessions are doing.",
  },
  {
    key: "needs-you",
    sel: '[data-tour="needs-you"]',
    title: "Needs you",
    body: "Sessions waiting on a decision land here first. Empty means you're genuinely clear.",
  },
  {
    key: "ship",
    sel: '[data-tour="ship"]',
    title: "Ship",
    body: "See which sessions are ready and ship them — tests, commit, push, PR — in one go.",
  },
  {
    key: "command",
    sel: '[data-tour="command"]',
    title: "Search",
    body: "⌘K jumps to any session or action. ⌘B / ⌘⇧B / ⌘J show or hide the side panels.",
  },
  {
    key: "settings",
    sel: '[data-tour="settings"]',
    title: "Settings",
    body: "Themes, background, the safety blocklist — and the button to replay this tour.",
  },
];

const prefersReduced = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** First step at or after `from` (dir +1) / at or before (dir -1) whose element
 *  is actually in the DOM. Returns -1 when none in that direction are mounted. */
function findMounted(from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < STEPS.length; i += dir) {
    if (document.querySelector(STEPS[i].sel)) return i;
  }
  return -1;
}

export function Onboarding() {
  // narrow selectors — never subscribe to the whole store
  const onboarded = useApp((s) => s.appSettings.onboarded);
  const activeProject = useApp((s) => s.activeProject);
  const pickerOpen = useApp((s) => s.pickerOpen);
  const setAppSetting = useApp((s) => s.setAppSetting);

  // Wait until a project is active — never fight the ProjectPicker for the screen.
  const consented = useApp((s) => s.appSettings.installConsent === true);
  // ...and never fight the first-run consent screen either
  const active = !onboarded && consented && !!activeProject && !pickerOpen;

  const [step, setStep] = useState(0);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const reduced = useRef(prefersReduced()).current;

  const done = useCallback(() => setAppSetting("onboarded", true), [setAppSetting]);

  // Entering the tour (fresh or via "replay"): start at the first mounted step.
  useEffect(() => {
    if (!active) return;
    const first = findMounted(0, 1);
    if (first === -1) done(); // honest fallback: nothing to point at
    else setStep(first);
  }, [active, done]);

  // Measure the current target and place the coachmark. Re-runs on step change,
  // window resize, scroll, and when the target itself resizes.
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const el = document.querySelector(STEPS[step].sel);
      if (!el) {
        // Target vanished (view/mode changed mid-tour) — hop to a mounted step.
        const alt = findMounted(step + 1, 1);
        const next = alt === -1 ? findMounted(step - 1, -1) : alt;
        if (next === -1) done();
        else setStep(next);
        return;
      }
      const r = el.getBoundingClientRect();
      const tip = tipRef.current;
      const size = tip
        ? { width: tip.offsetWidth, height: tip.offsetHeight }
        : { width: 340, height: 160 };
      setPlaced(
        placeCoachmark(
          { left: r.left, top: r.top, width: r.width, height: r.height },
          size,
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };

    // two passes: once now, once after the coachmark has real dimensions
    measure();
    const raf = requestAnimationFrame(measure);

    const el = document.querySelector(STEPS[step].sel);
    const ro =
      el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el as Element);

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, step, done]);

  if (!active || !placed) return null;

  const prev = findMounted(step - 1, -1);
  const next = findMounted(step + 1, 1);
  const { title, body } = STEPS[step];
  // human-facing counter over the steps that are actually reachable right now
  const reachable = STEPS.filter((_, i) => document.querySelector(STEPS[i].sel));
  const shownIndex = reachable.findIndex((s) => s.key === STEPS[step].key) + 1;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* transparent capture layer: swallow clicks on the app while touring */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* the cut-out highlight — box-shadow darkens everything but this rect */}
      <div
        className={`tour-spot ${reduced ? "" : "tour-motion"}`}
        style={{
          left: placed.spot.left,
          top: placed.spot.top,
          width: placed.spot.width,
          height: placed.spot.height,
        }}
      />

      {/* coachmark */}
      <div
        ref={tipRef}
        className={`tour-coachmark w-[340px] max-w-[calc(100vw-24px)] glass rounded-md shadow-2xl p-5 ${reduced ? "" : "rise"}`}
        style={{ left: placed.tip.left, top: placed.tip.top }}
      >
        <div className="panel-label mb-1">
          tour — {shownIndex} / {reachable.length}
        </div>
        <div className="font-display font-bold text-[16px] mb-2">{title}</div>
        <p className="text-dim text-[12px] leading-relaxed">{body}</p>
        <div className="flex gap-2 mt-4">
          <button className="btn" onClick={done}>skip tour</button>
          <span className="flex-1" />
          {prev !== -1 ? (
            <button className="btn" onClick={() => setStep(prev)}>back</button>
          ) : null}
          {next !== -1 ? (
            <button className="btn primary" onClick={() => setStep(next)}>next</button>
          ) : (
            <button className="btn primary" onClick={done}>start working</button>
          )}
        </div>
      </div>
    </div>
  );
}
