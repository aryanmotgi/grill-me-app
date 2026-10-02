import { useEffect, useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { GrillFlame } from "./GrillMark";
import { Toasts } from "./Chrome";
import { runDoctor, type DoctorCheck } from "./DoctorTab";
import { CONSENT_ITEMS } from "./InstallConsent";
import { SCAN_SOURCES, scanSummary, type ScanResult } from "../lib/scan";
import { agentsFromScan, type WorkflowProfile } from "../lib/profile";
import { BRAIN_NAMES } from "../lib/interview";
import { Interview, QuickForm, WorkflowResult, useProfileDraft, useWorkflowInputs } from "./WorkflowSetup";
import { interviewBrainOf, pickBrain, readyAis, statusLabel, type AiId, type AiStatus } from "../lib/aiConnect";
import { addProjectFromFinder, openProjectAt } from "../lib/addProject";
import { FIRST_RUN_STEPS, firstRunStepOf, nextStep, prevStep, stepNumber, type FirstRunStep } from "../lib/firstRun";

// ---------------------------------------------------------------------------
// First-run setup: eight short steps from "just installed" to "typing my first
// task". Every step says what it does and why, nothing installs or changes
// without a click, Back always works, and the step is saved so quitting (or
// the reload that opening a project does) picks up where you left off.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

/** The checks a session can't run without. Optional extras live in Settings.
 *  Signing in to an AI is its own step ("Connect your AI"). */
const REQUIRED_IDS = ["claude", "git", "python3"];

function useStep(): [FirstRunStep, (s: FirstRunStep) => void] {
  const step = useApp((s) => firstRunStepOf(s.appSettings.firstRunStep));
  const setAppSetting = useApp((s) => s.setAppSetting);
  return [step, (s) => setAppSetting("firstRunStep", s)];
}

function Frame({ step, title, lead, children, footer }: {
  step: FirstRunStep;
  title: string;
  lead: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  const n = stepNumber(step);
  return (
    <div className="h-full ground flex flex-col overflow-y-auto">
      <div data-tauri-drag-region className="h-12 flex-none" />
      <div className="flex-1 flex items-start justify-center px-6 pb-12">
        <div className="w-[560px] max-w-full flex flex-col gap-6 pt-[7vh]">
          <div className="flex items-center gap-3">
            <GrillFlame px={2.5} />
            <span className="text-[12px] text-faint">Step {n} of {FIRST_RUN_STEPS.length}</span>
            <span className="flex-1 flex gap-1" aria-hidden>
              {FIRST_RUN_STEPS.map((s, i) => (
                <span key={s} className={`h-1 flex-1 rounded-full ${i < n ? "bg-accent" : "bg-raised"}`} />
              ))}
            </span>
          </div>
          <div>
            <h1 className="text-[24px] font-semibold text-ink tracking-tight">{title}</h1>
            <p className="text-[14px] text-dim mt-2 leading-relaxed">{lead}</p>
          </div>
          {children}
          <div className="flex items-center gap-2 pt-2">{footer}</div>
        </div>
      </div>
    </div>
  );
}

function BackButton({ step, go }: { step: FirstRunStep; go: (s: FirstRunStep) => void }) {
  return (
    <button className="btn" onClick={() => go(prevStep(step))}>
      <Icon name="chevron" size={9} className="rotate-180" /> Back
    </button>
  );
}

// -- 1. Welcome --------------------------------------------------------------

function Welcome({ go }: { go: (s: FirstRunStep) => void }) {
  const setAppSetting = useApp((s) => s.setAppSetting);
  const start = (joining: boolean) => {
    setAppSetting("firstRunJoining", joining);
    go("check");
  };
  return (
    <Frame step="welcome" title="Welcome to Grill Me"
      lead="Grill Me keeps everyone's AI coding agents on the same track. Your team shares one goal and one plan, and every agent reads them before it writes code. Setup takes about two minutes."
      footer={<>
        <button className="btn primary" autoFocus onClick={() => start(false)}>Get started</button>
        <button className="btn" onClick={() => start(true)}>I'm joining a team</button>
      </>}
    >
      <ul className="flex flex-col gap-2 text-[13px] text-dim">
        <li className="flex gap-2"><Icon name="check" size={13} className="text-ok mt-0.5 flex-none" /> Works with Claude Code, on your own Claude plan.</li>
        <li className="flex gap-2"><Icon name="check" size={13} className="text-ok mt-0.5 flex-none" /> Your code and chats stay on this computer.</li>
        <li className="flex gap-2"><Icon name="check" size={13} className="text-ok mt-0.5 flex-none" /> Nothing gets installed or changed without you clicking first.</li>
      </ul>
    </Frame>
  );
}

// -- 2. Check your computer -----------------------------------------------------

function CheckRow({ c, onDone }: { c: DoctorCheck; onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const isLogin = c.id === "claude-login";
  const install = async () => {
    setBusy(true);
    setNote(isLogin ? "Finish signing in in your browser…" : c.fix.startsWith("xcode-select") ? "Follow Apple's installer window…" : "Installing… this can take a minute.");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("doctor_install", { id: c.id });
      setNote("");
      onDone();
    } catch (e) {
      setNote(`${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="hairline rounded-lg px-4 py-3 flex items-start gap-3 bg-panel/60">
      <span className={`mt-0.5 flex-none w-5 h-5 rounded-full flex items-center justify-center ${c.ok ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
        <Icon name={c.ok ? "check" : "cross"} size={11} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-ink">{c.label}</span>
          <span className="flex-1" />
          {c.ok ? <span className="text-[11.5px] text-faint truncate">{c.detail}</span> : null}
        </div>
        <div className="text-[12px] text-dim mt-0.5">{c.why}</div>
        {!c.ok ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="btn primary" disabled={busy} onClick={() => void install()}>
              {busy ? <span className="spinner" /> : null} {isLogin ? "Sign in" : "Install for me"}
            </button>
            <button className="font-mono text-[11px] text-dim hover:text-ink bg-raised hairline rounded px-2 py-1 cursor-pointer max-w-full truncate"
              title="Copy and run it in Terminal yourself"
              onClick={() => void navigator.clipboard.writeText(c.fix).then(() => toast("Copied. Run it in Terminal, then press Check again"))}>
              {c.fix}
            </button>
          </div>
        ) : null}
        {note ? <div className="text-[11.5px] text-dim mt-1.5 whitespace-pre-wrap">{note}</div> : null}
      </div>
    </div>
  );
}

function Check({ go }: { go: (s: FirstRunStep) => void }) {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const refresh = () => { setChecks(null); void runDoctor().then(setChecks); };
  useEffect(refresh, []);
  const required = (checks ?? []).filter((c) => REQUIRED_IDS.includes(c.id));
  const allOk = checks !== null && required.every((c) => c.ok);
  return (
    <Frame step="check" title="Check your computer"
      lead="Grill Me runs your agents on this computer, so it needs a few tools. We'll check what you have. Anything missing can be installed with one click, or you can copy the command and run it yourself."
      footer={<>
        <BackButton step="check" go={go} />
        <span className="flex-1" />
        <button className="btn" onClick={refresh}>Check again</button>
        {allOk || !native() ? (
          <button className="btn primary" onClick={() => go(nextStep("check"))}>Continue</button>
        ) : (
          <button className="btn" title="Sessions won't start until everything is green" onClick={() => go(nextStep("check"))}>Skip for now</button>
        )}
      </>}
    >
      {!native() ? (
        <p className="text-[13px] text-faint">The check runs in the desktop app.</p>
      ) : checks === null ? (
        <p className="text-[13px] text-faint flex items-center gap-2"><span className="spinner" /> Checking…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {required.map((c) => <CheckRow key={c.id} c={c} onDone={refresh} />)}
          {allOk ? <p className="text-[13px] text-ok">All set. Everything Grill Me needs is here.</p> : null}
        </div>
      )}
    </Frame>
  );
}

// -- 3. Connect your AI ---------------------------------------------------------

const LOGIN_POLL_MS = 3000;
const LOGIN_GIVE_UP_MS = 10 * 60_000;

async function aiStatus(ids?: AiId[]): Promise<AiStatus[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AiStatus[]>("ai_status", { ids: ids ?? null });
}

function AiRow({ r, chosen, onChoose, onSignedIn }: { r: AiStatus; chosen: boolean; onChoose: () => void; onSignedIn: (r: AiStatus) => void }) {
  const toast = useApp((s) => s.toast);
  const [waiting, setWaiting] = useState(false);
  const [note, setNote] = useState("");
  const ready = r.installed && r.signedIn === true;

  // while a sign-in is open, re-check this AI every few seconds so the row
  // turns green on its own the moment the browser login lands
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - started > LOGIN_GIVE_UP_MS) {
        setWaiting(false);
        setNote("Didn't see a sign-in. Try again, or use the quick form.");
        return;
      }
      void aiStatus([r.id]).then(([now]) => {
        if (now?.signedIn === true) {
          setWaiting(false);
          setNote("");
          onSignedIn(now);
          toast(`${r.name} connected`);
        }
      }).catch(() => {});
    }, LOGIN_POLL_MS);
    return () => window.clearInterval(t);
  }, [waiting]);

  const signIn = async () => {
    setWaiting(true);
    setNote(r.id === "gemini" ? "Gemini opened in Terminal. Pick “Sign in with Google” there." : "Finish signing in in your browser. We'll notice when you're done.");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("ai_login", { id: r.id });
    } catch (e) {
      // the login exited early; the poll may still have caught a success
      const [now] = await aiStatus([r.id]).catch(() => []);
      if (now?.signedIn !== true) { setWaiting(false); setNote(`${e}`); }
    }
  };

  return (
    <div className={`hairline rounded-lg px-4 py-3 flex items-start gap-3 bg-panel/60 ${chosen ? "border-accent/60" : ""}`}>
      <span className={`mt-0.5 flex-none w-5 h-5 rounded-full flex items-center justify-center ${ready ? "bg-ok/15 text-ok" : "bg-raised text-faint"}`}>
        <Icon name={ready ? "check" : "cross"} size={11} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-ink">{r.name}</span>
          <span className={`text-[11.5px] ${ready ? "text-ok" : "text-faint"}`}>{statusLabel(r)}</span>
          <span className="flex-1" />
          {ready ? (
            <label className="flex items-center gap-1.5 text-[12px] text-dim cursor-pointer">
              <input type="radio" name="interview-ai" className="accent-(--accent)" checked={chosen} onChange={onChoose} />
              Use for the interview
            </label>
          ) : r.installed ? (
            <button className="btn primary" disabled={waiting} onClick={() => void signIn()}>
              {waiting ? <span className="spinner" /> : null} {waiting ? "Waiting…" : "Sign in"}
            </button>
          ) : null}
        </div>
        {note ? <div className="text-[11.5px] text-dim mt-1.5 whitespace-pre-wrap">{note}</div> : null}
      </div>
    </div>
  );
}

