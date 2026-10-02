import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { ForgeWorld } from "../forge/engine";
import { constellationFromScan, toolCount } from "../forge/constellation";
import { playLogo3D } from "../forge/logo3d";
import { GlassCard } from "../forge/glassCard";
import "../forge/forge.css";
import { LOGO_TEXT } from "../brand";
import { probeFps } from "../lib/perf";
import { runDoctor, type DoctorCheck } from "./DoctorTab";
import { CONSENT_ITEMS } from "./InstallConsent";
import { SCAN_SOURCES, type ScanResult } from "../lib/scan";
import type { Catalog } from "../lib/catalog";
import { builtinCatalog, loadCatalog } from "../lib/catalogLoad";
import { addProjectFromFinder, openProjectAt } from "../lib/addProject";
import { FIRST_RUN_STEPS, firstRunStepOf, nextStep, prevStep, stepNumber, type FirstRunStep } from "../lib/firstRun";
import { interviewBrainOf, pickBrain, readyAis, type AiStatus } from "../lib/aiConnect";
import { BRAIN_NAMES, MAX_ANSWERS, MAX_ANSWER_CHARS, OPENING, OPENING_OPTIONS, REPLY_SCHEMA, SYSTEM_PROMPT, buildPrompt, mergeReply, type Turn } from "../lib/interview";
import { MAX_PAINS, PAINS, STAGES, STYLE, TEAM, emptyProfile, profileOf, suggestUpgrades, toolsYouHave, workflowStages, type Upgrade, type WorkflowProfile } from "../lib/profile";

// ---------------------------------------------------------------------------
// First run, floating over the user's own apps (no background). Everything
// lives on one "stage" in the middle of the screen with the same layout on
// every step, so a first-time user always knows where they are and what to
// do: step N of 6 · what this step is · a plain sentence on why and what to
// do · the step's content (diagrams stay inside it) · Back / Skip / the one
// main button, always in the same places. A soft native blur sits behind
// the stage only (src-tauri/src/blur.rs); clicks anywhere else reach the
// apps behind. Esc leaves from anywhere; Enter presses the main button.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;
const REQUIRED = ["claude", "git", "python3"];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const STEP_NAMES: Record<string, string> = { welcome: "Welcome", setup: "Get set up", project: "Your project", tools: "Your tools", workflow: "Your workflow", finish: "Finish" };

interface Forge {
  world: ForgeWorld;
  reduce: boolean;
  go: (s: FirstRunStep) => void;
  toast: (msg: string) => void;
  wait: (ms: number) => Promise<void>;
  /** an answer is absorbed into the Spark */
  absorb: (el: Element | null) => void;
  finish: (fast: boolean) => void;
  /** stay above other windows (off while a browser sign-in is open) */
  front: (on: boolean) => void;
}
interface SceneProps { f: Forge; step: FirstRunStep }

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
async function openExternal(url: string) {
  if (!native()) { window.open(url, "_blank"); return; }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url).catch(() => {});
}

// =================================================================== the stage

interface Action { label: string; onClick: () => void; disabled?: boolean }

