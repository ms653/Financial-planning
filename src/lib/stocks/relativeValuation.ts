/**
 * Relative valuation, quality/profitability, and balance-sheet-health — Phase 4
 * Milestone 3. Unlike the DCF, none of this needs a household-entered assumption:
 * every figure here is a ratio FMP already computes (`/stable/ratios`,
 * `/stable/key-metrics`) for the ticker itself and, for relative valuation, its peers
 * (`/stable/stock-peers`) — see `fmp.ts`'s own doc comment for the live-verified field
 * names and per-ticker coverage gaps this reads around.
 *
 * **A third disclosed, narrow exception to "money/rates never touch a float"** — same
 * category as `dcf.ts`'s suggestion functions and base-input mapper. Every value here
 * is a display-only ratio or percentage FMP already computed; nothing here flows into
 * `computeDcf`'s own bigint math or any stored money value.
 */
import type { FmpStatementPeriod } from './fmp';

/** Reads a named field off the most recent (index 0, newest-first) period, returning
 * `null` for anything missing or non-finite rather than `undefined` or `NaN` — every
 * field here is independently optional, so one missing figure never blanks out the
 * others. */
function latestNumber(periods: readonly FmpStatementPeriod[], field: string): number | null {
  const value = periods[0]?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface QualityMetrics {
  grossMargin: number | null;
  netMargin: number | null;
  returnOnEquity: number | null;
  returnOnInvestedCapital: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  freeCashFlowYield: number | null;
}

/**
 * The quality/profitability and balance-sheet-health screens, combined — PROPOSAL.md
 * names them as two bullet points but they draw from the same two endpoints and the
 * same most-recent-period read, so one function derives both rather than two near
 * -identical ones. Each field is independently `null` when its source figure is
 * missing or non-finite — a ticker with `ratios` but not `keyMetrics` (or vice versa)
 * still gets partial results, not nothing.
 */
export function deriveQualityMetrics(
  ratios: readonly FmpStatementPeriod[],
  keyMetrics: readonly FmpStatementPeriod[],
): QualityMetrics {
  return {
    grossMargin: latestNumber(ratios, 'grossProfitMargin'),
    netMargin: latestNumber(ratios, 'netProfitMargin'),
    returnOnEquity: latestNumber(keyMetrics, 'returnOnEquity'),
    returnOnInvestedCapital: latestNumber(keyMetrics, 'returnOnInvestedCapital'),
    debtToEquity: latestNumber(ratios, 'debtToEquityRatio'),
    currentRatio: latestNumber(ratios, 'currentRatio'),
    freeCashFlowYield: latestNumber(keyMetrics, 'freeCashFlowYield'),
  };
}

export interface ValuationMultiples {
  peRatio: number | null;
  evToEbitda: number | null;
}

function extractMultiples(
  ratios: readonly FmpStatementPeriod[],
  keyMetrics: readonly FmpStatementPeriod[],
): ValuationMultiples {
  return {
    peRatio: latestNumber(ratios, 'priceToEarningsRatio'),
    evToEbitda: latestNumber(keyMetrics, 'evToEBITDA'),
  };
}

/** Excludes non-positive values, not just `null` ones — a negative P/E or EV/EBITDA
 * (a loss-making peer, seen live for real tickers like SONY per `fmp.ts`'s own doc
 * comment) is unrankable on that metric, not a genuine data point to blend in. A real
 * bug, found by independent review: one loss-making peer at -50x averaged against a
 * healthy peer at 20x previously gave "-15.0x", reading as "far cheaper than peers"
 * when the honest comparison is "one peer can't be compared on this metric, the other
 * trades at 20x." Displaying a single loss-making peer's own negative multiple as-is
 * (not filtered) is unaffected — this only changes what feeds the *average*. */
function averagePositive(values: readonly (number | null)[]): number | null {
  const usable = values.filter((v): v is number => v !== null && v > 0);
  if (usable.length === 0) return null;
  return usable.reduce((sum, v) => sum + v, 0) / usable.length;
}

export interface PeerMultiples extends ValuationMultiples {
  ticker: string;
  companyName: string;
}

export interface PeerComparison {
  primary: ValuationMultiples;
  /** One entry per peer FMP returned — including a peer with no usable
   * `ratios`/`keyMetrics` (both fields `null`), so the household can see *which*
   * peers had no data available rather than silently dropping them. */
  peers: PeerMultiples[];
  /** Averaged over only the peers with a positive value for that metric — a
   * loss-making peer's negative multiple is excluded from the average (not
   * comparable, not a valid data point to blend in) while still shown as-is on that
   * peer's own row. `null`, not `NaN`, when zero peers qualify. */
  peerAveragePeRatio: number | null;
  peerAverageEvToEbitda: number | null;
}

/**
 * Builds the relative-valuation comparison: the primary ticker's own P/E and
 * EV/EBITDA, alongside each peer's, plus a peer average per metric. Peers are FMP's
 * own algorithmic determination (`fmp.ts`'s `peers` field) — not hand-picked, and not
 * filtered for "genuinely comparable" here; that judgment is left to whoever reads
 * the result, same posture as the DCF explainer's "treat this as one input, not a
 * verdict."
 */
export function derivePeerComparison(
  primary: { ratios: readonly FmpStatementPeriod[]; keyMetrics: readonly FmpStatementPeriod[] },
  peers: readonly {
    ticker: string;
    companyName: string;
    ratios: readonly FmpStatementPeriod[];
    keyMetrics: readonly FmpStatementPeriod[];
  }[],
): PeerComparison {
  const peerMultiples = peers.map((peer) => ({
    ticker: peer.ticker,
    companyName: peer.companyName,
    ...extractMultiples(peer.ratios, peer.keyMetrics),
  }));

  return {
    primary: extractMultiples(primary.ratios, primary.keyMetrics),
    peers: peerMultiples,
    peerAveragePeRatio: averagePositive(peerMultiples.map((p) => p.peRatio)),
    peerAverageEvToEbitda: averagePositive(peerMultiples.map((p) => p.evToEbitda)),
  };
}
