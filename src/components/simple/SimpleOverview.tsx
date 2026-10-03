import { useMemo, useState } from "react";
import { useApp, isSolo } from "../../store";
import { Icon } from "../Icon";
import { HomeDashboard } from "../HomeDashboard";
import { sessionTitle } from "../../lib/sessionTitle";
import { headline, sessionSentence, type Sentence } from "../../lib/sessionSentence";
import { money, sessionStats } from "../../lib/coach";
import { useTests } from "../../lib/testsStore";
import type { Teammate } from "../../types";
import { visibleSessions } from "../../lib/sessionNav";

// ---------------------------------------------------------------------------
// The simple layout's Overview: one headline that says what to do next, your
// sessions in plain sentences (what needs you first), and three numbers for
// today. Everything else (activity, merges, budget, radar) is one click away
// in the full dashboard.
// ---------------------------------------------------------------------------

const RANK: Record<Sentence["tone"], number> = { needs: 0, stopped: 1, working: 2, done: 3, quiet: 4 };
const TONE: Record<Sentence["tone"], string> = { needs: "text-warn", stopped: "text-danger", working: "text-dim", done: "text-ok", quiet: "text-faint" };

function Num({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised/30 px-4 py-3">
      <div className="num text-[22px] text-ink leading-tight">{value}</div>
      <div className="text-[11.5px] text-faint mt-0.5">{label}</div>
    </div>
  );
}

export function SimpleOverview() {
  const [full, setFull] = useState(false);
  const all = useApp((s) => s.teammates);
  const appMode = useApp((s) => s.appMode);
  const memberIds = useApp((s) => s.members.map((m) => m.id).join(","));
  // the same sessions the sidebar lists (solo: only yours)
  const teammates = useMemo(() => visibleSessions(all, appMode, memberIds ? memberIds.split(",") : []), [all, appMode, memberIds]);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const setActive = useApp((s) => s.setActive);
  const setView = useApp((s) => s.setView);
  const solo = useApp((s) => isSolo(s));
  const selfId = useApp((s) => s.roomSelf?.memberId);
  const team = useApp((s) => s.teamSessions);
  const tests = useTests((t) => t.results);

  const rows = useMemo(() => teammates
    .map((t: Teammate) => ({ t, said: sessionSentence(t, tests[t.id] && !tests[t.id].running ? tests[t.id].ok : null), st: sessionStats(t) }))
    .sort((a, b) => RANK[a.said.tone] - RANK[b.said.tone]), [teammates, tests]);
  const spent = rows.reduce((n, r) => n + (r.st?.cost ?? 0), 0);
  const turns = rows.reduce((n, r) => n + (r.st?.turns ?? 0), 0);
  const files = rows.reduce((n, r) => n + r.t.changes.length, 0);
  const others = solo ? [] : team.filter((d) => d.member !== selfId);

  if (full) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <button className="flex-none flex items-center gap-1.5 h-8 px-4 text-[12px] text-dim hover:text-ink border-b border-line cursor-pointer" onClick={() => setFull(false)}>
          ← Simple overview
        </button>
        <HomeDashboard />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-6 py-8 flex flex-col gap-7">
        <div className="flex items-center gap-3">
          <h1 className="text-[19px] font-medium text-ink flex-1">{headline(rows)}</h1>
          <button className="composer-btn" onClick={() => setView("new")}><Icon name="plus" size={12} /> New session</button>
        </div>

        {rows.length ? (
          <section className="flex flex-col gap-1.5" aria-label="Your sessions">
            {rows.map(({ t, said, st }) => (
              <button key={t.id} className="flex items-center gap-3 rounded-xl border border-line bg-raised/20 hover:bg-raised/50 px-4 py-3 text-left cursor-pointer transition-colors"
                onClick={() => setActive(t.id)}>
                <span className={`status-dot ${t.status} flex-none`} aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] text-ink truncate">{sessionTitle(t, titles)}</span>
                  <span className={`block text-[12px] truncate ${TONE[said.tone]}`}>{said.text}</span>
                </span>
                {st ? <span className="num text-[12px] text-faint flex-none" title="Estimated spend">{money(st.cost)}</span> : null}
                <Icon name="chevron" size={10} className="text-faint flex-none" />
              </button>
            ))}
          </section>
        ) : null}

        <section aria-label="Today">
          <div className="text-[11px] tracking-[0.12em] uppercase text-faint font-semibold mb-2">So far</div>
          <div className="grid grid-cols-3 gap-2">
            <Num value={spent > 0 ? money(spent) : "$0"} label="spent (estimate)" />
            <Num value={String(turns)} label={turns === 1 ? "message" : "messages"} />
            <Num value={String(files)} label={files === 1 ? "file changed" : "files changed"} />
          </div>
        </section>

        {others.length ? (
          <section aria-label="Teammates">
            <div className="text-[11px] tracking-[0.12em] uppercase text-faint font-semibold mb-2">Teammates</div>
            <div className="flex flex-col gap-1">
              {others.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-1 py-1.5 text-[12.5px]">
                  <span className={`status-dot ${d.status} flex-none`} aria-hidden />
                  <span className="text-ink">{d.memberName}</span>
                  <span className="text-faint truncate">{d.sentence || d.title}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <button className="self-start text-[12px] text-faint hover:text-ink cursor-pointer" onClick={() => setFull(true)}>
          Show the full dashboard (activity, merges, budget) →
        </button>
      </div>
    </div>
  );
}
