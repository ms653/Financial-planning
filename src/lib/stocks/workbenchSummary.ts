/**
 * Phase 4 Milestone 5 — extracted from `src/app/stocks/[ticker]/page.tsx`'s own inline
 * DCF-result/checklist computation (Milestones 2 and 4) so the watchlist page
 * (`src/app/stocks/page.tsx`) can show the same signals without duplicating the logic.
 * Pure: takes already-fetched fundamentals/quote/assumptions, computes nothing itself
 * from the network or the database.
 */
import { parseScaledDecimal, roundDiv, PRICE_SCALE } from '@/lib/portfolio/valuation';
import { buildFundamentalsChecklist, type ChecklistItem } from './checklist';
import { computeDcf, deriveDcfBaseInputs, type DcfInputsV1, type DcfResult } from './dcf';
import type { FmpStatements } from './fmp';

/** A quote's price string is `NUMERIC(14,4)` (pounds/dollars, `PRICE_SCALE`) — a
 * different scale from `formatMoney`'s pence convention. Converts without ever
 * touching a float, reusing `valuation.ts`'s existing fixed-point primitives (the same
 * `roundDiv`/`parseScaledDecimal` pair `dcf.ts`'s own math is built from). */
export function priceStringToPence(price: string): bigint {
  const priceScaled = parseScaledDecimal(price, PRICE_SCALE);
  return roundDiv(priceScaled, 10n ** BigInt(PRICE_SCALE - 2));
}

export interface WorkbenchSummary {
  marketPricePence: bigint | null;
  dcfResult: DcfResult | null;
  /** e.g. "12.3% below intrinsic value" — `null` whenever either side of the
   * comparison is unavailable. */
  deltaLine: string | null;
  checklist: ChecklistItem[] | null;
  checklistCounts: Record<ChecklistItem['status'], number> | null;
  /** True when the fundamentals or quote behind this summary are a fallback to the
   * last successfully-fetched value, not a fresh one (`FundamentalsView.stale`/
   * `QuoteView.stale`) — passed straight through, not computed here, since this
   * function only ever sees the already-unwrapped `statements`/`quotePrice`, not the
   * views those came from. Exists so the watchlist page (which only has this summary
   * object in scope per row, not the raw fundamentals/quote maps) can still show a
   * per-row "may be out of date" indicator. */
  stale: boolean;
  /** The currency the statement figures (and so `dcfResult`) are reported in, when
   * known — `null` when unknown, which is treated as "assume USD" the same as every
   * quote in this codebase already is (see `deriveDcfBaseInputs`'s own doc comment).
   * Non-null and not `"USD"` means `deltaLine` was deliberately left `null` below: a
   * quote (always USD here) can't be honestly compared against an intrinsic value
   * computed from a different currency's statements without a conversion this module
   * doesn't do. */
  statementsCurrency: string | null;
}

/**
 * `statements`/`quotePrice` are `null` whenever the corresponding provider key isn't
 * configured or the ticker isn't covered — every field on the result degrades to
 * `null` independently rather than the whole thing failing, the same posture every
 * other derivation in this module (`relativeValuation.ts`, `checklist.ts`) already
 * takes.
 */
export function buildWorkbenchSummary(
  statements: FmpStatements | null,
  quotePrice: string | null,
  dcfInputs: DcfInputsV1,
  stale = false,
): WorkbenchSummary {
  const marketPricePence = quotePrice ? priceStringToPence(quotePrice) : null;

  const baseInputs = statements ? deriveDcfBaseInputs(statements) : null;
  const dcfResult = baseInputs
    ? computeDcf(dcfInputs, baseInputs.baseFcfPence, baseInputs.netDebtPence, baseInputs.dilutedShares)
    : null;

  const statementsCurrency = baseInputs?.reportedCurrency ?? null;
  // The one quote source this codebase has is always fetched/stored as USD (see
  // `[ticker]/page.tsx`'s hardcoded `currency: 'USD'`) — comparing it against an
  // intrinsic value derived from non-USD statements (a real risk for a US-listed ADR
  // filing in its home currency, per `deriveDcfBaseInputs`'s own doc comment) would be
  // comparing two different currencies as if they were the same, off by whatever the
  // exchange rate is. `null` (currency unknown) is treated as USD, same as everywhere
  // else in this codebase defaults to when a currency isn't explicitly known otherwise.
  const currencyMismatch = statementsCurrency !== null && statementsCurrency !== 'USD';

  let deltaLine: string | null = null;
  if (
    !currencyMismatch &&
    dcfResult?.intrinsicValuePerSharePence != null &&
    dcfResult.intrinsicValuePerSharePence > 0n &&
    marketPricePence !== null &&
    marketPricePence > 0n
  ) {
    // Denominator is *intrinsic* value, matching the label ("X% below/above intrinsic
    // value") — dividing by market price instead was a real bug (found by independent
    // review): e.g. intrinsic £200 vs market £100 read "100.0% below intrinsic value",
    // which is nonsensical (nothing can be 100% below a positive number and still be
    // positive); the correct figure is 50.0% below.
    const deltaPct =
      (Number(dcfResult.intrinsicValuePerSharePence - marketPricePence) /
        Number(dcfResult.intrinsicValuePerSharePence)) *
      100;
    deltaLine =
      deltaPct >= 0
        ? `${deltaPct.toFixed(1)}% below intrinsic value`
        : `${Math.abs(deltaPct).toFixed(1)}% above intrinsic value`;
  }

  const checklist = statements ? buildFundamentalsChecklist(statements) : null;
  const checklistCounts = checklist?.reduce(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { pass: 0, warn: 0, fail: 0, unknown: 0 },
  ) ?? null;

  return { marketPricePence, dcfResult, deltaLine, checklist, checklistCounts, stale, statementsCurrency };
}