/** The one layout every step uses. */
function Stage({ f, step, title, body, children, primary, secondary, skip, back = true, viewHeight = 0, note }: {
  f: Forge; step: FirstRunStep; title: string; body: string; children?: React.ReactNode;
  primary?: Action; secondary?: Action; skip?: Action; back?: boolean; viewHeight?: number; note?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const typed = useTyped(f, body);
  const n = stepNumber(step);

  // the Spark sits just above the stage; diagrams live in the view area
  useLayoutEffect(() => {
    const place = () => {
      const p = panelRef.current?.getBoundingClientRect();
      if (p) f.world.sparkTo(innerWidth / 2, Math.max(70, p.top - 58), 15);
      const v = viewRef.current?.getBoundingClientRect();
      if (v) f.world.setViewport({ x: v.left, y: v.top, w: v.width, h: v.height });
    };
    place();
    const t = window.setInterval(place, 300);
    addEventListener("resize", place);
    return () => { clearInterval(t); removeEventListener("resize", place); };
  });

  // a new stage: the card's rim flares
  useEffect(() => { dispatchEvent(new Event("forge-stage")); }, [title]);

  // the main button throws a few embers as it's pressed
  const press = (btn: HTMLElement | null) => {
    if (!primary || primary.disabled) return;
    if (btn) {
      const r = btn.getBoundingClientRect();
      f.world.burstAt(r.left + r.width / 2, r.top + r.height / 2, 16, .9);
      btn.classList.remove("pressed"); void btn.offsetWidth; btn.classList.add("pressed");
    }
    primary.onClick();
  };

  // Enter presses the main button (unless typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !primary || primary.disabled) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      e.preventDefault();
      press(panelRef.current?.querySelector<HTMLElement>(".forge-btn.primary") ?? null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [primary]);

  return (
    <div ref={panelRef} key={title} className="forge-panel">
      <div className="forge-eyebrow">
        <span className="dots" aria-hidden>{FIRST_RUN_STEPS.map((s, i) => <i key={s} className={i < n - 1 ? "on" : i === n - 1 ? "on now" : ""} />)}</span>
        <span>Step {n} of {FIRST_RUN_STEPS.length} · {STEP_NAMES[step]}</span>
      </div>
      <h1 className="forge-title">{title}</h1>
      <p className="forge-body" aria-live="polite">{typed.text}{typed.done ? null : <span className="caret" />}</p>
      <div className={`forge-stagebody ${typed.done ? "in" : ""}`}>
        {viewHeight ? <div ref={viewRef} className="forge-view" style={{ height: viewHeight }} /> : null}
        {children}
      </div>
      <div className={`forge-footer ${typed.done ? "in" : ""}`}>
        <div className="left">{back ? <button type="button" className="forge-link" onClick={() => f.go(prevStep(step))}>← Back</button> : null}</div>
        <div className="mid">{skip ? <button type="button" className="forge-link" onClick={skip.onClick}>{skip.label}</button> : null}</div>
        <div className="right">
          {secondary ? <button type="button" className="forge-btn" onClick={secondary.onClick} disabled={secondary.disabled}>{secondary.label}</button> : null}
          {primary ? <button type="button" className="forge-btn primary" onClick={(e) => press(e.currentTarget)} disabled={primary.disabled}><span>{primary.label}</span></button> : null}
        </div>
      </div>
      {note ? <div className="forge-foot-note">{note}</div> : null}
    </div>
  );
}

/** Types `text` out while the Spark pulses; instant with Reduce Motion. */
function useTyped(f: Forge, text: string): { text: string; done: boolean } {
  const [n, setN] = useState(f.reduce ? text.length : 0);
  useEffect(() => {
    if (f.reduce) { setN(text.length); return; }
    let live = true;
    setN(0);
    f.world.spark.speaking = true;
    void (async () => {
      for (let i = 1; i <= text.length; i++) {
        if (!live) return;
        setN(i);
        await sleep(".?!".includes(text[i - 1]) ? 150 : text[i - 1] === "," ? 60 : 14);
      }
      if (live) f.world.spark.speaking = false;
    })();
    return () => { live = false; f.world.spark.speaking = false; };
  }, [text]);
  return { text: text.slice(0, n), done: n >= text.length };
}

// =================================================================== the shell

export function ForgeOnboarding() {
  const step = useApp((s) => firstRunStepOf(s.appSettings.firstRunStep));
  const setAppSetting = useApp((s) => s.setAppSetting);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shadeRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<GlassCard | null>(null);
  const [f, setF] = useState<Forge | null>(null);
  const [ready, setReady] = useState(false);
  const [finale, setFinale] = useState<null | "full" | "fast">(null);
  const finaleRef = useRef(finale);
  finaleRef.current = finale;

  useEffect(() => {
    document.documentElement.classList.add("forge-on");
    // ?reduce-motion forces the still version (handy to check it in a browser)
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || location.search.includes("reduce-motion");
    let world: ForgeWorld;
    try { world = new ForgeWorld(canvasRef.current!, shadeRef.current!, labelsRef.current!, reduce); }
    catch { setAppSetting("firstRunStep", "done"); return; } // no WebGL: straight to the app
    const wait = (ms: number) => sleep(reduce ? Math.min(ms, 200) : ms);
    let toastT = 0;
    const toast = (msg: string) => {
      const el = toastRef.current!;
      el.textContent = msg;
      el.classList.add("on");
      clearTimeout(toastT);
      toastT = window.setTimeout(() => el.classList.remove("on"), 3400);
    };
    const forge: Forge = {
      world, reduce, wait, toast,
      // the old stage blurs away first, then the new one rises in
      go: (s) => {
        const panel = rootRef.current?.querySelector<HTMLElement>(".forge-panel");
        if (reduce || !panel) { useApp.getState().setAppSetting("firstRunStep", s); return; }
        if (panel.classList.contains("leaving")) return; // a double click
        panel.classList.add("leaving");
        window.setTimeout(() => useApp.getState().setAppSetting("firstRunStep", s), 260);
      },
      absorb: (el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        world.burstAt(r.left + r.width / 2, r.top + r.height / 2, 10, .85);
        world.feed();
      },
      finish: (fast) => { if (!finaleRef.current) setFinale(fast ? "fast" : "full"); },
      front: (on) => { if (native()) void invoke("forge_front", { on }).catch(() => {}); },
    };
    world.onLite = () => toast("Using fewer effects: this computer is busy right now");
    world.start();
    // only what's drawn is clickable: tell the app where that is, so clicks
    // on empty space fall through to the apps behind
    let lastHit = "";
    const hitTimer = window.setInterval(() => {
      if (!native() || !rootRef.current) return;
      const rects: number[][] = [];
      const add = (x: number, y: number, w: number, h: number) => { if (w > 0 && h > 0) rects.push([Math.round(x - 8), Math.round(y - 8), Math.round(w + 16), Math.round(h + 16)]); };
      rootRef.current.querySelectorAll(".forge-panel, .forge-hud, .forge-toast.on").forEach((el) => { const r = el.getBoundingClientRect(); add(r.left, r.top, r.width, r.height); });
      const card = cardRef.current?.rect();
      if (card) add(...card);
      if (world.spark.born && world.spark.alpha > 0) add(...world.sparkRect());
      const key = JSON.stringify(rects);
      if (key !== lastHit) { lastHit = key; void invoke("forge_hit_rects", { rects }).catch(() => {}); }
    }, 120);
    const stopBlur = native() ? startBlurMask(rootRef.current!) : () => {};
    void probeFps("forge-intro", 9000, () => ({ cpuMsPerFrame: world.workAvg() }));
    setF(forge);
    // first time in: the 3D wordmark arrives, shrinks to a point, and the
    // Spark is born there. Resuming mid-setup (a project reload) skips it.
    void (async () => {
      const first = firstRunStepOf(useApp.getState().appSettings.firstRunStep) === "welcome";
      if (first && logoRef.current) {
        rootRef.current?.classList.add("arriving");
        const at = await playLogo3D(logoRef.current, LOGO_TEXT, reduce).catch(() => ({ x: innerWidth / 2, y: innerHeight * .3 }));
        rootRef.current?.classList.remove("arriving");
        world.sparkBorn(at.x, at.y);
        world.burstAt(at.x, at.y, 40, 1);
        await wait(500);
      } else world.sparkBorn(innerWidth / 2, innerHeight * .2);
      setReady(true);
    })();
    return () => { clearInterval(hitTimer); stopBlur(); world.stop(); document.documentElement.classList.remove("forge-on"); };
  }, []);

  // the stage's card: wavy glass under the diagrams (so they stay bright),
  // following the stage and fading in and out with it
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || location.search.includes("reduce-motion");
    const card = new GlassCard(backdropRef.current!, reduce);
    cardRef.current = card;
    let raf = 0;
    const follow = () => {
      card.setRect(rootRef.current?.querySelector<HTMLElement>(".forge-panel")?.getBoundingClientRect() ?? null);
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    const flare = () => card.pulse();
    addEventListener("forge-stage", flare);
    return () => { cancelAnimationFrame(raf); removeEventListener("forge-stage", flare); card.stop(); cardRef.current = null; };
  }, []);

  // Esc / "Leave": always works, from anywhere
  const leave = () => {
    const st = useApp.getState();
    st.setAppSetting("onboarded", true);
    if (st.appMode === null) st.setAppMode("solo");
    f?.finish(true);
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); leaveRef.current(); } };
    addEventListener("keydown", onKey);
    let un: (() => void) | undefined;
    if (native()) void import("@tauri-apps/api/event").then(({ listen }) => listen("forge-escape", () => leaveRef.current())).then((u) => { un = u; });
    return () => { removeEventListener("keydown", onKey); un?.(); };
  }, []);

  // finale: the card's rim flares, it folds into a line of light, then a
  // point, a flash, and the app opens behind it
  useEffect(() => {
    if (!finale || !f) return;
    const q = f.reduce ? 0 : finale === "fast" ? .5 : 1;
    const card = cardRef.current;
    void (async () => {
      card?.hold(true);
      card?.pulse();
      f.world.collapse();
      f.world.fadeSpark();
      await sleep(250 * q);
      const T = 1100 * q, t0 = performance.now();
      while (q && performance.now() - t0 < T) {
        card?.setSqueeze((performance.now() - t0) / T);
        await new Promise((r) => requestAnimationFrame(r));
      }
      card?.setSqueeze(1);
      const c = card?.center() ?? { x: innerWidth / 2, y: innerHeight / 2 };
      if (q) f.world.burstAt(c.x, c.y, 70, 1.3);
      flashRef.current?.style.setProperty("--x", `${c.x}px`);
      flashRef.current?.style.setProperty("--y", `${c.y}px`);
      flashRef.current?.classList.add("on");
      card?.hold(false);
      await sleep(420 * q);
      setAppSetting("firstRunStep", "done");
      if (native()) await invoke("forge_window_done").catch(() => {});
    })();
  }, [finale, f]);

  return (
    <div ref={rootRef} className="forge" role="dialog" aria-label="Set up Grill Me">
      <canvas ref={backdropRef} className="forge-backdrop" aria-hidden />
      <canvas ref={shadeRef} />
      <canvas ref={canvasRef} />
      <canvas ref={logoRef} className="forge-logo" />
      <div ref={labelsRef} className="forge-labels" aria-hidden />
      <div className="forge-ui">{f && ready && !finale ? <Scene step={step} f={f} /> : null}</div>
      <div ref={flashRef} className="forge-flash" aria-hidden />
      {!finale ? (
        <div className="forge-hud">
          <b>Grill Me</b><span>Setup</span>
          <span className="grow" />
          <button type="button" onClick={leave}>Esc to leave</button>
        </div>
      ) : null}
      <div ref={toastRef} className="forge-toast" role="status" />
    </div>
  );
}

