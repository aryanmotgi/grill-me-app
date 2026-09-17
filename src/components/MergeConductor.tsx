import { useEffect, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { isSolo, useApp } from "../store";
import { Icon } from "./Icon";
import { isTauri, predictConflict, type ConflictPrediction } from "../data/sources/git";
import { conductorStep, type VisitedMap } from "../lib/mergeConductor";

// ---------------------------------------------------------------------------
// Merge conductor — a guided, one-at-a-time walk of the merge queue. For the
// member at the head it shows their branch, asks claude (predict_conflict) how
// likely their branch is to actually conflict with the NEXT branch in line, and
// offers to merge them (shipApproved → runs /ship, which rotates the queue) or
// skip for now (advanceMergeQueue). The user confirms every step — nothing is
// automatic. Reuses predictConflict / shipApproved / advanceMergeQueue; adds no
// new Rust. Solo / empty / single-member queues get an honest empty state.
// ---------------------------------------------------------------------------

// mirrors HomeDashboard's ConflictChip palette: low reads as success, high as
// danger, medium as neutral cyan data. Never amber (reserved for actions).
const LIKELIHOOD_STYLE: Record<ConflictPrediction["likelihood"], string> = {
  low: "text-ok border-ok/40",
  medium: "text-data border-data/40",
  high: "text-danger border-danger/50",
};

type Predict =
  | { phase: "idle" }
  | { phase: "unavailable" }
  | { phase: "loading" }
  | { phase: "error"; message: string; missing: boolean }
  | { phase: "done"; prediction: ConflictPrediction };

export function MergeConductor() {
  const open = useApp((s) => s.mergeConductorOpen);
  const mergeQueue = useApp((s) => s.mergeQueue);
  const teammates = useApp((s) => s.teammates);
  const solo = useApp(isSolo);
  const advanceMergeQueue = useApp((s) => s.advanceMergeQueue);
  const shipApproved = useApp((s) => s.shipApproved);
  const modalA11y = useModalA11y("Merge conductor", open);

  // members actioned this session → drives the one-pass walk (see lib helper)
  const [visited, setVisited] = useState<VisitedMap>({});
  const [busy, setBusy] = useState(false);
  const [predict, setPredict] = useState<Predict>({ phase: "idle" });

  const step = conductorStep(mergeQueue, visited);
  const head = step.head;
  const next = step.next;

  // reset the walk each time the overlay opens fresh
  useEffect(() => {
    if (open) {
      setVisited({});
      setBusy(false);
    }
  }, [open]);

  // auto-run the conflict prediction whenever the head we're pointing at
  // changes. One claude call per step, exactly as the flow intends.
  useEffect(() => {
    if (!open || !head) return;
    let cancelled = false;
    if (!next) {
      setPredict({ phase: "idle" });
      return;
    }
    if (!isTauri()) {
      setPredict({ phase: "unavailable" });
      return;
    }
    setPredict({ phase: "loading" });
    predictConflict(head, next)
      .then((prediction) => {
        if (!cancelled) setPredict({ phase: "done", prediction });
      })
      .catch((e) => {
        if (cancelled) return;
        const message = typeof e === "string" ? e : String(e);
        setPredict({ phase: "error", missing: /claude cli not found|not found.*claude/i.test(message), message });
      });
    return () => {
      cancelled = true;
    };
    // head+next capture the queue position; re-run when either changes
  }, [open, head, next]);

  if (!open) return null;
  const close = () => useApp.setState({ mergeConductorOpen: false });

  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
  const initialsOf = (id: string) =>
    teammates.find((t) => t.id === id)?.initials ?? id.slice(0, 2).toUpperCase();

  // merge the head: run their /ship. shipApproved rotates the queue only on a
  // successful inject (it toasts its own readiness failures), so we compare the
  // head before/after and record "merged" only when the queue actually advanced.
  const mergeHead = async () => {
    if (!head || busy) return;
    setBusy(true);
    const before = useApp.getState().mergeQueue[0];
    try {
      await shipApproved(head);
    } finally {
      setBusy(false);
    }
    const after = useApp.getState().mergeQueue[0];
    if (after !== before) setVisited((v) => ({ ...v, [head]: "merged" }));
  };

  // skip: pass the merge turn (rotates the queue) and record it as visited so
  // the walk moves on without merging.
  const skipHead = () => {
    if (!head || busy) return;
    setVisited((v) => ({ ...v, [head]: "skipped" }));
    advanceMergeQueue();
  };

  const nothingToMerge = solo || step.total <= 1;
  const headMate = head ? teammates.find((t) => t.id === head) : undefined;

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[560px] max-w-[94vw] max-h-[84vh] flex flex-col glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">MERGE CONDUCTOR</span>
          <span className="text-faint text-[10px]">guided merge, one branch at a time</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        {/* progress line — walk position as tabular metrics (cyan data) */}
        {!nothingToMerge ? (
          <div className="flex items-center gap-3 mb-4 text-[11px]">
            <span className="text-dim">
              <span className="num text-data">{step.mergedCount}</span> merged
            </span>
            <span className="text-dim">
              <span className="num text-data">{step.skippedCount}</span> skipped
            </span>
            <span className="text-dim">
              <span className="num text-data">{step.remaining}</span> of{" "}
              <span className="num">{step.total}</span> left
            </span>
          </div>
        ) : null}

        {/* queue strip — head highlighted, visited members marked */}
        {!nothingToMerge ? (
          <div className="flex items-center gap-1.5 flex-wrap mb-5">
            {mergeQueue.map((id, i) => {
              const outcome = visited[id];
              const isHead = id === head;
              return (
                <div key={id} className="flex items-center gap-1.5">
                  {i > 0 ? <Icon name="chevron" size={11} className="text-faint" /> : null}
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold num border ${
                      isHead
                        ? "border-accent text-accent bg-accent/10"
                        : outcome === "merged"
                          ? "border-ok/50 text-ok"
                          : outcome === "skipped"
                            ? "border-line text-faint line-through"
                            : "border-line text-dim"
                    }`}
                    title={`${nameOf(id)}${
                      outcome ? ` — ${outcome}` : isHead ? " — up next" : " — waiting"
                    }`}
                  >
                    {initialsOf(id)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* honest empty state: solo, no team, or a queue of one */}
          {nothingToMerge ? (
            <div className="glass rounded-md px-5 py-8 text-center">
              <div className="flex justify-center mb-2 text-faint"><Icon name="merge" size={20} /></div>
              <div className="text-[12px] text-dim">Nothing to merge.</div>
              <div className="text-[10px] text-faint mt-1 leading-relaxed">
                {solo
                  ? "The merge conductor coordinates a shared queue — it only runs in team mode."
                  : "The merge queue needs at least two branches to sequence. Add teammates and it'll guide the merge order here."}
              </div>
            </div>
          ) : step.done ? (
            /* completion — walked the whole queue */
            <div className="glass rounded-md px-5 py-8 text-center">
              <div className="flex justify-center mb-2 text-ok"><Icon name="check" size={20} /></div>
              <div className="text-[12px] text-dim">Walked the whole queue.</div>
              <div className="text-[10px] text-faint mt-1 leading-relaxed">
                <span className="num text-data">{step.mergedCount}</span> merged
                {step.skippedCount > 0 ? (
                  <> · <span className="num text-data">{step.skippedCount}</span> left for later</>
                ) : null}
                . Re-open the conductor any time to run through what's queued again.
              </div>
            </div>
          ) : headMate ? (
            <>
              {/* current member card */}
              <div className="glass rounded-md p-4 mb-3">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold num border border-accent text-accent bg-accent/10">
                    {initialsOf(headMate.id)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold">{headMate.name}</div>
                    <div className="text-[10px] text-faint">up next to merge</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-3 text-[11px]">
                  <Icon name="branch" size={11} className="text-data flex-none" />
                  <span className="font-mono text-dim truncate" title={headMate.branch}>{headMate.branch}</span>
                </div>
                {headMate.taskLabel ? (
                  <div className="text-[10px] text-faint mt-1 truncate">{headMate.taskLabel}</div>
                ) : null}
              </div>

              {/* conflict prediction against the next branch in line */}
              <div className="glass rounded-md p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="panel-label">conflict with next</span>
                  {next ? (
                    <span className="text-faint text-[10px]">vs {nameOf(next)}</span>
                  ) : null}
                  {predict.phase === "error" && !predict.missing ? (
                    <button className="tag ml-auto cursor-pointer hover:text-data"
                      onClick={() => { if (head && next) { setPredict({ phase: "loading" });
                        predictConflict(head, next).then((prediction) => setPredict({ phase: "done", prediction }))
                          .catch((e) => { const m = typeof e === "string" ? e : String(e);
                            setPredict({ phase: "error", missing: false, message: m }); }); } }}>
                      retry
                    </button>
                  ) : null}
                </div>

                {!next ? (
                  <p className="text-[11px] text-dim leading-snug">
                    {headMate.name} is the last branch in line — nothing left to check against.
                  </p>
                ) : predict.phase === "loading" ? (
                  <div className="text-[12px] text-data flex items-center gap-1.5">
                    <span className="status-dot working" /> asking claude…
                  </div>
                ) : predict.phase === "unavailable" ? (
                  <p className="text-[11px] text-dim leading-snug">
                    Conflict prediction shells out to claude — only available in the desktop app.
                    You can still merge in order below.
                  </p>
                ) : predict.phase === "error" ? (
                  predict.missing ? (
                    <p className="text-[11px] text-dim leading-snug">
                      claude CLI isn&apos;t installed. Install it and prediction will work here — no restart needed.
                    </p>
                  ) : (
                    <p className="text-[11px] text-danger break-words leading-snug">{predict.message}</p>
                  )
                ) : predict.phase === "done" ? (
                  <div className="flex flex-col gap-2">
                    <span className={`tag self-start uppercase ${LIKELIHOOD_STYLE[predict.prediction.likelihood]}`}>
                      {predict.prediction.likelihood} likelihood
                    </span>
                    {predict.prediction.detail ? (
                      <p className="text-[11px] text-dim leading-snug">{predict.prediction.detail}</p>
                    ) : null}
                    {predict.prediction.recommendedOrder ? (
                      <div className="text-[11px] leading-snug flex items-start gap-1.5">
                        <Icon name="merge" size={11} className="text-data mt-0.5 flex-none" />
                        <span className="text-dim">{predict.prediction.recommendedOrder}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {/* actions — one primary (merge), one secondary (skip). Hidden on the
            empty / done states. */}
        {!nothingToMerge && !step.done && head ? (
          <div className="flex items-center gap-2 mt-4">
            <button className="btn primary" disabled={busy} onClick={mergeHead}>
              {busy ? "shipping…" : `merge ${nameOf(head)}`}
            </button>
            {busy ? <span className="spinner" aria-label="shipping" /> : null}
            <span className="flex-1" />
            <button className="btn" disabled={busy} onClick={skipHead}>skip for now</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
