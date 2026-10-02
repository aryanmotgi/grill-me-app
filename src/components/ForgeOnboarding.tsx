import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { ForgeWorld, SPRITES, type PathPoint } from "../forge/engine";
import { constellationFromScan, stageIndexOf } from "../forge/constellation";
import "../forge/forge.css";
import { LOGO_TEXT } from "../brand";
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
// First-run setup as an experience: "stepping into the forge where your
// workspace gets made". A full-screen, see-through ember world (src/forge)
// with the Spark, Grill Me's AI, as the guide. Same steps and logic as
// before (check → connect your AI → project → scan → interview + workflow +
// upgrades + card → consent → team); only the look and feel changed.
// "Skip to app" and Escape always work; Reduce Motion gets a still version;
// slow computers drop to a lite mode on their own.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;
const REQUIRED = ["claude", "git", "python3"];
/** The Spark's speech sits just under it. */
const bubbleTop = (y: number, r: number) => Math.min(innerHeight - 220, y + r * 4 + 14);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Forge {
  world: ForgeWorld;
  say: (text: string) => Promise<void>;
  hush: () => void;
  /** y just under the speech, where a scene puts its controls */
  below: (gap?: number) => number;
  toast: (msg: string) => void;
  go: (s: FirstRunStep) => void;
  wait: (ms: number) => Promise<void>;
  /** fly an element into the Spark (an answer being absorbed) */
  absorb: (el: Element | null) => void;
  finish: (fast: boolean) => void;
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

function Chip({ children, onClick, kind = "", float = true, disabled, autoFocus }: { children: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; kind?: string; float?: boolean; disabled?: boolean; autoFocus?: boolean }) {
  return <button type="button" className={`forge-chip ${kind} ${float ? "forge-float" : ""}`} onClick={onClick} disabled={disabled} autoFocus={autoFocus}>{children}</button>;
}

// =================================================================== the shell

export function ForgeOnboarding() {
  const step = useApp((s) => firstRunStepOf(s.appSettings.firstRunStep));
  const setAppSetting = useApp((s) => s.setAppSetting);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<HTMLDivElement>(null);
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
    // a browser preview has no desktop behind it: give it a dark backdrop
    if (!native()) document.documentElement.classList.add("forge-web");
    // ?reduce-motion forces the still version (handy to check it in a browser)
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || location.search.includes("reduce-motion");
    const world = new ForgeWorld(canvasRef.current!, starsRef.current!, reduce);
    const wait = (ms: number) => sleep(reduce ? Math.min(ms, 200) : ms);
    let toastT = 0;
    const toast = (msg: string) => {
      const el = toastRef.current!;
      el.textContent = msg;
      el.classList.add("on");
      clearTimeout(toastT);
      toastT = window.setTimeout(() => el.classList.remove("on"), 3000);
    };
    let sayGen = 0;
    const forge: Forge = {
      world, wait, toast,
      go: (s) => useApp.getState().setAppSetting("firstRunStep", s),
      say: async (text) => {
        const gen = ++sayGen;
        const el = sayRef.current!;
        el.innerHTML = '<span class="who">The Spark</span><span class="tx"></span>';
        const tx = el.querySelector(".tx")!;
        el.classList.add("on");
        world.spark.speaking = true;
        if (reduce) tx.textContent = text;
        else {
          for (let i = 1; i <= text.length; i++) {
            if (gen !== sayGen) return;
            tx.textContent = text.slice(0, i);
            await sleep(".?!".includes(text[i - 1]) ? 150 : 16);
          }
        }
        if (gen === sayGen) world.spark.speaking = false;
      },
      hush: () => { sayGen++; world.spark.speaking = false; sayRef.current?.classList.remove("on"); },
      below: (gap = 18) => {
        // from where the Spark is heading (the bubble may still be moving)
        const h = sayRef.current!.getBoundingClientRect().height || 80;
        return Math.min(innerHeight - 180, bubbleTop(world.spark.ty, world.spark.tr) + h + gap);
      },
      absorb: (el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const ghost = el.cloneNode(true) as HTMLElement;
        ghost.classList.remove("forge-float");
        Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: "0", zIndex: "20", pointerEvents: "none", translate: "0 0" });
        document.body.appendChild(ghost);
        const dx = world.spark.x - (r.left + r.width / 2), dy = world.spark.y - (r.top + r.height / 2);
        const done = () => { ghost.remove(); world.feed(); };
        if (reduce) { done(); return; }
        ghost.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.15)`, opacity: .2 }], { duration: 620, easing: "cubic-bezier(.5,0,.75,0)" }).onfinish = done;
      },
      finish: (fast) => { if (!finaleRef.current) setFinale(fast ? "fast" : "full"); },
    };
    world.onFrame = (sp) => { if (sayRef.current) sayRef.current.style.top = `${bubbleTop(sp.y, sp.r)}px`; };
    world.onLite = () => toast("Lite mode on: this computer is busy, so the forge uses fewer embers");
    world.start();
    setF(forge);
    // the launch animation hands off on the logo: burst it into the world.
    // Resuming mid-setup (opening a project reloads the app) skips that.
    void (async () => {
      const first = firstRunStepOf(useApp.getState().appSettings.firstRunStep) === "welcome";
      await document.fonts.ready;
      if (first) await world.logoBurst(LOGO_TEXT, wait);
      else world.sparkBorn(world.W / 2, world.H * .36);
      setReady(true);
    })();
    return () => { world.stop(); document.documentElement.classList.remove("forge-on", "forge-web"); };
  }, []);

  // Skip to app / Escape: always works, from anywhere
  const skip = () => {
    const st = useApp.getState();
    st.setAppSetting("onboarded", true);
    if (st.appMode === null) st.setAppMode("solo");
    f?.finish(true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") skip(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // the finale: everything collapses into the glass box, which opens into the app
  useEffect(() => {
    if (!finale || !f) return;
    const fast = finale === "fast";
    const q = f.world.reduce ? 0 : fast ? .45 : 1;
    void (async () => {
      f.hush();
      f.world.collapse();
      const box = boxRef.current!;
      await sleep(500 * q);
      box.style.opacity = "1";
      f.world.spark.born = false;
      if (!f.world.reduce) box.querySelector<HTMLElement>(".cube")!.style.animation = `forge-spin ${2.4 * q}s ease-in-out`;
      for (let p = 0; p <= 100; p += 10) { box.style.setProperty("--fill", `${p}%`); box.querySelectorAll<HTMLElement>(".f").forEach((x) => x.style.setProperty("--fill", `${p}%`)); await sleep(110 * q); }
      box.style.transform = "scale(9)";
      box.style.opacity = "0";
      f.world.fadeEmbers(.2);
      await sleep(380 * q);
      setAppSetting("firstRunStep", "done");
      if (native()) await invoke("forge_window_done").catch(() => {});
    })();
  }, [finale, f]);

  const n = stepNumber(step);
  return (
    <div className="forge" role="dialog" aria-label="Set up Grill Me">
      <div className="forge-veil" />
      <canvas ref={canvasRef} />
      <div ref={starsRef} className="forge-stars" aria-hidden />
      <div data-tauri-drag-region className="forge-drag" />
      <div className="forge-ui">
        {f && ready && !finale ? <Scene step={step} f={f} /> : null}
      </div>
      <div ref={sayRef} className="forge-say" role="status" aria-live="polite" />
      <div ref={boxRef} className="forge-box" aria-hidden>
        <div className="cube">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className={`f f${i}`} />)}</div>
      </div>
      {!finale ? <button type="button" className="forge-skip" onClick={skip}>Skip to app<kbd>esc</kbd></button> : null}
      <div className="forge-steps" aria-hidden>{FIRST_RUN_STEPS.map((s, i) => <i key={s} className={i < n ? "on" : ""} />)}</div>
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
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .32, 15); }, []);
  const top = useLine(f, "Welcome to the forge. This is where your workspace gets made. A few minutes, and you can leave any time.");
  const start = (join: boolean) => { setAppSetting("firstRunJoining", join); f.hush(); f.go(nextStep("welcome")); };
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      <div className="forge-row">
        <Chip kind={joining ? "" : "go"} autoFocus={!joining} onClick={() => start(false)}>Start forging</Chip>
        <Chip kind={joining ? "go" : ""} autoFocus={joining} onClick={() => start(true)}>I'm joining a team</Chip>
      </div>
    </div>
  );
}

function Check({ f }: SceneProps) {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [busy, setBusy] = useState("");
  const refresh = () => { void runDoctor().then(setChecks); };
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .24, 13); refresh(); }, []);
  const required = (checks ?? []).filter((c) => REQUIRED.includes(c.id));
  const allOk = checks !== null && required.every((c) => c.ok);
  const top = useLine(f, checks === null ? "First, let me check this computer has what the forge needs." : allOk ? "Everything the forge needs is here." : "A few tools are missing. I can install them, or you can run the command yourself.");
  // all good: move on by itself
  useEffect(() => {
    if (!native()) return;
    if (checks !== null && allOk) { const t = setTimeout(() => { f.hush(); f.go(nextStep("check")); }, 1400); return () => clearTimeout(t); }
  }, [checks, allOk]);
  const install = async (c: DoctorCheck) => {
    setBusy(c.id);
    try { await invoke("doctor_install", { id: c.id }); refresh(); } catch (e) { f.toast(`${e}`); } finally { setBusy(""); }
  };
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      {!native() ? <div className="forge-note">The computer check runs in the desktop app.</div> : null}
      {required.map((c) => (
        <div key={c.id} className={`forge-check ${c.ok ? "ok" : "missing"}`}>
          <span className="dot" />
          <div className="grow"><b>{c.label}</b><small>{c.ok ? c.detail : c.why}</small></div>
          {!c.ok ? (
            <>
              <Chip float={false} kind="go" disabled={!!busy} onClick={() => void install(c)}>{busy === c.id ? "Installing…" : "Install for me"}</Chip>
              <Chip float={false} kind="ghost" onClick={() => void navigator.clipboard.writeText(c.fix).then(() => f.toast("Copied. Run it in Terminal, then press Check again"))}>Copy command</Chip>
            </>
          ) : null}
        </div>
      ))}
      {!allOk || !native() ? (
        <div className="forge-row">
          {native() ? <Chip float={false} kind="ghost" onClick={refresh}>Check again</Chip> : null}
          <Chip float={false} kind={allOk || !native() ? "go" : "ghost"} onClick={() => { f.hush(); f.go(nextStep("check")); }}>{allOk || !native() ? "Continue" : "Skip for now"}</Chip>
        </div>
      ) : null}
    </div>
  );
}

const SAMPLE_AIS: AiStatus[] = [
  { id: "claude", name: "Claude Code", installed: true, signedIn: true, detail: "" },
  { id: "codex", name: "Codex", installed: true, signedIn: false, detail: "" },
];
const AI_MARK: Record<string, string> = { claude: "C", codex: "Cx", cursor: "Cu", gemini: "G" };

function Connect({ f }: SceneProps) {
  const setAppSetting = useApp((s) => s.setAppSetting);
  const saved = useApp((s) => s.appSettings.interviewBrain);
  const [rows, setRows] = useState<AiStatus[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [waiting, setWaiting] = useState("");
  const orbRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    f.world.sparkTo(f.world.W / 2, f.world.H * .2, 13);
    const load = native() ? invoke<AiStatus[]>("ai_status", { ids: null }).catch(() => []) : Promise.resolve(SAMPLE_AIS);
    void load.then((r) => { setRows(r); setChosen(pickBrain(r, saved)); });
  }, []);
  const top = useLine(f, "I talk through your own AI. It uses a little of your plan, about one short chat. Light one up.");
  const installed = (rows ?? []).filter((r) => r.installed);
  const ready = readyAis(rows ?? []);

  const ignite = (now: AiStatus) => {
    setRows((rs) => (rs ?? []).map((x) => (x.id === now.id ? now : x)));
    setChosen(now.id);
    const el = orbRefs.current[now.id]?.querySelector(".ball");
    if (el) { const r = el.getBoundingClientRect(); f.world.burstAt(r.left + r.width / 2, r.top + r.height / 2, 40); }
  };
  const signIn = async (r: AiStatus) => {
    setWaiting(r.id);
    if (!native()) { await sleep(1400); ignite({ ...r, signedIn: true }); setWaiting(""); return; }
    f.toast(r.id === "gemini" ? "Gemini opened in Terminal. Pick “Sign in with Google” there." : "Finish signing in in your browser. I'll notice.");
    const started = Date.now();
    const poll = window.setInterval(() => {
      if (Date.now() - started > 10 * 60_000) { window.clearInterval(poll); setWaiting(""); return; }
      void invoke<AiStatus[]>("ai_status", { ids: [r.id] }).then(([now]) => {
        if (now?.signedIn === true) { window.clearInterval(poll); setWaiting(""); ignite(now); }
      }).catch(() => {});
    }, 3000);
    invoke("ai_login", { id: r.id }).catch((e) => f.toast(`${e}`));
  };
  const finish = (brain: string) => { setAppSetting("interviewBrain", brain); f.hush(); f.go(nextStep("connect")); };

  if (top == null || rows === null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      {installed.length === 0 ? <div className="forge-note">No AI coding tools found. That's fine: I'll ask a few quick questions instead.</div> : null}
      <div className="forge-orbs">
        {installed.map((r) => {
          const lit = r.signedIn === true;
          return (
            <div key={r.id} ref={(el) => { orbRefs.current[r.id] = el; }} className={`forge-orb ${lit ? "lit" : ""} ${chosen === r.id ? "chosen" : ""}`}>
              <button type="button" className="ball" aria-label={r.name} onClick={() => lit && setChosen(r.id)}>{AI_MARK[r.id] ?? r.name[0]}</button>
              <b>{r.name}</b>
              <small>{waiting === r.id ? "Finish in your browser…" : statusLabel(r)}</small>
              {!lit ? <Chip float={false} disabled={waiting === r.id} onClick={() => void signIn(r)}>{waiting === r.id ? "Waiting…" : "Sign in"}</Chip> : null}
            </div>
          );
        })}
      </div>
      <div className="forge-row">
        {ready.length ? <Chip float={false} kind="go" onClick={() => finish(chosen || ready[0].id)}>Continue with {BRAIN_NAMES[chosen] ?? "your AI"}</Chip> : null}
        <Chip float={false} kind={ready.length ? "ghost" : "go"} onClick={() => finish("form")}>Use quick questions instead</Chip>
      </div>
    </div>
  );
}

function Project({ f }: SceneProps) {
  const activeProject = useApp((s) => s.activeProject);
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name);
  const [found, setFound] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const warn = (m: string) => f.toast(m);
  // opening a project reloads the app: save the next step first so the forge resumes there
  const advance = () => { f.hush(); f.go(nextStep("project")); };
  useEffect(() => {
    f.world.sparkTo(f.world.W / 2, f.world.H * .22, 13);
    if (native()) void invoke<string[]>("discover_repos", { known: [] }).then((r) => setFound(r.slice(0, 6))).catch(() => {});
  }, []);
  const top = useLine(f, "Which project are we forging? Pick one I found, open a folder, or paste your team's repo link.");
  const has = !!activeProject && activeProject !== "default";
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
      <div className="forge-row">
        {has ? <Chip kind="go" onClick={advance}>Keep {projectName ?? activeProject}</Chip> : null}
        {found.map((p) => <Chip key={p} disabled={!!busy} onClick={() => void openPath(p)}>{busy === p ? "Opening…" : p.split("/").pop()}</Chip>)}
        <Chip kind={has || found.length ? "ghost" : "go"} disabled={!!busy || !native()} onClick={() => void openFolder()}>{busy === "folder" ? "Opening…" : "Open a folder…"}</Chip>
        {!native() ? <Chip kind="go" onClick={advance}>Continue</Chip> : null}
      </div>
      <div className="forge-type">
        <input value={url} placeholder="https://github.com/your-team/your-repo" aria-label="Repository link" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void clone(); }} />
        <Chip float={false} kind="go" disabled={!url.trim() || !!busy || !native()} onClick={() => void clone()}>{busy === "clone" ? "Downloading…" : "Download"}</Chip>
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
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    f.world.sparkTo(f.world.W / 2, f.world.H * .2, 13);
    void f.say("Can I look at your setup? Names of tools only, never keys or code. Nothing leaves this computer.").then(() => live && setTop(f.below()));
    return () => { live = false; };
  }, []);
  const look = async () => {
    setPhase("looking");
    f.hush();
    f.world.sparkTo(f.world.W / 2, f.world.H * .5, 12);
    await f.wait(450);
    f.world.scoutOut();
    void f.say("Looking around…");
    const sources = SCAN_SOURCES.filter((x) => on[x.id]).map((x) => x.id);
    const [res] = await Promise.all([
      native() ? invoke<ScanResult>("workflow_scan", { project: projectPath ?? null, sources }).catch((e) => { f.toast(`Scan failed: ${e}`); return null; }) : Promise.resolve(SAMPLE_SCAN),
      f.wait(1300),
    ]);
    setResult(res);
    const { stars, links } = constellationFromScan(res);
    f.world.setStars(stars, links);
    f.world.scoutBack();
    await f.world.revealStars(f.wait);
    f.world.sparkTo(f.world.W / 2, f.world.H * .12, 11);
    const agents = stars.filter((s) => s.kind === "agent").length;
    await f.say(`Here's your forge: ${agents === 1 ? "your agent" : `${agents} agents`} and what they work with. Lines are things that work together.`);
    setPhase("done");
  };
  if (top == null) return null;
  if (phase === "ask") {
    return (
      <div className="forge-content" style={{ top }}>
        <div className="forge-row">
          {SCAN_SOURCES.map((x) => (
            <Chip key={x.id} float={false} kind={on[x.id] ? "on" : "ghost"} onClick={() => setOn({ ...on, [x.id]: !on[x.id] })}>{x.label}{x.defaultOn ? "" : " (optional)"}</Chip>
          ))}
        </div>
        <div className="forge-note">{SCAN_SOURCES.find((x) => x.id === "history")?.detail}</div>
        <div className="forge-row">
          <Chip kind="go" disabled={!Object.values(on).some(Boolean)} onClick={() => void look()}>Let the Spark look</Chip>
          <Chip kind="ghost" onClick={() => { f.hush(); f.go(nextStep("scan")); }}>Skip</Chip>
        </div>
      </div>
    );
  }
  if (phase === "looking") return null;
  return (
    <div className="forge-content" style={{ top: innerHeight - 150 }}>
      {showList && result ? <ul className="forge-panel">{result.checked.map((c, i) => <li key={i}>{c.item}</li>)}</ul> : null}
      <div className="forge-row">
        <Chip kind="go" autoFocus onClick={() => { f.hush(); f.go(nextStep("scan")); }}>Looks right</Chip>
        <Chip kind="ghost" onClick={() => setShowList(!showList)}>{showList ? "Hide" : "What did you look at?"}</Chip>
        <Chip kind="ghost" onClick={() => { void invoke("workflow_scan_delete").catch(() => {}); f.world.hideStars(); f.toast("Scan deleted"); f.hush(); f.go(nextStep("scan")); }}>Delete this scan</Chip>
      </div>
    </div>
  );
}

