import { useEffect, useState } from "react";
import { create } from "zustand";
import { useApp } from "../store";
import { sessionTitle } from "../lib/sessionTitle";
import { TestBadge, runTestsFor, useTests } from "./Automations";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Ship queue: every session's branch at a glance — commits ahead, uncommitted
// files, tests — and one button to ship all the ready ones. Shipping sends
// /ship into each session (tests → commit → push → PR, installed by Grill Me);
// merging then happens from the PR dashboard.
// ---------------------------------------------------------------------------

interface Row { id: string; branch: string; base: string; ahead: number; dirty: number; onDefault: boolean }

export const useShipQueue = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export type Readiness = "ready" | "nothing" | "default-branch" | "tests-failing";

export function readiness(r: Row, testsOk: boolean | undefined): Readiness {
  if (r.onDefault) return "default-branch";
  if (r.ahead === 0 && r.dirty === 0) return "nothing";
  if (testsOk === false) return "tests-failing";
  return "ready";
}

const LABEL: Record<Readiness, string> = {
  ready: "ready to ship",
  nothing: "nothing to ship",
  "default-branch": "on main — can't ship",
  "tests-failing": "tests failing",
};

export function ShipQueue() {
  const open = useShipQueue((q) => q.open);
  const setOpen = useShipQueue((q) => q.setOpen);
  const members = useApp((s) => s.members);
  const teammates = useApp((s) => s.teammates);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const shipApproved = useApp((s) => s.shipApproved);
  const toast = useApp((s) => s.toast);
  const tests = useTests((t) => t.results);
  const [rows, setRows] = useState<Row[]>([]);
  const [shipping, setShipping] = useState(false);

  useEffect(() => {
    if (!open || !("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<Row[]>("ship_overview", { sessions: members.map((m) => [m.id, m.repoPath]) }).then(setRows).catch(() => setRows([])));
  }, [open, members]);

  if (!open) return null;
  const name = (id: string) => {
    const t = teammates.find((x) => x.id === id);
    return t ? sessionTitle(t, titles) : id;
  };
  const ready = rows.filter((r) => readiness(r, tests[r.id]?.ok) === "ready");

  const shipAll = async () => {
    setShipping(true);
    for (const r of ready) await shipApproved(r.id);
    setShipping(false);
    toast(`Sent /ship to ${ready.length} session${ready.length === 1 ? "" : "s"} — each runs tests, commits, pushes, and opens a PR`);
  };

  return (
    <div className="fixed inset-0 z-50 scrim flex items-center justify-center p-6" onClick={() => setOpen(false)}>
      <div className="composer-menu w-[720px] max-h-[80vh] rounded-2xl flex flex-col overflow-hidden rise" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label="Ship queue">
        <div className="flex items-center gap-2 px-5 h-14 border-b border-line flex-none">
          <Icon name="push" size={15} />
          <span className="text-[15px] font-semibold text-ink flex-1">Ship queue</span>
          <button className="w-7 h-7 rounded-md flex items-center justify-center text-faint hover:text-ink hover:bg-raised cursor-pointer" onClick={() => setOpen(false)}>
            <Icon name="cross" size={12} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
          {rows.length === 0 ? <p className="text-[12.5px] text-faint p-2">No sessions with a worktree yet.</p> : null}
          {rows.map((r) => {
            const state = readiness(r, tests[r.id]?.ok);
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
                <span className={`w-2 h-2 rounded-full flex-none ${state === "ready" ? "bg-ok" : state === "tests-failing" ? "bg-danger" : "bg-idle"}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-ink truncate">{name(r.id)}</span>
                  <span className="block text-[11.5px] text-faint font-mono truncate">
                    {r.branch} · {r.ahead} commit{r.ahead === 1 ? "" : "s"} ahead · {r.dirty} uncommitted
                  </span>
                </span>
                <TestBadge id={r.id} />
                <button className="composer-btn h-7 text-[11.5px]" title="Run this session's tests now" onClick={() => void runTestsFor(r.id, true)}>Test</button>
                <span className={`text-[11.5px] w-[130px] text-right ${state === "ready" ? "text-ok" : state === "tests-failing" ? "text-danger" : "text-faint"}`}>{LABEL[state]}</span>
                <button className="composer-btn h-7 text-[11.5px]" disabled={state !== "ready"} onClick={() => void shipApproved(r.id)}>Ship</button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 px-5 h-14 border-t border-line flex-none">
          <span className="text-[12px] text-faint flex-1">Ship = tests → commit → push → PR, inside each session. Merge from the PR dashboard.</span>
          <button className="composer-btn" onClick={() => { setOpen(false); useApp.setState({ prDashboardOpen: true }); }}>PR dashboard</button>
          <button className="composer-btn on" disabled={!ready.length || shipping} onClick={() => void shipAll()}>
            {shipping ? <span className="spinner" /> : <Icon name="push" size={12} />} Ship all ready ({ready.length})
          </button>
        </div>
      </div>
    </div>
  );
}
