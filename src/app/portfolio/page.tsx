import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import {
  PortfolioAllocationPanel,
  type PortfolioSliceView,
} from '@/components/portfolio/PortfolioAllocationPanel';
import {
  PortfolioHoldingsTable,
  type PortfolioHoldingRowView,
} from '@/components/portfolio/PortfolioHoldingsTable';
import { formatMoney, numericToPence, sumPence } from '@/lib/money';
import { getPortfolioHoldings, getSetupState } from '@/lib/household/queries';
import { alphaVantageApiKey, quoteStaleAfterHours } from '@/lib/env';
import { createAlphaVantageQuoteSource, ensureFreshQuotes, resolveProviderSymbol } from '@/lib/portfolio/quotes';
import { aggregateByTicker, currentValuePence, gainLoss } from '@/lib/portfolio/valuation';
import { formatGainLossAmount, relativeTimeFrom } from '@/lib/portfolio/formatting';

/**
 * Portfolio View — DESIGN_SPEC.md.
 *
 * "Household-wide, not per-account: total invested value, allocation breakdown …, a
 * holdings table aggregated across all investment accounts."
 *
 * Grouping is done at the ticker-aggregate level (total quantity across accounts, one
 * quote lookup per ticker) rather than by summing each account's own valuation, per
 * `aggregateByTicker`'s own reasoning in src/lib/portfolio/valuation.ts: one multiplication
 * on the summed quantity avoids compounding rounding across many small per-account ones.
 *
 * Same Suspense-not-loading.tsx pattern as Accounts List, for the same reason: a
 * route-level loading file would turn the setup redirect below into a client-only
 * instruction instead of a real 307.
 */

export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  return (
    <AppShell pathname="/portfolio">
      <Heading />
      <Suspense fallback={<SkeletonRows rows={4} label="Loading your portfolio" />}>
        <PortfolioBody householdId={setup.householdId} />
      </Suspense>
    </AppShell>
  );
}

