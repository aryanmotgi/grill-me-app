import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { ForgeWorld, type PathPoint } from "../forge/engine";
import { constellationFromScan, stageIndexOf } from "../forge/constellation";
import "../forge/forge.css";
import { LOGO_TEXT } from "../brand";
import { probeFps } from "../lib/perf";
import { runDoctor, type DoctorCheck } from "./DoctorTab";
import { CONSENT_ITEMS } from "./InstallConsent";
import { SCAN_SOURCES, type ScanResult } from "../lib/scan";
import type { Catalog } from "../lib/catalog";
import { builtinCatalog, loadCatalog } from "../lib/catalogLoad";
import { addProjectFromFinder, openProjectAt } from "../lib/addProject";
import { FIRST_RUN_STEPS, firstRunStepOf, nextStep, stepNumber, type FirstRunStep } from "../lib/firstRun";
import { interviewBrainOf, pickBrain, readyAis, statusLabel, type AiStatus } from "../lib/aiConnect";
import { BRAIN_NAMES, MAX_ANSWERS, MAX_ANSWER_CHARS, OPENING, OPENING_OPTIONS, REPLY_SCHEMA, SYSTEM_PROMPT, buildPrompt, mergeReply, type Turn } from "../lib/interview";
import { MAX_PAINS, PAINS, STAGES, STYLE, TEAM, emptyProfile, profileOf, suggestUpgrades, toolsYouHave, workflowStages, type Upgrade, type WorkflowProfile } from "../lib/profile";

// ---------------------------------------------------------------------------
// First run: "stepping into the forge where your workspace gets made." The
// forge takes over the screen (macOS full screen), pure black, lit only by
// the Spark and its embers (GPU, src/forge). Same steps and logic as before:
// check → connect your AI → project → scan → interview, workflow, upgrades,
// card → consent → team. Esc leaves from anywhere. Reduce Motion gets a still
// version; slow machines drop to fewer embers on their own.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;
const REQUIRED = ["claude", "git", "python3"];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const STEP_NAMES: Record<string, string> = { welcome: "Arrival", check: "Your machine", connect: "Your AI", project: "Your project", scan: "Your tools", workflow: "Your workflow", consent: "Files", team: "Your team" };
const INTRO = "For the next few minutes, the forge takes over your screen. We'll learn how you work and shape Grill Me around it. Press Esc anytime to leave.";

interface Forge {
  world: ForgeWorld;
  say: (text: string) => Promise<void>;
  hush: () => void;
  /** y just under the Spark's words, where a scene puts its controls */
  below: (gap?: number) => number;
  toast: (msg: string) => void;
  go: (s: FirstRunStep) => void;
  wait: (ms: number) => Promise<void>;
  /** an answer is absorbed into the Spark */
  absorb: (el: Element | null) => void;
  finish: (fast: boolean) => void;
  /** step out of full screen (e.g. while a browser sign-in is open) and back */
  fullscreen: (on: boolean) => void;
}
interface SceneProps { f: Forge }

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
async function openExternal(url: string) {
  if (!native()) { window.open(url, "_blank"); return; }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url).catch(() => {});
}
const sayTop = (y: number, r: number) => Math.min(innerHeight - 240, y + Math.max(r, 10) * 3.2 + 26);

/** Says `text` when the scene mounts; returns where controls go once it's said. */
function useLine(f: Forge, text: string): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setTop(null);
    void f.say(text).then(() => { if (live) setTop(f.below()); });
    return () => { live = false; };
  }, [text]);
  return top;
}

