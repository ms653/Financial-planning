/**
 * Fixed-point decimal arithmetic for portfolio valuation.
 *
 * Mirrors src/lib/money.ts's "never touch a float" discipline, but at the precision
 * holdings actually need: `holding.quantity` is NUMERIC(18,6) (fractional shares) and
 * `quote_cache.price` is NUMERIC(14,4) (sub-penny precision) — money.ts's 2dp pence
 * helpers would round both away before the multiplication even happens, which is exactly
 * the kind of compounding error PROPOSAL.md warns a Monte Carlo engine could hide.
 */

/** Matches `holding.quantity`'s NUMERIC(18,6) column. */
const QUANTITY_SCALE = 6;
/** Matches `quote_cache.price`'s NUMERIC(14,4) column. */
export const PRICE_SCALE = 4;

/**
 * Parse a plain decimal string into an integer scaled by `10^scale`.
 *
 * Throws on garbage or on more fractional digits than `scale` allows — never silently
 * rounds, the same discipline as `parseMoneyInput`'s `too-many-decimals` rejection.
 */
export function parseScaledDecimal(raw: string, scale: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!match) throw new Error(`Not a decimal value: ${JSON.stringify(raw)}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > scale) {
    throw new Error(`Too many decimal places for scale ${scale}: ${JSON.stringify(raw)}`);
  }
  const scaledFraction = fraction.padEnd(scale, '0');
  const magnitude = BigInt(whole ?? '0') * 10n ** BigInt(scale) + BigInt(scaledFraction || '0');
  return sign === '-' ? -magnitude : magnitude;
}

/** Render a `10^scale`-scaled integer back to a plain decimal string. */
export function formatScaledDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = magnitude / divisor;
  const fraction = magnitude % divisor;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(scale, '0')}`;
}

/** Round-half-up integer division, signed. Used wherever a fixed-point product has to
 * land back on a coarser scale (e.g. sub-penny price × fractional shares → whole pence).
 * Exported (not module-private) so other fixed-point domains — e.g.
 * `src/lib/retirement/engineTypes.ts`'s rate-scale conversions — reuse this rather than
 * each defining their own copy. */
export function roundDiv(numerator: bigint, divisor: bigint): bigint {
  const negative = numerator < 0n !== divisor < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDivisor = divisor < 0n ? -divisor : divisor;
  const result = (absNumerator + absDivisor / 2n) / absDivisor;
  return negative ? -result : result;
}

/**
 * Current value of a holding, in integer pence.
 *
 * `quantity` (scaled by 10^6) × `price` (scaled by 10^4) gives a product scaled by 10^10
 * pounds-units; pence is pounds×100, so the product is divided by 10^8 to land on whole
 * pence, rounding half up rather than truncating.
 */
export function currentValuePence(quantity: string, price: string): bigint {
  const quantityScaled = parseScaledDecimal(quantity, QUANTITY_SCALE);
  const priceScaled = parseScaledDecimal(price, PRICE_SCALE);
  const product = quantityScaled * priceScaled;
  const divisor = 10n ** BigInt(QUANTITY_SCALE + PRICE_SCALE - 2);
  return roundDiv(product, divisor);
}

export interface GainLoss {
  amountPence: bigint;
  /** Percent vs. cost basis, 2dp, e.g. '12.34' or '-4.50'. Null when cost basis is zero
   * (nothing to divide by — not the same as a 0% gain). */
  percent: string | null;
  direction: 'up' | 'down' | 'flat';
}

/** Gain/loss **vs. cost basis** — not a benchmark-relative return. `holding.costBasis`
 * carries no acquisition date, so a true time-weighted return vs. an index isn't
 * computable from the current schema; conflating the two would misrepresent performance. */
export function gainLoss(costBasisPence: bigint, valuePence: bigint): GainLoss {
  const amountPence = valuePence - costBasisPence;
  const direction = amountPence > 0n ? 'up' : amountPence < 0n ? 'down' : 'flat';
  if (costBasisPence === 0n) return { amountPence, percent: null, direction };

  const percentScale = 2;
  const scaledNumerator = amountPence * 100n * 10n ** BigInt(percentScale);
  const scaledPercent = roundDiv(scaledNumerator, costBasisPence);
  return { amountPence, percent: formatScaledDecimal(scaledPercent, percentScale), direction };
}

export interface HoldingForAggregation {
  accountId: number;
  ticker: string;
  /** NUMERIC(18,6) string. */
  quantity: string;
  costBasisPence: bigint;
  /** The owning account's currency. Part of the grouping key below — see the function
   * doc comment for why. */
  accountCurrency: string;
}

export interface TickerAggregate {
  ticker: string;
  /** The currency every holding in this aggregate shares — see the function doc comment. */
  currency: string;
  totalQuantity: string;
  totalCostBasisPence: bigint;
  accountIds: number[];
}

/**
 * Group holdings across accounts by (ticker, currency) — the /portfolio page's
 * cross-account view (the same VWRL-shaped ETF held in two ISAs shows as one row with two
 * accounts, per DESIGN_SPEC.md's Portfolio View).
 *
 * Currency is part of the grouping key, not just the ticker: `resolveProviderSymbol` in
 * `quotes.ts` resolves one provider symbol per (ticker, currency) pair, and Phase 2 has no
 * FX conversion. Grouping by ticker alone would let the same bare ticker under two
 * different account currencies (real-world example: Vodafone trades as `VOD` both on the
 * LSE in GBP and as a NYSE ADR in USD) get summed into one quantity and priced against a
 * single quote — silently mixing currencies into one number rather than the "Price
 * unavailable"/excluded-with-a-label outcome Phase 2 promises everywhere else. Unreachable
 * today (every account is hardcoded GBP — see `schema.ts`'s `account.currency` default,
 * with no create/edit path that changes it yet), but grouping by currency too costs
 * nothing now and removes the landmine before a future phase adds currency editing.
 *
 * Deliberately has no dependency on quote data: valuation (current value, gain/loss, %
 * of portfolio) is computed separately once a price is known, via `currentValuePence`/
 * `gainLoss` above, applied once to the summed quantity rather than summed per-holding —
 * avoiding compounding rounding across many small multiplications.
 */
export function aggregateByTicker(
  holdings: readonly HoldingForAggregation[],
): TickerAggregate[] {
  const byKey = new Map<
    string,
    {
      ticker: string;
      currency: string;
      quantityScaled: bigint;
      costBasisPence: bigint;
      accountIds: number[];
    }
  >();

  for (const holding of holdings) {
    const key = `${holding.ticker} ${holding.accountCurrency}`;
    const entry = byKey.get(key) ?? {
      ticker: holding.ticker,
      currency: holding.accountCurrency,
      quantityScaled: 0n,
      costBasisPence: 0n,
      accountIds: [],
    };
    entry.quantityScaled += parseScaledDecimal(holding.quantity, QUANTITY_SCALE);
    entry.costBasisPence += holding.costBasisPence;
    entry.accountIds.push(holding.accountId);
    byKey.set(key, entry);
  }

  return Array.from(byKey.values()).map((entry) => ({
    ticker: entry.ticker,
    currency: entry.currency,
    totalQuantity: formatScaledDecimal(entry.quantityScaled, QUANTITY_SCALE),
    totalCostBasisPence: entry.costBasisPence,
    accountIds: entry.accountIds,
  }));
}