// ---- the soft blur behind the stage -----------------------------------------------------
// macOS vibrancy sits behind the whole (transparent) window, but a mask
// limits it to the stage and the corner labels: soft, feathered blobs that
// fade in when a step appears and fade out when it goes. Painted small and
// stretched by macOS, so the edges stay soft. Sent ~20×/s, only on change.
const BLUR_SCALE = 6;

function startBlurMask(root: HTMLElement): () => void {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const pieces = new Map<string, { r: [number, number, number, number]; a: number; target: number; pad: number }>();
  let lastSig = "";
  const tick = () => {
    const now = new Map<string, { r: [number, number, number, number]; pad: number }>();
    const panel = root.querySelector<HTMLElement>(".forge-panel");
    if (panel) {
      // the whole stage, from the first frame: the card sits there too
      const r = panel.getBoundingClientRect();
      if (r.width) now.set("panel", { r: [r.left, r.top, r.width, r.height], pad: 30 });
    }
    root.querySelectorAll(".forge-hud > *").forEach((el, i) => { const r = el.getBoundingClientRect(); if (r.width) now.set(`hud${i}`, { r: [r.left, r.top, r.width, r.height], pad: 12 }); });
    if (root.classList.contains("arriving")) now.set("logo", { r: [innerWidth * .25, innerHeight * .18, innerWidth * .5, innerHeight * .3], pad: 30 });
    for (const [k, v] of now) { const p = pieces.get(k); if (p) { p.r = v.r; p.pad = v.pad; p.target = 1; } else pieces.set(k, { ...v, a: 0, target: 1 }); }
    for (const [k, p] of pieces) {
      if (!now.has(k)) p.target = 0;
      p.a += (p.target - p.a) * .22;
      if (p.target === 0 && p.a < .02) pieces.delete(k);
    }
    const sig = [...pieces.values()].map((p) => `${p.r.map((n) => Math.round(n / 3)).join(",")}:${p.a.toFixed(2)}`).join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    const w = Math.ceil(innerWidth / BLUR_SCALE), h = Math.ceil(innerHeight / BLUR_SCALE);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    for (const p of pieces.values()) {
      if (p.a < .01) continue;
      const [x, y, rw, rh] = p.r;
      ctx.save();
      // only the blurred shadow of the shape lands on the canvas: feathered edges
      ctx.shadowColor = `rgba(255,255,255,${Math.min(1, p.a)})`;
      ctx.shadowBlur = p.pad / BLUR_SCALE * 1.3;
      ctx.shadowOffsetX = 10000;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      const pad = p.pad * .55;
      ctx.roundRect((x - pad) / BLUR_SCALE - 10000, (y - pad) / BLUR_SCALE, (rw + pad * 2) / BLUR_SCALE, (rh + pad * 2) / BLUR_SCALE, 24 / BLUR_SCALE);
      ctx.fill();
      ctx.restore();
    }
    void invoke("forge_blur_mask", { pngBase64: canvas.toDataURL("image/png") }).catch(() => {});
  };
  const timer = window.setInterval(tick, 50);
  return () => clearInterval(timer);
}

/** Show first-run setup? Waits for settings so existing users never see a flash. */
export function useFirstRunActive(): boolean {
  const loaded = useApp((s) => s.settingsLoaded);
  const step = useApp((s) => s.appSettings.firstRunStep);
  return loaded && step != null && step !== "done";
}

function Scene({ step, f }: { step: FirstRunStep; f: Forge }) {
  switch (step) {
    case "welcome": return <Welcome f={f} step={step} />;
    case "setup": return <Setup f={f} step={step} />;
    case "project": return <Project f={f} step={step} />;
    case "tools": return <Tools f={f} step={step} />;
    case "workflow": return <Workflow f={f} step={step} />;
    case "finish": return <Finish f={f} step={step} />;
    default: return null;
  }
}

// =================================================================== 1. welcome

function Welcome({ f, step }: SceneProps) {
  const setAppSetting = useApp((s) => s.setAppSetting);
  const begin = (join: boolean) => { setAppSetting("firstRunJoining", join); f.go(nextStep(step)); };
  return (
    <Stage f={f} step={step} back={false}
      title="Let's set up Grill Me"
      body="It takes about three minutes. I'll learn how you work, then set Grill Me up around it. You can leave anytime with Esc."
      primary={{ label: "Get started", onClick: () => begin(false) }}
      secondary={{ label: "I have a team invite", onClick: () => begin(true) }}>
      <ol className="forge-plan">
        <li><b>Connect your AI</b><span>So I can ask you a few questions</span></li>
        <li><b>Pick your project</b><span>The code you'll work on</span></li>
        <li><b>See your workflow</b><span>And what would make it better</span></li>
      </ol>
    </Stage>
  );
}

// =================================================================== 2. get set up

const SAMPLE_AIS: AiStatus[] = [
  { id: "claude", name: "Claude Code", installed: true, signedIn: true, detail: "" },
  { id: "codex", name: "Codex", installed: true, signedIn: false, detail: "" },
];