function Btn({ children, onClick, primary, small, disabled, autoFocus }: { children: React.ReactNode; onClick: () => void; primary?: boolean; small?: boolean; disabled?: boolean; autoFocus?: boolean }) {
  return <button type="button" className={`forge-btn ${primary ? "primary" : ""} ${small ? "small" : ""}`} onClick={onClick} disabled={disabled} autoFocus={autoFocus}>{children}</button>;
}
function Link({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className="forge-link" onClick={onClick}>{children}</button>;
}

// =================================================================== the shell

export function ForgeOnboarding() {
  const step = useApp((s) => firstRunStepOf(s.appSettings.firstRunStep));
  const setAppSetting = useApp((s) => s.setAppSetting);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sayRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
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
    try { world = new ForgeWorld(canvasRef.current!, labelsRef.current!, reduce); }
    catch { setAppSetting("firstRunStep", "done"); return; } // no WebGL: straight to the app
    const wait = (ms: number) => sleep(reduce ? Math.min(ms, 200) : ms);
    let toastT = 0;
    const toast = (msg: string) => {
      const el = toastRef.current!;
      el.textContent = msg;
      el.classList.add("on");
      clearTimeout(toastT);
      toastT = window.setTimeout(() => el.classList.remove("on"), 3200);
    };
    let sayGen = 0;
    const forge: Forge = {
      world, wait, toast,
      go: (s) => useApp.getState().setAppSetting("firstRunStep", s),
      say: async (text) => {
        const gen = ++sayGen;
        const el = sayRef.current!;
        el.textContent = "";
        const tx = document.createElement("span"), caret = document.createElement("span");
        caret.className = "caret";
        el.append(tx, caret);
        el.classList.add("on");
        world.spark.speaking = true;
        if (reduce) tx.textContent = text;
        else {
          for (let i = 1; i <= text.length; i++) {
            if (gen !== sayGen) return;
            tx.textContent = text.slice(0, i);
            await sleep(".?!".includes(text[i - 1]) ? 170 : text[i - 1] === "," ? 70 : 19);
          }
        }
        if (gen === sayGen) { world.spark.speaking = false; caret.remove(); }
      },
      hush: () => { sayGen++; world.spark.speaking = false; sayRef.current?.classList.remove("on"); },
      below: (gap = 26) => {
        const h = sayRef.current!.getBoundingClientRect().height || 60;
        return Math.min(innerHeight - 200, sayTop(world.spark.ty, world.spark.tr) + h + gap);
      },
      absorb: (el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.animate([{ opacity: 1 }, { opacity: .25 }], { duration: 300, fill: "forwards" });
        world.burstAt(r.left + r.width / 2, r.top + r.height / 2, 10, .85);
        world.feed();
      },
      finish: (fast) => { if (!finaleRef.current) setFinale(fast ? "fast" : "full"); },
      fullscreen: (on) => { if (native()) void invoke("forge_fullscreen", { on }).catch(() => {}); },
    };
    world.onFrame = (sp) => { if (sayRef.current) sayRef.current.style.top = `${sayTop(sp.y, sp.r)}px`; };
    world.onLite = () => toast("Fewer embers: this computer is busy right now");
    world.start();
    // take over the screen once we're actually on it (asking while the
    // window is still appearing is ignored by macOS)
    forge.fullscreen(true);
    void probeFps("forge-intro", 9000, () => ({ cpuMsPerFrame: world.workAvg(), ambientEmbers: world.gl.ambientCount }));
    setF(forge);
    // first time in: embers rise into the wordmark, burst, and the Spark is
    // born. Resuming mid-setup (opening a project reloads the app) skips it.
    void (async () => {
      const first = firstRunStepOf(useApp.getState().appSettings.firstRunStep) === "welcome";
      // let macOS finish sliding into full screen before the wordmark forms
      await sleep(reduce ? 0 : 1100);
      if (first) await world.logoBurst(LOGO_TEXT, wait);
      else world.sparkBorn(world.W / 2, world.H * .34);
      setReady(true);
    })();
    return () => { world.stop(); document.documentElement.classList.remove("forge-on"); };
  }, []);

  // Esc / "Leave": always works, from anywhere
  const leave = () => {
    const st = useApp.getState();
    st.setAppSetting("onboarded", true);
    if (st.appMode === null) st.setAppMode("solo");
    f?.finish(true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); leave(); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // finale: everything is drawn into the glass box, which opens into the app
  useEffect(() => {
    if (!finale || !f) return;
    const q = f.world.reduce ? 0 : finale === "fast" ? .45 : 1;
    void (async () => {
      f.hush();
      f.world.collapse();
      const box = boxRef.current!;
      await sleep(700 * q);
      box.style.opacity = "1";
      f.world.fadeSpark();
      if (!f.world.reduce) box.querySelector<HTMLElement>(".cube")!.style.animation = `forge-spin ${2.2 * q}s cubic-bezier(.6,0,.3,1)`;
      for (let p = 0; p <= 100; p += 10) { box.querySelectorAll<HTMLElement>(".f").forEach((x) => x.style.setProperty("--fill", `${p}%`)); await sleep(110 * q); }
      box.style.transform = "scale(10)";
      box.style.opacity = "0";
      await sleep(450 * q);
      setAppSetting("firstRunStep", "done");
      if (native()) await invoke("forge_window_done").catch(() => {});
    })();
  }, [finale, f]);

  const n = stepNumber(step);
  return (
    <div className="forge" role="dialog" aria-label="Set up Grill Me">
      <canvas ref={canvasRef} />
      <div ref={labelsRef} className="forge-labels" aria-hidden />
      <div className="forge-ui">{f && ready && !finale ? <Scene step={step} f={f} /> : null}</div>
      <div ref={sayRef} className="forge-say" role="status" aria-live="polite" />
      <div ref={boxRef} className="forge-box" aria-hidden>
        <div className="cube">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className={`f f${i}`} />)}</div>
      </div>
      {!finale ? (
        <div className="forge-hud">
          <b>Grill Me</b>
          <span>{String(n).padStart(2, "0")} / {String(FIRST_RUN_STEPS.length).padStart(2, "0")}</span>
          <span>{STEP_NAMES[step] ?? ""}</span>
          <span className="grow" />
          <button type="button" onClick={leave}>Esc · Leave</button>
        </div>
      ) : null}
      <div className="forge-progress" aria-hidden><i style={{ width: `${(n / FIRST_RUN_STEPS.length) * 100}%` }} /></div>
      <div ref={toastRef} className="forge-toast" role="status" />
    </div>
  );
}

/** Show first-run setup? Waits for settings so existing users never see a flash. */
export function useFirstRunActive(): boolean {
  const loaded = useApp((s) => s.settingsLoaded);
  const step = useApp((s) => s.appSettings.firstRunStep);
  return loaded && step != null && step !== "done";
}

function Scene({ step, f }: { step: FirstRunStep; f: Forge }) {
  switch (step) {
    case "welcome": return <Welcome f={f} />;
    case "check": return <Check f={f} />;
    case "connect": return <Connect f={f} />;
    case "project": return <Project f={f} />;
    case "scan": return <Scan f={f} />;
    case "workflow": return <Workflow f={f} />;
    case "consent": return <Consent f={f} />;
    case "team": return <Team f={f} />;
    default: return null;
  }
}

// =================================================================== scenes

function Welcome({ f }: SceneProps) {
  const setAppSetting = useApp((s) => s.setAppSetting);
  const joining = useApp((s) => s.appSettings.firstRunJoining === true);
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .3, 20); }, []);
  const top = useLine(f, INTRO);
  const start = (join: boolean) => { setAppSetting("firstRunJoining", join); f.hush(); f.go(nextStep("welcome")); };
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      <div className="forge-row">
        <Btn primary autoFocus onClick={() => start(joining)}>{joining ? "Join my team" : "Enter the forge"}</Btn>
        {joining ? null : <Btn onClick={() => start(true)}>I'm joining a team</Btn>}
      </div>
    </div>
  );
}

