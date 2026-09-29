import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, ptyIdFor } from "../store";
import type { Teammate } from "../types";
import { parseTranscript, type ChatItem } from "../lib/chat";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

// ---------------------------------------------------------------------------
// Monocode-style chat view of a Claude Code session. The agent keeps running
// in its pty exactly as before; this polls the transcript Claude Code writes
// (~/.claude/projects/<folder>/*.jsonl, via `transcript_tail`) and renders
// it as chat. Interactive prompts (questions, plan approval) only exist in
// the TUI, so needs-input surfaces a one-click jump to the terminal.
// ---------------------------------------------------------------------------

const POLL_MS = 1200;
const MAX_LINES = 4000;

interface Chunk { path: string; offset: number; reset: boolean; lines: string[] }

function useTranscript(repoPath: string | undefined) {
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  const cursor = useRef<{ path: string | null; offset: number }>({ path: null, offset: 0 });

  useEffect(() => {
    if (!repoPath) return;
    if (!("__TAURI_INTERNALS__" in window)) {
      // browser dev: demo conversation (dynamic import keeps it out of the app path)
      void import("../data/fakeChat").then((m) => { setLines(m.FAKE_CHAT_LINES); setState("ok"); });
      return;
    }
    let alive = true;
    cursor.current = { path: null, offset: 0 };
    setLines([]);
    setState("loading");
    const tick = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const c = await invoke<Chunk>("transcript_tail", {
          repoPath, path: cursor.current.path, offset: cursor.current.offset,
        });
        if (!alive) return;
        if (!c.path) { setState("none"); return; }
        cursor.current = { path: c.path, offset: c.offset };
        setState("ok");
        if (c.reset) setLines(c.lines.slice(-MAX_LINES));
        else if (c.lines.length) setLines((prev) => [...prev, ...c.lines].slice(-MAX_LINES));
      } catch {
        if (alive) setState("none");
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [repoPath]);

  return { lines, state };
}

function ToolRow({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const pending = item.result === undefined;
  return (
    <div className="text-[12.5px]">
      <button
        className="flex items-center gap-2 max-w-full text-left text-faint hover:text-dim cursor-pointer py-0.5"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={item.isError ? "text-danger" : pending ? "text-dim" : ""}>
          {pending ? <span className="spinner inline-block align-[-2px]" style={{ width: 11, height: 11 }} /> : <Icon name={item.isError ? "cross" : "check"} size={11} />}
        </span>
        <span className="truncate">{item.summary}</span>
        <Icon name="chevron" size={9} className={`opacity-60 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="ml-5 mt-1 mb-1.5 flex flex-col gap-1.5">
          <pre className="md-pre text-[11px] max-h-48">{item.detail}</pre>
          {item.result ? <pre className={`md-pre text-[11px] max-h-64 ${item.isError ? "text-danger" : "text-dim"}`}>{item.result}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

function Working({ mate }: { mate: Teammate }) {
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setSince(Date.now()); }, [mate.status]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return (
    <div className="flex items-center gap-2 text-[13px] text-faint py-1">
      <span className="chat-pulse"><AgentLogo agent="claude" size={13} /></span>
      <span>Claude working for <span className="text-dim num">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span></span>
    </div>
  );
}

export function ChatView({ mate, repoPath, onOpenTerminal }: {
  mate: Teammate;
  repoPath: string | undefined;
  onOpenTerminal: () => void;
}) {
  const { lines, state } = useTranscript(repoPath);
  const items = useMemo(() => parseTranscript(lines), [lines]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const member = useApp((s) => s.members.find((m) => m.id === mate.id));
  const agent = member?.agent ?? "claude";

  // sessions spawn lazily on first view — the chat is a view too, so make
  // sure the agent is running (same call + config the terminal pane uses)
  useEffect(() => {
    if (!member || !("__TAURI_INTERNALS__" in window) || useApp.getState().claudeMissing) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("pty_ensure", {
        id: ptyIdFor(member.id), cwd: member.repoPath, shell: false,
        remote: member.remote ?? null, tmux: member.tmuxSession ?? null, agent: member.agent ?? null,
      }).catch(() => {}),
    );
  }, [member]);

  // stick to the bottom while the user hasn't scrolled up
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items.length, lines.length, mate.status]);

  return (
    <div
      ref={scroller}
      className="flex-1 min-h-0 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="max-w-[820px] mx-auto px-6 py-6 flex flex-col gap-3 select-text">
        {agent !== "claude" ? (
          <p className="text-faint text-[12px] text-center py-16">
            Chat view supports Claude Code sessions. <button className="underline cursor-pointer" onClick={onOpenTerminal}>Open the terminal</button>
          </p>
        ) : state === "loading" ? (
          <p className="text-faint text-[12px] text-center py-16">Loading conversation…</p>
        ) : items.length === 0 ? (
          <div className="text-center py-16 flex flex-col items-center gap-2">
            <AgentLogo agent="claude" size={22} />
            <p className="text-dim text-[13px]">No messages yet</p>
            <p className="text-faint text-[12px]">Send one below — the conversation shows up here.</p>
          </div>
        ) : (
          items.map((it) =>
            it.kind === "user" ? (
              <div key={it.id} className="flex justify-end">
                <div className="chat-bubble max-w-[78%] whitespace-pre-wrap break-words">
                  {it.text}
                  {it.images ? <div className="text-[11px] text-faint mt-1">{it.images} image{it.images > 1 ? "s" : ""} attached</div> : null}
                </div>
              </div>
            ) : it.kind === "assistant" ? (
              <div key={it.id} className="chat-reply text-[13.5px] leading-[1.65] text-dim">
                <Markdown text={it.text} />
              </div>
            ) : it.kind === "tool" ? (
              <ToolRow key={it.id} item={it} />
            ) : (
              <div key={it.id} className="text-[11.5px] text-faint text-center py-1">{it.text}</div>
            ),
          )
        )}

        {mate.status === "working" ? <Working mate={mate} /> : null}
        {mate.status === "needs-input" ? (
          <div className="flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[13px]">
            <span className="status-dot needs-input" />
            <span className="flex-1 text-ink">Claude is waiting on you — it may be asking a question or for approval.</span>
            <button className="composer-btn" onClick={onOpenTerminal}><Icon name="terminal" size={12} /> Open terminal</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