function Setup({ f, step }: SceneProps) {
  const setAppSetting = useApp((s) => s.setAppSetting);
  const saved = useApp((s) => s.appSettings.interviewBrain);
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [busy, setBusy] = useState("");
  const [rows, setRows] = useState<AiStatus[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [waiting, setWaiting] = useState("");
  const refresh = () => { void runDoctor().then(setChecks); };
  useEffect(() => {
    refresh();
    const load = native() ? invoke<AiStatus[]>("ai_status", { ids: null }).catch(() => []) : Promise.resolve(SAMPLE_AIS);
    void load.then((r) => { setRows(r); setChosen(pickBrain(r, saved)); });
  }, []);
  const required = (checks ?? []).filter((c) => REQUIRED.includes(c.id));
  const missing = required.filter((c) => !c.ok);
  const installed = (rows ?? []).filter((r) => r.installed);
  const ready = readyAis(rows ?? []);

  const install = async (c: DoctorCheck) => {
    setBusy(c.id);
    try { await invoke("doctor_install", { id: c.id }); refresh(); } catch (e) { f.toast(`${e}`); } finally { setBusy(""); }
  };
  const ignite = (now: AiStatus) => { setRows((rs) => (rs ?? []).map((x) => (x.id === now.id ? now : x))); setChosen(now.id); };
  const signIn = async (r: AiStatus) => {
    setWaiting(r.id);
    if (!native()) { await sleep(1400); ignite({ ...r, signedIn: true }); setWaiting(""); return; }
    // the browser opens for the sign-in: let it come to the front meanwhile
    f.front(false);
    f.toast(`A browser window is opening to sign in to ${r.name}. Come back when it says you're done.`);
    const started = Date.now();
    const poll = window.setInterval(() => {
      if (Date.now() - started > 10 * 60_000) { window.clearInterval(poll); setWaiting(""); f.front(true); return; }
      void invoke<AiStatus[]>("ai_status", { ids: [r.id] }).then(([now]) => {
        if (now?.signedIn === true) { window.clearInterval(poll); setWaiting(""); f.front(true); ignite(now); f.toast(`${r.name} is connected`); }
      }).catch(() => {});
    }, 3000);
    invoke("ai_login", { id: r.id }).catch((e) => f.toast(`${e}`));
  };
  const next = (brain: string) => { setAppSetting("interviewBrain", brain); f.go(nextStep(step)); };

  // one plain line: what to do now
  const checking = native() && checks === null;
  const nextHint = checking || rows === null ? "One moment, checking this Mac…"
    : missing.length ? `Install ${missing.map((c) => c.label).join(" and ")} above, or continue and do it later.`
    : waiting ? "Finish signing in, in your browser. This page updates by itself."
    : ready.length ? `All set. Continue and ${BRAIN_NAMES[chosen] ?? "your AI"} will ask you a few questions.`
    : installed.length ? "Sign in to one of your AIs above, or continue with quick questions."
    : "Continue: you'll answer a few quick questions instead.";

  return (
    <Stage f={f} step={step}
      title="Get set up"
      body="Two quick checks: the tools Grill Me needs on this Mac, and which AI will ask you a few questions."
      primary={{ label: ready.length ? `Continue with ${BRAIN_NAMES[chosen] ?? "your AI"}` : "Continue", onClick: () => next(ready.length ? (chosen || ready[0].id) : "form"), disabled: checking }}
      skip={ready.length ? { label: "Use quick questions instead", onClick: () => next("form") } : undefined}>
      <div className="forge-part">
        <div className="forge-parthead">
          <span className="num">1</span><b>This Mac</b>
          <span className={`forge-chip ${checking ? "wait" : !native() ? "" : missing.length ? "warn" : "ok"}`}>
            {checking ? "Checking…" : !native() ? "Runs in the app" : missing.length ? `${missing.length} to install` : "Ready"}
          </span>
        </div>
        {native() && checks !== null && !missing.length
          ? <div className="forge-dim">{required.map((c) => c.label).join(", ")} are installed.</div>
          : (
            <div className="forge-checks">
              {required.filter((c) => !c.ok).map((c) => (
                <div key={c.id} className="forge-check missing">
                  <span className="mark">!</span>
                  <b>{c.label}</b>
                  <small>{c.why}</small>
                  <button type="button" className="forge-btn small primary" disabled={!!busy} onClick={() => void install(c)}>{busy === c.id ? "Installing…" : "Install"}</button>
                </div>
              ))}
            </div>
          )}
      </div>
      <div className="forge-part">
        <div className="forge-parthead">
          <span className="num">2</span><b>Your AI</b>
          <span className={`forge-chip ${rows === null ? "wait" : ready.length ? "ok" : installed.length ? "warn" : ""}`}>
            {rows === null ? "Looking…" : ready.length ? `${ready.length} ready` : installed.length ? "Sign in needed" : "None found"}
          </span>
        </div>
        {rows !== null && installed.length === 0 ? <div className="forge-dim">No AI coding tools found. That's fine: you'll answer a few quick questions instead.</div> : null}
        {installed.length ? (
          <div className="forge-ais">
            {installed.map((r) => {
              const lit = r.signedIn === true;
              const on = lit && chosen === r.id;
              const wait = waiting === r.id;
              return (
                <button type="button" key={r.id} className={`forge-ai ${lit ? "lit" : ""} ${on ? "on" : ""} ${wait ? "wait" : ""}`} onClick={() => (lit ? setChosen(r.id) : void signIn(r))} disabled={wait}>
                  <span className="orb" />
                  <b>{r.name}</b>
                  <span className={`state ${on ? "on" : lit ? "ok" : wait ? "wait" : "act"}`}>{on ? "✓ Using this" : lit ? "Ready · choose" : wait ? "Waiting for browser…" : "Sign in →"}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {installed.length ? <div className="forge-dim">Questions run on your own plan, about as much as one short chat.</div> : null}
      </div>
      <div className={`forge-next ${missing.length || (!ready.length && installed.length) ? "act" : ""}`}><span className="dot" />{nextHint}</div>
    </Stage>
  );
}

// =================================================================== 3. project

function Project({ f, step }: SceneProps) {
  const activeProject = useApp((s) => s.activeProject);
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name);
  const [found, setFound] = useState<string[]>([]);
  const [pick, setPick] = useState<string>("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const warn = (m: string) => f.toast(m);
  const has = !!activeProject && activeProject !== "default";
  useEffect(() => {
    if (native()) void invoke<string[]>("discover_repos", { known: [] }).then((r) => setFound(r.slice(0, 5))).catch(() => {});
  }, []);
  // opening a project reloads the app: save the next step first so setup resumes there
  const openPath = async (p: string) => { setBusy(p); try { useApp.getState().setAppSetting("firstRunStep", nextStep(step)); await openProjectAt(p, warn); } catch (e) { warn(`${e}`); setBusy(""); } };
  const openFolder = async () => { setBusy("folder"); useApp.getState().setAppSetting("firstRunStep", nextStep(step)); if (!(await addProjectFromFinder(warn))) { useApp.getState().setAppSetting("firstRunStep", step); setBusy(""); } };
  const clone = async () => {
    const u = url.trim(); if (!u) return;
    setBusy("clone");
    try {
      const { homeDir } = await import("@tauri-apps/api/path");
      const name = u.split("/").pop()?.replace(/\.git$/, "") || "project";
      const dest = `${(await homeDir()).replace(/\/+$/, "")}/${name}`;
      await invoke("git_clone", { url: u, dest });
      await openPath(dest);
    } catch (e) { warn(`Couldn't download it: ${e}`); setBusy(""); }
  };
  const chosenName = pick ? pick.split("/").pop() : has ? projectName ?? activeProject : "";
  const primary: Action = pick
    ? { label: busy ? "Opening…" : `Use ${chosenName}`, onClick: () => void openPath(pick), disabled: !!busy }
    : has ? { label: `Use ${chosenName}`, onClick: () => f.go(nextStep(step)) }
    : { label: native() ? "Choose a project" : "Continue", onClick: () => f.go(nextStep(step)), disabled: native() };
  return (
    <Stage f={f} step={step}
      title="Pick your project"
      body="Choose the code you'll work on with Grill Me. You can add more projects later."
      primary={primary}>
      <div className="forge-list">
        {has && !found.some((p) => p.split("/").pop() === projectName) ? (
          <button type="button" className={`forge-row ${!pick ? "on" : ""}`} onClick={() => setPick("")}><b>{projectName ?? activeProject}</b><small>Open now</small></button>
        ) : null}
        {found.map((p) => (
          <button type="button" key={p} className={`forge-row ${pick === p || (!pick && has && p.split("/").pop() === projectName) ? "on" : ""}`} onClick={() => setPick(p)} disabled={!!busy}>
            <b>{p.split("/").pop()}</b><small>{p.replace(/^\/Users\/[^/]+/, "~")}</small>
          </button>
        ))}
        <button type="button" className="forge-row ghost" onClick={() => void openFolder()} disabled={!!busy || !native()}><b>{busy === "folder" ? "Opening…" : "Open a folder…"}</b><small>Any folder on this Mac</small></button>
      </div>
      <div className="forge-type">
        <input value={url} placeholder="Or paste a GitHub link to download it" aria-label="Repository link" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void clone(); }} />
        <button type="button" className="forge-btn small" disabled={!url.trim() || !!busy || !native()} onClick={() => void clone()}>{busy === "clone" ? "Downloading…" : "Download"}</button>
      </div>
    </Stage>
  );
}

// =================================================================== 4. tools

const SAMPLE_SCAN: ScanResult = {
  ts: 0, sources: ["agents", "extensions"], checked: [{ source: "agents", item: "~/.claude/settings.json" }, { source: "extensions", item: "~/.codex/config.toml" }],
  agents: { bins: ["claude", "codex"], apps: [] },
  extensions: {
    mcp: [{ name: "context7", agent: "claude", scope: "user" }, { name: "github", agent: "codex", scope: "user" }],
    plugins: [{ name: "frontend-design", marketplace: "claude-plugins-official", agent: "claude" }, { name: "caveman", marketplace: "caveman", agent: "claude" }],
    skills: [],
  },
  stack: { languages: ["TypeScript"], frameworks: ["React"] },
};
async function loadScan(): Promise<ScanResult | null> {
  if (!native()) return SAMPLE_SCAN;
  return invoke<ScanResult | null>("workflow_scan_read").catch(() => null);
}

function Tools({ f, step }: SceneProps) {
  const projectPath = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.path);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(SCAN_SOURCES.map((x) => [x.id, x.defaultOn])));
  const [phase, setPhase] = useState<"ask" | "looking" | "done">("ask");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [showList, setShowList] = useState(false);
  useEffect(() => () => { f.world.clearStars(); }, []);
  const look = async () => {
    setPhase("looking");
    await f.wait(300);
    const scouts = f.world.scoutOut();
    const sources = SCAN_SOURCES.filter((x) => on[x.id]).map((x) => x.id);
    const [res] = await Promise.all([
      native() ? invoke<ScanResult>("workflow_scan", { project: projectPath ?? null, sources }).catch((e) => { f.toast(`Scan failed: ${e}`); return null; }) : Promise.resolve(SAMPLE_SCAN),
      f.wait(1300),
    ]);
    setResult(res);
    setPhase("done");
    await f.wait(60); // let the picture area exist before stars arrive
    const { stars, links } = constellationFromScan(res);
    f.world.setStars(stars, links);
    f.world.scoutBack(scouts);
    await f.world.revealStars(f.wait);
  };
  if (phase !== "done") {
    return (
      <Stage f={f} step={step}
        title="See your tools"
        body="With your OK, I'll look at which AI tools, plugins and MCP servers you use. Names only, never keys or code. Nothing leaves this Mac."
        primary={{ label: phase === "looking" ? "Looking…" : "Scan my setup", onClick: () => void look(), disabled: phase === "looking" || !Object.values(on).some(Boolean) }}
        skip={{ label: "Skip this step", onClick: () => f.go(nextStep(step)) }}>
        <div className="forge-checkgrid">
          {SCAN_SOURCES.map((x) => (
            <label key={x.id} className={`forge-tick ${on[x.id] ? "on" : ""}`}>
              <input type="checkbox" checked={on[x.id]} onChange={() => setOn({ ...on, [x.id]: !on[x.id] })} disabled={phase === "looking"} />
              <span className="box" aria-hidden />
              <span><b>{x.label}</b>{x.defaultOn ? null : <em>optional</em>}</span>
            </label>
          ))}
        </div>
      </Stage>
    );
  }
  const agents = constellationFromScan(result).stars.filter((s) => s.kind === "agent").length;
  const tools = toolCount(result);
  return (
    <Stage f={f} step={step} viewHeight={280}
      title="Your tools"
      body={`Found ${agents === 1 ? "1 AI agent" : `${agents} AI agents`} and ${tools} tools. Each agent sits in the middle of its tools; lines link tools that work together.`}
      primary={{ label: "Continue", onClick: () => f.go(nextStep(step)) }}
      note={<button type="button" className="forge-link" onClick={() => setShowList(!showList)}>{showList ? "Hide what I read" : "What did you read?"}</button>}>
      {showList && result ? <ul className="forge-read">{result.checked.map((c, i) => <li key={i}>{c.item}</li>)}</ul> : null}
    </Stage>
  );
}

// =================================================================== 5. workflow

interface Q { key: "team" | "style" | "pains"; text: string; options: string[]; multi?: boolean }
const QUICK: Q[] = [
  { key: "team", text: OPENING, options: OPENING_OPTIONS },
  { key: "style", text: "How do you work with AI when you code?", options: STYLE.map((s) => s.label) },
  { key: "pains", text: `What slows you down most? Choose up to ${MAX_PAINS}.`, options: PAINS.map((p) => p.label), multi: true },
];
const idOf = <T extends string>(list: { id: T; label: string }[], label: string) => list.find((x) => x.label === label)?.id;

function Workflow({ f, step }: SceneProps) {
  const brain = useApp((s) => interviewBrainOf(s.appSettings.interviewBrain));
  const savedProfile = useApp((s) => s.appSettings.workflowProfile);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(builtinCatalog);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<"interview" | "path" | "upgrades" | "card">("interview");
  const [profile, setProfile] = useState<WorkflowProfile | null>(null);
  useEffect(() => {
    void (async () => {
      const [s, c] = await Promise.all([loadScan(), loadCatalog().catch(() => builtinCatalog())]);
      setScan(s); setCatalog(c);
      const p = profileOf(savedProfile);
      if (p && p.updated) { setProfile(p); setPhase("path"); } else setProfile(emptyProfile(s));
      setLoaded(true);
    })();
  }, []);
  if (!loaded || !profile) return null;
  const done = (p: WorkflowProfile) => { const saved = { ...p, updated: Date.now() }; setProfile(saved); setAppSetting("workflowProfile", saved); setPhase("path"); };
  if (phase === "interview") return <Interview f={f} step={step} brain={brain} scan={scan} start={profile} onDone={done} />;
  return <Forged f={f} step={step} scan={scan} catalog={catalog} profile={profile} phase={phase} setPhase={setPhase} />;
}

function Interview({ f, step, brain, scan, start, onDone }: SceneProps & { brain: string; scan: ScanResult | null; start: WorkflowProfile; onDone: (p: WorkflowProfile) => void }) {
  const ai = brain !== "form" && native();
  const name = BRAIN_NAMES[brain] ?? "your AI";
  const [q, setQ] = useState<Q>(QUICK[0]);
  const [count, setCount] = useState(1);
  const [picks, setPicks] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = useRef({ turns: [{ who: "ai", text: OPENING }] as Turn[], profile: { ...start }, i: 0, ai });
  const optsRef = useRef<HTMLDivElement>(null);
  const lastAnswer = useRef("");
  const total = state.current.ai ? MAX_ANSWERS : QUICK.length;

  const ask = (next: Q) => { setPicks([]); setTyped(""); setQ(next); setCount((c) => c + 1); };

  const answer = async (text: string, chosen: string[] = []) => {
    const s = state.current;
    if (busy) return;
    optsRef.current?.querySelectorAll(".forge-opt.on").forEach((el) => f.absorb(el));
    if (!s.ai) {
      const p = { ...s.profile };
      if (q.key === "team") p.team = idOf(TEAM, text) ?? p.team;
      if (q.key === "style") p.style = idOf(STYLE, text) ?? p.style;
      if (q.key === "pains") p.pains = chosen.map((c) => idOf(PAINS, c)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, MAX_PAINS);
      s.profile = p;
      await f.wait(350);
      s.i++;
      if (s.i < QUICK.length) ask(QUICK[s.i]); else onDone(p);
      return;
    }
    lastAnswer.current = text;
    s.turns = [...s.turns, { who: "you", text: text.slice(0, MAX_ANSWER_CHARS) }];
    setBusy(true); setError("");
    try {
      const raw = await invoke<unknown>("interview_turn", { brain, system: SYSTEM_PROMPT, prompt: buildPrompt(s.turns, s.profile, scan), schema: JSON.stringify(REPLY_SCHEMA) });
      const r = mergeReply(s.profile, raw);
      s.profile = r.profile;
      s.turns = [...s.turns, { who: "ai", text: r.say }];
      setBusy(false);
      if (r.done || s.turns.filter((t) => t.who === "you").length >= MAX_ANSWERS) { onDone(r.profile); return; }
      ask({ key: "pains", text: r.say, options: r.options });
    } catch (e) {
      setBusy(false);
      s.turns = s.turns.slice(0, -1);
      setError(`${name} couldn't answer: ${e}`);
    }
  };
  const quick = () => { state.current.ai = false; state.current.i = 0; setError(""); setCount(0); ask(QUICK[0]); };
  const multi = !!q.multi && !state.current.ai;
  return (
    <Stage f={f} step={step}
      title={`A few quick questions · ${Math.min(count, total)} of ${state.current.ai ? `up to ${total}` : total}`}
      body={busy ? `${name} is thinking…` : error || q.text}
      primary={error ? { label: "Try again", onClick: () => { setError(""); void answer(lastAnswer.current); } }
        : multi ? { label: "Done", onClick: () => void answer(picks.join(", "), picks), disabled: picks.length === 0 }
        : typed.trim() ? { label: "Send", onClick: () => void answer(typed.trim()) } : undefined}
      skip={error ? { label: "Use quick questions", onClick: quick } : { label: "Skip the questions", onClick: () => onDone(state.current.profile) }}>
      {!busy && !error ? (
        <>
          <div ref={optsRef} className="forge-opts">
            {q.options.map((o) => {
              const i = picks.indexOf(o);
              return (
                <button type="button" key={o} className={`forge-opt ${i >= 0 ? "on" : ""}`} onClick={(e) => {
                  if (!multi) { e.currentTarget.classList.add("on"); void answer(o); return; }
                  setPicks(i >= 0 ? picks.filter((x) => x !== o) : picks.length < MAX_PAINS ? [...picks, o] : picks);
                }}>{multi && i >= 0 ? <span className="n">{i + 1}</span> : null}{o}</button>
              );
            })}
          </div>
          <div className="forge-type">
            <input value={typed} placeholder="Or answer in your own words…" aria-label="Your answer" maxLength={MAX_ANSWER_CHARS}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) { f.absorb(e.currentTarget); void answer(typed.trim(), multi ? [typed.trim()] : []); } }} />
          </div>
        </>
      ) : null}
    </Stage>
  );
}