function Check({ f }: SceneProps) {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [busy, setBusy] = useState("");
  const refresh = () => { void runDoctor().then(setChecks); };
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .22, 17); refresh(); }, []);
  const required = (checks ?? []).filter((c) => REQUIRED.includes(c.id));
  const allOk = checks !== null && required.every((c) => c.ok);
  const top = useLine(f, checks === null ? "First, the tools the forge needs on this machine." : allOk ? "Everything the forge needs is here." : "A few tools are missing. I can install them for you.");
  useEffect(() => {
    if (!native() || top == null || !allOk) return;
    const t = setTimeout(() => { f.hush(); f.go(nextStep("check")); }, 2600);
    return () => clearTimeout(t);
  }, [top, allOk]);
  const install = async (c: DoctorCheck) => {
    setBusy(c.id);
    try { await invoke("doctor_install", { id: c.id }); refresh(); } catch (e) { f.toast(`${e}`); } finally { setBusy(""); }
  };
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      {native() ? (
        <div className="forge-checks">
          {required.map((c) => (
            <div key={c.id} className={`forge-check ${c.ok ? "ok" : "missing"}`}>
              <span className="mark" />
              <div className="grow"><b>{c.label}</b><small>{c.ok ? c.detail : c.why}</small></div>
              {!c.ok ? <Btn small primary disabled={!!busy} onClick={() => void install(c)}>{busy === c.id ? "Installing" : "Install"}</Btn> : null}
            </div>
          ))}
        </div>
      ) : <div className="forge-note">The machine check runs in the desktop app.</div>}
      {!allOk || !native() ? (
        <div className="forge-row">
          {native() ? <Link onClick={refresh}>Check again</Link> : null}
          <Btn primary={allOk || !native()} onClick={() => { f.hush(); f.go(nextStep("check")); }}>{allOk || !native() ? "Continue" : "Skip for now"}</Btn>
        </div>
      ) : null}
    </div>
  );
}

const SAMPLE_AIS: AiStatus[] = [
  { id: "claude", name: "Claude Code", installed: true, signedIn: true, detail: "" },
  { id: "codex", name: "Codex", installed: true, signedIn: false, detail: "" },
];

function Connect({ f }: SceneProps) {
  const setAppSetting = useApp((s) => s.setAppSetting);
  const saved = useApp((s) => s.appSettings.interviewBrain);
  const [rows, setRows] = useState<AiStatus[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [waiting, setWaiting] = useState("");
  const W = f.world.W, H = f.world.H;
  useEffect(() => {
    f.world.sparkTo(W / 2, H * .2, 17);
    const load = native() ? invoke<AiStatus[]>("ai_status", { ids: null }).catch(() => []) : Promise.resolve(SAMPLE_AIS);
    void load.then((r) => { setRows(r); setChosen(pickBrain(r, saved)); });
    return () => f.world.clearBeacons();
  }, []);
  const top = useLine(f, "I speak through your own AI. It uses a little of your plan, about one short chat. Light one.");
  const installed = (rows ?? []).filter((r) => r.installed);
  const ready = readyAis(rows ?? []);
  const oy = H * .55;
  const ox = (i: number) => W / 2 + (i - (installed.length - 1) / 2) * Math.min(220, W / (installed.length + 1));
  // orbs are light, drawn on the GPU: dim until signed in, then they ignite
  useEffect(() => {
    installed.forEach((r, i) => f.world.setBeacon(`ai:${r.id}`, { x: ox(i), y: oy, lit: r.signedIn === true ? (chosen === r.id ? 1 : .75) : .1, size: 46, pulse: waiting === r.id }));
  }, [rows, chosen, waiting, W, H]);

  const ignite = (now: AiStatus) => {
    setRows((rs) => (rs ?? []).map((x) => (x.id === now.id ? now : x)));
    setChosen(now.id);
  };
  const signIn = async (r: AiStatus) => {
    setWaiting(r.id);
    if (!native()) { await sleep(1400); ignite({ ...r, signedIn: true }); setWaiting(""); return; }
    // the browser opens for the sign-in: step out of full screen meanwhile
    f.fullscreen(false);
    const started = Date.now();
    const poll = window.setInterval(() => {
      if (Date.now() - started > 10 * 60_000) { window.clearInterval(poll); setWaiting(""); f.fullscreen(true); return; }
      void invoke<AiStatus[]>("ai_status", { ids: [r.id] }).then(([now]) => {
        if (now?.signedIn === true) { window.clearInterval(poll); setWaiting(""); f.fullscreen(true); setTimeout(() => ignite(now), 700); }
      }).catch(() => {});
    }, 3000);
    invoke("ai_login", { id: r.id }).catch((e) => f.toast(`${e}`));
  };
  const finish = (brain: string) => { setAppSetting("interviewBrain", brain); f.hush(); f.go(nextStep("connect")); };

  if (top == null || rows === null) return null;
  return (
    <>
      {installed.map((r, i) => {
        const lit = r.signedIn === true;
        return (
          <div key={r.id}>
            <button type="button" className="forge-hit" style={{ left: ox(i), top: oy }} aria-label={`${r.name}: ${statusLabel(r)}`} onClick={() => (lit ? setChosen(r.id) : void signIn(r))} />
            <div className={`forge-tag ${lit ? "" : "dark"}`} style={{ left: ox(i), top: oy + 46 }}>
              <b>{r.name}</b>
              <small>{waiting === r.id ? "Finish in your browser" : chosen === r.id && lit ? "Speaking through this" : statusLabel(r)}</small>
            </div>
            {!lit && waiting !== r.id ? <div className="forge-orb-act" style={{ left: ox(i), top: oy + 96 }}><Btn small onClick={() => void signIn(r)}>Sign in</Btn></div> : null}
          </div>
        );
      })}
      <div className="forge-content" style={{ top: Math.max(top, oy + 150) }}>
        {installed.length === 0 ? <div className="forge-note">No AI coding tools on this machine. That's fine: I'll ask a few quick questions instead.</div> : null}
        <div className="forge-row">
          {ready.length ? <Btn primary autoFocus onClick={() => finish(chosen || ready[0].id)}>Continue with {BRAIN_NAMES[chosen] ?? "your AI"}</Btn> : null}
          <Link onClick={() => finish("form")}>Use quick questions instead</Link>
        </div>
      </div>
    </>
  );
}

function Project({ f }: SceneProps) {
  const activeProject = useApp((s) => s.activeProject);
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name);
  const [found, setFound] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const warn = (m: string) => f.toast(m);
  const advance = () => { f.hush(); f.go(nextStep("project")); };
  useEffect(() => {
    f.world.sparkTo(f.world.W / 2, f.world.H * .22, 17);
    if (native()) void invoke<string[]>("discover_repos", { known: [] }).then((r) => setFound(r.slice(0, 6))).catch(() => {});
  }, []);
  const top = useLine(f, "Which project are we forging? Pick one I found, open a folder, or paste your team's repo link.");
  const has = !!activeProject && activeProject !== "default";
  // opening a project reloads the app: save the next step first so the forge resumes there
  const openPath = async (p: string) => { setBusy(p); try { useApp.getState().setAppSetting("firstRunStep", nextStep("project")); await openProjectAt(p, warn); } catch (e) { warn(`${e}`); setBusy(""); } };
  const openFolder = async () => { setBusy("folder"); useApp.getState().setAppSetting("firstRunStep", nextStep("project")); if (!(await addProjectFromFinder(warn))) { useApp.getState().setAppSetting("firstRunStep", "project"); setBusy(""); } };
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
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      {has ? <Btn primary autoFocus onClick={advance}>Keep {projectName ?? activeProject}</Btn> : null}
      {found.length ? (
        <div className="forge-opts">
          {found.map((p) => <button type="button" key={p} className="forge-opt" disabled={!!busy} onClick={() => void openPath(p)}>{busy === p ? "Opening…" : p.split("/").pop()}</button>)}
        </div>
      ) : null}
      <div className="forge-type">
        <input value={url} placeholder="https://github.com/your-team/your-repo" aria-label="Repository link" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void clone(); }} />
        <Btn small disabled={!url.trim() || !!busy || !native()} onClick={() => void clone()}>{busy === "clone" ? "Downloading" : "Download"}</Btn>
      </div>
      <div className="forge-row">
        <Link onClick={() => void openFolder()}>{busy === "folder" ? "Opening…" : "Open a folder"}</Link>
        {!native() ? <Btn primary onClick={advance}>Continue</Btn> : null}
      </div>
    </div>
  );
}

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

