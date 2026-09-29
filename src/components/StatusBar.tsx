import { useEffect, useState } from "react";
import { useApp, attentionSessions } from "../store";
import { tokenBudget, DEFAULT_TOKEN_BUDGET } from "../lib/dashboard";
import { AgentLogo } from "./AgentLogo";
import { GrillFlame } from "./GrillMark";
import { Icon } from "./Icon";
import { BridgeButton } from "./BridgePanel";

// ---------------------------------------------------------------------------
// Monocode-style bottom status bar for the center column, with the Grill Me
// extras: active agent + token budget meter, live session counts (click
// "need you" to jump to the first waiting session), the active branch, a
// hackathon countdown clock, and the Terminal toggle (⌘`).
// ---------------------------------------------------------------------------

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** "5h 12m" / "42m" / "time's up" for the hackathon clock */
export function clockLabel(msLeft: number): string {
  if (msLeft <= 0) return "time's up";
  const totalMin = Math.floor(msLeft / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

const CLOCK_PRESETS = [6, 12, 24, 36, 48];

function HackClock() {
  const endsAt = useApp((s) => s.appSettings.hackathonEndsAt as number | undefined);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // minute resolution is enough — a per-second tick is a repaint per second
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [endsAt]);

  const left = endsAt ? endsAt - now : 0;
  const urgent = !!endsAt && left < 2 * 3_600_000;

  return (
    <span className="relative">
      <button
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md cursor-pointer transition-colors hover:bg-raised ${
          endsAt ? (urgent ? "text-warn" : "text-ink") : "text-faint hover:text-dim"
        }`}
        title={endsAt ? `Hackathon ends ${new Date(endsAt).toLocaleString()}` : "Start a hackathon countdown"}
        onClick={() => setOpen(!open)}
      >
        <GrillFlame px={1.25} dim={!endsAt} />
        {endsAt ? <span className="num">{clockLabel(left)} left</span> : "Hack clock"}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="composer-menu absolute bottom-8 right-0 z-40 w-[220px] rounded-xl p-2 rise">
            <div className="px-1.5 pb-2 text-[10.5px] tracking-[0.12em] text-faint uppercase">Hackathon ends in</div>
            <div className="grid grid-cols-5 gap-1">
              {CLOCK_PRESETS.map((h) => (
                <button key={h} className="composer-btn justify-center px-0 h-7 text-[11.5px]"
                  onClick={() => { setAppSetting("hackathonEndsAt", Date.now() + h * 3_600_000); setNow(Date.now()); setOpen(false); }}>
                  {h}h
                </button>
              ))}
            </div>
            {endsAt ? (
              <button className="w-full mt-2 text-[11.5px] text-faint hover:text-ink cursor-pointer py-1"
                onClick={() => { setAppSetting("hackathonEndsAt", undefined); setOpen(false); }}>
                Stop clock
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </span>
  );
}

export function StatusBar() {
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const activeId = useApp((s) => s.activeId);
  const setActive = useApp((s) => s.setActive);
  const capSetting = useApp((s) => s.appSettings.tokenBudget);
  const bottomTermOpen = useApp((s) => s.bottomTermOpen);
  const toggleBottomTerm = useApp((s) => s.toggleBottomTerm);

  const cap = typeof capSetting === "number" ? capSetting : DEFAULT_TOKEN_BUDGET;
  const budget = tokenBudget(teammates, cap);
  const pct = Math.min(100, Math.round(budget.ratio * 100));
  const agent = members.find((m) => m.id === activeId)?.agent ?? "claude";
  const active = teammates.find((t) => t.id === activeId);
  const working = teammates.filter((t) => t.status === "working").length;
  const waiting = attentionSessions(teammates);

  return (
    <div className="h-8 flex-none flex items-center gap-2.5 px-3 border-t border-line text-[11.5px] text-dim demo-hide">
      <AgentLogo agent={agent} size={13} />
      <span className="meter w-12" title={`Today's tokens vs your soft budget (${compact(cap)})`}>
        <div className={pct >= 100 ? "hot" : ""} style={{ width: `${pct}%`, background: pct >= 80 ? undefined : "var(--dim)" }} />
      </span>
      <span className="num" title={`${compact(budget.spent)} tokens today`}>{pct}%</span>

      <span className="w-px h-3.5 bg-line" />
      <span className="flex items-center gap-1.5" title="Sessions producing output right now">
        <span className="status-dot working" style={{ width: 6, height: 6 }} /> <span className="num">{working}</span> working
      </span>
      {waiting.length ? (
        <button className="flex items-center gap-1.5 text-warn hover:underline cursor-pointer"
          title={`Jump to ${waiting[0].name}`}
          onClick={() => setActive(waiting[0].id)}>
          <span className="status-dot needs-input" style={{ width: 6, height: 6 }} /> <span className="num">{waiting.length}</span> need you
        </button>
      ) : null}

      {active ? (
        <>
          <span className="w-px h-3.5 bg-line" />
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] truncate min-w-0" title={`${active.name} · ${active.branch}`}>
            <Icon name="branch" size={11} /> <span className="truncate">{active.branch}</span>
            {active.changes.length ? <span className="text-faint num">±{active.changes.length}</span> : null}
          </span>
        </>
      ) : null}

      <span className="flex-1" />
      <BridgeButton />
      <HackClock />
      <button
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
          bottomTermOpen ? "text-ink bg-raised" : "hover:text-ink hover:bg-raised"
        }`}
        title="Toggle terminal (⌘`)"
        onClick={toggleBottomTerm}
      >
        <Icon name="terminal" size={12} /> Terminal
      </button>
    </div>
  );
}