async function PortfolioBody({ householdId }: { householdId: number }) {
  let holdingRows: Awaited<ReturnType<typeof getPortfolioHoldings>>;
  try {
    holdingRows = await getPortfolioHoldings(householdId);
  } catch (error) {
    console.error('[portfolio] failed to load holdings', error);
    return (
      <ErrorState retryHref="/portfolio" detail="Your data is safe — this was a problem reading it." />
    );
  }

  if (holdingRows.length === 0) {
    return (
      <EmptyState
        title="Add an investment account to see your portfolio here"
        ctaLabel="Go to Accounts"
        ctaHref="/accounts"
      />
    );
  }

  const now = new Date();
  const aggregates = aggregateByTicker(
    holdingRows.map((holding) => ({
      accountId: holding.accountId,
      ticker: holding.ticker,
      quantity: holding.quantity,
      costBasisPence: numericToPence(holding.costBasis),
      accountCurrency: holding.accountCurrency,
    })),
  );

  // Keyed by (ticker, currency), matching aggregateByTicker's own grouping key — not
  // ticker alone. Two holdings of the same bare ticker under different account
  // currencies (unreachable today; every account is GBP) must not collapse into one
  // aggregate or one accordion group, or the wrong holdings show under the wrong price.
  const aggregateKey = (ticker: string, currency: string) => `${ticker} ${currency}`;

  const apiKey = alphaVantageApiKey();
  const quotes = apiKey
    ? await ensureFreshQuotes(
        aggregates.map((aggregate) => ({
          symbol: resolveProviderSymbol(aggregate.ticker, aggregate.currency),
          currency: aggregate.currency,
        })),
        { source: createAlphaVantageQuoteSource(apiKey), staleAfterHours: quoteStaleAfterHours() },
      )
    : new Map();

  const holdingsByKey = new Map<string, typeof holdingRows>();
  for (const holding of holdingRows) {
    const key = aggregateKey(holding.ticker, holding.accountCurrency);
    const list = holdingsByKey.get(key) ?? [];
    list.push(holding);
    holdingsByKey.set(key, list);
  }

  interface TickerValuation {
    ticker: string;
    currency: string;
    totalQuantity: string;
    totalCostBasisPence: bigint;
    /** null when unpriced, or priced in a currency other than this aggregate's own
     * account currency — a provider inconsistency, not the expected case (see
     * `nonGbpCurrency`). */
    valuePence: bigint | null;
    nonGbpCurrency: string | null;
    fetchedAt: Date | null;
    stale: boolean;
  }

  const tickerValuations: TickerValuation[] = aggregates.map((aggregate) => {
    const symbol = resolveProviderSymbol(aggregate.ticker, aggregate.currency);
    const quote = quotes.get(symbol);

    if (!quote || quote.price === null) {
      return {
        ticker: aggregate.ticker,
        currency: aggregate.currency,
        totalQuantity: aggregate.totalQuantity,
        totalCostBasisPence: aggregate.totalCostBasisPence,
        valuePence: null,
        nonGbpCurrency: null,
        fetchedAt: quote?.fetchedAt ?? null,
        stale: quote?.stale ?? false,
      };
    }

    const valuePence = currentValuePence(aggregate.totalQuantity, quote.price);
    // Only a GBP-priced quote contributes to the GBP total/allocation — Phase 2 has no FX
    // conversion (see resolveProviderSymbol's doc comment), so mixing currencies into one
    // GBP-labelled sum would misrepresent the total rather than merely omit a figure.
    // Comparing against the aggregate's own currency (not a hardcoded 'GBP') so this stays
    // correct if a future phase ever prices a genuinely USD-denominated aggregate.
    const isExpectedCurrency = quote.currency === aggregate.currency;
    return {
      ticker: aggregate.ticker,
      currency: aggregate.currency,
      totalQuantity: aggregate.totalQuantity,
      totalCostBasisPence: aggregate.totalCostBasisPence,
      valuePence: aggregate.currency === 'GBP' && isExpectedCurrency ? valuePence : null,
      nonGbpCurrency: aggregate.currency === 'GBP' ? null : aggregate.currency,
      fetchedAt: quote.fetchedAt,
      stale: quote.stale,
    };
  });

  const totalPortfolioPence = sumPence(
    tickerValuations.map((t) => t.valuePence).filter((v): v is bigint => v !== null),
  );

  // Same partial-sum caveat as the total above: gain/loss is only computable from the
  // tickers that actually priced, so its cost-basis side matches — not every holding's
  // cost basis, only the priced ones', or the percentage would be measured against money
  // that isn't reflected in the value side.
  const pricedTickers = tickerValuations.filter((t) => t.valuePence !== null);
  const totalGainLoss =
    pricedTickers.length > 0
      ? gainLoss(sumPence(pricedTickers.map((t) => t.totalCostBasisPence)), totalPortfolioPence)
      : null;
  const unpricedTickerCount = tickerValuations.length - pricedTickers.length;

  const fetchedTimes = tickerValuations.map((t) => t.fetchedAt).filter((d): d is Date => d !== null);
  const latestFetch = fetchedTimes.length > 0 ? new Date(Math.max(...fetchedTimes.map((d) => d.getTime()))) : null;
  const anyStale = tickerValuations.some((t) => t.stale);

  const slices: PortfolioSliceView[] = tickerValuations
    .filter((t) => t.valuePence !== null && t.valuePence > 0n)
    .map((t) => ({
      key: aggregateKey(t.ticker, t.currency),
      label: t.ticker,
      amount: formatMoney(t.valuePence!, { showPence: true }),
      share: totalPortfolioPence > 0n ? Number(t.valuePence) / Number(totalPortfolioPence) : 0,
    }))
    .sort((a, b) => b.share - a.share);

  const rows: PortfolioHoldingRowView[] = tickerValuations
    .map((t) => {
      const accounts = (holdingsByKey.get(aggregateKey(t.ticker, t.currency)) ?? []).map((holding) => ({
        accountId: holding.accountId,
        accountName: holding.accountName,
        ownerName: holding.ownerName,
        quantity: holding.quantity,
        currency: holding.accountCurrency,
      }));

      const gl = t.valuePence !== null ? gainLoss(t.totalCostBasisPence, t.valuePence) : null;

      return {
        ticker: t.ticker,
        // Distinguishes two rows that happen to share a bare ticker under different
        // account currencies (unreachable today) — see aggregateByTicker's doc comment.
        rowKey: aggregateKey(t.ticker, t.currency),
        totalQuantity: t.totalQuantity,
        totalValue: t.valuePence !== null ? formatMoney(t.valuePence, { showPence: true }) : null,
        sharePercent:
          t.valuePence !== null && totalPortfolioPence > 0n
            ? `${((Number(t.valuePence) / Number(totalPortfolioPence)) * 100).toFixed(1)}%`
            : null,
        gainLoss: gl ? { amount: formatGainLossAmount(gl.amountPence), percent: gl.percent, direction: gl.direction } : null,
        accounts,
        nonGbpCurrency: t.nonGbpCurrency,
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  return (
    <>
      <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <p className="text-[11px] font-medium uppercase tracking-wider text-content-faint">
          Total invested
        </p>
        <p className="tabular mt-1 font-serif text-[clamp(1.75rem,5vw,2.5rem)] leading-none text-content">
          {formatMoney(totalPortfolioPence)}
        </p>
        {totalGainLoss ? (
          <p
            className={`tabular mt-1.5 text-sm ${
              totalGainLoss.direction === 'up'
                ? 'text-sage'
                : totalGainLoss.direction === 'down'
                  ? 'text-clay'
                  : 'text-content-muted'
            }`}
          >
            {formatGainLossAmount(totalGainLoss.amountPence)}
            {totalGainLoss.percent ? (
              <span className="ml-1 text-content-faint">({totalGainLoss.percent}%)</span>
            ) : null}
            <span className="ml-1 text-content-faint">vs. cost basis</span>
          </p>
        ) : null}
        {latestFetch ? (
          <p className="mt-2 text-xs text-content-muted">
            Prices as of {relativeTimeFrom(latestFetch, now)}
            {anyStale ? ' — couldn’t refresh everything just now' : ''}
          </p>
        ) : !apiKey ? (
          <p className="mt-2 text-xs text-content-faint">
            No market-data provider configured — showing holdings without live pricing.
          </p>
        ) : null}
        {unpricedTickerCount > 0 && pricedTickers.length > 0 ? (
          <p className="mt-1 text-xs text-content-faint">
            Excludes {unpricedTickerCount} unpriced holding{unpricedTickerCount === 1 ? '' : 's'}.
          </p>
        ) : null}
      </div>

      <div className="mt-5">
        <PortfolioAllocationPanel slices={slices} />
      </div>

      <div className="mt-5 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Holdings</h2>
        <div className="mt-4">
          <PortfolioHoldingsTable rows={rows} />
        </div>
      </div>
    </>
  );
}

function Heading() {
  return (
    <div className="mb-6">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-content-faint">
        Invest
      </span>
      <h1 className="font-serif text-3xl leading-tight text-content">Portfolio</h1>
    </div>
  );
}
