import { useApp } from "../store";
import { tokenBudget, DEFAULT_TOKEN_BUDGET } from "../lib/dashboard";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Monocode-style bottom status bar for the center column: active agent mark,
// today's token spend vs the soft budget as a thin meter, and a Terminal
// toggle (⌘`) on the right.
// ---------------------------------------------------------------------------

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function StatusBar() {
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const activeId = useApp((s) => s.activeId);
  const capSetting = useApp((s) => s.appSettings.tokenBudget);
  const bottomTermOpen = useApp((s) => s.bottomTermOpen);
  const toggleBottomTerm = useApp((s) => s.toggleBottomTerm);

  const cap = typeof capSetting === "number" ? capSetting : DEFAULT_TOKEN_BUDGET;
  const budget = tokenBudget(teammates, cap);
  const pct = Math.min(100, Math.round(budget.ratio * 100));
  const agent = members.find((m) => m.id === activeId)?.agent ?? "claude";

  return (
    <div className="h-8 flex-none flex items-center gap-2.5 px-3 border-t border-line text-[11.5px] text-dim demo-hide">
      <AgentLogo agent={agent} size={13} />
      <span className="meter w-12" title={`Today's tokens vs your soft budget (${compact(cap)})`}>
        <div className={pct >= 100 ? "hot" : ""} style={{ width: `${pct}%`, background: pct >= 80 ? undefined : "var(--dim)" }} />
      </span>
      <span className="num">{pct}%</span>
      <span className="text-faint num">· {compact(budget.spent)} tokens today</span>
      <span className="flex-1" />
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