interface NodeView { id: string; name: string; lit: boolean; tools: string[] }

function Forged({ f, step, scan, catalog, profile, phase, setPhase }: SceneProps & { scan: ScanResult | null; catalog: Catalog; profile: WorkflowProfile; phase: string; setPhase: (p: "path" | "upgrades" | "card") => void }) {
  const have = useMemo(() => toolsYouHave(catalog, scan), [catalog, scan]);
  const stages = useMemo(() => workflowStages(have, scan, profile), [have, scan, profile]);
  const upgrades = useMemo(() => suggestUpgrades(profile, catalog, have, scan), [profile, catalog, have, scan]);
  const [nodes, setNodes] = useState<NodeView[]>(() => stages.map((st) => ({ id: st.id, name: st.name, lit: st.covered, tools: st.tools })));
  const [placed, setPlaced] = useState<(Upgrade & { at: number })[]>([]);
  const [focus, setFocus] = useState<(Upgrade & { at: number }) | null>(null);
  const [target, setTarget] = useState(-1);

  useEffect(() => {
    if (phase === "card") { f.world.clearStages(); return; }
    f.world.setStages(nodes.map((n) => ({ id: n.id, name: n.name, lit: n.lit, sub: n.lit ? n.tools.slice(0, 2).join(", ") + (n.tools.length > 2 ? ` +${n.tools.length - 2}` : "") : "Nothing yet" })));
  }, [nodes, phase]);
  useEffect(() => { f.world.pulseStage(target); }, [target]);
  useEffect(() => () => { f.world.clearStages(); }, []);

  const light = (u: Upgrade) => {
    const at = STAGES.findIndex((s) => s.id === u.stage);
    if (placed.some((p) => p.id === u.id) || at < 0) return;
    setNodes(nodes.map((n, i) => (i === at ? { ...n, lit: true, tools: [u.name, ...n.tools] } : n)));
    const p = { ...u, at };
    setPlaced([...placed, p]);
    setFocus(p);
  };
  const dark = nodes.filter((n) => !n.lit).map((n) => n.name);

  if (phase === "path") {
    return (
      <Stage f={f} step={step} viewHeight={230}
        title="Your workflow"
        body={dark.length ? `Here's how your tools cover each stage, from planning to shipping. ${dark.join(", ")} ${dark.length === 1 ? "has" : "have"} nothing helping yet.` : "Here's how your tools cover each stage, from planning to shipping. Every stage has help."}
        primary={{ label: upgrades.length ? "See suggestions" : "Continue", onClick: () => setPhase(upgrades.length ? "upgrades" : "card") }} />
    );
  }
  if (phase === "upgrades") {
    const left = upgrades.filter((u) => !placed.some((p) => p.id === u.id));
    return (
      <Stage f={f} step={step} viewHeight={200}
        title="Fill the gaps"
        body="Picked for how you work. Drag one onto its stage, or press Add. Nothing installs by itself: you copy the command when you're ready."
        primary={{ label: "Continue", onClick: () => setPhase("card") }}
        skip={!placed.length ? { label: "Maybe later", onClick: () => setPhase("card") } : undefined}>
        {focus ? (
          <div className="forge-placed">
            <div className="head"><span className="gem" />{focus.name} added to {STAGES[focus.at].name}</div>
            <p>{focus.what}</p>
            {focus.command ? <code>{focus.command}</code> : null}
            <div className="acts">
              {focus.command ? <button type="button" className="forge-btn small primary" onClick={() => void navigator.clipboard.writeText(focus.command!).then(() => f.toast(focus.command!.startsWith("/") ? "Copied. Paste it into Claude Code" : "Copied. Run it in Terminal"), () => f.toast("Select the command to copy it"))}>Copy command</button> : null}
              {focus.docs ? <button type="button" className="forge-link" onClick={() => void openExternal(focus.docs!)}>How to set it up</button> : null}
              <button type="button" className="forge-link" onClick={() => setFocus(null)}>{left.length ? "Next suggestion" : "Close"}</button>
            </div>
          </div>
        ) : left.length ? (
          <div className="forge-ups">
            {left.map((u, i) => (
              <UpgradeCard key={u.id} u={u} index={i} reduce={f.reduce}
                stagePos={() => { const at = STAGES.findIndex((s) => s.id === u.stage); const p = f.world.stagePos(at); return { x: p?.x ?? 0, y: p?.y ?? 0, at }; }}
                onTarget={setTarget} onPlace={() => { setTarget(-1); light(u); }} onMiss={(st) => f.toast(`Drop it on ${st}`)} />
            ))}
          </div>
        ) : <div className="forge-dim">All suggestions added.</div>}
      </Stage>
    );
  }
  return <ShareCard f={f} step={step} nodes={nodes} scan={scan} profile={profile} />;
}

