import { useEffect, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { isTauri, fetchBranchOverview } from "../data/sources/git";
import type { BranchOverview, TeamMemberConfig } from "../data/sources/git";
import { fmtRelTime } from "../lib/format";
import { Icon } from "./Icon";

type Row = { member: TeamMemberConfig; data: BranchOverview | null; error: string | null };
type Load =
  | { state: "loading" }
  | { state: "ready"; rows: Row[] };

/** One divergence indicator word + tone for a lane. Pure — unit-tested. */
export function divergence(o: BranchOverview): { label: string; tone: "sync" | "ahead" | "behind" | "diverged" } {
  if (o.onMain) return { label: "on main", tone: "sync" };
  if (o.ahead > 0 && o.behind > 0) return { label: "diverged", tone: "diverged" };
  if (o.ahead > 0) return { label: "ahead", tone: "ahead" };
  if (o.behind > 0) return { label: "behind", tone: "behind" };
  return { label: "in sync", tone: "sync" };
}

/** One member's branch as a lane: behind|main|ahead bars scaled to the widest
 *  lane in view, +ahead / -behind counts (cyan .num), last commit + age, and a
 *  changed-file count. Read-only — mirrors the conflict radar's honesty. */
function Lane({ row, maxSpan }: { row: Row; maxSpan: number }) {
  const status = useApp((s) => s.teammates.find((t) => t.id === row.member.id)?.status);
  const { member, data, error } = row;

  const aheadPct = data ? Math.round((data.ahead / maxSpan) * 100) : 0;
  const behindPct = data ? Math.round((data.behind / maxSpan) * 100) : 0;
  const div = data ? divergence(data) : null;

  return (
    <section className="border border-line rounded-md bg-panel px-3 py-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`status-dot ${status ?? "idle"}`} />
        <span className="font-display font-semibold text-[12px]">{member.name}</span>
        <span className="font-mono text-faint text-[10px] flex items-center gap-1">
          <Icon name="branch" size={11} /> {data?.branch ?? member.id}
        </span>
        <span className="flex-1" />
        {error ? (
          <span className="tag danger"><Icon name="warn" size={9} /> read failed</span>
        ) : data ? (
          <span className={`tag ${div!.tone === "diverged" ? "danger" : ""}`}>{div!.label}</span>
        ) : null}
      </div>

      {error ? (
        <div className="text-faint text-[11px]">{error}</div>
      ) : !data ? null : (
        <>
          {/* divergence bars: behind grows left of the main line, ahead right */}
          <div className="flex items-center gap-2" aria-hidden="true">
            <div className="flex-1 flex justify-end">
              <div className="w-full flex justify-end">
                <div
                  className="h-1.5 rounded-sm bg-faint/50"
                  style={{ width: `${behindPct}%` }}
                />
              </div>
            </div>
            <div className="w-px h-3.5 bg-line" title="main" />
            <div className="flex-1">
              <div
                className="h-1.5 rounded-sm bg-data/70"
                style={{ width: `${aheadPct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 text-[10px]">
            <span className="font-mono flex items-center gap-2">
              <span className="num text-data" title={`${data.ahead} commit(s) ahead of main`}>
                +{data.ahead}
              </span>
              <span className="num text-faint" title={`${data.behind} commit(s) behind main`}>
                −{data.behind}
              </span>
            </span>
            <span className="text-faint">
              <span className="num text-data">{data.changedFiles}</span> file
              {data.changedFiles === 1 ? "" : "s"} vs main
            </span>
            <span className="flex-1" />
            {data.lastTs > 0 ? (
              <span className="text-faint" title={data.lastSubject}>
                {fmtRelTime(data.lastTs * 1000)}
              </span>
            ) : null}
          </div>

          {data.lastSubject ? (
            <div className="text-[11px] text-dim leading-snug truncate" title={data.lastSubject}>
              <Icon name="commit" size={10} className="inline align-[-1px] mr-1 text-faint" />
              {data.lastSubject}
            </div>
          ) : (
            <div className="text-faint text-[11px]">no commits yet</div>
          )}
        </>
      )}
    </section>
  );
}

/** Branch graph overlay: every teammate's branch as a lane showing ahead/behind
 *  vs main. Pairs with the conflict radar. Reuses branch_overview (Rust) per
 *  member, with honest empty / loading / error states. */
export function BranchGraph() {
  const open = useApp((s) => s.branchGraphOpen);
  const members = useApp((s) => s.members);
  const modalA11y = useModalA11y("Branch graph", open);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    if (!open || !isTauri() || members.length === 0) return;
    let live = true;
    setLoad({ state: "loading" });
    Promise.all(
      members.map((member) =>
        fetchBranchOverview(member.repoPath)
          .then((data) => ({ member, data, error: data.ok ? null : (data.error ?? "unknown error") }))
          .catch((e) => ({ member, data: null, error: String(e) }))
      )
    ).then((rows) => live && setLoad({ state: "ready", rows }));
    return () => { live = false; };
  }, [open, members]);

  if (!open) return null;
  const close = () => useApp.setState({ branchGraphOpen: false });

  const unavailable = !isTauri()
    ? "branch graph needs the native app — run npm run tauri dev"
    : members.length === 0
      ? "no worktrees configured — add sessions to graph their branches"
      : null;

  const rows = load.state === "ready" ? load.rows : [];
  const maxSpan = Math.max(
    1,
    ...rows.flatMap((r) => (r.data ? [r.data.ahead, r.data.behind] : []))
  );

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[5vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[760px] max-w-[94vw] max-h-[86vh] glass rounded-md shadow-2xl rise flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line flex-none">
          <span className="font-display font-bold text-[14px]">BRANCH GRAPH</span>
          <span className="text-dim text-[11px]">every branch vs main — ahead / behind</span>
          <span className="flex-1" />
          <button className="btn" onClick={close}>close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {unavailable ? (
            <div className="text-faint text-[11px]">{unavailable}</div>
          ) : load.state === "loading" ? (
            <div className="text-faint text-[11px]">reading branches…</div>
          ) : (
            rows.map((r) => <Lane key={r.member.id} row={r} maxSpan={maxSpan} />)
          )}
        </div>
      </div>
    </div>
  );
}