// ---- workflow: interview → path → upgrades → card ----------------------------------

interface Q { key: "team" | "style" | "pains"; text: string; options: string[]; multi?: boolean }
const QUICK: Q[] = [
  { key: "team", text: OPENING, options: OPENING_OPTIONS },
  { key: "style", text: "How do you use AI to code?", options: STYLE.map((s) => s.label) },
  { key: "pains", text: `What slows you down most? Pick up to ${MAX_PAINS}.`, options: PAINS.map((p) => p.label), multi: true },
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
      if (s) { const { stars, links } = constellationFromScan(s); f.world.setStars(stars, links); f.world.showAllStars(); }
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
  const rowRef = useRef<HTMLDivElement>(null);
  const lastQ = useRef<Q | null>(null);
  const lastAnswer = useRef("");

  const ask = async (next: Q) => {
    lastQ.current = next;
    setTop(null); setPicks([]); setTyped("");
    await f.say(next.text);
    setQ(next); setTop(f.below(22));
  };
  useEffect(() => {
    f.world.recede(true);
    f.world.setDim(true);
    f.world.sparkTo(f.world.W / 2, f.world.H * .3, 15);
    void (async () => {
      await f.say(state.current.ai ? `A few questions, through ${name}. Tap an answer or type your own.` : "A few quick questions. Tap an answer or type your own.");
      await f.wait(600);
      state.current.turns = [{ who: "ai", text: OPENING }];
      void ask(QUICK[0]);
    })();
    return () => { f.world.recede(false); f.world.setDim(false); };
  }, []);

  const finish = async (p: WorkflowProfile, thanks = "Got it. Let's forge your workflow.") => {
    setQ(null); setTop(null);
    await f.say(thanks);
    await f.wait(500);
    onDone(p);
  };

  const answer = async (text: string, chosen: string[] = []) => {
    const s = state.current;
    const cur = q ?? lastQ.current;
    if (!cur || busy) return;
    // the answer is absorbed into the Spark
    const els = rowRef.current ? [...rowRef.current.querySelectorAll(".forge-chip.on, .forge-chip.picked")] : [];
    els.forEach((el) => f.absorb(el));
    if (!s.ai) {
      // quick questions: fill fields straight from the chips
      const p = { ...s.profile };
      if (cur.key === "team") p.team = idOf(TEAM, text) ?? p.team;
      if (cur.key === "style") p.style = idOf(STYLE, text) ?? p.style;
      if (cur.key === "pains") p.pains = chosen.map((c) => idOf(PAINS, c)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, MAX_PAINS);
      s.profile = p;
      setQ(null);
      await f.wait(650);
      s.i++;
      if (s.i < QUICK.length) void ask(QUICK[s.i]);
      else void finish(p);
      return;
    }
    // your AI: one turn, validated, then its next question and options
    lastAnswer.current = text;
    s.turns = [...s.turns, { who: "you", text: text.slice(0, MAX_ANSWER_CHARS) }];
    setBusy(true); setError(""); setQ(null);
    try {
      const raw = await invoke<unknown>("interview_turn", { brain, system: SYSTEM_PROMPT, prompt: buildPrompt(s.turns, s.profile, scan), schema: JSON.stringify(REPLY_SCHEMA) });
      const r = mergeReply(s.profile, raw);
      s.profile = r.profile;
      s.turns = [...s.turns, { who: "ai", text: r.say }];
      const answers = s.turns.filter((t) => t.who === "you").length;
      if (r.done || answers >= MAX_ANSWERS) { setBusy(false); void finish(r.profile, r.say); return; }
      setBusy(false);
      void ask({ key: "pains", text: r.say, options: r.options });
    } catch (e) {
      setBusy(false);
      s.turns = s.turns.slice(0, -1);
      setError(`${name} couldn't answer: ${e}`);
    }
  };

  const fallBack = () => { state.current.ai = false; setError(""); state.current.i = 0; void ask(QUICK[0]); };

  if (busy) return <div className="forge-content" style={{ top: f.below(22) }}><div className="forge-note">{name} is thinking…</div></div>;
  if (error) {
    return (
      <div className="forge-content" style={{ top: f.below(22) }}>
        <div className="forge-note">{error}</div>
        <div className="forge-row"><Chip kind="go" onClick={() => { setError(""); void answer(lastAnswer.current); }}>Try again</Chip><Chip kind="ghost" onClick={fallBack}>Use quick questions</Chip></div>
      </div>
    );
  }
  if (top == null || !q) return null;
  const multi = q.multi && !state.current.ai;
  return (
    <div className="forge-content" style={{ top }}>
      <div ref={rowRef} className="forge-row">
        {q.options.map((o) => {
          const i = picks.indexOf(o);
          return (
            <Chip key={o} kind={i >= 0 ? "on picked" : ""} onClick={(e) => {
              if (!multi) { e.currentTarget.classList.add("picked"); void answer(o); return; }
              setPicks(i >= 0 ? picks.filter((x) => x !== o) : picks.length < MAX_PAINS ? [...picks, o] : picks);
            }}>{multi && i >= 0 ? <span className="n">{i + 1}</span> : null}{o}</Chip>
          );
        })}
      </div>
      <div className="forge-type">
        <input value={typed} placeholder="Or type it…" aria-label="Type your answer" maxLength={MAX_ANSWER_CHARS} autoFocus={q.options.length === 0}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) { f.absorb(e.currentTarget); void answer(typed.trim(), multi ? [typed.trim()] : []); } }} />
        {multi ? <Chip float={false} kind="go" disabled={picks.length === 0} onClick={() => void answer(picks.join(", "), picks)}>That's it</Chip> : null}
      </div>
      <div className="forge-row"><button type="button" className="forge-chip ghost" style={{ padding: "4px 12px", fontSize: 12.5 }} onClick={() => void finish(state.current.profile, "No problem. Let's forge with what I know.")}>Finish now</button></div>
    </div>
  );
}