function UpgradeCard({ u, index, reduce, stagePos, onTarget, onPlace, onMiss }: { u: Upgrade; index: number; reduce: boolean; stagePos: () => { x: number; y: number; at: number }; onTarget: (i: number) => void; onPlace: () => void; onMiss: (stage: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ sx: 0, sy: 0, on: false });
  const stage = STAGES.find((s) => s.id === u.stage)?.name ?? "";
  useEffect(() => {
    if (reduce || !ref.current) return;
    ref.current.animate([{ transform: "translateY(14px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 500, delay: index * 90, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
  }, []);
  const near = (x: number, y: number) => { const p = stagePos(); return Math.hypot(x - p.x, y - p.y) < 80; };
  return (
    <div ref={ref} className="forge-up" tabIndex={0} role="button" aria-label={`${u.name}. For ${stage}. Press Enter to add it.`}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onPlace(); } }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).tagName === "BUTTON") return;
        drag.current = { sx: e.clientX, sy: e.clientY, on: true };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.classList.add("dragging");
        onTarget(stagePos().at);
      }}
      onPointerMove={(e) => { if (drag.current.on) e.currentTarget.style.translate = `${e.clientX - drag.current.sx}px ${e.clientY - drag.current.sy}px`; }}
      onPointerUp={(e) => {
        if (!drag.current.on) return;
        drag.current.on = false;
        e.currentTarget.classList.remove("dragging");
        onTarget(-1);
        if (near(e.clientX, e.clientY)) onPlace();
        else { e.currentTarget.style.translate = "0 0"; if (Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy) > 12) onMiss(stage); }
      }}>
      <div className="top"><span className="gem" /><b>{u.name}</b><em>{u.kind === "tip" ? "tip" : u.kind}</em></div>
      <div className="why">{u.why}</div>
      <div className="foot"><span>For <b>{stage}</b></span><button type="button" onClick={onPlace}>Add</button></div>
    </div>
  );
}