function Connect({ go }: { go: (s: FirstRunStep) => void }) {
  const saved = useApp((s) => s.appSettings.interviewBrain);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const [rows, setRows] = useState<AiStatus[] | null>(null);
  const [chosen, setChosen] = useState<string>(typeof saved === "string" ? saved : "");
  const refresh = () => {
    setRows(null);
    void aiStatus().then((r) => { setRows(r); setChosen((c) => pickBrain(r, c || saved)); }).catch(() => setRows([]));
  };
  useEffect(() => { if (native()) refresh(); else setRows([]); }, []);

  const installed = (rows ?? []).filter((r) => r.installed);
  const ready = readyAis(rows ?? []);
  const update = (now: AiStatus) => setRows((rs) => {
    const next = (rs ?? []).map((x) => (x.id === now.id ? now : x));
    setChosen((c) => pickBrain(next, c));
    return next;
  });
  const finish = (brain: string) => {
    setAppSetting("interviewBrain", brain);
    go(nextStep("connect"));
  };

  return (
    <Frame step="connect" title="Connect your AI"
      lead="Grill Me asks you a few questions about how you work, using your own AI. It uses a little of your plan, about as much as one short chat. Sign in once and we'll notice."
      footer={<>
        <BackButton step="connect" go={go} />
        <span className="flex-1" />
        <button className="btn" onClick={() => finish("form")}>Use the quick form instead</button>
        {ready.length ? <button className="btn primary" onClick={() => finish(chosen || ready[0].id)}>Continue</button> : null}
      </>}
    >
      {!native() ? (
        <p className="text-[13px] text-faint">Signing in runs in the desktop app.</p>
      ) : rows === null ? (
        <p className="text-[13px] text-faint flex items-center gap-2"><span className="spinner" /> Looking for your AI tools…</p>
      ) : installed.length === 0 ? (
        <div className="hairline rounded-lg px-4 py-3 bg-panel/60 text-[13px] text-dim">
          No AI coding tools found on this computer. That's fine: the quick form takes about a minute and needs no AI.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {installed.map((r) => (
            <AiRow key={r.id} r={r} chosen={chosen === r.id} onChoose={() => setChosen(r.id)} onSignedIn={update} />
          ))}
          <div className="flex items-center gap-2 text-[12px] text-faint">
            <span className="flex-1">No password ever reaches Grill Me. Each AI signs in through its own page.</span>
            <button className="hover:text-ink cursor-pointer" onClick={refresh}>Check again</button>
          </div>
        </div>
      )}
    </Frame>
  );
}

