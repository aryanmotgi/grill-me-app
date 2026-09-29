import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import type { AgentId } from "../data/sources/git";
import { SKILL_LOADERS } from "../data/skills";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Monocode-style "What should we work on?" screen — the center view for a
// new session. A pixel dot-grid banner up top, then one composer card:
// context chips (project + the branch it will create), the prompt, and a
// toolbar (+ menu, agent picker, send). Sending spawns a worktree session on
// feat/<slug> and briefs the prompt in once the agent is ready.
// ---------------------------------------------------------------------------

/** kebab slug from the first few words of the prompt — session id + branch */
export function promptSlug(text: string, taken: string[]): string {
  const base =
    text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean).slice(0, 4).join("-").slice(0, 32) ||
    "session";
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}

const PLAN_PREFIX = "Before writing any code, propose a short plan and wait for my approval.\n\n";

// 7x7 pixel sprites for the banner (1 = lit)
const SPRITES: Record<string, string[]> = {
  invader: ["0100010", "0011100", "0111110", "1101011", "1111111", "0101010", "1000001"],
  ghost: ["0011100", "0111110", "1101011", "1111111", "1111111", "1111111", "1010101"],
  chomp: ["0011110", "0111111", "1111100", "1111000", "1111100", "0111111", "0011110"],
  bot: ["0010100", "0111110", "1101011", "1111111", "0111110", "0100010", "0110110"],
};

function Sprite({ name, x, y, px = 4 }: { name: string; x: string; y: number; px?: number }) {
  const rows = SPRITES[name];
  return (
    <svg className="absolute pixel-sprite" style={{ left: x, top: y }} width={7 * px} height={7 * px} aria-hidden>
      {rows.flatMap((r, j) =>
        [...r].map((c, i) => (c === "1" ? <rect key={`${i}-${j}`} x={i * px} y={j * px} width={px - 0.5} height={px - 0.5} /> : null)),
      )}
    </svg>
  );
}

function PixelBanner() {
  return (
    <div className="pixel-banner relative h-[34vh] min-h-[200px] flex-none overflow-hidden" aria-hidden>
      <Sprite name="invader" x="58%" y={34} />
      <Sprite name="ghost" x="30%" y={96} />
      <Sprite name="chomp" x="76%" y={120} />
      <Sprite name="bot" x="47%" y={150} px={3} />
    </div>
  );
}

function MenuItem({ icon, label, detail, onClick, soon, tint }: {
  icon: string; label: string; detail: string; onClick: () => void; soon?: boolean; tint?: string;
}) {
  return (
    <button
      className="flex items-start gap-3 w-full text-left px-3 py-2 rounded-lg cursor-pointer hover:bg-raised transition-colors"
      onClick={onClick}
    >
      <span className="mt-[2px]" style={{ color: tint }}><Icon name={icon} size={15} /></span>
      <span className="flex flex-col min-w-0">
        <span className="flex items-center gap-2 text-[13px] text-ink">
          {label}
          {soon ? <span className="text-[9.5px] px-1.5 rounded bg-raised text-faint">soon</span> : null}
        </span>
        <span className="text-[11.5px] text-faint truncate">{detail}</span>
      </span>
    </button>
  );
}

