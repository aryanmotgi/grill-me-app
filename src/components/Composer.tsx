import { usePendingChat } from "../lib/pendingChat";
import { submitToAgent } from "../lib/ptyReady";
import { useMemo, useRef, useState } from "react";
import { useApp, ptyIdFor } from "../store";
import { isTauri } from "../data/sources/git";
import { Icon } from "./Icon";
import { activeToken } from "../lib/composer";
import { promptHints, sessionStats, type Hint } from "../lib/coach";
import { useFanOutDraft } from "./FanOut";

// ---------------------------------------------------------------------------
// Monocode-style composer under the terminal. Multiline prompt (Enter sends,
// Shift+Enter for a newline) that writes into the agent session's pty. Typing
// "/" surfaces common agent slash-commands; typing "@" surfaces files you're
// working on to drop in as @references. The chip row grounds you in the real
// session (workspace ⎇ branch, which agent CLI, permission mode).
// ---------------------------------------------------------------------------

const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex" };

// Real Claude Code slash-commands — inserted as text, run by the agent itself.
const SLASH: { cmd: string; desc: string }[] = [
  { cmd: "/ship", desc: "test → commit → push → PR" },
  { cmd: "/review", desc: "review the current diff" },
  { cmd: "/compact", desc: "summarize + shrink context" },
  { cmd: "/clear", desc: "clear the conversation" },
  { cmd: "/mcp", desc: "authenticate MCP servers" },
  { cmd: "/cost", desc: "token cost so far" },
  { cmd: "/model", desc: "switch model" },
  { cmd: "/init", desc: "generate CLAUDE.md" },
];

interface Suggestion { insert: string; label: string; hint?: string }