// -- 4. Pick your project -----------------------------------------------------

function Project({ go }: { go: (s: FirstRunStep) => void }) {
  const toast = useApp((s) => s.toast);
  const activeProject = useApp((s) => s.activeProject);
  const [found, setFound] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const warn = (m: string) => toast(m, "warn");
  // opening reloads the app — save the next step first so it resumes there
  const advance = () => useApp.getState().setAppSetting("firstRunStep", nextStep("project"));

  useEffect(() => {
    if (!native()) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<string[]>("discover_repos", { known: [] }).then((r) => setFound(r.slice(0, 6))).catch(() => {}));
  }, []);

  const openFolder = async () => {
    setBusy("folder");
    try {
      if (await addProjectFromFinder(warn)) advance();
    } finally { setBusy(""); }
  };
  const openPath = async (path: string) => {
    setBusy(path);
    try { await openProjectAt(path, warn); advance(); } catch (e) { warn(`${e}`); } finally { setBusy(""); }
  };
  const clone = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy("clone");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { homeDir } = await import("@tauri-apps/api/path");
      const name = u.split("/").pop()?.replace(/\.git$/, "") || "project";
      const dest = `${(await homeDir()).replace(/\/+$/, "")}/${name}`;
      await invoke("git_clone", { url: u, dest });
      await openProjectAt(dest, warn);
      advance();
    } catch (e) {
      warn(`Couldn't download it: ${e}`);
    } finally { setBusy(""); }
  };

  return (
    <Frame step="project" title="Pick your project"
      lead="Choose the code you're working on. If your team already has a repo, paste its link and we'll download it. You can add more projects later."
      footer={<>
        <BackButton step="project" go={go} />
        <span className="flex-1" />
        {(activeProject && activeProject !== "default") || !native() ? (
          <button className="btn primary" onClick={() => go(nextStep("project"))}>Continue</button>
        ) : null}
      </>}
    >
      <div className="flex flex-col gap-3">
        <button className="hairline rounded-lg px-4 py-3 flex items-center gap-3 bg-panel/60 hover:border-accent/60 cursor-pointer text-left disabled:opacity-50"
          disabled={!!busy} onClick={() => void openFolder()}>
          <Icon name="folder" size={16} className="text-dim" />
          <span className="flex-1">
            <span className="block text-[13.5px] text-ink font-medium">Open a folder on this computer</span>
            <span className="block text-[12px] text-dim">An existing project, or make a new empty folder.</span>
          </span>
          {busy === "folder" ? <span className="spinner" /> : null}
        </button>
        <div className="hairline rounded-lg px-4 py-3 bg-panel/60 flex flex-col gap-2">
          <span className="text-[13.5px] text-ink font-medium">Download from a link</span>
          <div className="flex gap-2">
            <input className="flex-1 min-w-0 bg-raised hairline rounded-md px-3 py-1.5 text-[12.5px] outline-none focus:border-accent placeholder:text-faint"
              placeholder="https://github.com/your-team/your-repo" value={url}
              onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void clone(); }} />
            <button className="btn primary" disabled={!url.trim() || !!busy} onClick={() => void clone()}>
              {busy === "clone" ? <span className="spinner" /> : null} Download
            </button>
          </div>
        </div>
        {found.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-faint">Found on this computer</span>
            {found.map((p) => (
              <button key={p} className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-raised text-left cursor-pointer disabled:opacity-50"
                disabled={!!busy} onClick={() => void openPath(p)}>
                <Icon name="branch" size={12} className="text-faint" />
                <span className="text-[13px] text-ink">{p.split("/").pop()}</span>
                <span className="text-[11.5px] text-faint truncate flex-1">{p}</span>
                {busy === p ? <span className="spinner" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

// -- 5. Scan your setup ----------------------------------------------------------

function Scan({ go }: { go: (s: FirstRunStep) => void }) {
  const toast = useApp((s) => s.toast);
  const projectPath = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.path);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(SCAN_SOURCES.map((x) => [x.id, x.defaultOn])));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [showChecked, setShowChecked] = useState(false);

  const scan = async () => {
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const sources = SCAN_SOURCES.filter((x) => on[x.id]).map((x) => x.id);
      setResult(await invoke<ScanResult>("workflow_scan", { project: projectPath ?? null, sources }));
    } catch (e) {
      toast(`Scan failed: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };
  const forget = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("workflow_scan_delete").catch(() => {});
    setResult(null);
    toast("Scan deleted");
  };

  if (result) {
    const lines = scanSummary(result);
    return (
      <Frame step="scan" title="Here's what we found"
        lead="Grill Me will use this to skip questions it can already answer and to suggest better ways to work. It stays on this computer."
        footer={<>
          <BackButton step="scan" go={go} />
          <span className="flex-1" />
          <button className="btn" onClick={() => setResult(null)}>Scan again</button>
          <button className="btn primary" autoFocus onClick={() => go(nextStep("scan"))}>Looks right</button>
        </>}
      >
        <div className="hairline rounded-lg bg-panel/60 divide-y divide-line">
          {lines.length === 0 ? <p className="px-4 py-3 text-[13px] text-faint">Nothing found in the sources you picked.</p> : null}
          {lines.map((l) => (
            <div key={l.label} className="px-4 py-2.5 flex gap-3 text-[13px]">
              <span className="w-[130px] flex-none text-dim">{l.label}</span>
              <span className="text-ink min-w-0">{l.value}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <button className="text-[12px] text-dim hover:text-ink text-left cursor-pointer w-fit" aria-expanded={showChecked} onClick={() => setShowChecked(!showChecked)}>
            {showChecked ? "▾" : "▸"} What we looked at ({result.checked.length})
          </button>
          {showChecked ? (
            <ul className="text-[11.5px] text-faint font-mono flex flex-col gap-0.5 pl-4 max-h-[180px] overflow-y-auto select-text">
              {result.checked.map((c, i) => <li key={i}>{c.item}</li>)}
            </ul>
          ) : null}
          <button className="text-[12px] text-faint hover:text-ink text-left cursor-pointer w-fit" onClick={() => void forget()}>Delete this scan</button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame step="scan" title="Can Grill Me look at your setup?"
      lead="A quick look at this computer tells Grill Me which AI tools you use, so it can skip questions and suggest better ways to work. It takes a few seconds, and nothing leaves this computer."
      footer={<>
        <BackButton step="scan" go={go} />
        <span className="flex-1" />
        <button className="btn" onClick={() => go(nextStep("scan"))}>Skip</button>
        <button className="btn primary" disabled={busy || !native() || !Object.values(on).some(Boolean)} onClick={() => void scan()}>
          {busy ? <span className="spinner" /> : null} Scan
        </button>
      </>}
    >
      <div className="flex flex-col gap-2">
        {SCAN_SOURCES.map((x) => (
          <label key={x.id} className="hairline rounded-lg px-4 py-2.5 bg-panel/60 flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1 accent-(--accent)" checked={on[x.id]} onChange={(e) => setOn({ ...on, [x.id]: e.target.checked })} />
            <span className="flex-1">
              <span className="block text-[13.5px] text-ink">{x.label}{x.defaultOn ? null : <span className="ml-2 text-[11px] text-faint">optional</span>}</span>
              <span className="block text-[12px] text-dim mt-0.5">{x.detail}</span>
            </span>
          </label>
        ))}
        {!native() ? <p className="text-[12px] text-faint">The scan runs in the desktop app.</p> : null}
      </div>
    </Frame>
  );
}

// -- 6. Your workflow ---------------------------------------------------------

function Workflow({ go }: { go: (s: FirstRunStep) => void }) {
  const setAppSetting = useApp((s) => s.setAppSetting);
  const brain = useApp((s) => interviewBrainOf(s.appSettings.interviewBrain));
  const { scan, catalog, ready } = useWorkflowInputs();
  const [draft, setDraft, hadSaved] = useProfileDraft(scan, ready);
  // a saved profile opens on the result; otherwise the interview when an AI
  // is connected, else the quick form
  const [view, setView] = useState<"interview" | "form" | "result">(hadSaved ? "result" : brain !== "form" && native() ? "interview" : "form");
  const aiName = BRAIN_NAMES[brain] ?? "your AI";

  const save = (p: WorkflowProfile) => {
    const saved = { ...p, updated: Date.now() };
    setDraft(saved);
    setAppSetting("workflowProfile", saved);
    setView("result");
  };

  if (view === "result") {
    return (
      <Frame step="workflow" title="Here's how you work"
        lead="Built from your scan and your answers. The upgrades are only suggestions, picked for what slows you down and what your setup is missing."
        footer={<>
          <BackButton step="workflow" go={go} />
          <span className="flex-1" />
          <button className="btn primary" autoFocus onClick={() => go(nextStep("workflow"))}>Continue</button>
        </>}
      >
        <WorkflowResult profile={draft} scan={scan} catalog={catalog} onEdit={() => setView("form")} />
      </Frame>
    );
  }

  if (view === "interview") {
    return (
      <Frame step="workflow" title="How do you work?"
        lead={`A quick chat with ${aiName} so Grill Me can suggest a better way to work. About a minute, and you can stop any time.`}
        footer={<>
          <BackButton step="workflow" go={go} />
          <span className="flex-1" />
          <button className="btn" onClick={() => go(nextStep("workflow"))}>Skip</button>
        </>}
      >
        {ready ? <Interview brain={brain} scan={scan} start={draft} onDone={save} onUseForm={() => setView("form")} />
          : <p className="text-[13px] text-faint flex items-center gap-2"><span className="spinner" /> Loading…</p>}
      </Frame>
    );
  }

  return (
    <Frame step="workflow" title="How do you work?"
      lead="Five quick questions so Grill Me can suggest a better way to work. All optional, about a minute."
      footer={<>
        <BackButton step="workflow" go={go} />
        <span className="flex-1" />
        {brain !== "form" && native() ? <button className="btn" onClick={() => setView("interview")}>Chat with {aiName} instead</button> : null}
        <button className="btn" onClick={() => go(nextStep("workflow"))}>Skip</button>
        <button className="btn primary" disabled={!ready} onClick={() => save({ ...draft, source: "form" })}>See my workflow</button>
      </>}
    >
      {ready ? <QuickForm value={draft} onChange={setDraft} scanned={agentsFromScan(scan).length > 0} /> : <p className="text-[13px] text-faint flex items-center gap-2"><span className="spinner" /> Loading…</p>}
    </Frame>
  );
}

// -- 7. What we'll add ---------------------------------------------------------

function Consent({ go }: { go: (s: FirstRunStep) => void }) {
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "your project");
  const setAppSetting = useApp((s) => s.setAppSetting);
  const answer = (v: true | "declined") => {
    setAppSetting("installConsent", v);
    go(nextStep("consent"));
  };
  return (
    <Frame step="consent" title="What Grill Me adds"
      lead={`To follow your sessions and share the plan with your agents, Grill Me adds two small files to ${projectName}. They're hidden from git, so nothing ends up in your commits.`}
      footer={<>
        <BackButton step="consent" go={go} />
        <span className="flex-1" />
        <button className="btn" title="Sessions still run; Grill Me just can't see their status or share the plan with them" onClick={() => answer("declined")}>
          Skip for now
        </button>
        <button className="btn primary" autoFocus onClick={() => answer(true)}>Add them</button>
      </>}
    >
      <div className="flex flex-col gap-2">
        {CONSENT_ITEMS.map((it) => (
          <div key={it.title} className="hairline rounded-lg px-4 py-3 bg-panel/60">
            <div className="text-[13.5px] font-medium text-ink">{it.title}</div>
            <div className="text-[12px] text-dim mt-1 leading-relaxed">{it.detail}</div>
            <div className="text-faint font-mono text-[11px] mt-1.5">{it.file}</div>
          </div>
        ))}
        <p className="text-[12px] text-faint">You can remove them any time: Settings → Setup check → Remove from my repos.</p>
      </div>
    </Frame>
  );
}

// -- 8. Working with others? ---------------------------------------------------

function Team({ go }: { go: (s: FirstRunStep) => void }) {
  const joining = useApp((s) => s.appSettings.firstRunJoining === true);
  const setAppMode = useApp((s) => s.setAppMode);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const finish = (mode: "solo" | "team") => {
    // the old spotlight tour points at classic-layout chrome; this setup replaces it
    setAppSetting("onboarded", true);
    setAppMode(mode);
    useApp.getState().setView("new");
    go("done");
  };
  const Option = ({ mode, title, body, primary }: { mode: "solo" | "team"; title: string; body: string; primary: boolean }) => (
    <button className={`hairline rounded-lg px-4 py-3.5 flex items-start gap-3 bg-panel/60 cursor-pointer text-left hover:border-accent/60 ${primary ? "border-accent/60" : ""}`}
      autoFocus={primary} onClick={() => finish(mode)}>
      <Icon name={mode === "solo" ? "terminal" : "team"} size={16} className="text-dim mt-0.5" />
      <span className="flex-1">
        <span className="block text-[13.5px] text-ink font-medium">{title}</span>
        <span className="block text-[12px] text-dim mt-0.5">{body}</span>
      </span>
    </button>
  );
  return (
    <Frame step="team" title="Working with others?"
      lead="Grill Me shines with a team: everyone's agents share one goal, one plan and one chat. You can also start alone and invite people later from the sidebar."
      footer={<BackButton step="team" go={go} />}
    >
      <div className="flex flex-col gap-2">
        <Option mode="team" primary={joining} title={joining ? "Join my team" : "Create or join a team"}
          body={joining ? "Paste the invite link your teammate sent you." : "Start a team and get an invite link, or join one with a link a teammate sent."} />
        <Option mode="solo" primary={!joining} title="Just me for now" body="Jump straight in. Invite teammates whenever you're ready." />
      </div>
    </Frame>
  );
}

export function FirstRun() {
  const [step, go] = useStep();
  return (
    <>
      {step === "welcome" ? <Welcome go={go} /> : null}
      {step === "check" ? <Check go={go} /> : null}
      {step === "connect" ? <Connect go={go} /> : null}
      {step === "project" ? <Project go={go} /> : null}
      {step === "scan" ? <Scan go={go} /> : null}
      {step === "workflow" ? <Workflow go={go} /> : null}
      {step === "consent" ? <Consent go={go} /> : null}
      {step === "team" ? <Team go={go} /> : null}
      <Toasts />
    </>
  );
}

/** Show first-run setup? Waits for settings so existing users never see a flash. */
export function useFirstRunActive(): boolean {
  const loaded = useApp((s) => s.settingsLoaded);
  const step = useApp((s) => s.appSettings.firstRunStep);
  return loaded && step != null && step !== "done";
}