function Scan({ f }: SceneProps) {
  const projectPath = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.path);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(SCAN_SOURCES.map((x) => [x.id, x.defaultOn])));
  const [phase, setPhase] = useState<"ask" | "looking" | "done">("ask");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [showList, setShowList] = useState(false);
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .2, 17); }, []);
  const top = useLine(f, "May I look at your setup? Names of tools only. Never keys, never code. Nothing leaves this machine.");
  const look = async () => {
    setPhase("looking");
    f.hush();
    f.world.sparkTo(f.world.W / 2, f.world.H * .5, 16);
    await f.wait(500);
    const scouts = f.world.scoutOut();
    const sources = SCAN_SOURCES.filter((x) => on[x.id]).map((x) => x.id);
    const [res] = await Promise.all([
      native() ? invoke<ScanResult>("workflow_scan", { project: projectPath ?? null, sources }).catch((e) => { f.toast(`Scan failed: ${e}`); return null; }) : Promise.resolve(SAMPLE_SCAN),
      f.wait(1400),
    ]);
    setResult(res);
    const { stars, links } = constellationFromScan(res);
    f.world.setStars(stars, links);
    f.world.scoutBack(scouts);
    await f.world.revealStars(f.wait);
    f.world.sparkTo(f.world.W / 2, f.world.H * .13, 14);
    const agents = stars.filter((s) => s.kind === "agent").length;
    await f.say(`Your forge. ${agents === 1 ? "One agent" : `${agents} agents`}, and everything they work with. Lines are things that work together.`);
    setPhase("done");
  };
  if (top == null) return null;
  if (phase === "ask") {
    return (
      <div className="forge-content" style={{ top }}>
        <div className="forge-opts">
          {SCAN_SOURCES.map((x) => (
            <button type="button" key={x.id} className={`forge-opt ${on[x.id] ? "on" : ""}`} aria-pressed={on[x.id]} onClick={() => setOn({ ...on, [x.id]: !on[x.id] })}>
              {x.label}{x.defaultOn ? "" : <span className="n">optional</span>}
            </button>
          ))}
        </div>
        <div className="forge-row">
          <Btn primary autoFocus disabled={!Object.values(on).some(Boolean)} onClick={() => void look()}>Look</Btn>
          <Link onClick={() => { f.hush(); f.go(nextStep("scan")); }}>Skip</Link>
        </div>
      </div>
    );
  }
  if (phase === "looking") return null;
  return (
    <div className="forge-content" style={{ top: innerHeight - 130 }}>
      {showList && result ? <ul className="forge-list">{result.checked.map((c, i) => <li key={i}>{c.item}</li>)}</ul> : null}
      <div className="forge-row">
        <Btn primary autoFocus onClick={() => { f.hush(); f.go(nextStep("scan")); }}>That's right</Btn>
        <Link onClick={() => setShowList(!showList)}>{showList ? "Hide" : "What did you read?"}</Link>
        <Link onClick={() => { void invoke("workflow_scan_delete").catch(() => {}); f.world.hideStars(); f.toast("Scan deleted"); f.hush(); f.go(nextStep("scan")); }}>Forget it</Link>
      </div>
    </div>
  );
}

