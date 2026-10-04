import { useEffect, useMemo, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { ptyIdFor, useApp } from "../store";
import { Icon } from "./Icon";
import { sessionTitle } from "../lib/sessionTitle";
import { sendToSession } from "../lib/ptyReady";
import { candidates, hasConflicts, lines, mergePrompt, useMergeSessions, withWork, type BranchPreview } from "../lib/mergeSessions";
import { useSavePoints } from "../lib/savepoints";

// ---------------------------------------------------------------------------
// Merge my sessions: everything your parallel sessions did, brought into the
// main session's branch. First you see what each one changed (commits,
// files, +/- lines) and what would conflict. Then: no conflicts → Grill Me
// merges them itself (a save point first, so it's undoable); conflicts → the
// main session's agent merges them and keeps both sides working.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export function MergeSessions() {
  const open = useMergeSessions((m) => m.open);
  const setOpen = useMergeSessions((m) => m.setOpen);
  const members = useApp((s) => s.members);
  const teammates = useApp((s) => s.teammates);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const toast = useApp((s) => s.toast);
  const setActive = useApp((s) => s.setActive);
  const a11y = useModalA11y("Merge my sessions", open);
  const [previews, setPreviews] = useState<BranchPreview[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const main = members[0];
  const target = teammates.find((t) => t.id === main?.id)?.branch ?? "";
  const others = useMemo(() => candidates(teammates.filter((t) => t.id !== main?.id), target), [teammates, main?.id, target]);
  const byBranch = useMemo(() => new Map(others.map((t) => [t.branch, t])), [others]);
  // work that isn't committed yet can't be merged: offer to have it committed
  const unsaved = others.filter((t) => !t.missing && t.changes.length > 0);
  const askToCommit = async () => {
    setBusy(true);
    try {
      const asked = unsaved.map((t) => {
        const m = members.find((x) => x.id === t.id);
        return m ? sendToSession(m, ptyIdFor(t.id), "Commit your current work on this branch with a clear message. Don't push.") : Promise.resolve(false);
      });
      toast(`Asking ${unsaved.length} session${unsaved.length === 1 ? "" : "s"} to commit. Open Merge my sessions again when they're done.`);
      close();
      const ok = (await Promise.all(asked)).filter(Boolean).length;
      if (ok < unsaved.length) toast(`${unsaved.length - ok} session${unsaved.length - ok === 1 ? "" : "s"} didn't get ready in time. Open it and ask again.`, "warn");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!open || !main || !native()) return;
    setPreviews(null); setError("");
    const branches = [...new Set(others.map((t) => t.branch))];
    if (!branches.length || !target || target === "—") { setPreviews([]); return; }
    void call<BranchPreview[]>("merge_preview", { repoPath: main.repoPath, target, branches })
      .then((p) => { const w = withWork(p); setPreviews(w); setPicked(new Set(w.map((x) => x.branch))); })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const close = () => setOpen(false);
  const chosen = (previews ?? []).filter((p) => picked.has(p.branch));
  const conflicts = hasConflicts(chosen);
  const name = (b: string) => { const t = byBranch.get(b); return t ? sessionTitle(t, titles) : b; };

  const mergeDirect = async () => {
    setBusy(true);
    try {
      const r = await call<{ merged: string[]; conflict: string | null }>("merge_branches", { repoPath: main.repoPath, branches: chosen.map((p) => p.branch) });
      useSavePoints.getState().bump();
      if (r.conflict) {
        toast(`Merged ${r.merged.length}; ${name(r.conflict)} conflicts. Hand it to the agent to finish.`, "warn");
        setPreviews(chosen.filter((p) => !r.merged.includes(p.branch)).map((p) => (p.branch === r.conflict && !p.conflicts.length ? { ...p, conflicts: ["(found while merging)"] } : p)));
      } else {
        toast(`Merged ${r.merged.length} session${r.merged.length === 1 ? "" : "s"} into ${target}. Undo from the save points if you need to.`);
        close();
      }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const mergeWithAgent = async () => {
    setBusy(true);
    try {
      // the main session's agent may not be running yet after a restart
      if (!(await sendToSession(main, ptyIdFor(main.id), mergePrompt(target, chosen)))) throw new Error("The main session didn't get ready in time. Open it and try again.");
      setActive(main.id);
      toast("The main session is merging them. Its receipt will show what it resolved.");
      close();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div {...a11y} className="w-[640px] max-w-[94vw] max-h-[84vh] flex flex-col glass rounded-2xl shadow-2xl rise p-6 outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-[16px] font-semibold text-ink flex-1">Merge my sessions</span>
          <button className="composer-btn h-8" onClick={close}>Close</button>
        </div>
        <p className="text-[12.5px] text-faint mb-4">Into <span className="font-mono text-dim">{target || "—"}</span>, the branch your main session is on. Check what each brings first.</p>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
          {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
          {!error && previews === null ? <p className="text-[12.5px] text-faint flex items-center gap-2"><span className="spinner" /> Looking at each session's work…</p> : null}
          {unsaved.length ? (
            <div className="rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 flex items-center gap-3">
              <span className="flex-1 text-[12.5px] text-dim">
                {unsaved.map((t) => sessionTitle(t, titles)).join(", ")} {unsaved.length === 1 ? "has" : "have"} changes that aren't committed yet. Only committed work can be merged.
              </span>
              <button className="composer-btn h-8 flex-none" disabled={busy} onClick={() => void askToCommit()}>Ask {unsaved.length === 1 ? "it" : "them"} to commit</button>
            </div>
          ) : null}
          {previews?.length === 0 && !unsaved.length ? <p className="text-[12.5px] text-faint">Nothing to merge: no other session has committed work on its own branch.</p> : null}
          {previews?.map((p) => {
            const n = lines(p.files);
            const on = picked.has(p.branch);
            return (
              <label key={p.branch} className={`rounded-xl border px-4 py-3 cursor-pointer ${on ? "border-line bg-raised/30" : "border-line/50 opacity-60"}`}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={on} className="accent-[var(--accent)]"
                    onChange={() => setPicked((s) => { const x = new Set(s); if (x.has(p.branch)) x.delete(p.branch); else x.add(p.branch); return x; })} />
                  <span className="text-[13.5px] text-ink flex-1 truncate">{name(p.branch)}</span>
                  <span className="text-[11.5px] text-faint num">{p.commits.length} commit{p.commits.length === 1 ? "" : "s"} · <span className="text-ok">+{n.adds}</span> <span className="text-danger">−{n.dels}</span></span>
                </div>
                <div className="pl-7 mt-1.5 flex flex-col gap-1">
                  {p.commits.slice(0, 3).map((c) => <span key={c} className="text-[12px] text-dim truncate">• {c}</span>)}
                  <span className="text-[11.5px] text-faint truncate font-mono" title={p.files.map((f) => f.file).join("\n")}>
                    {p.files.slice(0, 5).map((f) => f.file.split("/").pop()).join(", ")}{p.files.length > 5 ? ` +${p.files.length - 5}` : ""}
                  </span>
                  {p.conflicts.length ? (
                    <span className="text-[12px] text-warn flex items-center gap-1.5"><Icon name="warn" size={11} /> Conflicts in {p.conflicts.join(", ")}</span>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>

        {chosen.length ? (
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-line">
            <span className="text-[12px] text-faint flex-1">
              {conflicts ? "Some files conflict. The main session's agent will merge them and keep both sides working." : "No conflicts. Grill Me merges them now, with a save point first."}
            </span>
            {conflicts ? (
              <button className="composer-btn h-9 bg-accent text-accent-ink font-medium" disabled={busy} onClick={() => void mergeWithAgent()}>
                {busy ? "Sending…" : `Merge ${chosen.length} with the agent`}
              </button>
            ) : (
              <button className="composer-btn h-9 bg-accent text-accent-ink font-medium" disabled={busy} onClick={() => void mergeDirect()}>
                {busy ? "Merging…" : `Merge ${chosen.length} now`}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
