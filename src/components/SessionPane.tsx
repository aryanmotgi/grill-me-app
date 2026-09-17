import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { ptyIdFor, useApp } from "../store";

async function shipRaw(memberId: string, data: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  invoke("pty_write", { id: ptyIdFor(memberId), data }).catch(() => {});
}
import type { Teammate } from "../types";
import { isHelpPending } from "../lib/help";
import { XtermPane } from "./XtermPane";
import { useApp as useVitals } from "../store";
import { fmtFullTime, fmtMem, fmtTokens } from "../lib/format";

function VitalsStrip({ mateId }: { mateId: string }) {
  const res = useVitals((s) => s.resources[s.activeProject && s.activeProject !== "default" ? `${s.activeProject}:${mateId}` : mateId]);
  const mate = useVitals((s) => s.teammates.find((t) => t.id === mateId));
  const tok = mate?.usage.tokens;
  return (
    <div className="flex items-center gap-4 px-3 h-6 border-t border-line bg-panel flex-none font-mono text-[9px] text-faint">
      <span>{mate?.branch !== "—" ? mate?.branch : "no branch"}</span>
      <span className="ml-auto" />
      {res ? <span title="CPU across this session's processes">{res.cpu.toFixed(0)}% cpu</span> : null}
      {res ? <span title="Memory">{fmtMem(res.memMb)}</span> : null}
      {tok ? <span title="Tokens this session">{fmtTokens(tok.output)} out · {fmtTokens(tok.input)} in</span> : null}
      <span title="Session status">{mate?.status}</span>
    </div>
  );
}
import { useState as usePrState } from "react";
import { isTauri } from "../data/sources/git";

