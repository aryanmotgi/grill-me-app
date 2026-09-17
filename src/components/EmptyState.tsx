import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * The one shared empty/quiet-state primitive. Every async or quiet surface
 * (inbox, activity timeline, session list, overlays) uses this so "nothing
 * here yet" reads the same everywhere: a faint icon, a plain-language title of
 * what belongs here, one line of what to do next, and an optional ghost
 * action. Tokens only, no hardcoded color; transparent so it sits over glass
 * or the layered ground unchanged. Not a shouting box — quiet by design.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
}: {
  icon: string;
  title: string;
  hint?: string;
  action?: ReactNode;
  /** Tighter padding for inline column/list slots vs. full overlay bodies. */
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center text-center ${compact ? "py-6 px-3 gap-1.5" : "py-12 px-4 gap-2"}`}
    >
      <span className="text-faint/70" aria-hidden>
        <Icon name={icon} size={compact ? 18 : 22} />
      </span>
      <div className="text-dim text-[12px] font-medium">{title}</div>
      {hint ? (
        <div className="text-faint text-[11px] leading-relaxed max-w-[40ch]">{hint}</div>
      ) : null}
      {action ? <div className="mt-1.5 flex items-center gap-1.5">{action}</div> : null}
    </div>
  );
}