export function NewSession() {
  const projects = useApp((s) => s.projects);
  const activeProject = useApp((s) => s.activeProject);
  const members = useApp((s) => s.members);
  const available = useApp((s) => s.availableAgents);
  const spawnFromTemplate = useApp((s) => s.spawnFromTemplate);
  const toast = useApp((s) => s.toast);

  const [text, setText] = useState("");
  const [agent, setAgent] = useState<AgentId>("claude");
  const [plan, setPlan] = useState(false);
  const [menu, setMenu] = useState<"" | "add" | "agent">("");
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ta.current?.focus(); }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(""); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);

  const project = projects.find((p) => p.id === activeProject);
  const projectName = project?.name ?? members[0]?.repoPath.split("/").pop() ?? "this project";
  const slug = promptSlug(text, members.map((m) => m.id));
  const branch = `feat/${slug}`;
  const agents: { id: AgentId; name: string; ok: boolean }[] = available.length
    ? available.map((a) => ({ id: a.id, name: a.name, ok: a.installed }))
    : [{ id: "claude", name: "Claude Code", ok: true }];
  const agentName = agents.find((a) => a.id === agent)?.name ?? agent;

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    await spawnFromTemplate(slug, slug, branch, (plan ? PLAN_PREFIX : "") + body, agent);
    setBusy(false);
    // spawn registered the member → it's now the active tab; else keep the draft
    if (useApp.getState().members.some((m) => m.id === slug)) {
      setText("");
      useApp.getState().setActive(slug);
    }
  };

  const attach = async () => {
    setMenu("");
    if (!("__TAURI_INTERNALS__" in window)) { toast("File attach needs the native app", "warn"); return; }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: true, directory: false });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length) setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${paths.map((p) => `@${p}`).join(" ")} `);
    ta.current?.focus();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      <PixelBanner />
      <div className="w-full max-w-[820px] mx-auto px-6 pb-16 pt-[6vh]">
        <h1 className="text-[20px] font-medium text-ink mb-4 px-1">What should we work on in {projectName}?</h1>

        <div className="composer-card relative rounded-xl">
          <div className="flex items-center gap-4 px-4 pt-3 text-[12px] text-faint">
            <span className="flex items-center gap-1.5" title={members[0]?.repoPath}>
              <Icon name="folder" size={13} /> New worktree
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[11px]" title="Branch this session will create">
              <Icon name="branch" size={13} /> {text.trim() ? branch : "feat/…"}
            </span>
          </div>

          <textarea
            ref={ta}
            rows={2}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            placeholder="Ask, build, or describe the task — it becomes the first message…"
            className="block w-full resize-none bg-transparent outline-none px-4 pt-3 pb-2 text-[14px] text-ink placeholder:text-faint max-h-[240px] field-sizing-content"
          />

          <div className="flex items-center gap-1.5 px-3 pb-3">
            <button className={`composer-btn w-8 justify-center ${menu === "add" ? "on" : ""}`} title="Add to message"
              onClick={() => setMenu(menu === "add" ? "" : "add")}>
              <Icon name="plus" size={13} />
            </button>
            <button className="composer-btn" title="Agent for this session" onClick={() => setMenu(menu === "agent" ? "" : "agent")}>
              <AgentLogo agent={agent} size={14} /> {agentName} <Icon name="chevron" size={10} className="rotate-90 opacity-60" />
            </button>
            {plan ? (
              <button className="composer-btn on" title="Plan mode on — click to turn off" onClick={() => setPlan(false)}>
                <Icon name="bulb" size={13} /> Plan mode <Icon name="cross" size={9} className="opacity-60" />
              </button>
            ) : null}
            <span className="flex-1" />
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors bg-raised text-dim enabled:hover:text-ink disabled:opacity-40 data-[ready=true]:bg-ink data-[ready=true]:text-bg"
              data-ready={!!text.trim() && !busy}
              disabled={!text.trim() || busy}
              title="Start session (↵)"
              onClick={() => void send()}
            >
              {busy ? <span className="spinner" /> : <Icon name="up" size={14} />}
            </button>
          </div>

          {menu ? <div className="fixed inset-0 z-30" onClick={() => setMenu("")} /> : null}

          {menu === "add" ? (
            <div className="composer-menu absolute left-2 bottom-[52px] z-40 w-[340px] max-h-[440px] overflow-y-auto rounded-xl p-1.5 rise">
              <div className="px-3 pt-2 pb-1 text-[10.5px] tracking-[0.12em] text-faint uppercase">Add to message</div>
              <MenuItem icon="upload" label="Upload file" detail="Attach files as @references" onClick={attach} />
              <MenuItem icon="bulb" label="Plan mode" detail="Review a plan before building" tint="#d9b45a"
                onClick={() => { setPlan(true); setMenu(""); ta.current?.focus(); }} />
              <div className="px-3 pt-3 pb-1 text-[10.5px] tracking-[0.12em] text-faint uppercase">Hackathon skills</div>
              {SKILL_LOADERS.map((s) => (
                <MenuItem key={s.id} icon="doc" label={s.label} detail={s.detail} soon={!s.path} tint="#8ea6c7"
                  onClick={() => { setMenu(""); toast(`${s.label} skill file isn't written yet — placeholder`); }} />
              ))}
            </div>
          ) : null}

          {menu === "agent" ? (
            <div className="composer-menu absolute left-12 bottom-[52px] z-40 w-[240px] rounded-xl p-1.5 rise">
              {agents.map((a) => (
                <button key={a.id} disabled={!a.ok}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-left cursor-pointer hover:bg-raised disabled:opacity-40 disabled:cursor-default"
                  onClick={() => { setAgent(a.id); setMenu(""); }}>
                  <AgentLogo agent={a.id} size={14} />
                  <span className="flex-1">{a.name}</span>
                  {!a.ok ? <span className="text-[10px] text-faint">not installed</span> : a.id === agent ? <Icon name="check" size={12} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
