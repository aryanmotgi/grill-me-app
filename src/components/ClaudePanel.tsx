import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoGrow } from "../hooks/useAutoGrow";
import { useApp } from "../store";
import { parseTranscript, toRows } from "../lib/chat";
import { SKILL_LOADERS, loadSkill } from "../data/skills";
import { useBridge } from "./BridgePanel";
import { ChatRows, Working } from "./ChatView";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";
import { PanelControls } from "./Dock";
import { ClaudeConnect, useRemote } from "./ClaudeConnect";

// ---------------------------------------------------------------------------
// The Claude side panel (⌘J / nav rail → Claude):
//   claude.ai     — the real site, embedded, with your chats and projects;
//                   once connected (ClaudeConnect) it also sees your sessions
//   Grill Me Chat — local brainstorm partner wired to your sessions through
//                   the grill-me tools (plans, reviews, hand-offs; never edits
//                   code) — shown only while claude.ai isn't connected
// ---------------------------------------------------------------------------

interface ChatMeta { id: string; title: string; project: string; ts: number }

const native = () => "__TAURI_INTERNALS__" in window;
const CHATS_FILE = "brainstorm-chats.json";

async function chatsPath() {
  const { homeDir, join } = await import("@tauri-apps/api/path");
  return join(await homeDir(), ".grillme", CHATS_FILE);
}

