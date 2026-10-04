import { useEffect, useState } from "react";
import { useApp } from "../store";
import { sessionTitle } from "../lib/sessionTitle";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";
import { loadKits, type StarterKit } from "./Kickoff";

// ---------------------------------------------------------------------------
// Brain page, round 3: pitch writer, code quiz, and past-hackathon lessons.
// All three are one-shot Claude calls in Rust (bridge.rs) over inputs the
// grill-me script gathers from the real work (commits, diffs, sessions).
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function projectFile(name: string): Promise<string> {
  const { homeDir, join } = await import("@tauri-apps/api/path");
  const project = useApp.getState().activeProject;
  const home = await homeDir();
  return project && project !== "default"
    ? join(home, ".grillme", "projects", project, name)
    : join(home, ".grillme", name);
}

function Card({ title, icon, action, children }: { title: string; icon: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="composer-card rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon name={icon} size={13} />
        <span className="text-[13px] font-semibold text-ink flex-1">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

// ---- pitch -------------------------------------------------------------------

export function PitchCard() {
  const toast = useApp((s) => s.toast);
  const project = useApp((s) => s.activeProject);
  const [pitch, setPitch] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // the last pitch stays on disk per project
  useEffect(() => {
    if (!native()) return;
    void (async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      setPitch(await readTextFile(await projectFile("pitch.md")).catch(() => null));
    })();
  }, [project]);

  const write = async () => {
    if (!native()) { toast("Needs the native app", "warn"); return; }
    setBusy(true);
    try {
      const md = await call<string>("brain_pitch");
      setPitch(md);
      setOpen(true);
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(await projectFile("pitch.md"), md).catch(() => {});
    } catch (e) {
      toast(`Couldn't write the pitch: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Pitch" icon="broadcast" action={
      <div className="flex gap-1.5">
        {pitch ? <button className="composer-btn" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button> : null}
        {pitch && open ? (
          <button className="composer-btn" onClick={() => void navigator.clipboard.writeText(pitch).then(() => toast("Pitch copied"))}>
            <Icon name="doc" size={11} /> Copy
          </button>
        ) : null}
        <button className="composer-btn" disabled={busy} onClick={() => void write()}>
          {busy ? <span className="spinner" /> : <Icon name="spark" size={11} />} {pitch ? "Rewrite" : "Write the pitch"}
        </button>
      </div>
    }>
      {!pitch ? (
        <p className="text-[12px] text-faint">One-liner, demo script, Devpost text, and judge Q&A — written from what you actually built.</p>
      ) : open ? (
        <div className="text-[13px] leading-[1.6] text-dim select-text"><Markdown text={pitch} /></div>
      ) : (
        <p className="text-[12px] text-faint">Pitch ready. Show it, copy it, or rewrite after more work lands.</p>
      )}
    </Card>
  );
}

// ---- quiz --------------------------------------------------------------------

interface Question { q: string; choices: string[]; answer: number; why: string }

export function QuizCard() {
  const toast = useApp((s) => s.toast);
  const teammates = useApp((s) => s.teammates);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const [session, setSession] = useState<string>("");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);

  const target = session || teammates[0]?.id || "";
  const label = (id: string) => {
    const t = teammates.find((x) => x.id === id);
    return t ? sessionTitle(t, titles) : id;
  };
  const answered = Object.keys(picked).length;
  const score = questions ? questions.filter((q, i) => picked[i] === q.answer).length : 0;
  const finished = !!questions && answered === questions.length;

  const start = async () => {
    if (!native()) { toast("Needs the native app", "warn"); return; }
    setBusy(true);
    setQuestions(null);
    setPicked({});
    try {
      const r = await call<{ questions: Question[] }>("brain_quiz", { memberId: target });
      setQuestions(r.questions);
    } catch (e) {
      toast(`${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!finished || !questions) return;
    void call("bridge_add_note", {
      text: `Quiz on ${label(target)}'s code: ${score}/${questions.length}`,
      by: "Code quiz",
    }).catch(() => {});
    toast(score === questions.length ? "Perfect — you know this code" : `${score}/${questions.length} — read the explanations, then quiz again`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  return (
    <Card title="Quiz me on the code" icon="help" action={
      <div className="flex gap-1.5 items-center">
        <select className="composer-btn" value={target} onChange={(e) => setSession(e.target.value)}>
          {teammates.map((t) => <option key={t.id} value={t.id}>{label(t.id)}</option>)}
        </select>
        <button className="composer-btn" disabled={busy || !target} onClick={() => void start()}>
          {busy ? <span className="spinner" /> : <Icon name="spark" size={11} />} {questions ? "New quiz" : "Quiz me"}
        </button>
      </div>
    }>
      {!questions ? (
        <p className="text-[12px] text-faint">Four questions on what the AI actually wrote in that session — so you understand your own code before you ship.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {questions.map((q, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="text-[13px] text-ink">{i + 1}. {q.q}</div>
              <div className="grid gap-1">
                {q.choices.map((c, j) => {
                  const chosen = picked[i] !== undefined;
                  const tone = !chosen ? "hover:bg-raised text-dim" : j === q.answer ? "bg-ok/15 text-ink" : picked[i] === j ? "bg-danger/15 text-ink" : "text-faint";
                  return (
                    <button key={j} disabled={chosen}
                      className={`text-left px-3 py-1.5 rounded-lg text-[12.5px] border border-line cursor-pointer disabled:cursor-default ${tone}`}
                      onClick={() => setPicked((p) => ({ ...p, [i]: j }))}>
                      {c}
                    </button>
                  );
                })}
              </div>
              {picked[i] !== undefined && q.why ? <div className="text-[12px] text-faint pl-1">{q.why}</div> : null}
            </div>
          ))}
          {finished ? <div className="text-[13px] font-semibold text-ink">Score: {score}/{questions.length}</div> : null}
        </div>
      )}
    </Card>
  );
}

// ---- past hackathons -----------------------------------------------------------

interface Lesson { project: string; name?: string; date?: string; summary?: string; stack?: string[]; worked?: string[]; mistakes?: string[]; reuse?: string[] }

export function LessonsCard() {
  const toast = useApp((s) => s.toast);
  const project = useApp((s) => s.activeProject) ?? "default";
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "this project");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [kits, setKits] = useState<StarterKit[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!native()) return;
    void loadKits().then(setKits);
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const { homeDir, join } = await import("@tauri-apps/api/path");
    try {
      const v = JSON.parse(await readTextFile(await join(await homeDir(), ".grillme", "lessons.json")));
      setLessons(Array.isArray(v) ? v.reverse() : []);
    } catch {
      setLessons([]);
    }
  };
  useEffect(() => { void load(); }, []);

  const wrapUp = async () => {
    if (!native()) { toast("Needs the native app", "warn"); return; }
    setBusy(true);
    try {
      await call("brain_wrapup", { projectId: project, projectName });
      await load();
      toast("Lessons and starter kit saved — your next project starts with them");
    } catch (e) {
      toast(`Couldn't wrap up: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const mine = lessons.find((l) => l.project === project);
  return (
    <Card title="Past hackathons" icon="clock" action={
      <button className="composer-btn" disabled={busy} onClick={() => void wrapUp()}>
        {busy ? <span className="spinner" /> : <Icon name="check" size={11} />} {mine ? "Update lessons" : "Wrap up this hackathon"}
      </button>
    }>
      {lessons.length === 0 ? (
        <p className="text-[12px] text-faint">When a hackathon ends, wrap it up: Claude saves the stack, what worked, and what to avoid. New projects start with those lessons automatically.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-[12.5px] text-dim select-text">
          {lessons.slice(0, 8).map((l) => (
            <li key={l.project}>
              <span className="text-ink font-medium">{l.name ?? l.project}</span>
              {l.date ? <span className="text-faint"> · {new Date(Number(l.date) * 1000).toLocaleDateString()}</span> : null}
              {l.project === project ? <span className="text-faint"> · this project</span> : null}
              {l.summary ? <div>{l.summary}</div> : null}
              {l.worked?.length ? <div className="text-faint">✓ {l.worked.join(" · ")}</div> : null}
              {l.mistakes?.length ? <div className="text-faint">✗ {l.mistakes.join(" · ")}</div> : null}
              {(() => {
                const k = kits.find((x) => x.project === l.project);
                if (!k) return null;
                const n = k.files?.length ?? 0;
                return (
                  <div className="text-faint">
                    Starter kit{k.stack?.length ? `: ${k.stack.join(", ")}` : ""}{n ? ` · ${n} reusable file${n === 1 ? "" : "s"}` : ""} — pick it in “Start a hackathon”
                  </div>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