// ---- workflow: interview → forged path → upgrades → card ---------------------------

interface Q { key: "team" | "style" | "pains"; text: string; options: string[]; multi?: boolean }
const QUICK: Q[] = [
  { key: "team", text: OPENING, options: OPENING_OPTIONS },
  { key: "style", text: "How do you work with AI when you code?", options: STYLE.map((s) => s.label) },
  { key: "pains", text: `What slows you down most? Choose up to ${MAX_PAINS}.`, options: PAINS.map((p) => p.label), multi: true },
];
const idOf = <T extends string>(list: { id: T; label: string }[], label: string) => list.find((x) => x.label === label)?.id;

function Workflow({ f }: SceneProps) {
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
      // resuming after a reload: rebuild the constellation from the saved scan
      if (s && !f.world.hasStars()) { const { stars, links } = constellationFromScan(s); f.world.setStars(stars, links); f.world.showAllStars(); }
      const p = profileOf(savedProfile);
      if (p && p.updated) { setProfile(p); setPhase("path"); } else setProfile(emptyProfile(s));
      setLoaded(true);
    })();
  }, []);
  if (!loaded || !profile) return null;
  const done = (p: WorkflowProfile) => { const saved = { ...p, updated: Date.now() }; setProfile(saved); setAppSetting("workflowProfile", saved); setPhase("path"); };
  if (phase === "interview") return <Interview f={f} brain={brain} scan={scan} start={profile} onDone={done} />;
  return <Forged f={f} scan={scan} catalog={catalog} profile={profile} phase={phase} setPhase={setPhase} />;
}

function Interview({ f, brain, scan, start, onDone }: SceneProps & { brain: string; scan: ScanResult | null; start: WorkflowProfile; onDone: (p: WorkflowProfile) => void }) {
  const ai = brain !== "form" && native();
  const name = BRAIN_NAMES[brain] ?? "your AI";
  const [q, setQ] = useState<Q | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = useRef({ turns: [] as Turn[], profile: { ...start }, i: 0, ai });
  const optsRef = useRef<HTMLDivElement>(null);
  const lastQ = useRef<Q | null>(null);
  const lastAnswer = useRef("");

  const ask = async (next: Q) => {
    lastQ.current = next;
    setTop(null); setPicks([]); setTyped("");
    await f.say(next.text);
    setQ(next); setTop(f.below());
  };
  useEffect(() => {
    f.world.recede(true);
    f.world.setDim(true);
    f.world.sparkTo(f.world.W / 2, f.world.H * .3, 20);
    void (async () => {
      await f.say(state.current.ai ? `A few questions, through ${name}. Choose an answer, or say it in your own words.` : "A few quick questions. Choose an answer, or say it in your own words.");
      await f.wait(700);
      state.current.turns = [{ who: "ai", text: OPENING }];
      void ask(QUICK[0]);
    })();
    return () => { f.world.recede(false); f.world.setDim(false); };
  }, []);

  const finish = async (p: WorkflowProfile, thanks = "Understood. Now let's forge your workflow.") => {
    setQ(null); setTop(null);
    await f.say(thanks);
    await f.wait(600);
    onDone(p);
  };

  const answer = async (text: string, chosen: string[] = []) => {
    const s = state.current;
    const cur = q ?? lastQ.current;
    if (!cur || busy) return;
    optsRef.current?.querySelectorAll(".forge-opt.on").forEach((el) => f.absorb(el));
    if (!s.ai) {
      const p = { ...s.profile };
      if (cur.key === "team") p.team = idOf(TEAM, text) ?? p.team;
      if (cur.key === "style") p.style = idOf(STYLE, text) ?? p.style;
      if (cur.key === "pains") p.pains = chosen.map((c) => idOf(PAINS, c)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, MAX_PAINS);
      s.profile = p;
      setQ(null);
      await f.wait(600);
      s.i++;
      if (s.i < QUICK.length) void ask(QUICK[s.i]);
      else void finish(p);
      return;
    }
    lastAnswer.current = text;
    s.turns = [...s.turns, { who: "you", text: text.slice(0, MAX_ANSWER_CHARS) }];
    setBusy(true); setError(""); setQ(null);
    try {
      const raw = await invoke<unknown>("interview_turn", { brain, system: SYSTEM_PROMPT, prompt: buildPrompt(s.turns, s.profile, scan), schema: JSON.stringify(REPLY_SCHEMA) });
      const r = mergeReply(s.profile, raw);
      s.profile = r.profile;
      s.turns = [...s.turns, { who: "ai", text: r.say }];
      const answers = s.turns.filter((t) => t.who === "you").length;
      setBusy(false);
      if (r.done || answers >= MAX_ANSWERS) { void finish(r.profile, r.say); return; }
      void ask({ key: "pains", text: r.say, options: r.options });
    } catch (e) {
      setBusy(false);
      s.turns = s.turns.slice(0, -1);
      setError(`${name} couldn't answer: ${e}`);
    }
  };
  const fallBack = () => { state.current.ai = false; setError(""); state.current.i = 0; void ask(QUICK[0]); };

  if (busy) return <div className="forge-content" style={{ top: f.below() }}><div className="forge-micro">{name} is thinking</div></div>;
  if (error) {
    return (
      <div className="forge-content" style={{ top: f.below() }}>
        <div className="forge-note">{error}</div>
        <div className="forge-row"><Btn primary onClick={() => { setError(""); void answer(lastAnswer.current); }}>Try again</Btn><Link onClick={fallBack}>Use quick questions</Link></div>
      </div>
    );
  }
  if (top == null || !q) return null;
  const multi = q.multi && !state.current.ai;
  return (
    <div className="forge-content" style={{ top }}>
      <div ref={optsRef} className="forge-opts">
        {q.options.map((o) => {
          const i = picks.indexOf(o);
          return (
            <button type="button" key={o} className={`forge-opt ${i >= 0 ? "on" : ""}`} onClick={(e) => {
              if (!multi) { e.currentTarget.classList.add("on"); void answer(o); return; }
              setPicks(i >= 0 ? picks.filter((x) => x !== o) : picks.length < MAX_PAINS ? [...picks, o] : picks);
            }}>{multi && i >= 0 ? <span className="n">{String(i + 1).padStart(2, "0")}</span> : null}{o}</button>
          );
        })}
      </div>
      <div className="forge-type">
        <input value={typed} placeholder="Or in your own words…" aria-label="Your answer" maxLength={MAX_ANSWER_CHARS} autoFocus={q.options.length === 0}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) { f.absorb(e.currentTarget); void answer(typed.trim(), multi ? [typed.trim()] : []); } }} />
        {multi ? <Btn small primary disabled={picks.length === 0} onClick={() => void answer(picks.join(", "), picks)}>Done</Btn> : null}
      </div>
      <Link onClick={() => void finish(state.current.profile, "Fine. I'll forge with what I know.")}>Finish now</Link>
    </div>
  );
}

