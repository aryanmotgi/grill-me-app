import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, ptyIdFor } from "../store";
import type { Teammate } from "../types";
import { modelLabel, parseTranscript, toRows, type ChatItem, type ChatRow } from "../lib/chat";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { TRUST_ACCEPT_KEYS } from "../lib/ptyReady";

/** Claude Code asks once per new folder whether to trust it. A brand-new
 *  session's worktree always hits this, and the chat can't show Claude's
 *  menu, so answer it here. Its default is "No, exit", so we move to "Yes". */
function TrustCard({ mate, folder, onOpenTerminal }: { mate: Teammate; folder?: string; onOpenTerminal: () => void }) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const key of TRUST_ACCEPT_KEYS) {
        await invoke("pty_write", { id: ptyIdFor(mate.id), data: key });
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (e) {
      toast(`Couldn't answer Claude: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[13px]">
      <div className="flex items-center gap-3">
        <span className="status-dot needs-input" />
        <span className="flex-1 text-ink">Claude asks whether you trust this folder before it starts.</span>
      </div>
      <p className="text-[12px] text-dim">
        It's a copy of your project that Grill Me made for this session{folder ? <> (<span className="font-mono">{folder.split("/").pop()}</span>)</> : null}. Your message is sent as soon as you say yes.
      </p>
      <div className="flex gap-2">
        <button className="composer-btn" disabled={busy} onClick={() => void accept()}>
          {busy ? <span className="spinner" /> : <Icon name="check" size={12} />} Yes, trust this folder
        </button>
        <button className="composer-btn" onClick={onOpenTerminal}><Icon name="terminal" size={12} /> Open terminal</button>
      </div>
    </div>
  );
}

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

function ToolGroup({ tools }: { tools: Extract<ChatItem, { kind: "tool" }>[] }) {
  const [open, setOpen] = useState(false);
  if (tools.length === 1) return <ToolRow item={tools[0]} />;
  const pending = tools.some((t) => t.result === undefined);
  const errors = tools.filter((t) => t.isError).length;
  const last = tools[tools.length - 1];
  return (
    <div className="text-[12.5px]">
      <button className="flex items-center gap-2 max-w-full text-left text-faint hover:text-dim cursor-pointer py-0.5"
        onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={errors ? "text-danger" : ""}>
          {pending ? <span className="spinner inline-block align-[-2px]" style={{ width: 11, height: 11 }} /> : <Icon name={errors ? "cross" : "check"} size={11} />}
        </span>
        <span className="truncate">
          Used {tools.length} tools<span className="text-faint/70"> · {last.summary}</span>
        </span>
        <Icon name="chevron" size={9} className={`opacity-60 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="ml-2 pl-3 border-l border-line flex flex-col">
          {tools.map((t) => <ToolRow key={t.id} item={t} />)}
        </div>
      ) : null}
    </div>
  );
}

export function Working({ since, model }: { since: number | undefined; model: string }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // a transcript stamp hours old means status detection lags the transcript —
  // count from when we started watching instead of showing a silly number
  const from = since !== undefined && now - since < 3 * 3_600_000 ? since : start;
  const s = Math.max(0, Math.round((now - from) / 1000));
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-faint py-1">
      <span className="chat-pulse"><AgentLogo agent="claude" size={12} /></span>
      <span>{model} working for <span className="text-dim num">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span></span>
    </div>
  );
}

/** The conversation rows (bubbles, replies, tool groups, "worked for") —
 *  shared by session chat and the Grill Me Chat panel. */
export function ChatRows({ rows }: { rows: ChatRow[] }) {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === "tools") return <ToolGroup key={row.id} tools={row.tools} />;
        if (row.kind === "worked") {
          return (
            <div key={row.id} className="flex items-center gap-2 text-[12.5px] text-faint pb-2">
              <AgentLogo agent="claude" size={12} />
              <span>{row.model} worked for <span className="num">{row.seconds < 60 ? `${row.seconds}s` : `${Math.floor(row.seconds / 60)}m ${row.seconds % 60}s`}</span></span>
            </div>
          );
        }
        const it = row.item;
        return it.kind === "user" ? (
          <div key={it.id} className="flex justify-end pt-2">
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
        );
      })}
    </>
  );
}

export function ChatView({ mate, repoPath, onOpenTerminal }: {
  mate: Teammate;
  repoPath: string | undefined;
  onOpenTerminal: () => void;
}) {
  const { lines, state } = useTranscript(repoPath);
  const items = useMemo(() => parseTranscript(lines), [lines]);
  const rows = useMemo(() => toRows(items, mate.status === "working"), [items, mate.status]);
  const lastUserTs = useMemo(() => [...items].reverse().find((i) => i.kind === "user")?.ts, [items]);
  const lastModel = useMemo(() => modelLabel([...items].reverse().find((i) => i.model)?.model), [items]);
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
          <ChatRows rows={rows} />
        )}

        {mate.status === "working" ? <Working since={lastUserTs} model={lastModel} /> : null}
        {mate.trustPrompt ? (
          <TrustCard mate={mate} folder={member?.repoPath} onOpenTerminal={onOpenTerminal} />
        ) : mate.status === "needs-input" ? (
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
