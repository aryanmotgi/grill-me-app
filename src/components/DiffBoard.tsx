import { useEffect, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { diffLineStats } from "../lib/diffStats";
import { Icon } from "./Icon";
import type { TeamMemberConfig } from "../data/sources/git";

interface ReviewData {
  branch: string;
  log: string;
  diffstat: string;
  diff: string;
}

type Load = { state: "loading" } | { state: "error"; error: string } | { state: "ready"; data: ReviewData };

/** One member's branch-vs-main diff. Reuses the same git_review command the
 *  pre-merge ReviewModal uses (120KB-capped diff), keyed by repoPath. */
function MemberDiff({ member }: { member: TeamMemberConfig }) {
  const status = useApp((s) => s.teammates.find((t) => t.id === member.id)?.status);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<ReviewData>("git_review", { repoPath: member.repoPath }))
      .then((data) => live && setLoad({ state: "ready", data }))
      .catch((e) => live && setLoad({ state: "error", error: String(e) }));
    return () => { live = false; };
  }, [member.repoPath]);

  const data = load.state === "ready" ? load.data : null;
  const clean = data ? !data.diff.trim() : false;
  const { added, removed } = data ? diffLineStats(data.diff) : { added: 0, removed: 0 };
  const fileCount = data
    ? data.diffstat.trim().split("\n").filter((l) => l.includes("|")).length
    : 0;

  return (
    <section className="border border-line rounded-md overflow-hidden bg-panel">
      <button
        className="w-full flex items-center gap-2 px-3 h-9 text-left hover:bg-raised transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`status-dot ${status ?? "idle"}`} />
        <span className="font-display font-semibold text-[12px]">{member.name}</span>
        <span className="font-mono text-faint text-[10px]">
          <Icon name="branch" size={11} /> {data?.branch ?? member.id}
        </span>
        <span className="flex-1" />
        {load.state === "loading" ? (
          <span className="text-faint text-[10px]">loading…</span>
        ) : load.state === "error" ? (
          <span className="tag danger"><Icon name="warn" size={9} /> diff failed</span>
        ) : clean ? (
          <span className="text-faint text-[10px]">clean vs main</span>
        ) : (
          <span className="font-mono text-[10px] flex items-center gap-2">
            <span className="text-faint">{fileCount} file{fileCount === 1 ? "" : "s"}</span>
            <span className="num text-data">+{added}</span>
            <span className="num text-data">−{removed}</span>
          </span>
        )}
        <Icon name="chevron" size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-line px-3 py-2 flex flex-col gap-2">
          {load.state === "loading" ? (
            <div className="text-faint text-[11px]">loading diff…</div>
          ) : load.state === "error" ? (
            <div className="text-faint text-[11px]">{load.error}</div>
          ) : clean ? (
            <div className="text-faint text-[11px]">Working tree clean vs main — nothing to review.</div>
          ) : (
            <>
              <div>
                <div className="panel-label mb-1">files changed</div>
                <pre className="font-mono text-[10px] text-dim whitespace-pre-wrap">{data!.diffstat.trim()}</pre>
              </div>
              <div>
                <div className="panel-label mb-1">diff</div>
                <pre className="font-mono text-[9px] text-term-ink bg-term-bg rounded-sm p-3 max-h-[48vh] overflow-auto whitespace-pre">
                  {data!.diff}
                </pre>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Diff review board: every teammate's branch-vs-main diff in one scrollable
 *  column. Collapsible per member, honest empty states, reuses git_review. */
export function DiffBoard() {
  const open = useApp((s) => s.diffBoardOpen);
  const members = useApp((s) => s.members);
  const modalA11y = useModalA11y("Diff review board", open);
  if (!open) return null;
  const close = () => useApp.setState({ diffBoardOpen: false });

  const unavailable = !isTauri()
    ? "diffs need the native app — run npm run tauri dev"
    : members.length === 0
      ? "no worktrees configured — add sessions to review their diffs"
      : null;

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[5vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[860px] max-w-[94vw] max-h-[86vh] glass rounded-md shadow-2xl rise flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line flex-none">
          <span className="font-display font-bold text-[14px]">DIFF REVIEW BOARD</span>
          <span className="text-dim text-[11px]">every session's branch vs main</span>
          <span className="flex-1" />
          <button className="btn" onClick={close}>close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {unavailable ? (
            <div className="text-faint text-[11px]">{unavailable}</div>
          ) : (
            members.map((m) => <MemberDiff key={m.id} member={m} />)
          )}
        </div>
      </div>
    </div>
  );
}