export function Composer({ mateId }: { mateId: string }) {
  const members = useApp((s) => s.members);
  const teammates = useApp((s) => s.teammates);
  const openFiles = useApp((s) => s.openFiles);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0); // highlighted suggestion index
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [hushed, setHushed] = useState<Set<string>>(new Set());

  const member = members.find((m) => m.id === mateId);
  const mate = teammates.find((t) => t.id === mateId);

  // files you're working on — open tabs + this session's changed files
  const fileRefs = useMemo(() => {
    const set = new Set<string>(openFiles);
    for (const c of mate?.changes ?? []) set.add(typeof c === "string" ? c : (c as { file: string }).file);
    return [...set].filter(Boolean);
  }, [openFiles, mate?.changes]);

  const token = activeToken(draft, caret);
  const suggestions: Suggestion[] = useMemo(() => {
    if (!token) return [];
    const q = token.query.toLowerCase();
    if (token.kind === "/") {
      return SLASH.filter((s) => s.cmd.slice(1).toLowerCase().startsWith(q))
        .map((s) => ({ insert: s.cmd + " ", label: s.cmd, hint: s.desc }));
    }
    return fileRefs.filter((f) => f.toLowerCase().includes(q)).slice(0, 8)
      .map((f) => ({ insert: "@" + f + " ", label: "@" + (f.split("/").pop() ?? f), hint: f }));
  }, [token, fileRefs]);

  // the coach: quiet unless the draft would waste a turn, time or money
  const stats = useMemo(() => sessionStats(mate), [mate]);
  const hints = useMemo(() => promptHints(draft, stats).filter((h) => !hushed.has(h.id)), [draft, stats, hushed]);

  if (!member || !isTauri()) return null;
  const viewOnly = mate?.permission === "view";

  const applySuggestion = (s: Suggestion) => {
    if (!token) return;
    const before = draft.slice(0, token.start);
    const after = draft.slice(caret);
    const next = before + s.insert + after;
    setDraft(next);
    const pos = (before + s.insert).length;
    setCaret(pos);
    setSel(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || viewOnly) return;
    setSending(true);
    try {
      // show it in the chat now; the transcript catches up a moment later
      usePendingChat.getState().add(mateId, text);
      await submitToAgent(ptyIdFor(mateId), text);
      setDraft("");
      setCaret(0);
      setHushed(new Set());
    } catch (e) {
      toast(`Send failed: ${e}`, "warn");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const applyHint = async (h: Hint) => {
    const fix = h.fix;
    if (!fix) return;
    setHushed((x) => new Set(x).add(h.id));
    if (fix.kind === "append") {
      const next = draft.trimEnd() + fix.value;
      setDraft(next);
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.length, next.length); });
    } else if (fix.kind === "split") {
      useFanOutDraft.getState().set(fix.value);
      useApp.getState().setView("tasks");
      setDraft("");
    } else {
      await submitToAgent(ptyIdFor(mateId), fix.value).catch((e) => toast(`Couldn't send ${fix.value}: ${e}`, "warn"));
      toast(`Sent ${fix.value}. Your message is still here, send it when you're ready.`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => (i + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applySuggestion(suggestions[sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); setCaret(-1); return; } // dismiss menu
    }
    // Enter sends; Shift+Enter is a newline
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const syncCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

  return (
    <div className="flex-none border-t border-line bg-panel px-3 py-2 flex flex-col gap-1.5 relative">
      {suggestions.length > 0 && (
        <div className="absolute left-3 right-3 bottom-full mb-1 glass rounded-md shadow-2xl overflow-hidden z-20">
          <div className="px-2.5 py-1 border-b border-line text-[9px] uppercase tracking-wider text-faint">
            {token?.kind === "/" ? "commands" : "reference a file"}
          </div>
          {suggestions.map((s, i) => (
            <button key={s.label + i}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer ${i === sel ? "bg-raised" : "hover:bg-raised/60"}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => applySuggestion(s)}>
              <Icon name={token?.kind === "/" ? "terminal" : "file"} size={11} className="text-faint flex-none" />
              <span className="text-[12px] font-mono">{s.label}</span>
              {s.hint ? <span className="text-[10px] text-faint truncate ml-auto">{s.hint}</span> : null}
            </button>
          ))}
        </div>
      )}

      {hints.length > 0 && suggestions.length === 0 ? (
        <div className="flex flex-col gap-1" aria-live="polite">
          {hints.map((h) => (
            <div key={h.id} className="coach-hint flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11.5px] text-dim">
              <Icon name="bulb" size={12} className="text-accent flex-none" />
              <span className="flex-1 min-w-0">{h.text}</span>
              {h.fix ? (
                <button className="composer-btn h-6 text-[11px] flex-none" onClick={() => void applyHint(h)}>{h.fix.label}</button>
              ) : null}
              <button className="text-faint hover:text-ink cursor-pointer flex-none" title="Hide this tip"
                aria-label="Hide this tip" onClick={() => setHushed((x) => new Set(x).add(h.id))}>
                <Icon name="cross" size={10} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        ref={inputRef}
        rows={1}
        className="w-full bg-raised hairline rounded-md px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-accent placeholder:text-faint resize-none max-h-40"
        placeholder={viewOnly ? "view-only session" : "Ask, build, / for commands, @ for files — Enter sends, ⇧⏎ newline"}
        value={draft}
        disabled={viewOnly || sending}
        onChange={(e) => { setDraft(e.target.value); syncCaret(e.target); setSel(0);
          e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
        onKeyUp={(e) => syncCaret(e.currentTarget)}
        onClick={(e) => syncCaret(e.currentTarget)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-raised text-[10px] text-dim font-mono" title={member.repoPath}>
          <Icon name="folder" size={10} /> {member.repoPath.split("/").pop()}
          <Icon name="branch" size={10} /> {mate?.branch ?? "main"}
        </span>
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-raised text-[10px] text-dim"
          title="Which agent CLI runs in this session (chosen at session creation)">
          <Icon name="spark" size={10} /> {AGENT_LABEL[member.agent ?? "claude"]}
        </span>
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-raised text-[10px] text-dim"
          title="Sessions run with permission prompts bypassed; the audit blocklist still applies">
          <Icon name="lock" size={10} /> bypass on
        </span>
        <span className="flex-1" />
        <button
          className="flex items-center gap-1 px-3 py-1 rounded-md bg-accent text-accent-ink text-[11px] font-semibold cursor-pointer hover:brightness-110 disabled:opacity-40"
          disabled={!draft.trim() || viewOnly || sending}
          title="Send to the agent (Enter)"
          onClick={send}
        >
          send ↵
        </button>
      </div>
    </div>
  );
}