interface NodeView { id: string; name: string; x: number; y: number; lit: boolean; tools: string[]; ignite: number }

function Forged({ f, scan, catalog, profile, phase, setPhase }: SceneProps & { scan: ScanResult | null; catalog: Catalog; profile: WorkflowProfile; phase: string; setPhase: (p: "path" | "upgrades" | "card") => void }) {
  const have = useMemo(() => toolsYouHave(catalog, scan), [catalog, scan]);
  const stages = useMemo(() => workflowStages(have, scan, profile), [have, scan, profile]);
  const upgrades = useMemo(() => suggestUpgrades(profile, catalog, have, scan), [profile, catalog, have, scan]);
  const [nodes, setNodes] = useState<NodeView[]>([]);
  const [top, setTop] = useState<number | null>(null);
  const [placed, setPlaced] = useState<(Upgrade & { at: number })[]>([]);
  const [focus, setFocus] = useState<(Upgrade & { at: number }) | null>(null);
  const [dragTarget, setDragTarget] = useState(-1);
  const [card, setCard] = useState("");
  const W = f.world.W, H = f.world.H;
  const y = H * .48;
  const slots = STAGES.map((_, i) => ({ x: W * .14 + (W * .72) * (i / (STAGES.length - 1)), y }));

  const syncPath = (ns: NodeView[]) => f.world.setPath(ns.map((n): PathPoint => ({ x: n.x, y: n.y - 18, lit: n.lit })));

  // the stars pull into a line and get forged into the five stages
  useEffect(() => {
    void (async () => {
      f.hush();
      f.world.sparkTo(W / 2, H * .13, 11);
      await f.world.forgeLine((label) => stageIndexOf(label, catalog), slots, f.wait);
      const ns: NodeView[] = [];
      for (const [i, st] of stages.entries()) {
        ns.push({ id: st.id, name: st.name, x: slots[i].x, y: slots[i].y, lit: st.covered, tools: st.tools, ignite: st.covered ? 1 : 0 });
        setNodes([...ns]);
        if (st.covered) f.world.burstAt(slots[i].x, slots[i].y - 18, 22);
        await f.wait(220);
      }
      syncPath(ns);
      const lit = ns.filter((n) => n.lit).map((n) => n.name), dark = ns.filter((n) => !n.lit).map((n) => n.name.toLowerCase());
      await f.say(`Here's your workflow. ${lit.length ? `${lit.join(", ")} ${lit.length === 1 ? "is" : "are"} lit.` : "Nothing's lit yet."} ${dark.length ? `${dark.join(", ")} ${dark.length === 1 ? "is" : "are"} still dark.` : "Every stage is lit."}`.replace(/\. ([a-z])/, (_, c: string) => `. ${c.toUpperCase()}`));
      setTop(H - 150);
    })();
    return () => { f.world.setPath(null); };
  }, []);

  const light = (u: Upgrade) => {
    const at = STAGES.findIndex((s) => s.id === u.stage);
    if (placed.some((p) => p.id === u.id)) return;
    const ns = nodes.map((n, i) => (i === at ? { ...n, lit: true, tools: [u.name, ...n.tools], ignite: n.ignite + 1 } : n));
    setNodes(ns);
    syncPath(ns);
    f.world.burstAt(ns[at].x, ns[at].y - 18, 46);
    const p = { ...u, at };
    setPlaced([...placed, p]);
    setFocus(p);
  };

  if (phase === "path") {
    return (
      <>
        {nodes.map((n) => <StageNode key={`${n.id}-${n.ignite}`} n={n} target={false} />)}
        {top != null ? (
          <div className="forge-content" style={{ top }}>
            <div className="forge-row">
              <Chip kind="go" autoFocus onClick={() => { setTop(null); setPhase(upgrades.length ? "upgrades" : "card"); }}>{upgrades.length ? "Show me how to light them" : "Continue"}</Chip>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (phase === "upgrades") {
    return (
      <>
        {nodes.map((n, i) => <StageNode key={`${n.id}-${n.ignite}`} n={n} target={dragTarget === i} />)}
        <UpgradeIntro f={f} count={upgrades.length} />
        <div className="forge-ups" style={{ top: H * .64 }}>
          {upgrades.filter((u) => !placed.some((p) => p.id === u.id)).map((u, i) => (
            <UpgradeCard key={u.id} u={u} index={i} reduce={f.world.reduce}
              nodeRect={() => {
                const at = STAGES.findIndex((s) => s.id === u.stage);
                return { x: nodes[at]?.x ?? 0, y: (nodes[at]?.y ?? 0) - 18, at };
              }}
              onTarget={setDragTarget}
              onPlace={() => { setDragTarget(-1); light(u); }}
              onMiss={(stage) => f.toast(`Drop it on ${stage}`)} />
          ))}
        </div>
        {focus ? (
          <div className="forge-placed" style={{ left: Math.min(Math.max(nodes[focus.at].x, 200), W - 200), top: nodes[focus.at].y + 74 }}>
            <b>{focus.name}</b> lights {STAGES[focus.at].name}. {focus.what}
            {focus.command ? <code>{focus.command}</code> : null}
            <div className="acts">
              {focus.command ? <Chip float={false} kind="go" onClick={() => void navigator.clipboard.writeText(focus.command!).then(() => f.toast(focus.command!.startsWith("/") ? "Copied. Paste it into Claude Code" : "Copied. Run it in Terminal"), () => f.toast("Select the command to copy it"))}>Copy command</Chip> : null}
              {focus.docs ? <Chip float={false} kind="ghost" onClick={() => void openExternal(focus.docs!)}>How to set it up</Chip> : null}
              <Chip float={false} kind="ghost" onClick={() => setFocus(null)}>Done</Chip>
            </div>
          </div>
        ) : null}
        <div className="forge-content" style={{ top: H - 96 }}>
          <div className="forge-row"><Chip float={false} kind={placed.length ? "go" : "ghost"} onClick={() => { setFocus(null); f.hush(); setPhase("card"); }}>{placed.length ? "Continue" : "Maybe later"}</Chip></div>
        </div>
      </>
    );
  }

  // card
  return <ShareCard f={f} nodes={nodes} scan={scan} profile={profile} card={card} setCard={setCard} />;
}

function StageNode({ n, target }: { n: NodeView; target: boolean }) {
  return (
    <div className={`forge-node ${n.lit ? "lit" : "gap"} ${target ? "target" : ""} ${n.ignite > 1 ? "ignite" : ""}`} style={{ left: n.x, top: n.y }}>
      <div className="core" />
      <b>{n.name}</b>
      <small>{n.lit ? n.tools.slice(0, 2).join(", ") + (n.tools.length > 2 ? ` +${n.tools.length - 2}` : "") : "Nothing yet"}</small>
    </div>
  );
}

function UpgradeIntro({ f, count }: { f: Forge; count: number }) {
  useEffect(() => { void f.say(`${count === 1 ? "One upgrade" : `${count} upgrades`} picked for you. Drag one onto its stage to light it.`); }, []);
  return null;
}

function UpgradeCard({ u, index, reduce, nodeRect, onTarget, onPlace, onMiss }: { u: Upgrade; index: number; reduce: boolean; nodeRect: () => { x: number; y: number; at: number }; onTarget: (i: number) => void; onPlace: () => void; onMiss: (stage: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; on: boolean }>({ sx: 0, sy: 0, on: false });
  const stage = STAGES.find((s) => s.id === u.stage)?.name ?? "";
  useEffect(() => {
    if (reduce || !ref.current) return;
    ref.current.animate([{ transform: "translateY(70px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 600, delay: index * 140, easing: "cubic-bezier(.2,1.2,.4,1)", fill: "backwards" });
  }, []);
  const near = (x: number, y: number) => { const r = nodeRect(); return Math.hypot(x - r.x, y - r.y) < 95; };
  return (
    <div ref={ref} className="forge-up" tabIndex={0} role="button" aria-label={`${u.name}. Lights ${stage}. Press Enter to place it.`}
      onKeyDown={(e) => { if (e.key === "Enter") onPlace(); }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).tagName === "BUTTON") return;
        drag.current = { sx: e.clientX, sy: e.clientY, on: true };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.classList.add("dragging");
        onTarget(nodeRect().at);
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
      <span className="gem" />
      <div className="name">{u.name}<span className="kind">{u.kind === "tip" ? "tip" : u.kind}</span></div>
      <div className="why">{u.why}</div>
      <div className="foot"><span>Lights <b>{stage}</b></span><button type="button" onClick={onPlace}>Place it</button></div>
    </div>
  );
}

function ShareCard({ f, nodes, scan, profile, card, setCard }: SceneProps & { nodes: NodeView[]; scan: ScanResult | null; profile: WorkflowProfile; card: string; setCard: (s: string) => void }) {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    f.world.setPath(null);
    f.world.sparkTo(f.world.W / 2, f.world.H * .09, 10);
    setCard(drawCard(nodes, scan, profile));
    void f.say("Your workflow, as a card. Share it if you like.").then(() => setTop(f.below(14)));
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
  if (top == null || !card) return null;
  return (
    <div className="forge-content" style={{ top }}>
      <img className="forge-card" src={card} alt="Your Grill Me workflow card" />
      <div className="forge-row">
        <Chip float={false} kind="go" onClick={() => void save()}>Save image</Chip>
        <Chip float={false} kind="ghost" onClick={() => void copy()}>Copy</Chip>
        <Chip float={false} kind="ghost" onClick={() => void openExternal(`https://x.com/intent/post?text=${text}`)}>Post on X</Chip>
        <Chip float={false} kind="ghost" onClick={() => void openExternal(`https://www.linkedin.com/feed/?shareActive=true&text=${text}`)}>Share on LinkedIn</Chip>
        <Chip float={false} kind="go" onClick={() => { f.hush(); f.world.hideStars(); f.go(nextStep("workflow")); }}>Continue</Chip>
      </div>
    </div>
  );
}

/** A 1200×630 image (the size X and LinkedIn preview well) of their workflow. */
function drawCard(nodes: NodeView[], scan: ScanResult | null, profile: WorkflowProfile): string {
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 1200, 630);
  g.addColorStop(0, "#1c1219"); g.addColorStop(1, "#0d090c");
  x.fillStyle = g; x.fillRect(0, 0, 1200, 630);
  const glow = (cx: number, cy: number, r: number, col: string) => { const gg = x.createRadialGradient(cx, cy, 0, cx, cy, r); gg.addColorStop(0, col); gg.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gg; x.fillRect(0, 0, 1200, 630); };
  glow(120, 600, 420, "rgba(196,84,40,.35)"); glow(1120, 40, 360, "rgba(242,160,78,.18)");
  x.globalCompositeOperation = "lighter";
  for (let i = 0; i < 140; i++) { const s = 6 + Math.random() * 16; x.globalAlpha = Math.random() * .5; x.drawImage(SPRITES[(Math.random() * 5) | 0], Math.random() * 1200, Math.random() * 630, s, s); }
  x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
  x.fillStyle = "#f2c14e"; x.font = "600 22px 'IBM Plex Mono', monospace"; x.fillText("MY AI CODING WORKFLOW", 70, 92);
  const agents = constellationFromScan(scan).stars.filter((s) => s.kind === "agent").map((s) => s.label);
  x.fillStyle = "#f6efea"; x.font = "700 54px 'Chakra Petch', sans-serif"; x.fillText(agents.join(" + "), 70, 160);
  const y = 330, xs = nodes.map((_, i) => 130 + i * 235);
  for (let i = 0; i < nodes.length - 1; i++) {
    const lit = nodes[i].lit && nodes[i + 1].lit;
    x.strokeStyle = lit ? "#ff8a3a" : "rgba(255,255,255,.18)"; x.lineWidth = lit ? 5 : 3; x.setLineDash(lit ? [] : [10, 12]);
    x.beginPath(); x.moveTo(xs[i], y); x.lineTo(xs[i + 1], y); x.stroke();
  }
  x.setLineDash([]);
  nodes.forEach((n, i) => {
    x.save(); x.translate(xs[i], y); x.rotate(Math.PI / 4);
    if (n.lit) { const gg = x.createRadialGradient(-8, -8, 2, 0, 0, 44); gg.addColorStop(0, "#fff2d6"); gg.addColorStop(.35, "#ffb347"); gg.addColorStop(.7, "#ff6a2a"); gg.addColorStop(1, "#7a2410"); x.fillStyle = gg; x.shadowColor = "#ff7a2e"; x.shadowBlur = 40; x.fillRect(-30, -30, 60, 60); }
    else { x.fillStyle = "#1c1418"; x.fillRect(-30, -30, 60, 60); x.strokeStyle = "rgba(255,255,255,.25)"; x.setLineDash([6, 6]); x.lineWidth = 2; x.strokeRect(-30, -30, 60, 60); x.setLineDash([]); }
    x.restore();
    x.textAlign = "center";
    x.fillStyle = n.lit ? "#f6efea" : "#8e7f78"; x.font = "700 30px 'Chakra Petch', sans-serif"; x.fillText(n.name, xs[i], y + 88);
    x.font = "400 19px 'IBM Plex Sans', sans-serif"; x.fillStyle = n.lit ? "#c2b3ab" : "#6f625c";
    const label = n.lit ? n.tools[0] ?? "" : "—";
    x.fillText(label.length > 22 ? `${label.slice(0, 21)}…` : label, xs[i], y + 120);
    x.textAlign = "left";
  });
  const team = TEAM.find((t) => t.id === profile.team)?.label;
  const pains = profile.pains.map((p) => PAINS.find((x) => x.id === p)?.say ?? p);
  x.fillStyle = "#c2b3ab"; x.font = "400 22px 'IBM Plex Sans', sans-serif";
  x.fillText([team, pains.length ? `fixing ${pains.join(", ")}` : ""].filter(Boolean).join(" · "), 70, 540);
  x.textAlign = "right"; x.fillStyle = "#ff8a3a"; x.font = "700 26px 'Chakra Petch', sans-serif"; x.fillText("forged in grillme", 1130, 584);
  return c.toDataURL("image/png");
}

function Consent({ f }: SceneProps) {
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "your project");
  const setAppSetting = useApp((s) => s.setAppSetting);
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .18, 12); }, []);
  const top = useLine(f, `To follow your sessions, I'll add a few small files to ${projectName}. They stay on this computer and out of git.`);
  const answer = (v: true | "declined") => { setAppSetting("installConsent", v); f.hush(); f.go(nextStep("consent")); };
  if (top == null) return null;
  return (
    <div className="forge-content" style={{ top }}>
      <div className="forge-consent">
        {CONSENT_ITEMS.map((it) => <div key={it.title}><b>{it.title}</b>{it.detail}<code>{it.file}</code></div>)}
      </div>
      <div className="forge-row">
        <Chip kind="go" autoFocus onClick={() => answer(true)}>Add them</Chip>
        <Chip kind="ghost" onClick={() => answer("declined")}>Skip for now</Chip>
      </div>
      <div className="forge-note">You can remove them any time: Settings → Setup check → Remove from my repos.</div>
    </div>
  );
}

function Team({ f }: SceneProps) {
  const joining = useApp((s) => s.appSettings.firstRunJoining === true);
  useEffect(() => { f.world.sparkTo(f.world.W / 2, f.world.H * .24, 13); }, []);
  const top = useLine(f, joining
    ? "Last step: let's get you into your team. Your agents will all read one plan."
    : "Working with others? Everyone's agents share one goal, one plan and one chat. Or start alone and invite people later.");
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
        <Chip kind={joining ? "go" : ""} autoFocus={joining} onClick={() => done("team")}>{joining ? "Join my team" : "Create or join a team"}</Chip>
        <Chip kind={joining ? "ghost" : "go"} autoFocus={!joining} onClick={() => done("solo")}>Just me for now</Chip>
      </div>
      {joining ? <div className="forge-note">Have the invite link your teammate sent ready. You'll paste it next.</div> : null}
    </div>
  );
}