async function loadChats(): Promise<ChatMeta[]> {
  if (!native()) return [];
  try {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const v = JSON.parse(await readTextFile(await chatsPath()));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function saveChats(chats: ChatMeta[]) {
  if (!native()) return;
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(await chatsPath(), JSON.stringify(chats.slice(0, 200), null, 2)).catch(() => {});
}

const STARTERS = [
  "What are my sessions doing?",
  "Explain what my latest session changed, in plain words.",
  "Let's plan the next feature.",
  "Grill me on what I'm building.",
];

function GrillChat({ compact = false }: { compact?: boolean }) {
  const activeProject = useApp((s) => s.activeProject) ?? "default";
  const toast = useApp((s) => s.toast);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<number | undefined>();
  const [draft, setDraft] = useState("");
  const draftBox = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(draftBox, draft);
  const [menu, setMenu] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const projectChats = chats.filter((c) => c.project === activeProject);
  const current = chats.find((c) => c.id === chatId);

  useEffect(() => { void loadChats().then(setChats); }, []);

  const refresh = useCallback(async (id: string | null) => {
    if (!id || !native()) { setLines([]); return; }
    const { invoke } = await import("@tauri-apps/api/core");
    setLines(await invoke<string[]>("brainstorm_history", { chatId: id }).catch(() => []));
  }, []);

  useEffect(() => { void refresh(chatId); }, [chatId, refresh]);

  // live updates while Claude answers
  useEffect(() => {
    if (!native()) return;
    const offs: (() => void)[] = [];
    let alive = true;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const a = await listen<string>("brainstorm-progress", (e) => { if (e.payload === chatId) void refresh(chatId); });
      const b = await listen<{ chatId: string; isError: boolean; text: string }>("brainstorm-done", (e) => {
        if (e.payload.chatId !== chatId) return;
        setBusy(false);
        void refresh(chatId);
        if (e.payload.isError && e.payload.text) toast(`Claude: ${e.payload.text}`, "warn");
      });
      if (alive) offs.push(a, b); else { a(); b(); }
    });
    return () => { alive = false; offs.forEach((f) => f()); };
  }, [chatId, refresh, toast]);

  const rows = useMemo(() => toRows(parseTranscript(lines), busy), [lines, busy]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, busy]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || busy) return;
    if (!native()) { toast("Grill Me Chat needs the native app", "warn"); return; }
    let id = chatId;
    let resume = true;
    let list = chats;
    if (!id) {
      id = crypto.randomUUID();
      resume = false;
      const meta: ChatMeta = { id, title: body.slice(0, 60), project: activeProject, ts: Date.now() };
      list = [meta, ...chats];
      setChats(list);
      setChatId(id);
    } else {
      list = [{ ...current!, ts: Date.now() }, ...chats.filter((c) => c.id !== id)];
      setChats(list);
    }
    void saveChats(list);
    setDraft("");
    setBusy(true);
    setSentAt(Date.now());
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const projectName = useApp.getState().projects.find((p) => p.id === activeProject)?.name ?? activeProject;
      await invoke("brainstorm_send", { chatId: id, message: body, resume, model: null, project: projectName });
    } catch (e) {
      setBusy(false);
      toast(`${e}`, "warn");
    }
  };

  const stop = async () => {
    if (!chatId) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("brainstorm_stop", { chatId });
  };

  const pickSkill = async (i: number) => {
    setMenu(false);
    try {
      const s = SKILL_LOADERS[i];
      setDraft(`${(await loadSkill(s)).trim()}\n\n`);
    } catch {
      toast("Couldn't read that playbook from ~/.grillme/skills", "warn");
    }
  };

  return (
    <div className="flex-1 min-h-0 flex">
      {/* chat list (full view only — the dock uses a picker instead) */}
      {compact ? null : <aside className="w-[220px] flex-none border-r border-line flex flex-col">
        <button className="m-2 h-8 rounded-lg flex items-center gap-2 px-3 text-[12.5px] text-ink bg-raised hover:bg-raised/80 cursor-pointer"
          onClick={() => { setChatId(null); setLines([]); }}>
          <Icon name="plus" size={12} /> New chat
        </button>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
          {projectChats.length === 0 ? <p className="px-2 py-1 text-[11.5px] text-faint">No chats yet in this project.</p> : null}
          {projectChats.map((c) => (
            <button key={c.id}
              className={`text-left px-2.5 py-1.5 rounded-lg text-[12.5px] truncate cursor-pointer ${c.id === chatId ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/50"}`}
              title={c.title}
              onClick={() => setChatId(c.id)}>
              {c.title}
            </button>
          ))}
        </div>
      </aside>}

      {/* conversation */}
      <div className="flex-1 min-w-0 flex flex-col">
        {compact ? (
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line flex-none">
            <select className="composer-btn h-7 flex-1 min-w-0 text-[12px]" value={chatId ?? ""}
              onChange={(e) => setChatId(e.target.value || null)}>
              <option value="">New chat</option>
              {projectChats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button className="composer-btn h-7 text-[12px]" title="New chat" onClick={() => { setChatId(null); setLines([]); }}>
              <Icon name="plus" size={11} />
            </button>
          </div>
        ) : null}
        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
          <div className={`max-w-[780px] mx-auto flex flex-col gap-3 select-text ${compact ? "px-4 py-4" : "px-6 py-6"}`}>
            {rows.length === 0 && !busy ? (
              <div className="py-12 flex flex-col items-center gap-3 text-center">
                <AgentLogo agent="claude" size={24} />
                <p className="text-[15px] text-ink">Brainstorm with Claude</p>
                <p className="text-[12.5px] text-faint max-w-[420px]">It can see your sessions in this project, read their changes, save plans to the board, and hand tasks to a coder — after you approve.</p>
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {STARTERS.map((s) => <button key={s} className="starter-chip" onClick={() => void send(s)}>{s}</button>)}
                </div>
              </div>
            ) : (
              <ChatRows rows={rows} />
            )}
            {busy ? <Working since={sentAt} model="Claude" /> : null}
          </div>
        </div>

        <div className={`max-w-[780px] w-full mx-auto pb-4 ${compact ? "px-3" : "px-6"}`}>
          <div className="composer-card relative rounded-xl">
            <textarea
              ref={draftBox}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } }}
              placeholder="Brainstorm, ask about your sessions, plan the next step…"
              className="block w-full resize-none bg-transparent outline-none px-4 pt-3 pb-2 text-[13.5px] text-ink placeholder:text-faint min-h-[60px] max-h-[220px] overflow-y-auto"
            />
            <div className="flex items-center gap-1.5 px-3 pb-3">
              <button className={`composer-btn w-8 justify-center ${menu ? "on" : ""}`} title="Hackathon playbooks" onClick={() => setMenu(!menu)}>
                <Icon name="plus" size={13} />
              </button>
              {compact ? null : <span className="text-[11px] text-faint">Uses your Claude plan · can't edit code — it hands off to your sessions</span>}
              <span className="flex-1" />
              {busy ? (
                <button className="w-8 h-8 rounded-lg flex items-center justify-center bg-raised text-ink cursor-pointer" title="Stop" onClick={() => void stop()}>
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-ink" />
                </button>
              ) : (
                <button className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer bg-raised text-dim disabled:opacity-40 data-[ready=true]:bg-ink data-[ready=true]:text-bg"
                  data-ready={!!draft.trim()} disabled={!draft.trim()} title="Send (↵)" onClick={() => void send(draft)}>
                  <Icon name="up" size={14} />
                </button>
              )}
            </div>
            {menu ? (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                <div className="composer-menu absolute left-2 bottom-[52px] z-40 w-[300px] rounded-xl p-1.5 rise">
                  <div className="px-3 pt-2 pb-1 text-[10.5px] tracking-[0.12em] text-faint uppercase">Hackathon playbooks</div>
                  {SKILL_LOADERS.map((s, i) => (
                    <button key={s.id} className="flex flex-col w-full text-left px-3 py-1.5 rounded-lg hover:bg-raised cursor-pointer" onClick={() => void pickSkill(i)}>
                      <span className="text-[13px] text-ink">{s.label}</span>
                      <span className="text-[11.5px] text-faint">{s.detail}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const OVERLAY_SEL = '.scrim, [aria-modal="true"], [data-overlay], aside.composer-menu';

/** True while any modal/overlay is in the DOM (rAF-throttled observer). */
function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(() => typeof document !== "undefined" && !!document.querySelector(OVERLAY_SEL));
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setOpen(!!document.querySelector(OVERLAY_SEL)));
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    check();
    return () => { mo.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return open;
}

/** The real claude.ai, as a native child webview laid over this box. */
function ClaudeAi() {
  const box = useRef<HTMLDivElement>(null);
  // A native webview always draws ABOVE the page, so it must step aside
  // whenever ANY Grill Me overlay is up — not a hand-kept list (that missed
  // the hackathon kickoff, ship queue, review, consent…). Any element that is
  // a scrimmed dialog, an aria-modal, or a floating panel counts.
  const overlayUp = useOverlayOpen();
  const bridgeOpen = useBridge((b) => b.open);
  const hidden = overlayUp || bridgeOpen;

  useEffect(() => {
    if (!native() || !box.current) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        if (hidden || !box.current) { await invoke("claudeai_hide").catch(() => {}); return; }
        const r = box.current.getBoundingClientRect();
        await invoke("claudeai_show", { x: r.left, y: r.top, w: r.width, h: r.height }).catch((e) => useApp.getState().toast(`claude.ai: ${e}`, "warn"));
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(box.current);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", place);
      void import("@tauri-apps/api/core").then(({ invoke }) => invoke("claudeai_hide").catch(() => {}));
    };
  }, [hidden]);

  return (
    <div ref={box} className="flex-1 min-h-0 flex items-center justify-center text-faint text-[12px]">
      {native() ? (hidden ? "claude.ai steps aside while a window is open" : "Loading claude.ai…") : "claude.ai needs the native app"}
    </div>
  );
}

/** The Claude chat docked as a side panel next to your sessions. */
/** The Claude panel docked beside your sessions. Once claude.ai is
 *  connected to Grill Me it's one thing — your real Claude that also sees
 *  your sessions. Until then, Grill Me Chat covers the code side. */
export function ClaudeDock({ edge, side, width }: { edge: boolean; side: "left" | "right"; width: number }) {
  const connected = !!useRemote((r) => r.status?.url);
  const [pick, setPick] = useState<"chat" | "web">("web");
  const tab = connected ? "web" : pick;
  return (
    <aside style={{ width }} className={`flex-none bg-panel flex flex-col overflow-hidden border-line ${side === "left" ? "border-r" : "border-l"}`}>
      <div data-tauri-drag-region className={`flex items-center gap-1 h-12 pr-2 flex-none border-b border-line ${edge ? "pl-[84px]" : "pl-3"}`}>
        {connected ? (
          <span className="flex items-center gap-2 px-1 text-[13px] text-ink"><span style={{ color: "#c88a6a" }}>✳</span> Claude</span>
        ) : (
          ([["web", "claude.ai"], ["chat", "Grill Me Chat"]] as const).map(([id, label]) => (
            <button key={id}
              className={`px-3 h-7 rounded-lg text-[12.5px] cursor-pointer transition-colors ${tab === id ? "bg-raised text-ink" : "text-dim hover:text-ink"}`}
              title={id === "chat" ? "Local chat that sees your sessions (no claude.ai history)" : "Your claude.ai chats and projects"}
              onClick={() => setPick(id)}>
              {label}
            </button>
          ))
        )}
        <span data-tauri-drag-region className="flex-1 h-full" />
        <PanelControls id="claude" />
      </div>
      {tab === "web" ? (
        <>
          <ClaudeConnect />
          <ClaudeAi />
        </>
      ) : (
        <GrillChat compact />
      )}
    </aside>
  );
}