function ShareCard({ f, step, nodes, scan, profile }: SceneProps & { nodes: NodeView[]; scan: ScanResult | null; profile: WorkflowProfile }) {
  const card = useMemo(() => drawCard(nodes, scan, profile), []);
  const text = encodeURIComponent(`My AI coding workflow, set up with Grill Me: ${nodes.map((n) => `${n.lit ? "●" : "○"} ${n.name}`).join(" → ")}`);
  const save = async () => {
    if (!native()) { f.toast("Saving runs in the desktop app"); return; }
    try { const path = await invoke<string>("save_share_card", { pngBase64: card }); f.toast(`Saved to ${path.replace(/^\/Users\/[^/]+/, "~")}`); } catch (e) { f.toast(`${e}`); }
  };
  const copy = async () => {
    try { const blob = await (await fetch(card)).blob(); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); f.toast("Image copied"); }
    catch { f.toast("Couldn't copy the image here. Save it instead"); }
  };
  return (
    <Stage f={f} step={step}
      title="Your workflow card"
      body="A picture of your setup. Save it, or share it if you like."
      primary={{ label: "Continue", onClick: () => f.go(nextStep(step)) }}>
      <img className="forge-card" src={card} alt="Your Grill Me workflow card" />
      <div className="forge-actions">
        <button type="button" className="forge-btn small" onClick={() => void save()}>Save image</button>
        <button type="button" className="forge-btn small" onClick={() => void copy()}>Copy</button>
        <button type="button" className="forge-btn small" onClick={() => void openExternal(`https://x.com/intent/post?text=${text}`)}>Post on X</button>
        <button type="button" className="forge-btn small" onClick={() => void openExternal(`https://www.linkedin.com/feed/?shareActive=true&text=${text}`)}>LinkedIn</button>
      </div>
    </Stage>
  );
}

