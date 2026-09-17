import { useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { isTauri } from "../data/sources/git";

type Status = "idle" | "loading" | "ready" | "error";

/** A missing claude CLI comes back from the Rust preflight with this text —
 *  detect it so we can show an install hint instead of a raw error. */
function isClaudeMissing(err: string): boolean {
  return /claude.*not found|not found.*claude/i.test(err);
}

/** Release-notes overlay: one click gathers the base repo's commit subjects
 *  (and merged PRs, best-effort) since the last tag and asks claude for grouped
 *  Features / Fixes / Chores markdown, shown pre-wrap. Copy it. Loading spinner
 *  while claude runs; honest error + claude-missing states. */
export function ReleaseNotes() {
  const open = useApp((s) => s.releaseNotesOpen);
  const repoPath = useApp((s) => s.members[0]?.repoPath);
  const toast = useApp((s) => s.toast);
  const modalA11y = useModalA11y("Release notes", open);

  const [status, setStatus] = useState<Status>("idle");
  const [md, setMd] = useState("");
  const [err, setErr] = useState("");

  if (!open) return null;
  const close = () => useApp.setState({ releaseNotesOpen: false });

  const generate = async () => {
    if (!isTauri()) {
      setStatus("error");
      setErr("Release notes run claude locally — only available in the desktop app.");
      return;
    }
    if (!repoPath) {
      setStatus("error");
      setErr("No project repo found to read commits from.");
      return;
    }
    setStatus("loading");
    setErr("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const out = await invoke<string>("generate_release_notes", { repoPath });
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
      toast("Release notes copied to clipboard");
    } catch {
      toast("Copy failed", "warn");
    }
  };

  const claudeMissing = status === "error" && isClaudeMissing(err);

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[640px] max-w-[94vw] max-h-[84vh] flex flex-col glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">RELEASE NOTES</span>
          <span className="text-faint text-[10px]">features / fixes / chores, from commits + merged PRs since the last tag</span>
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
            <button className="btn" onClick={copy}>copy</button>
          ) : null}
        </div>

        {/* body: idle / loading / error / ready */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {status === "idle" ? (
            <div className="glass rounded-md px-5 py-8 text-center">
              <div className="flex justify-center mb-2 text-faint"><Icon name="push" size={20} /></div>
              <div className="text-[12px] text-dim">No release notes yet.</div>
              <div className="text-[10px] text-faint mt-1 leading-relaxed">
                Generate reads the commit subjects (and any merged PRs) since your last
                git tag, then groups them into Features / Fixes / Chores.
              </div>
            </div>
          ) : null}

          {status === "loading" ? (
            <div className="glass rounded-md px-5 py-8 text-center text-[11px] text-dim">
              asking claude for the release notes — reading commits and merged PRs…
            </div>
          ) : null}

          {status === "error" ? (
            <div className="glass rounded-md px-5 py-6 border-l-2 border-l-warn">
              {claudeMissing ? (
                <>
                  <div className="text-[12px] text-warn mb-1">claude CLI not found</div>
                  <div className="text-[10px] text-faint leading-relaxed">
                    Release notes shell out to Claude Code. Install the <span className="font-mono">claude</span> CLI
                    and make sure it&apos;s on your PATH, then generate again.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[12px] text-warn mb-1">release notes failed</div>
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
