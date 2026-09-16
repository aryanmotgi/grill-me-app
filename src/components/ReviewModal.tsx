import { useEffect, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";

interface ReviewData {
  branch: string;
  log: string;
  diffstat: string;
  diff: string;
}

/** Pre-merge review: summary + diff + explicit approve / request changes. */
export function ReviewModal() {
  const { reviewFor, setReviewFor, members, teammates, shipApproved, setDraftReply, setRailTab, toast } = useApp();
  const [data, setData] = useState<ReviewData | null>(null);
  const member = members.find((m) => m.id === reviewFor);
  const mate = teammates.find((t) => t.id === reviewFor);
  const modalA11y = useModalA11y("Pre-merge review", Boolean(reviewFor));

  useEffect(() => {
    if (!reviewFor || !member || !isTauri()) return;
    setData(null);
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<ReviewData>("git_review", { repoPath: member.repoPath })
        .then(setData)
        .catch((e) => setData({ branch: "?", log: "", diffstat: `review failed: ${e}`, diff: "" })),
    );
  }, [reviewFor, member]);

  if (!reviewFor) return null;

  const approve = () => {
    shipApproved(reviewFor);
    setReviewFor(null);
  };
  const requestChanges = () => {
    setReviewFor(null);
    setDraftReply({ to: reviewFor, threadId: `review-${Date.now()}`, mention: reviewFor });
    setRailTab("inbox");
    toast("Write what needs to change — sends as a blocking thread");
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-start justify-center pt-[5vh]" onClick={() => setReviewFor(null)}>
      <div {...modalA11y}
        className="w-[760px] max-h-[86vh] bg-overlay hairline rounded-md shadow-2xl rise flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <span className="font-display font-bold text-[14px]">PRE-MERGE REVIEW</span>
          <span className="text-dim text-[11px]">{mate?.name}</span>
          <span className="font-mono text-faint text-[10px]">{data?.branch}</span>
          <span className="flex-1" />
          <button className="btn" onClick={() => setReviewFor(null)}>cancel</button>
          <button className="btn" onClick={requestChanges}>request changes</button>
          <button className="btn primary" onClick={approve} title="Runs /ship in their session — tests before push">
            approve & ship
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {!data ? (
            <div className="text-faint text-[11px]">loading diff…</div>
          ) : (
            <>
              <div>
                <div className="panel-label mb-1">commits ahead of main</div>
                <pre className="font-mono text-[10px] text-dim whitespace-pre-wrap">{data.log || "(none — uncommitted changes only)"}</pre>
              </div>
              <div>
                <div className="panel-label mb-1">files changed</div>
                <pre className="font-mono text-[10px] text-dim whitespace-pre-wrap">{data.diffstat || "(working tree clean vs main)"}</pre>
              </div>
              <div>
                <div className="panel-label mb-1">full diff</div>
                <pre className="font-mono text-[9px] text-term-ink bg-term-bg rounded-sm p-3 whitespace-pre-wrap max-h-[45vh] overflow-y-auto">
                  {data.diff || "(no diff)"}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