/** A 1200×630 card (the size X and LinkedIn preview well). */
function drawCard(nodes: NodeView[], scan: ScanResult | null, profile: WorkflowProfile): string {
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const x = c.getContext("2d")!;
  const font = (w: number, s: number) => `${w} ${s}px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif`;
  const tracked = (s: string, cx: number, y: number, size: number, col: string, track: number, align: "left" | "center" | "right" = "left") => {
    x.font = font(600, size); x.fillStyle = col; x.textAlign = "left";
    const w = [...s].reduce((a, ch) => a + x.measureText(ch).width + track, -track);
    let px = align === "center" ? cx - w / 2 : align === "right" ? cx - w : cx;
    for (const ch of s) { x.fillText(ch, px, y); px += x.measureText(ch).width + track; }
  };
  const g = x.createLinearGradient(0, 0, 1200, 630); g.addColorStop(0, "#17110f"); g.addColorStop(1, "#0b0909");
  x.fillStyle = g; x.fillRect(0, 0, 1200, 630);
  x.strokeStyle = "rgba(255,180,120,.18)"; x.lineWidth = 1; x.strokeRect(24.5, 24.5, 1151, 581);
  tracked("MY AI CODING WORKFLOW", 72, 96, 13, "rgba(255,200,160,.6)", 4);
  const agents = constellationFromScan(scan).stars.filter((s) => s.kind === "agent").map((s) => s.label);
  x.font = `700 48px "Chakra Petch", -apple-system, sans-serif`; x.fillStyle = "#fff"; x.textAlign = "left"; x.fillText(agents.join("  +  "), 70, 160);
  const y = 330, xs = nodes.map((_, i) => 150 + i * 225);
  for (let i = 0; i < nodes.length - 1; i++) {
    const lit = nodes[i].lit && nodes[i + 1].lit;
    x.strokeStyle = lit ? "rgba(255,160,90,.85)" : "rgba(255,255,255,.2)"; x.lineWidth = 2; x.setLineDash(lit ? [] : [3, 7]);
    x.beginPath(); x.moveTo(xs[i] + 22, y); x.lineTo(xs[i + 1] - 22, y); x.stroke();
  }
  x.setLineDash([]);
  nodes.forEach((n, i) => {
    x.save(); x.translate(xs[i], y); x.rotate(Math.PI / 4);
    if (n.lit) { const gg = x.createRadialGradient(-6, -6, 2, 0, 0, 30); gg.addColorStop(0, "#fff2d6"); gg.addColorStop(.35, "#ffb347"); gg.addColorStop(.75, "#ff6a2a"); gg.addColorStop(1, "#7a2410"); x.fillStyle = gg; x.shadowColor = "#ff7a2e"; x.shadowBlur = 30; x.fillRect(-18, -18, 36, 36); }
    else { x.strokeStyle = "rgba(255,255,255,.35)"; x.setLineDash([4, 4]); x.lineWidth = 1.5; x.strokeRect(-18, -18, 36, 36); x.setLineDash([]); }
    x.restore();
    tracked(n.name.toUpperCase(), xs[i], y + 72, 12, n.lit ? "#fff" : "rgba(255,255,255,.4)", 3, "center");
    x.textAlign = "center"; x.font = font(400, 16); x.fillStyle = n.lit ? "rgba(255,255,255,.65)" : "rgba(255,255,255,.3)";
    const label = n.lit ? n.tools[0] ?? "" : "nothing yet";
    x.fillText(label.length > 20 ? `${label.slice(0, 19)}…` : label, xs[i], y + 100);
  });
  const team = TEAM.find((t) => t.id === profile.team)?.label;
  const pains = profile.pains.map((p) => PAINS.find((q) => q.id === p)?.say ?? p);
  x.textAlign = "left"; x.font = font(400, 18); x.fillStyle = "rgba(255,255,255,.6)";
  x.fillText([team, pains.length ? `fixing ${pains.join(", ")}` : ""].filter(Boolean).join("   ·   "), 72, 548);
  x.textAlign = "right"; x.font = `700 22px "Chakra Petch", -apple-system, sans-serif`; x.fillStyle = "#ff8a3a"; x.fillText("grillme", 1128, 552);
  return c.toDataURL("image/png");
}

// =================================================================== 6. finish

function Finish({ f, step }: SceneProps) {
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "your project");
  const joining = useApp((s) => s.appSettings.firstRunJoining === true);
  const [files, setFiles] = useState(true);
  const [team, setTeam] = useState<"solo" | "team">(joining ? "team" : "solo");
  const [showFiles, setShowFiles] = useState(false);
  const open = () => {
    const st = useApp.getState();
    st.setAppSetting("installConsent", files ? true : "declined");
    st.setAppSetting("onboarded", true);
    st.setAppMode(team);
    st.setView("new");
    f.finish(false);
  };
  return (
    <Stage f={f} step={step}
      title="Almost done"
      body="Two quick choices, then you're in."
      primary={{ label: team === "team" ? (joining ? "Open Grill Me and join my team" : "Open Grill Me and set up my team") : "Open Grill Me", onClick: open }}>
      <div className="forge-section">
        <label className={`forge-tick wide ${files ? "on" : ""}`}>
          <input type="checkbox" checked={files} onChange={() => setFiles(!files)} />
          <span className="box" aria-hidden />
          <span><b>Add Grill Me's helper files to {projectName}</b> <em>recommended</em><small>Lets Grill Me follow your sessions and adds a /ship command. They stay on this Mac, out of git.</small></span>
        </label>
        <button type="button" className="forge-link" onClick={() => setShowFiles(!showFiles)}>{showFiles ? "Hide the files" : "Which files?"}</button>
        {showFiles ? <ul className="forge-read">{CONSENT_ITEMS.map((it) => <li key={it.file}>{it.file} · {it.title}</li>)}</ul> : null}
      </div>
      <div className="forge-section">
        <div className="forge-label">Who's working on it?</div>
        <div className="forge-choice">
          <button type="button" className={`forge-row ${team === "solo" ? "on" : ""}`} onClick={() => setTeam("solo")}><b>Just me for now</b><small>You can invite people anytime</small></button>
          <button type="button" className={`forge-row ${team === "team" ? "on" : ""}`} onClick={() => setTeam("team")}><b>{joining ? "Join my team" : "Work with a team"}</b><small>{joining ? "You'll paste your invite link next" : "Everyone's agents share one plan and one chat"}</small></button>
        </div>
      </div>
    </Stage>
  );
}