function PrDraft({ repoPath }: { repoPath?: string }) {
  const [busy, setBusy] = usePrState(false);
  const [draft, setDraft] = usePrState("");
  const run = async () => {
    if (!repoPath || !isTauri()) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setDraft(await invoke<string>("pr_draft", { repoPath }));
    } catch (e) {
      setDraft(`draft failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn" disabled={busy} onClick={run}>
        {busy ? "drafting…" : "draft PR body"}
      </button>
      {draft ? (
        <textarea
          readOnly
          className="w-full h-40 mt-2 bg-raised hairline rounded-sm p-2 font-mono text-[10px] outline-none"
          value={draft}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
    </>
  );
}

type PaneTab = "terminal" | "shell" | "changes" | "audit";

function ChangeRow({ file, summary, repoPath, onRevert }: {
  file: string; summary: string; repoPath?: string; onRevert: () => void;
}) {
  const [diff, setDiff] = usePrState<string | null>(null);
  const peek = async () => {
    if (diff !== null) return setDiff(null);
    if (!repoPath || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const d = await invoke<string>("git_diff_file", { repoPath, file }).catch((e) => `diff failed: ${e}`);
    setDiff(d || "(new file or no diff)");
  };
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 text-[11px]">
        <button className="font-mono text-ink text-[10px] truncate cursor-pointer hover:text-accent text-left"
          onClick={peek} title="Click for inline diff">
          {file}
        </button>
        <span className="text-faint">{summary}</span>
        <span className="flex-1" />
        <button className="btn" onClick={onRevert}>revert</button>
      </div>
      {diff !== null ? (
        <pre className="mt-1 max-h-56 overflow-auto bg-term-bg rounded-sm p-2 font-mono text-[9px] text-term-ink whitespace-pre-wrap">{diff}</pre>
      ) : null}
    </div>
  );
}

function AuditView({ memberId }: { memberId: string }) {
  const [lines, setLines] = usePrState<{ ts: number; tool: string; detail: string }[]>([]);
  const load = async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string[]>("audit_tail", { member: memberId }).catch(() => [] as string[]);
    setLines(raw.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
  };
  useAuditEffect(load, memberId);
  return (
    <div className="flex-1 overflow-y-auto p-3 bg-panel">
      <div className="panel-label mb-2">audit log — every executed tool call</div>
      {lines.length === 0 ? (
        <div className="text-faint text-[11px]">No tool calls recorded yet for this session.</div>
      ) : (
        lines.slice().reverse().map((l, i) => (
          <div key={i} className="flex gap-2 py-1 text-[10px] font-mono">
            <span className="text-faint tabular-nums flex-none" title={fmtFullTime(l.ts * 1000)}>
              {new Date(l.ts * 1000).toTimeString().slice(0, 8)}
            </span>
            <span className="text-accent flex-none w-14">{l.tool}</span>
            <span className="text-dim truncate">{l.detail}</span>
          </div>
        ))
      )}
    </div>
  );
}

import { useEffect as useAuditEffectBase } from "react";
function useAuditEffect(load: () => void, memberId: string) {
  useAuditEffectBase(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);
}

// Brief in-memory cache of the last explanation per session, so reopening the
// popover within the TTL is instant and doesn't re-spend a claude call.
const explainCache = new Map<string, { text: string; at: number }>();
const EXPLAIN_TTL_MS = 90_000;

// "Explain what this session is doing" — a light, unobtrusive AI affordance in
// the pane header. Pipes recent terminal output + branch/task/file to claude
// via the explain_session command and shows a 2-3 sentence summary in a glass
// popover. Loading, error, and claude-missing states are all honest.
function ExplainSession({ mate }: { mate: Teammate }) {
  const claudeMissing = useApp((s) => s.claudeMissing);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const run = async (force = false) => {
    const key = ptyIdFor(mate.id);
    if (!force) {
      const hit = explainCache.get(key);
      if (hit && Date.now() - hit.at < EXPLAIN_TTL_MS) {
        setText(hit.text);
        setError(null);
        return;
      }
    }
    if (!isTauri()) {
      setError("Explain runs in the desktop app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const summary = await invoke<string>("explain_session", {
        ptyId: key,
        branch: mate.branch,
        task: mate.taskLabel,
        file: mate.currentFile,
      });
      setText(summary);
      explainCache.set(key, { text: summary, at: Date.now() });
    } catch (e) {
      const msg = String(e);
      setError(/not found|not installed|command -v/i.test(msg)
        ? "claude CLI not found — install it to explain sessions."
        : `Couldn't explain: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !claudeMissing) run();
  };

  // close on outside click / Escape while open
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        className={`btn ${open ? "active" : ""}`}
        aria-expanded={open}
        onClick={toggle}
        title="Plain-English summary of what this session is doing right now"
      >
        <Icon name="spark" size={11} /> explain
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Session explanation"
          className="absolute right-0 top-full mt-1 z-40 w-72 glass rounded-md shadow-2xl p-3 rise"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="panel-label">what's happening</span>
            <span className="flex-1" />
            {!claudeMissing ? (
              <button className="btn" disabled={busy} onClick={() => run(true)}
                title="Re-read the latest terminal output">
                {busy ? "…" : "refresh"}
              </button>
            ) : null}
          </div>
          {claudeMissing ? (
            <p className="text-warn text-[11px] leading-relaxed">
              claude CLI not found — install it to explain sessions.
            </p>
          ) : busy ? (
            <p className="text-dim text-[11px] leading-relaxed flex items-center gap-2">
              <span className="status-dot working" /> reading the session…
            </p>
          ) : error ? (
            <p className="text-danger text-[11px] leading-relaxed">{error}</p>
          ) : text ? (
            <p className="text-dim text-[12px] leading-relaxed">{text}</p>
          ) : (
            <p className="text-faint text-[11px] leading-relaxed">No summary yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Read this session's live scrollback (base64 raw pty bytes), strip ANSI, and
// save it as a Markdown transcript through the native save dialog. Honest
// toasts on non-native (browser dev) and on failure/cancel.
async function exportTranscript(mate: Teammate, toast: (t: string, k?: "info" | "warn") => void) {
  if (!isTauri()) { toast("Export runs in the desktop app", "warn"); return; }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const b64 = await invoke<string>("pty_scrollback", { id: ptyIdFor(mate.id) });
    let raw = "";
    if (b64) {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      raw = new TextDecoder().decode(u);
    }
    const at = Date.now();
    const { buildTranscript, transcriptFilename } = await import("../lib/transcript");
    const md = buildTranscript(raw, { name: mate.name, branch: mate.branch, at });
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: transcriptFilename(mate.name, at),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return; // user cancelled the dialog
    await invoke("transcript_write", { path, content: md });
    toast(`Transcript saved → ${path}`);
  } catch (e) {
    toast(`Export failed: ${e}`, "warn");
  }
}

export function SessionPane({ mate }: { mate: Teammate }) {
  const { toggleRecording, revertChange, shipSession, members, themeName, setHandoffFor, requestHelp, resolveHelp, toast } = useApp();
  const helpPending = useApp((s) => isHelpPending(s.messages, mate.id));
  const [tab, setTab] = useState<PaneTab>("terminal");
  const member = members.find((m) => m.id === mate.id);

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-term-bg">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-line bg-panel flex-none">
        <span className={`status-dot ${mate.status}`} />
        <span className="font-display font-semibold text-[12px]">{mate.name}</span>
        <span className="font-mono text-faint text-[10px]"><Icon name="branch" size={11} /> {mate.branch}</span>
        {mate.recording ? <span className="tag danger"><Icon name="record" size={9} /> rec</span> : null}
        {helpPending ? (
          <span className="tag warn" title="This session is flagged for help — the team can see it needs eyes">
            <Icon name="help" size={9} /> needs help
          </span>
        ) : null}
        {mate.terminal.some((l) => l.text.includes("need authentication")) ? (
          <button className="tag warn cursor-pointer" title="MCP servers need auth — click to run /mcp in this session"
            onClick={() => shipRaw(mate.id, "/mcp\n")}>
            <Icon name="warn" size={9} /> mcp auth
          </button>
        ) : null}
        <span className="flex-1" />
        <div className="flex demo-hide items-center">
          <ExplainSession mate={mate} />
          <button className={`btn ml-1 ${tab === "terminal" ? "active" : ""}`} onClick={() => setTab("terminal")}>
            terminal
          </button>
          <button className={`btn ${tab === "shell" ? "active" : ""} ml-1`} onClick={() => setTab("shell")}>
            shell
          </button>
          <button className={`btn ${tab === "changes" ? "active" : ""} ml-1`} onClick={() => setTab("changes")}>
            changes {mate.changes.length}
          </button>
          <button className={`btn ${tab === "audit" ? "active" : ""} ml-1`} onClick={() => setTab("audit")}
            title="Audit: timestamped log of every command this session actually executed, for tracing incidents">
            audit
          </button>
          <button
            className={`btn ml-1 ${mate.recording ? "active" : ""}`}
            onClick={() => toggleRecording(mate.id)}
            title="Record: saves this session's raw terminal output to a file for later replay (~/.grillme/recordings)"
          >
            {mate.recording ? "stop rec" : "rec"}
          </button>
          <button
            className={`btn ml-1 ${helpPending ? "active" : ""}`}
            onClick={() => (helpPending ? resolveHelp(mate.id) : requestHelp(mate.id))}
            title={helpPending
              ? "Clear the help flag — use once a teammate has eyes on this session"
              : "Flag this session as stuck — pings the team and shows on everyone's home"}
          >
            <Icon name="help" size={11} /> {helpPending ? "got help" : "request help"}
          </button>
          <button
            className="btn ml-1"
            onClick={() => exportTranscript(mate, toast)}
            title="Export transcript: save this session's terminal scrollback as a Markdown file"
          >
            <Icon name="download" size={11} /> export
          </button>
          <button
            className="btn ml-1"
            onClick={() => setHandoffFor(mate.id)}
            title="Hand off: summarize this session (Claude) and send a where-I-am / what's-next note to a teammate"
          >
            hand off
          </button>
        </div>
      </div>

      {tab === "terminal" || tab === "shell" ? (
        member ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0">
              <XtermPane
                key={tab}
                id={tab === "shell" ? `${ptyIdFor(mate.id)}:shell` : ptyIdFor(mate.id)}
                cwd={member.repoPath}
                themeName={themeName}
                shell={tab === "shell"}
              />
            </div>
            <VitalsStrip mateId={mate.id} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-faint text-[11px]">
            no worktree configured for this session
          </div>
        )
      ) : tab === "audit" ? (
        <AuditView memberId={mate.id} />
      ) : (
        <div className="flex-1 overflow-y-auto p-3 bg-panel">
          <div className="panel-label mb-2">working tree — {mate.branch}</div>
          {mate.changes.length === 0 ? (
            <div className="text-faint text-[11px]">No uncommitted changes.</div>
          ) : (
            mate.changes.map((c) => (
              <ChangeRow key={c.file} file={c.file} summary={c.summary}
                repoPath={member?.repoPath} onRevert={() => revertChange(mate.id, c.file)} />
            ))
          )}
          <div className="flex gap-2 mt-3">
            <button className="btn primary" title="Runs the team workflow: tests, review, push — inside this session"
              onClick={() => shipSession(mate.id)}>
              /ship
            </button>
            <PrDraft repoPath={member?.repoPath} />
          </div>
        </div>
      )}
    </section>
  );
}
