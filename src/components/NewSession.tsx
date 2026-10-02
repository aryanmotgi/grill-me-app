import { usePendingChat } from "../lib/pendingChat";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAutoGrow } from "../hooks/useAutoGrow";
import { uiLayoutOf } from "../lib/uiLayout";
import { promptHints } from "../lib/coach";
import { useFanOutDraft } from "./FanOut";
import { saveBeforeSend } from "../lib/savepoints";
import { ptyIdFor, useApp } from "../store";
import { deliverBriefWhenReady } from "../lib/ptyReady";
import type { AgentId } from "../data/sources/git";
import { SKILL_LOADERS, loadSkill, type SkillLoader } from "../data/skills";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";
import { GrillFlame } from "./GrillMark";

// ---------------------------------------------------------------------------
// Monocode-style "What should we work on?" screen — the center view for a
// new session. A pixel dot-grid banner up top, then one composer card:
// context chips (project + the branch it will create), the prompt, and a
// toolbar (+ menu, agent picker, send). By default the prompt goes to the
// session working in the project folder itself; "New worktree" instead spawns
// a session on its own copy (feat/<slug>), for agents working in parallel.
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

/** Grill modes route the first message through the /grillme coaching skill:
 *  "grill" orients + grills your understanding before building; "hack" runs
 *  it in hackathon mode against the hours left on the clock. */
type GrillMode = "" | "grill" | "hack";
export function grillPrefix(mode: GrillMode, hoursLeft: number | null): string {
  if (mode === "grill") return "/grillme ";
  if (mode === "hack") return `/grillme --hackathon ${Math.max(1, Math.ceil(hoursLeft ?? 24))} `;
  return "";
}

// pixel sprites for the banner (x = lit) — grill-themed, drawn in the
// muted banner gray; the one ember flame is the brand mark.
const SPRITES: Record<string, string[]> = {
  kettle: [".xxxxxxx.", "xxxxxxxxx", "x.x.x.x.x", "xxxxxxxxx", ".xxxxxxx.", "..x...x..", ".x.....x."],
  burger: ["..xxxxx..", ".xxxxxxx.", "xxxxxxxxx", ".........", "xxxxxxxxx", ".........", ".xxxxxxx."],
  sausage: ["....x....", "....x....", ".xxxxxxx.", "xxxxxxxxx", ".xxxxxxx.", "....x....", "....x...."],
  spatula: ["xxxx.....", "xxxx.....", "xxxx.....", "...x.....", "....x....", ".....x...", "......xx."],
  invader: [".x...x.", "..xxx..", ".xxxxx.", "xx.x.xx", "xxxxxxx", ".x.x.x.", "x.....x"],
};

function Sprite({ name, x, y, px = 4 }: { name: string; x: string; y: string; px?: number }) {
  const rows = SPRITES[name];
  const w = rows[0].length;
  return (
    <svg className="absolute pixel-sprite" style={{ left: x, top: y }} width={w * px} height={rows.length * px} aria-hidden>
      {rows.flatMap((r, j) =>
        [...r].map((c, i) => (c === "x" ? <rect key={`${i}-${j}`} x={i * px} y={j * px} width={px - 0.5} height={px - 0.5} /> : null)),
      )}
    </svg>
  );
}

function PixelBanner() {
  return (
    <div className="pixel-banner relative h-[22vh] min-h-[120px] max-h-[240px] flex-none overflow-hidden" aria-hidden>
      <Sprite name="kettle" x="56%" y="16%" />
      <Sprite name="burger" x="28%" y="40%" />
      <Sprite name="sausage" x="78%" y="48%" />
      <Sprite name="spatula" x="44%" y="62%" px={3} />
      <Sprite name="invader" x="12%" y="18%" px={3} />
      <span className="absolute" style={{ left: "66%", top: "58%" }}><GrillFlame px={4} dim /></span>
    </div>
  );
}