interface NodeView { id: string; name: string; x: number; y: number; lit: boolean; tools: string[] }

function Forged({ f, scan, catalog, profile, phase, setPhase }: SceneProps & { scan: ScanResult | null; catalog: Catalog; profile: WorkflowProfile; phase: string; setPhase: (p: "path" | "upgrades" | "card") => void }) {
  const have = useMemo(() => toolsYouHave(catalog, scan), [catalog, scan]);
  const stages = useMemo(() => workflowStages(have, scan, profile), [have, scan, profile]);
  const upgrades = useMemo(() => suggestUpgrades(profile, catalog, have, scan), [profile, catalog, have, scan]);
  const [nodes, setNodes] = useState<NodeView[]>([]);
  const [top, setTop] = useState<number | null>(null);
  const [placed, setPlaced] = useState<(Upgrade & { at: number })[]>([]);
  const [focus, setFocus] = useState<(Upgrade & { at: number }) | null>(null);
  const [target, setTarget] = useState(-1);
  const W = f.world.W, H = f.world.H;
  const y = H * .46;
  const slots = STAGES.map((_, i) => ({ x: W * .15 + (W * .7) * (i / (STAGES.length - 1)), y }));

  // stage lights + the path between them, drawn on the GPU
  useEffect(() => {
    nodes.forEach((n, i) => f.world.setBeacon(`stage:${n.id}`, { x: n.x, y: n.y, lit: n.lit ? 1 : .12, size: 30, pulse: target === i }));
    f.world.setPath(nodes.length ? nodes.map((n): PathPoint => ({ x: n.x, y: n.y, lit: n.lit })) : null);
  }, [nodes, target]);
  useEffect(() => () => { f.world.clearBeacons(); f.world.setPath(null); }, []);

  // the stars pull into a line and are forged into the five stages
  useEffect(() => {
    void (async () => {
      f.hush();
      f.world.sparkTo(W / 2, H * .13, 14);
      await f.world.forgeLine((label) => stageIndexOf(label, catalog), slots, f.wait);
      const ns: NodeView[] = [];
      for (const [i, st] of stages.entries()) {
        ns.push({ id: st.id, name: st.name, x: slots[i].x, y: slots[i].y, lit: st.covered, tools: st.tools });
        setNodes([...ns]);
        await f.wait(240);
      }
      const lit = ns.filter((n) => n.lit).map((n) => n.name), dark = ns.filter((n) => !n.lit).map((n) => n.name.toLowerCase());
      const a = lit.length ? `${lit.join(", ")} ${lit.length === 1 ? "is" : "are"} burning.` : "Nothing is burning yet.";
      const b = dark.length ? ` ${dark.join(", ").replace(/^./, (c) => c.toUpperCase())} ${dark.length === 1 ? "is" : "are"} still dark.` : " Every stage is lit.";
      await f.say(`Your workflow. ${a}${b}`);
      setTop(H - 130);
    })();
  }, []);

  const light = (u: Upgrade) => {
    const at = STAGES.findIndex((s) => s.id === u.stage);
    if (placed.some((p) => p.id === u.id) || at < 0) return;
    const ns = nodes.map((n, i) => (i === at ? { ...n, lit: true, tools: [u.name, ...n.tools] } : n));
    setNodes(ns);
    const p = { ...u, at };
    setPlaced([...placed, p]);
    setFocus(p);
  };

  const labels = nodes.map((n) => (
    <div key={n.id} className={`forge-stage ${n.lit ? "" : "gap"}`} style={{ left: n.x, top: n.y + 30 }}>
      <b>{n.name}</b>
      <small>{n.lit ? n.tools.slice(0, 2).join(", ") + (n.tools.length > 2 ? ` +${n.tools.length - 2}` : "") : "Dark"}</small>
    </div>
  ));

  if (phase === "path") {
    return (
      <>
        {labels}
        {top != null ? (
          <div className="forge-content" style={{ top }}>
            <Btn primary autoFocus onClick={() => { setTop(null); setPhase(upgrades.length ? "upgrades" : "card"); }}>{upgrades.length ? "Light the dark stages" : "Continue"}</Btn>
          </div>
        ) : null}
      </>
    );
  }

  if (phase === "upgrades") {
    return (
      <>
        {labels}
        <UpgradeIntro f={f} count={upgrades.length} />
        {focus ? (
          <div className="forge-placed" style={{ left: W / 2, top: H * .64 }}>
            <div className="head">{focus.name} lights {STAGES[focus.at].name}</div>
            <p>{focus.what}</p>
            {focus.command ? <code>{focus.command}</code> : null}
            <div className="acts">
              {focus.command ? <Link onClick={() => void navigator.clipboard.writeText(focus.command!).then(() => f.toast(focus.command!.startsWith("/") ? "Copied. Paste it into Claude Code" : "Copied. Run it in Terminal"), () => f.toast("Select the command to copy it"))}>Copy command</Link> : null}
              {focus.docs ? <Link onClick={() => void openExternal(focus.docs!)}>How to set it up</Link> : null}
              <Link onClick={() => setFocus(null)}>Done</Link>
            </div>
          </div>
        ) : (
          <div className="forge-ups" style={{ top: H * .64 }}>
            {upgrades.filter((u) => !placed.some((p) => p.id === u.id)).map((u, i) => (
              <UpgradeCard key={u.id} u={u} index={i} reduce={f.world.reduce}
                stagePos={() => { const at = STAGES.findIndex((s) => s.id === u.stage); return { x: nodes[at]?.x ?? 0, y: nodes[at]?.y ?? 0, at }; }}
                onTarget={setTarget} onPlace={() => { setTarget(-1); light(u); }} onMiss={(stage) => f.toast(`Drop it on ${stage}`)} />
            ))}
          </div>
        )}
        <div className="forge-content" style={{ top: H - 92 }}>
          <Btn primary={placed.length > 0} onClick={() => { setFocus(null); f.hush(); setPhase("card"); }}>{placed.length ? "Continue" : "Maybe later"}</Btn>
        </div>
      </>
    );
  }
  return <ShareCard f={f} nodes={nodes} scan={scan} profile={profile} />;
}

