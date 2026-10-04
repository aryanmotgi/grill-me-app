import { unseen, usePendingChat } from "../lib/pendingChat";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, ptyIdFor } from "../store";
import type { Teammate } from "../types";
import { modelLabel, parseTranscript, toRows, type ChatItem, type ChatRow } from "../lib/chat";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { TRUST_ACCEPT_KEYS } from "../lib/ptyReady";
import { money, turnCost } from "../lib/coach";
import { uiLayoutOf } from "../lib/uiLayout";
import { goBack, listSavePoints, pointForTurn, useSavePoints, type SavePoint } from "../lib/savepoints";

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

function useTranscript(repoPath: string | undefined, fast = false) {
  // poll faster while a reply is on its way
  const fastRef = useRef(fast);
  fastRef.current = fast;
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
    let t = 0;
    const loop = async () => { await tick(); if (alive) t = window.setTimeout(loop, fastRef.current ? 400 : POLL_MS); };
    void loop();
    return () => { alive = false; clearTimeout(t); };
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

/** Claude's edited files (basenames) plus git's changed paths, no repeats. */
export function mergeFiles(tools: string[], git: string[]): string[] {
  const out = [...tools];
  for (const g of git) {
    const base = g.split("/").pop() ?? g;
    if (!out.includes(base)) out.push(base);
  }
  return out;
}

const dur = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

/** The receipt under a finished turn: what it touched, whether the tests
 *  passed, what it cost, and undo, all in one line. */
function Receipt({ row: raw, undo, gitFiles }: { row: Extract<ChatRow, { kind: "worked" }>; undo?: () => void; gitFiles?: string[] }) {
  // what git saw change (shell edits included) plus Claude's own file edits
  const row = gitFiles ? { ...raw, files: mergeFiles(raw.files, gitFiles) } : raw;
  const cost = turnCost(row.usage, row.modelId);
  const shown = row.files.slice(0, 3);
  return (
    <div className="turn-receipt flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint pb-3">
      <span className="flex items-center gap-1.5"><AgentLogo agent="claude" size={12} /> {row.model} · <span className="num">{dur(row.seconds)}</span></span>
      {row.files.length ? (
        <span className="flex items-center gap-1 min-w-0" title={row.files.join("\n")}>
          <Icon name="file" size={11} />
          <span className="truncate max-w-[280px]">{shown.join(", ")}{row.files.length > shown.length ? ` +${row.files.length - shown.length}` : ""}</span>
        </span>
      ) : <span>no files changed</span>}
      {row.tests ? (
        <span className={`flex items-center gap-1 ${row.tests === "pass" ? "text-ok" : "text-danger"}`}>
          <Icon name={row.tests === "pass" ? "check" : "cross"} size={11} /> {row.tests === "pass" ? "tests pass" : "tests fail"}
        </span>
      ) : null}
      {cost !== null ? <span className="num" title="Estimated at list prices from this turn's real token counts">{money(cost)}</span> : null}
      {undo && row.files.length ? (
        <button className="turn-undo flex items-center gap-1 hover:text-ink cursor-pointer" onClick={undo}
          title="Put every file back the way it was before this message (where you are now is saved first)">
          <Icon name="up" size={10} className="-rotate-90" /> Undo this turn
        </button>
      ) : null}
    </div>
  );
}

/** The conversation rows (bubbles, replies, tool groups, turn receipts) —
 *  shared by session chat and the Grill Me Chat panel. `undoFor` turns on
 *  per-turn undo where save points exist. */
export function ChatRows({ rows, undoFor, gitFiles }: { rows: ChatRow[]; undoFor?: (ask: string | undefined, startTs?: number) => (() => void) | undefined; gitFiles?: Record<string, string[]> }) {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === "tools") return <ToolGroup key={row.id} tools={row.tools} />;
        if (row.kind === "worked") return <Receipt key={row.id} row={row} undo={undoFor?.(row.ask, row.startTs)} gitFiles={gitFiles?.[row.id]} />;
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
  const pendingAll = usePendingChat((s) => s.byMate[mate.id]);
  const { lines, state } = useTranscript(repoPath, !!pendingAll?.length || mate.status === "working");
  const items = useMemo(() => parseTranscript(lines), [lines]);
  // what you sent that the transcript doesn't show yet
  const seen = useMemo(() => items.filter((i) => i.kind === "user").map((i) => ({ text: (i as { text: string }).text, ts: i.ts })), [items]);
  const pending = useMemo(() => unseen(pendingAll ?? [], seen), [pendingAll, seen]);
  useEffect(() => { usePendingChat.getState().settle(mate.id, seen); }, [seen, mate.id]);
  const rows = useMemo(() => toRows(items, mate.status === "working"), [items, mate.status]);
  const lastUserTs = useMemo(() => [...items].reverse().find((i) => i.kind === "user")?.ts, [items]);
  const lastModel = useMemo(() => modelLabel([...items].reverse().find((i) => i.model)?.model), [items]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const member = useApp((s) => s.members.find((m) => m.id === mate.id));
  const toast = useApp((s) => s.toast);
  const simple = useApp((s) => uiLayoutOf(s.appSettings) === "simple");
  // save points taken before each message, matched to the turn they started
  const rev = useSavePoints((s) => s.rev);
  const [points, setPoints] = useState<SavePoint[]>([]);
  useEffect(() => { if (repoPath) void listSavePoints(repoPath).then(setPoints); }, [repoPath, rev, items.length]);
  const undoFor = (ask: string | undefined, startTs?: number) => {
    if (!repoPath) return undefined;
    const sp = pointForTurn(points, ask, startTs);
    if (!sp) return undefined;
    return () => void goBack(repoPath, sp.id).then((m) => toast(m), (e) => toast(`Couldn't undo: ${e}`, "warn"));
  };
  const agent = member?.agent ?? "claude";
  // each turn's real changes, from git: its save point to the next turn's
  // (or the folder now, for the latest). Catches edits made through shell
  // commands, which Claude's edit tools don't show.
  const [gitFiles, setGitFiles] = useState<Record<string, string[]>>({});
  const turnKey = rows.filter((r) => r.kind === "worked").map((r) => r.id).join("|") + `#${points.length}`;
  useEffect(() => {
    if (!repoPath || !("__TAURI_INTERNALS__" in window)) return;
    const turns = rows.filter((r): r is Extract<ChatRow, { kind: "worked" }> => r.kind === "worked").slice(-15);
    let alive = true;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const out: Record<string, string[]> = {};
      for (let i = 0; i < turns.length; i++) {
        const from = pointForTurn(points, turns[i].ask, turns[i].startTs);
        if (!from) continue;
        const next = turns[i + 1] ? pointForTurn(points, turns[i + 1].ask, turns[i + 1].startTs) : undefined;
        if (turns[i + 1] && !next) continue; // can't bound it: leave Claude's own list
        const files = await invoke<string[]>("savepoint_changes", { repoPath, from: from.id, until: next?.id ?? null }).catch(() => null);
        if (files) out[turns[i].id] = files;
      }
      if (alive) setGitFiles(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, repoPath]);

  // sessions spawn lazily on first view — the chat is a view too, so make
  // sure the agent is running (same call + config the terminal pane uses)
  useEffect(() => {
    // a session whose folder is gone can't start: it would just crash
    if (!member || !("__TAURI_INTERNALS__" in window) || useApp.getState().claudeMissing || mate.missing) return;
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
      {/* the simple layout floats the Chat/Terminal switcher over the top: leave room */}
      <div className={`max-w-[820px] mx-auto px-6 pb-6 ${simple ? "pt-14" : "pt-6"} flex flex-col gap-3 select-text`}>
        {agent !== "claude" ? (
          <p className="text-faint text-[12px] text-center py-16">
            Chat view supports Claude Code sessions. <button className="underline cursor-pointer" onClick={onOpenTerminal}>Open the terminal</button>
          </p>
        ) : state === "loading" ? (
          <p className="text-faint text-[12px] text-center py-16">Loading conversation…</p>
        ) : items.length === 0 && !pending.length ? (
          <div className="text-center py-16 flex flex-col items-center gap-2">
            <AgentLogo agent="claude" size={22} />
            <p className="text-dim text-[13px]">No messages yet</p>
            <p className="text-faint text-[12px]">Send one below — the conversation shows up here.</p>
          </div>
        ) : (
          <ChatRows rows={rows} undoFor={undoFor} gitFiles={gitFiles} />
        )}
        {pending.map((p) => (
          <div key={p.at} className="flex justify-end pt-2">
            <div className="chat-bubble max-w-[78%] whitespace-pre-wrap break-words opacity-80">{p.text}</div>
          </div>
        ))}

        {mate.status === "working" || pending.length ? <Working since={pending.length ? pending[0].at : lastUserTs} model={lastModel} /> : null}
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