function MenuItem({ icon, label, detail, onClick, tint }: {
  icon: string; label: string; detail: string; onClick: () => void; tint?: string;
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
  const [skill, setSkill] = useState<{ s: SkillLoader; body: string } | null>(null);
  const [grill, setGrill] = useState<GrillMode>("");
  // the simple layout speaks plainly and skips /grillme (a personal skill most
  // people don't have installed)
  const simple = useApp((s) => uiLayoutOf(s.appSettings) === "simple");
  const hackEndsAt = useApp((s) => s.appSettings.hackathonEndsAt as number | undefined);
  const hoursLeft = hackEndsAt ? (hackEndsAt - Date.now()) / 3_600_000 : null;
  const [menu, setMenu] = useState<"" | "add" | "agent">("");
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ta, text);
  const hints = useMemo(() => promptHints(text, null), [text]);
  const perksSeen = useApp((s) => s.appSettings.perksSeen === true);

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
  // where it runs: the project folder itself (default), or a new worktree
  const where = useApp((s) => (s.appSettings.newSessionWhere === "worktree" ? "worktree" : "folder"));
  const setAppSetting = useApp((s) => s.setAppSetting);
  const clean = (p?: string) => (p ?? "").replace(/\/+$/, "");
  const folderSession = members.find((m) => clean(m.repoPath) === clean(project?.path) && (m.agent ?? "claude") === agent)
    ?? members.find((m) => m.id === "me" && (m.agent ?? "claude") === agent);
  const branch = `feat/${slug}`;
  const agents: { id: AgentId; name: string; ok: boolean }[] = available.length
    ? available.map((a) => ({ id: a.id, name: a.name, ok: a.installed }))
    : [{ id: "claude", name: "Claude Code", ok: true }];
  const agentName = agents.find((a) => a.id === agent)?.name ?? agent;

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    // "This folder": hand it to the session already working in the project
    // folder (same agent), instead of making a new worktree and branch
    if (where === "folder" && folderSession) {
      const playbook0 = skill ? `Follow this ${skill.s.label} playbook:\n\n${skill.body.trim()}\n\n---\n\n` : "";
      const brief0 = agent === "claude" && grill ? grillPrefix(grill, hoursLeft) + (plan ? PLAN_PREFIX : "") + playbook0 + body : (plan ? PLAN_PREFIX : "") + playbook0 + body;
      useApp.getState().setActive(folderSession.id);
      usePendingChat.getState().add(folderSession.id, body);
      saveBeforeSend(folderSession.repoPath, body);
      setText(""); setSkill(null); setBusy(false);
      void deliverBriefWhenReady(ptyIdFor(folderSession.id), brief0).then((ok) => { if (!ok) toast("The session didn't get ready in time. Try sending again from its chat.", "warn"); });
      return;
    }
    // the slash command must lead the message for Claude Code to run the skill
    const playbook = skill ? `Follow this ${skill.s.label} playbook:\n\n${skill.body.trim()}\n\n---\n\n` : "";
    const brief = agent === "claude" && grill
      ? grillPrefix(grill, hoursLeft) + (plan ? PLAN_PREFIX : "") + playbook + body
      : (plan ? PLAN_PREFIX : "") + playbook + body;
    await spawnFromTemplate(slug, slug, branch, brief, agent);
    setBusy(false);
    // spawn registered the member → it's now the active tab; else keep the draft
    if (useApp.getState().members.some((m) => m.id === slug)) {
      setText("");
      setSkill(null);
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
        <h1 className="text-[20px] font-medium text-ink mb-4 px-1">{simple ? `What should your agent work on in ${projectName}?` : `What are we grilling in ${projectName}?`}</h1>

        <div className="composer-card relative rounded-xl">
          <div className="flex items-center gap-4 px-4 pt-3 text-[12px] text-faint">
            <button type="button" className="flex items-center gap-1.5 hover:text-ink cursor-pointer"
              title={where === "folder" ? "Works right in your project folder, on its current branch. Click for a separate worktree (for agents working in parallel)." : "A separate copy of the project on its own branch, so this agent can work in parallel. Click to work in your folder instead."}
              onClick={() => setAppSetting("newSessionWhere", where === "folder" ? "worktree" : "folder")}>
              <Icon name="folder" size={13} /> {where === "folder" ? `This folder${folderSession ? "" : " (starts a session)"}` : "New worktree"} <span className="text-faint">· change</span>
            </button>
            {where === "worktree" || !folderSession ? (
              <span className="flex items-center gap-1.5 font-mono text-[11px]" title="Branch this session will create">
                <Icon name="branch" size={13} /> {text.trim() ? branch : "feat/…"}
              </span>
            ) : <span className="flex items-center gap-1.5 text-[11px]" title={folderSession.repoPath}><Icon name="branch" size={13} /> current branch</span>}
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
            placeholder="Describe the task — it becomes the first message"
            className="block w-full resize-none bg-transparent outline-none px-4 pt-3 pb-2 text-[14px] text-ink placeholder:text-faint min-h-[64px] max-h-[240px] overflow-y-auto"
          />

          {hints.length ? (
            <div className="flex flex-col gap-1 px-3 pb-2" aria-live="polite">
              {hints.map((h) => (
                <div key={h.id} className="coach-hint flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-dim">
                  <Icon name="bulb" size={12} className="text-accent flex-none" />
                  <span className="flex-1 min-w-0">{h.text}</span>
                  {h.fix?.kind === "split" ? (
                    <button className="composer-btn h-7 text-[11.5px] flex-none"
                      onClick={() => { useFanOutDraft.getState().set(h.fix!.value); setText(""); useApp.getState().setView("tasks"); }}>
                      {h.fix.label}
                    </button>
                  ) : h.fix?.kind === "append" ? (
                    <button className="composer-btn h-7 text-[11.5px] flex-none"
                      onClick={() => { setText((t) => t.trimEnd() + h.fix!.value); ta.current?.focus(); }}>
                      {h.fix.label}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-1.5 px-3 pb-3">
            <button className={`composer-btn w-8 justify-center ${menu === "add" ? "on" : ""}`} title="Add to message"
              onClick={() => setMenu(menu === "add" ? "" : "add")}>
              <Icon name="plus" size={13} />
            </button>
            <button className="composer-btn" title="Agent for this session" onClick={() => setMenu(menu === "agent" ? "" : "agent")}>
              <AgentLogo agent={agent} size={14} /> {agentName} <Icon name="chevron" size={10} className="rotate-90 opacity-60" />
            </button>
            {agent === "claude" && !simple ? (
              <button className={`composer-btn ${grill ? "grill-on" : ""}`}
                title={grill ? "Grill mode on — the /grillme coach orients and grills you before building. Click to turn off." : "Grill mode: run this through the /grillme coach first"}
                onClick={() => setGrill(grill ? "" : "grill")}>
                <GrillFlame px={1.5} dim={!grill} /> {grill === "hack" ? "Hackathon grill" : "Grill"}
              </button>
            ) : null}
            {skill ? (
              <button className="composer-btn on" title="Playbook attached to the first message — click to remove" onClick={() => setSkill(null)}>
                <Icon name="doc" size={12} /> {skill.s.label} <Icon name="cross" size={9} className="opacity-60" />
              </button>
            ) : null}
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
                <MenuItem key={s.id} icon="doc" label={s.label} detail={s.detail} tint="#8ea6c7"
                  onClick={async () => {
                    setMenu("");
                    try {
                      setSkill({ s, body: await loadSkill(s) });
                      ta.current?.focus();
                    } catch {
                      toast(`Couldn't read ~/.grillme/${s.path}${"__TAURI_INTERNALS__" in window ? "" : " (needs the native app)"}`, "warn");
                    }
                  }} />
              ))}
              <div className="px-3 pt-1 pb-2 text-[10.5px] text-faint">Edit these in ~/.grillme/skills — the Claude app sees them too.</div>
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

        <div className="flex flex-wrap gap-2 mt-4 px-1">
          {simple ? null : <Starter icon={<GrillFlame px={1.5} />} label="Grill me on this" hint="Orient, grill my understanding, then plan — via /grillme"
            onClick={() => { setAgent("claude"); setGrill("grill"); ta.current?.focus(); }} />}
          <Starter icon={<Icon name="bolt" size={13} />} label="Start a hackathon" hint="Idea → goal + parallel tasks → one session per task"
            onClick={() => void import("./Kickoff").then(({ useKickoff }) => useKickoff.getState().setOpen(true))} />
          {simple ? null : <Starter icon={<Icon name="clock" size={13} />} label="Hackathon mode"
            hint={`/grillme --hackathon — scoped to ${hoursLeft !== null && hoursLeft > 0 ? `${Math.ceil(hoursLeft)}h left on the clock` : "24h (set the clock in the status bar)"}`}
            onClick={() => { setAgent("claude"); setGrill("hack"); ta.current?.focus(); }} />}
          <Starter icon={<Icon name="swap" size={13} />} label={simple ? "Run a checklist in parallel" : "Fan out a checklist"} hint="Paste a checklist → one session per independent item, side by side"
            onClick={() => useApp.getState().setView("tasks")} />
          <Starter icon={<Icon name="doc" size={13} />} label="From template" hint="Branch prefix + a saved starting brief"
            onClick={() => useApp.setState({ sessionTemplatesOpen: true })} />
          {simple ? null : <Starter icon={<Icon name="team" size={13} />} label="Standup" hint="AI Done / Doing / Blocked from git + tasks"
            onClick={() => useApp.setState({ standupOpen: true })} />}
        </div>

        {perksSeen ? null : <Perks onDone={() => setAppSetting("perksSeen", true)} />}
      </div>
    </div>
  );
}

/** What you get here that a bare terminal never gives you. Shown until dismissed. */
const PERKS: { icon: string; title: string; body: string }[] = [
  { icon: "eye", title: "See every change", body: "Each file it touches, as a diff, while it works. Explain turns it into plain English." },
  { icon: "commit", title: "Undo any turn", body: "Every message you send is a save point. Agent broke something? One click puts your files back." },
  { icon: "bulb", title: "Know what it costs", body: "Live spend per session, and tips before you send that cut wasted turns." },
  { icon: "swap", title: "Work in parallel", body: "Paste a checklist: one agent per task, side by side, each on its own branch." },
  { icon: "bell", title: "Pinged when it needs you", body: "Walk away. You get a ping the moment an agent asks a question or gets stuck." },
  { icon: "lock", title: "Safety net", body: "Force-push to main, rm -rf, DROP TABLE: blocked, even with permissions skipped." },
];

function Perks({ onDone }: { onDone: () => void }) {
  return (
    <section className="mt-10 px-1" aria-label="What Grill Me adds">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-[13px] font-medium text-ink">What you get here that a terminal won't give you</h2>
        <span className="flex-1" />
        <button className="text-[11.5px] text-faint hover:text-ink cursor-pointer" onClick={onDone}>Got it</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {PERKS.map((p) => (
          <div key={p.title} className="rounded-xl border border-line bg-raised/30 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[12.5px] text-ink font-medium"><Icon name={p.icon} size={13} className="text-accent" /> {p.title}</div>
            <p className="mt-1 text-[11.5px] text-dim leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Starter({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button className="starter-chip" title={hint} onClick={onClick}>
      {icon} {label}
    </button>
  );
}
