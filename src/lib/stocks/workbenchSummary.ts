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
): WorkbenchSummary {
  const marketPricePence = quotePrice ? priceStringToPence(quotePrice) : null;

  const baseInputs = statements ? deriveDcfBaseInputs(statements) : null;
  const dcfResult = baseInputs
    ? computeDcf(dcfInputs, baseInputs.baseFcfPence, baseInputs.netDebtPence, baseInputs.dilutedShares)
    : null;

  let deltaLine: string | null = null;
  if (dcfResult?.intrinsicValuePerSharePence != null && marketPricePence !== null && marketPricePence > 0n) {
    const deltaPct =
      (Number(dcfResult.intrinsicValuePerSharePence - marketPricePence) / Number(marketPricePence)) * 100;
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

  return { marketPricePence, dcfResult, deltaLine, checklist, checklistCounts };
}
