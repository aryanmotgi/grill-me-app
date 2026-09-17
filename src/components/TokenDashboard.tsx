import { useMemo } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { TickNumber } from "./TickNumber";
import { Icon } from "./Icon";
import { fmtTokens, fmtUsd } from "../lib/format";
import {
  resolveRates,
  sessionSpends,
  totalCost,
  type SessionSpend,
} from "../lib/cost";

/** Shorten a model id for a tag: "claude-sonnet-4-5-20250514" → "sonnet-4-5". */
function shortModel(model: string): string {
  if (!model || model === "—") return "—";
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-latest$/, "");
}

function SpendRow({ row, maxTotal }: { row: SessionSpend; maxTotal: number }) {
  const pct = maxTotal > 0 ? (row.total / maxTotal) * 100 : 0;
  const inPct = row.total > 0 ? (row.input / row.total) * 100 : 0;
  const outPct = row.total > 0 ? (row.output / row.total) * 100 : 0;
  return (
    <div className="py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-semibold truncate">{row.name}</span>
        <span className="tag" title={row.model}>{shortModel(row.model)}</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] num text-data" title="input + output tokens this session">
          {fmtTokens(row.total)}
        </span>
        <span className="font-mono text-[10px] num text-faint" title="estimated cost — input + output + cache reads">
          {fmtUsd(row.cost)}
        </span>
      </div>
      {/* burn bar: length ∝ this session's share of the busiest session;
          split cyan input (dim) vs output (lit) — real token composition */}
      <div className="mt-1.5 h-2 rounded-full bg-line/30 overflow-hidden" title={`${fmtTokens(row.input)} in · ${fmtTokens(row.output)} out`}>
        <div className="h-full flex rounded-full overflow-hidden transition-all" style={{ width: `${pct}%` }}>
          <div className="h-full bg-data/45" style={{ width: `${inPct}%` }} />
          <div className="h-full bg-data" style={{ width: `${outPct}%` }} />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-3 text-faint text-[10px] num">
        <span title="input tokens">in {fmtTokens(row.input)}</span>
        <span title="output tokens">out {fmtTokens(row.output)}</span>
        <span title="cache-read tokens (near-free, excluded from spend)">cache {fmtTokens(row.cacheRead)}</span>
        <span title="assistant turns">{row.turns} turn{row.turns === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

/** Token & cost dashboard: per-session token totals, a burn chart, the biggest
 *  spender, and an estimated $ from configurable local rates. All figures come
 *  from the real usage feed (Claude Code transcripts); empty until it reports. */
export function TokenDashboard() {
  const open = useApp((s) => s.tokenDashOpen);
  const teammates = useApp((s) => s.teammates);
  const rateOverride = useApp((s) => s.appSettings.tokenRates);
  const modalA11y = useModalA11y("Token and cost dashboard", open);

  const rates = useMemo(() => resolveRates(rateOverride), [rateOverride]);
  const rows = useMemo(() => sessionSpends(teammates, rates), [teammates, rates]);
  const cost = useMemo(() => totalCost(teammates, rates), [teammates, rates]);

  if (!open) return null;
  const close = () => useApp.setState({ tokenDashOpen: false });

  const totalTokens = rows.reduce((s, r) => s + r.total, 0);
  const totalTurns = rows.reduce((s, r) => s + r.turns, 0);
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));
  const top = rows[0] ?? null;

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[6vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[720px] max-w-[94vw] max-h-[86vh] overflow-y-auto glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">TOKEN &amp; COST</span>
          <span className="text-faint text-[10px]">real tallies from each session&apos;s transcript</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        {rows.length === 0 ? (
          <div className="glass rounded-md px-5 py-8 text-center">
            <div className="flex justify-center mb-2 text-faint"><Icon name="broadcast" size={20} /></div>
            <div className="text-[12px] text-dim">No token usage yet.</div>
            <div className="text-[10px] text-faint mt-1 leading-relaxed">
              Once a session runs Claude Code, its input/output token counts appear
              here — per session, with a burn chart and an estimated cost.
            </div>
          </div>
        ) : (
          <>
            {/* summary band — team totals. Tokens are readouts → cyan .num. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
              <div className="glass rounded-md px-3 py-3">
                <span className="block text-[22px] font-display font-bold text-data num">{fmtTokens(totalTokens)}</span>
                <div className="text-faint text-[10px] mt-0.5">tokens in + out</div>
              </div>
              <div className="glass rounded-md px-3 py-3">
                <span className="block text-[22px] font-display font-bold text-data num">{fmtUsd(cost)}</span>
                <div className="text-faint text-[10px] mt-0.5">estimated cost</div>
              </div>
              <div className="glass rounded-md px-3 py-3">
                <TickNumber value={totalTurns} className="block text-[22px] font-display font-bold text-data" />
                <div className="text-faint text-[10px] mt-0.5">assistant turns</div>
              </div>
              <div className="glass rounded-md px-3 py-3">
                <TickNumber value={rows.length} className="block text-[22px] font-display font-bold text-data" />
                <div className="text-faint text-[10px] mt-0.5">active session{rows.length === 1 ? "" : "s"}</div>
              </div>
            </div>

            {/* biggest spender callout */}
            {top ? (
              <div className="glass rounded-md px-4 py-3 mb-5 flex items-center gap-3 border-l-2 border-l-data">
                <Icon name="broadcast" size={14} className="text-data" />
                <span className="text-[12px]">
                  biggest spender: <b>{top.name}</b>
                </span>
                <span className="ml-auto font-mono text-[11px] num text-data">{fmtTokens(top.total)}</span>
                <span className="font-mono text-[10px] num text-faint">{fmtUsd(top.cost)}</span>
              </div>
            ) : null}

            {/* burn chart / per-session rollup */}
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="panel-label">token burn by session</span>
              <span className="flex items-center gap-2.5 text-faint text-[9px]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-data/45 inline-block" />input</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-data inline-block" />output</span>
              </span>
            </div>
            <div className="glass rounded-md px-4 divide-y divide-line/50">
              {rows.map((r) => (
                <SpendRow key={r.id} row={r} maxTotal={maxTotal} />
              ))}
            </div>

            {/* estimate disclaimer — clearly not a bill */}
            <div className="text-faint text-[10px] mt-3 leading-relaxed num">
              Cost is an estimate: real token counts × local rates
              (${rates.input}/M in · ${rates.output}/M out · ${rates.cacheRead}/M cache read).
              Override with the <span className="font-mono">tokenRates</span> app setting.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
