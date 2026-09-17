import type { Teammate } from "../types";

// ---------------------------------------------------------------------------
// Token cost estimate — pure math over the real per-session token tallies the
// usage feed writes (input/output/cacheRead, from Claude Code's own
// transcripts). This is an ESTIMATE, never a bill: local rate constants
// multiplied by real token counts. Kept React/Tauri-free so it's unit-testable
// and the dashboard widget stays dumb.
// ---------------------------------------------------------------------------

export interface TokenRates {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-read tokens. */
  cacheRead: number;
}

/** Public list pricing for Claude Sonnet (USD per 1M tokens) — a reasonable
 *  default for the estimate. Overridable via appSettings.tokenRates when a team
 *  runs a different model or plan. This drives a local estimate only. */
export const DEFAULT_TOKEN_RATES: TokenRates = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
};

/** Coerce a possibly-partial appSettings override into full rates, keeping
 *  defaults for any field that isn't a finite non-negative number. */
export function resolveRates(override: unknown): TokenRates {
  if (!override || typeof override !== "object") return DEFAULT_TOKEN_RATES;
  const o = override as Record<string, unknown>;
  const pick = (k: keyof TokenRates) =>
    typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= 0
      ? (o[k] as number)
      : DEFAULT_TOKEN_RATES[k];
  return { input: pick("input"), output: pick("output"), cacheRead: pick("cacheRead") };
}

/** Estimated USD for a token tally at the given rates. */
export function estimateCost(
  tokens: { input: number; output: number; cacheRead: number },
  rates: TokenRates = DEFAULT_TOKEN_RATES,
): number {
  return (
    (tokens.input / 1_000_000) * rates.input +
    (tokens.output / 1_000_000) * rates.output +
    (tokens.cacheRead / 1_000_000) * rates.cacheRead
  );
}

export interface SessionSpend {
  id: string;
  name: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  turns: number;
  /** input + output — what counts as spend (cache reads are near-free). */
  total: number;
  /** estimated USD across input + output + cacheRead. */
  cost: number;
}

/**
 * Per-session rollup for sessions that carry a real transcript tally, sorted
 * biggest-spender first. Sessions without tokens (or all-zero) are omitted
 * rather than shown as a fake zero, so the dashboard only ever renders real
 * data.
 */
export function sessionSpends(
  teammates: Teammate[],
  rates: TokenRates = DEFAULT_TOKEN_RATES,
): SessionSpend[] {
  const out: SessionSpend[] = [];
  for (const t of teammates) {
    const tk = t.usage.tokens;
    if (!tk) continue;
    const total = tk.input + tk.output;
    if (total <= 0) continue;
    out.push({
      id: t.id,
      name: t.name,
      model: t.usage.model,
      input: tk.input,
      output: tk.output,
      cacheRead: tk.cacheRead,
      turns: tk.turns,
      total,
      cost: estimateCost(tk, rates),
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Total estimated USD across all sessions with real tallies. */
export function totalCost(
  teammates: Teammate[],
  rates: TokenRates = DEFAULT_TOKEN_RATES,
): number {
  return sessionSpends(teammates, rates).reduce((s, x) => s + x.cost, 0);
}
