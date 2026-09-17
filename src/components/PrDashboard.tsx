import { useCallback, useEffect, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";
import {
  parsePrList,
  ciLabel,
  reviewLabel,
  type PrRow,
  type CiStatus,
} from "../lib/prStatus";
import { Icon } from "./Icon";

type Load =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; rows: PrRow[] };

/** CI traffic-light dot. Reuses .status-dot's shape + glow; colored by token
 *  only (ok/danger/data), never amber — amber is reserved for the merge action.
 *  "none" falls back to the hollow idle dot. */
function CiDot({ ci }: { ci: CiStatus }) {
  if (ci === "none") return <span className="status-dot idle" aria-hidden />;
  const token = ci === "pass" ? "--ok" : ci === "fail" ? "--danger" : "--data";
  return (
    <span
      className="status-dot"
      aria-hidden
      style={{
        background: `var(${token})`,
        boxShadow: `0 0 6px color-mix(in srgb, var(${token}) 70%, transparent)`,
      }}
    />
  );
}

/** One PR row: number, title, branch, author, CI dot, review state, and a
 *  guarded squash-merge. The merge button flips to an inline confirm so only
 *  the row you're acting on shows the single amber primary. */
function PrItem({ pr, repoPath, onMerged }: { pr: PrRow; repoPath: string; onMerged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const merge = async () => {
    setMerging(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("pr_merge", { repoPath, number: pr.number });
      onMerged();
    } catch (e) {
      setError(String(e));
      setMerging(false);
      setConfirming(false);
    }
  };

  return (
    <section className="border border-line rounded-md bg-panel px-3 py-2 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="num text-data text-[12px] font-semibold">#{pr.number}</span>
        <span className="text-[12px] font-semibold truncate">{pr.title}</span>
        {pr.isDraft ? <span className="tag">draft</span> : null}
        <span className="flex-1" />
        {merging ? (
          <span className="text-faint text-[10px]">merging…</span>
        ) : confirming ? (
          <span className="flex items-center gap-1.5">
            <span className="text-warn text-[10px]">squash-merge #{pr.number}?</span>
            <button className="btn primary" onClick={merge}>confirm merge</button>
            <button className="btn" onClick={() => setConfirming(false)}>cancel</button>
          </span>
        ) : (
          <button className="btn" onClick={() => setConfirming(true)}>merge</button>
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px] font-mono text-faint">
        <span className="flex items-center gap-1">
          <Icon name="branch" size={11} /> {pr.branch}
        </span>
        <span>@{pr.author}</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5" title={ciLabel(pr.ci)}>
          <CiDot ci={pr.ci} /> {ciLabel(pr.ci)}
        </span>
        <span className={pr.review === "changes_requested" ? "text-danger" : pr.review === "approved" ? "text-ok" : ""}>
          {reviewLabel(pr.review)}
        </span>
      </div>
      {error ? <div className="text-danger text-[10px]">{error}</div> : null}
    </section>
  );
}

/** PR dashboard overlay: open PRs for the active project's repo with CI +
 *  review state and one-click squash-merge. Reads the real `gh pr list` via the
 *  pr_list Rust command; honest loading / empty / error / gh-missing states. */
export function PrDashboard() {
  const open = useApp((s) => s.prDashboardOpen);
  const repoPath = useApp((s) => s.members[0]?.repoPath);
  const modalA11y = useModalA11y("PR dashboard", open);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(() => {
    if (!repoPath) return;
    setLoad({ state: "loading" });
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("pr_list", { repoPath }))
      .then((json) => setLoad({ state: "ready", rows: parsePrList(json) }))
      .catch((e) => setLoad({ state: "error", error: String(e) }));
  }, [repoPath]);

  useEffect(() => {
    if (open && isTauri() && repoPath) refresh();
  }, [open, repoPath, refresh]);

  if (!open) return null;
  const close = () => useApp.setState({ prDashboardOpen: false });

  const unavailable = !isTauri()
    ? "PRs need the native app — run npm run tauri dev"
    : !repoPath
      ? "no repo configured — add a session to see its PRs"
      : null;

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[5vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[760px] max-w-[94vw] max-h-[86vh] glass rounded-md shadow-2xl rise flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line flex-none">
          <span className="font-display font-bold text-[14px]">PR DASHBOARD</span>
          <span className="text-dim text-[11px]">open pull requests · CI &amp; review</span>
          <span className="flex-1" />
          {load.state === "ready" && !unavailable ? (
            <button className="btn" onClick={refresh}>refresh</button>
          ) : null}
          <button className="btn" onClick={close}>close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
          {unavailable ? (
            <div className="text-faint text-[11px]">{unavailable}</div>
          ) : load.state === "loading" ? (
            <div className="text-faint text-[11px]">loading open PRs…</div>
          ) : load.state === "error" ? (
            <div className="flex flex-col gap-1">
              <div className="tag danger self-start"><Icon name="warn" size={9} /> gh failed</div>
              <pre className="text-faint text-[10px] whitespace-pre-wrap font-mono">{load.error}</pre>
              <div className="text-faint text-[10px]">
                Needs the GitHub CLI, authenticated: install <span className="font-mono">gh</span> and run{" "}
                <span className="font-mono">gh auth login</span>.
              </div>
              <button className="btn self-start mt-1" onClick={refresh}>retry</button>
            </div>
          ) : load.rows.length === 0 ? (
            <div className="text-faint text-[11px]">no open PRs — nothing to merge.</div>
          ) : (
            load.rows.map((pr) => (
              <PrItem key={pr.number} pr={pr} repoPath={repoPath!} onMerged={refresh} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