function UpgradeIntro({ f, count }: { f: Forge; count: number }) {
  useEffect(() => { void f.say(`${count === 1 ? "One upgrade" : `${count} upgrades`}, chosen for how you work. Drag one onto its stage to light it.`); }, []);
  return null;
}

function UpgradeCard({ u, index, reduce, stagePos, onTarget, onPlace, onMiss }: { u: Upgrade; index: number; reduce: boolean; stagePos: () => { x: number; y: number; at: number }; onTarget: (i: number) => void; onPlace: () => void; onMiss: (stage: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ sx: 0, sy: 0, on: false });
  const stage = STAGES.find((s) => s.id === u.stage)?.name ?? "";
  useEffect(() => {
    if (reduce || !ref.current) return;
    ref.current.animate([{ transform: "translateY(24px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 700, delay: index * 120, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
  }, []);
  const near = (x: number, y: number) => { const p = stagePos(); return Math.hypot(x - p.x, y - p.y) < 90; };
  return (
    <div ref={ref} className="forge-up" tabIndex={0} role="button" aria-label={`${u.name}. Lights ${stage}. Press Enter to place it.`}
      onKeyDown={(e) => { if (e.key === "Enter") onPlace(); }}
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
      <div className="kind"><i />{u.kind === "tip" ? "Tip" : u.kind}</div>
      <div className="name">{u.name}</div>
      <div className="why">{u.why}</div>
      <div className="foot"><span>Lights <b>{stage}</b></span><button type="button" onClick={onPlace}>Place</button></div>
    </div>
  );
}

function ShareCard({ f, nodes, scan, profile }: SceneProps & { nodes: NodeView[]; scan: ScanResult | null; profile: WorkflowProfile }) {
  const [top, setTop] = useState<number | null>(null);
  const card = useMemo(() => drawCard(nodes, scan, profile), []);
  useEffect(() => {
    f.world.clearBeacons();
    f.world.setPath(null);
    f.world.sparkTo(f.world.W / 2, f.world.H * .1, 13);
    void f.say("Your workflow, as a card. Share it if you like.").then(() => setTop(f.below(18)));
  }, []);
  const text = encodeURIComponent(`My AI coding workflow, forged in Grill Me: ${nodes.map((n) => `${n.lit ? "●" : "○"} ${n.name}`).join(" → ")}`);
  const save = async () => {
    if (!native()) { f.toast("Saving runs in the desktop app"); return; }
    try { const path = await invoke<string>("save_share_card", { pngBase64: card }); f.toast(`Saved to ${path.replace(/^\/Users\/[^/]+/, "~")}`); } catch (e) { f.toast(`${e}`); }
  };
  const copy = async () => {
    try { const blob = await (await fetch(card)).blob(); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); f.toast("Image copied"); }
    catch { f.toast("Couldn't copy the image here. Save it instead"); }
  };
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      <img className="forge-card" src={card} alt="Your Grill Me workflow card" />
      <div className="forge-row">
        <Link onClick={() => void save()}>Save image</Link>
        <Link onClick={() => void copy()}>Copy</Link>
        <Link onClick={() => void openExternal(`https://x.com/intent/post?text=${text}`)}>Post on X</Link>
        <Link onClick={() => void openExternal(`https://www.linkedin.com/feed/?shareActive=true&text=${text}`)}>LinkedIn</Link>
      </div>
      <Btn primary onClick={() => { f.hush(); f.world.hideStars(); f.go(nextStep("workflow")); }}>Continue</Btn>
    </div>
  );
}

/** A 1200×630 card (the size X and LinkedIn preview well), in the forge's
 *  language: black, hairlines, small type, light only where a stage burns. */
function drawCard(nodes: NodeView[], scan: ScanResult | null, profile: WorkflowProfile): string {
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const x = c.getContext("2d")!;
  const font = (w: number, s: number) => `${w} ${s}px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif`;
  const tracked = (s: string, cx: number, y: number, size: number, col: string, track: number, align: "left" | "center" | "right" = "left") => {
    x.font = font(500, size); x.fillStyle = col; x.textAlign = "left";
    const w = [...s].reduce((a, ch) => a + x.measureText(ch).width + track, -track);
    let px = align === "center" ? cx - w / 2 : align === "right" ? cx - w : cx;
    for (const ch of s) { x.fillText(ch, px, y); px += x.measureText(ch).width + track; }
  };
  x.fillStyle = "#000"; x.fillRect(0, 0, 1200, 630);
  x.strokeStyle = "rgba(255,255,255,.12)"; x.lineWidth = 1; x.strokeRect(24.5, 24.5, 1151, 581);
  tracked("MY AI CODING WORKFLOW", 72, 96, 13, "rgba(255,255,255,.45)", 4);
  const agents = constellationFromScan(scan).stars.filter((s) => s.kind === "agent").map((s) => s.label);
  x.font = font(500, 44); x.fillStyle = "#fff"; x.textAlign = "left"; x.fillText(agents.join("  +  "), 70, 158);
  const y = 330, xs = nodes.map((_, i) => 150 + i * 225);
  for (let i = 0; i < nodes.length - 1; i++) {
    const lit = nodes[i].lit && nodes[i + 1].lit;
    x.strokeStyle = lit ? "rgba(255,160,90,.85)" : "rgba(255,255,255,.18)"; x.lineWidth = 1.5; x.setLineDash(lit ? [] : [3, 7]);
    x.beginPath(); x.moveTo(xs[i] + 14, y); x.lineTo(xs[i + 1] - 14, y); x.stroke();
  }
  x.setLineDash([]);
  nodes.forEach((n, i) => {
    if (n.lit) {
      const g = x.createRadialGradient(xs[i], y, 0, xs[i], y, 46);
      g.addColorStop(0, "rgba(255,248,235,1)"); g.addColorStop(.12, "rgba(255,190,120,.95)"); g.addColorStop(.4, "rgba(240,110,40,.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.beginPath(); x.arc(xs[i], y, 46, 0, 6.283); x.fill();
    } else { x.strokeStyle = "rgba(255,255,255,.3)"; x.beginPath(); x.arc(xs[i], y, 5, 0, 6.283); x.stroke(); }
    tracked(n.name.toUpperCase(), xs[i], y + 74, 12, n.lit ? "#fff" : "rgba(255,255,255,.35)", 3, "center");
    x.textAlign = "center"; x.font = font(400, 16); x.fillStyle = n.lit ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.22)";
    const label = n.lit ? n.tools[0] ?? "" : "dark";
    x.fillText(label.length > 20 ? `${label.slice(0, 19)}…` : label, xs[i], y + 104);
  });
  const team = TEAM.find((t) => t.id === profile.team)?.label;
  const pains = profile.pains.map((p) => PAINS.find((q) => q.id === p)?.say ?? p);
  x.textAlign = "left"; x.font = font(400, 18); x.fillStyle = "rgba(255,255,255,.55)";
  x.fillText([team, pains.length ? `fixing ${pains.join(", ")}` : ""].filter(Boolean).join("   ·   "), 72, 548);
  tracked("FORGED IN GRILL ME", 1128, 548, 12, "rgba(255,170,110,.85)", 4, "right");
  return c.toDataURL("image/png");
}

function Consent({ f }: SceneProps) {
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "your project");
  const setAppSetting = useApp((s) => s.setAppSetting);
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .18, 16); }, []);
  const top = useLine(f, `To follow your sessions, I'll add a few small files to ${projectName}. They stay on this machine, and out of git.`);
  const answer = (v: true | "declined") => { setAppSetting("installConsent", v); f.hush(); f.go(nextStep("consent")); };
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      <div className="forge-files">
        {CONSENT_ITEMS.map((it) => <div key={it.title}><b>{it.title}</b><code>{it.file}</code><span>{it.detail}</span></div>)}
      </div>
      <div className="forge-row">
        <Btn primary autoFocus onClick={() => answer(true)}>Add them</Btn>
        <Link onClick={() => answer("declined")}>Not now</Link>
      </div>
      <div className="forge-micro">Remove them any time · Settings → Setup check</div>
    </div>
  );
}

function Team({ f }: SceneProps) {
  const joining = useApp((s) => s.appSettings.firstRunJoining === true);
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .26, 17); }, []);
  const top = useLine(f, joining
    ? "Last, your team. Every agent on it will read one plan."
    : "Working with others? Everyone's agents share one goal, one plan, one chat. Or begin alone, and invite them later.");
  const done = (mode: "solo" | "team") => {
    const st = useApp.getState();
    st.setAppSetting("onboarded", true);
    st.setAppMode(mode);
    st.setView("new");
    f.finish(false);
  };
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      <div className="forge-row">
        <Btn primary={joining} autoFocus={joining} onClick={() => done("team")}>{joining ? "Join my team" : "Create or join a team"}</Btn>
        <Btn primary={!joining} autoFocus={!joining} onClick={() => done("solo")}>Begin alone</Btn>
      </div>
      {joining ? <div className="forge-micro">Have the invite link ready · you'll paste it next</div> : null}
    </div>
  );
}
