import { useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { isTauri } from "../data/sources/git";
import type { Teammate } from "../types";

type Status = "idle" | "loading" | "ready" | "error";

/** A missing claude CLI comes back from the Rust preflight with this text —
 *  detect it so we can show an install hint instead of a raw error. */
function isClaudeMissing(err: string): boolean {
  return /claude.*not found|not found.*claude/i.test(err);
}

/** Parse the generated markdown into one `{id, note}` per teammate section so
 *  each lands in the shared standup log attributed to the right member (the
 *  Activity feed resolves the id → name). Sections are '## <name> (<branch>)'
 *  headers; the body lines become a compact single-line note. */
function toLogEntries(md: string, teammates: Teammate[]): { id: string; note: string }[] {
  const byName = new Map(teammates.map((t) => [t.name.trim().toLowerCase(), t.id]));
  const entries: { id: string; note: string }[] = [];
  let curId: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (curId && body.length) {
      const note = body
        .map((l) => l.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200);
      if (note) entries.push({ id: curId, note });
    }
    body = [];
  };

  for (const raw of md.split("\n")) {
    const header = raw.match(/^#{1,3}\s+(.+?)\s*$/);
    if (header) {
      flush();
      // strip a trailing "(branch)" from the heading, then match by name
      const name = header[1].replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
      const slug = name.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
      curId = byName.get(name) ?? (slug || null);
    } else if (raw.trim()) {
      body.push(raw);
    }
  }
  flush();
  return entries;
}

/** Auto-standup overlay: one click asks claude for a per-teammate
 *  Done/Doing/Blocked summary grounded in each member's git log + tasks, shown
 *  as markdown (pre-wrap). Copy it, or post one line per teammate to the shared
 *  standup log. Loading spinner while claude runs; honest error + claude-missing
 *  states. */
export function StandupSummary() {
  const open = useApp((s) => s.standupOpen);
  const teammates = useApp((s) => s.teammates);
  const toast = useApp((s) => s.toast);
  const modalA11y = useModalA11y("Standup summary", open);

  const [status, setStatus] = useState<Status>("idle");
  const [md, setMd] = useState("");
  const [err, setErr] = useState("");
  const [posting, setPosting] = useState(false);

  if (!open) return null;
  const close = () => useApp.setState({ standupOpen: false });

  const generate = async () => {
    if (!isTauri()) {
      setStatus("error");
      setErr("Standup runs claude locally — only available in the desktop app.");
      return;
    }
    setStatus("loading");
    setErr("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const out = await invoke<string>("generate_standup");
      setMd(out);
      setStatus("ready");
    } catch (e) {
      setErr(String(e));
      setStatus("error");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      toast("Standup copied to clipboard");
    } catch {
      toast("Copy failed", "warn");
    }
  };

  const postToLog = async () => {
    if (!isTauri()) return;
    const entries = toLogEntries(md, teammates);
    if (entries.length === 0) {
      toast("Nothing to post — no teammate sections found", "warn");
      return;
    }
    setPosting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const e of entries) {
        await invoke("standup_append", { id: e.id, note: e.note });
      }
      // pull the fresh tail so the Activity feed reflects it immediately
      const lines = await invoke<string[]>("standup_tail").catch(() => null);
      if (lines) useApp.setState({ standupLines: lines });
      toast(`Posted ${entries.length} line${entries.length === 1 ? "" : "s"} to the standup log`);
    } catch (e) {
      toast(`Post failed: ${e}`, "warn");
    } finally {
      setPosting(false);
    }
  };

  const claudeMissing = status === "error" && isClaudeMissing(err);

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[640px] max-w-[94vw] max-h-[84vh] flex flex-col glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">STANDUP</span>
          <span className="text-faint text-[10px]">per-teammate done / doing / blocked, from git log + tasks</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        {/* action bar */}
        <div className="flex items-center gap-2 mb-4">
          <button className="btn primary" disabled={status === "loading"} onClick={generate}>
            {status === "loading" ? "generating…" : status === "ready" ? "regenerate" : "generate"}
          </button>
          {status === "loading" ? <span className="spinner" aria-label="generating" /> : null}
          <span className="flex-1" />
          {status === "ready" && md ? (
            <>
              <button className="btn" disabled={posting} onClick={copy}>copy</button>
              <button className="btn" disabled={posting} onClick={postToLog}>
                {posting ? "posting…" : "post to standup log"}
              </button>
            </>
          ) : null}
        </div>

        {/* body: idle / loading / error / ready */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {status === "idle" ? (
            <div className="glass rounded-md px-5 py-8 text-center">
              <div className="flex justify-center mb-2 text-faint"><Icon name="broadcast" size={20} /></div>
              <div className="text-[12px] text-dim">No standup yet.</div>
              <div className="text-[10px] text-faint mt-1 leading-relaxed">
                Generate stitches each teammate&apos;s last-24h commits, in-flight and blocked
                tasks, and waiting-on-input sessions into a Done / Doing / Blocked summary.
              </div>
            </div>
          ) : null}

          {status === "loading" ? (
            <div className="glass rounded-md px-5 py-8 text-center text-[11px] text-dim">
              asking claude for the standup — reading git logs and tasks…
            </div>
          ) : null}

          {status === "error" ? (
            <div className="glass rounded-md px-5 py-6 border-l-2 border-l-warn">
              {claudeMissing ? (
                <>
                  <div className="text-[12px] text-warn mb-1">claude CLI not found</div>
                  <div className="text-[10px] text-faint leading-relaxed">
                    Standup shells out to Claude Code. Install the <span className="font-mono">claude</span> CLI
                    and make sure it&apos;s on your PATH, then generate again.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[12px] text-warn mb-1">standup failed</div>
                  <div className="text-[10px] text-faint leading-relaxed font-mono break-words">{err}</div>
                </>
              )}
            </div>
          ) : null}

          {status === "ready" ? (
            <pre className="glass rounded-md p-4 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono">
              {md}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
