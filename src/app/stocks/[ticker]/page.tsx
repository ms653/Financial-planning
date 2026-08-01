import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { DcfForm } from '@/components/stocks/DcfForm';
import { getSetupState } from '@/lib/household/queries';
import { getStockAnalysis } from '@/lib/stocks/queries';
import { saveDcfInputs } from '@/lib/stocks/actions';
import { computeDcf, deriveDcfBaseInputs, parseDcfInputs, type DcfInputsV1 } from '@/lib/stocks/dcf';
import { createFmpFundamentalsSource, ensureFreshFundamentals } from '@/lib/stocks/fmp';
import { createAlphaVantageQuoteSource, ensureFreshQuotes } from '@/lib/portfolio/quotes';
import { parseScaledDecimal, roundDiv, PRICE_SCALE } from '@/lib/portfolio/valuation';
import { alphaVantageApiKey, fmpApiKey, fundamentalsStaleAfterHours, quoteStaleAfterHours } from '@/lib/env';
import { formatMoney } from '@/lib/money';

/**
 * Phase 4 Milestone 2 — the DCF calculator, the first real page to read
 * `stock_analysis` and to trigger `ensureFreshFundamentals` (Milestone 1 built both,
 * used by neither yet). Recomputes the DCF live on every load rather than persisting a
 * result row — a closed-form calculation over a handful of years is fast enough that
 * PROPOSAL.md's own "under ~2s, synchronous is acceptable" decision rule applies, per
 * the judgment call already flagged in Milestone 1's own STATUS.md entry.
 */

export const dynamic = 'force-dynamic';

const TICKER_PATTERN = /^[A-Z0-9.\-:]{1,20}$/;

const DEFAULT_DCF_INPUTS: DcfInputsV1 = {
  schemaVersion: 1,
  growthRatePct: '8.000',
  discountRatePct: '10.000',
  terminalGrowthRatePct: '2.500',
  projectionYears: 5,
};

/** A quote's price string is `NUMERIC(14,4)` (pounds/dollars, `PRICE_SCALE`) — a
 * different scale from `formatMoney`'s pence convention. Converts without ever
 * touching a float, reusing `valuation.ts`'s existing fixed-point primitives (the same
 * `roundDiv`/`parseScaledDecimal` pair `dcf.ts`'s own math is built from) rather than
 * inventing a third way to do this one conversion. */
function priceStringToPence(price: string): bigint {
  const priceScaled = parseScaledDecimal(price, PRICE_SCALE);
  return roundDiv(priceScaled, 10n ** BigInt(PRICE_SCALE - 2));
}

export default async function StockTickerPage({ params }: { params: { ticker: string } }) {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const ticker = params.ticker.toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) notFound();

  const [fundamentalsView, quoteView, analysis] = await Promise.all([
    (async () => {
      const key = fmpApiKey();
      if (!key) return null;
      const result = await ensureFreshFundamentals([ticker], {
        source: createFmpFundamentalsSource(key),
        staleAfterHours: fundamentalsStaleAfterHours(),
      });
      return result.get(ticker) ?? null;
    })(),
    (async () => {
      const key = alphaVantageApiKey();
      if (!key) return null;
      // A bare US ticker, matching M1's "US-listed tickers first" decision — no
      // `.LON` resolution here, unlike a holding's own account-currency-derived symbol.
      const result = await ensureFreshQuotes([{ symbol: ticker, currency: 'USD' }], {
        source: createAlphaVantageQuoteSource(key),
        staleAfterHours: quoteStaleAfterHours(),
      });
      return result.get(ticker) ?? null;
    })(),
    getStockAnalysis(setup.householdId, ticker),
  ]);

  let dcfInputs = DEFAULT_DCF_INPUTS;
  if (analysis) {
    try {
      dcfInputs = parseDcfInputs(analysis.inputs);
    } catch {
      // A malformed or future-schema-version row shouldn't crash the page — fall back
      // to defaults, same posture as every other JSONB read in this codebase.
    }
  }

  const baseInputs = fundamentalsView?.statements ? deriveDcfBaseInputs(fundamentalsView.statements) : null;
  const dcfResult = baseInputs
    ? computeDcf(dcfInputs, baseInputs.baseFcfPence, baseInputs.netDebtPence, baseInputs.dilutedShares)
    : null;

  const marketPricePence = quoteView?.price ? priceStringToPence(quoteView.price) : null;

  let deltaLine: string | null = null;
  if (dcfResult?.intrinsicValuePerSharePence != null && marketPricePence !== null && marketPricePence > 0n) {
    const deltaPct =
      (Number(dcfResult.intrinsicValuePerSharePence - marketPricePence) / Number(marketPricePence)) * 100;
    deltaLine =
      deltaPct >= 0
        ? `${deltaPct.toFixed(1)}% below intrinsic value`
        : `${Math.abs(deltaPct).toFixed(1)}% above intrinsic value`;
  }

  return (
    <AppShell pathname="/stocks">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-content-muted">
        <Link href="/stocks" className="underline underline-offset-2 hover:text-content">
          Stocks
        </Link>
        <span className="mx-2 text-content-faint">/</span>
        <span className="text-content">{ticker}</span>
      </nav>

      <h1 className="font-serif text-3xl leading-tight text-content">{ticker}</h1>

      <section className="mt-7 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">DCF (discounted cash flow)</h2>
        <p className="mt-0.5 text-xs text-content-faint">
          Intrinsic value per share, from projected free cash flow — one of several
          valuation methods this workbench will show side by side as more are built.
        </p>

        <div className="mt-5">
          {!fmpApiKey() ? (
            <p className="text-sm text-content-faint">
              No FMP API key configured — fundamentals can’t be fetched yet. See{' '}
              <code className="text-xs">FMP_API_KEY</code> in <code className="text-xs">.env</code>.
            </p>
          ) : fundamentalsView?.statements == null ? (
            <p className="text-sm text-content-faint">
              No fundamentals available for {ticker} yet — this could be an unsupported
              ticker, or the provider genuinely has nothing for it.
            </p>
          ) : !baseInputs ? (
            <p className="text-sm text-content-faint">
              {ticker}’s fundamentals are missing a figure this calculation needs (free
              cash flow, debt, cash, or shares outstanding) — can’t compute a DCF yet.
            </p>
          ) : dcfResult ? (
            <div className="space-y-4">
              <div className="rounded-card border border-line bg-paper p-4">
                <p className="text-xs uppercase tracking-wider text-content-faint">Intrinsic value per share</p>
                <p className="mt-1 font-serif text-2xl text-content tabular">
                  {dcfResult.intrinsicValuePerSharePence !== null
                    ? formatMoney(dcfResult.intrinsicValuePerSharePence, { showPence: true, currency: 'USD' })
                    : '—'}
                </p>
                {marketPricePence !== null ? (
                  <p className="mt-1 text-sm text-content-muted">
                    Market price: {formatMoney(marketPricePence, { showPence: true, currency: 'USD' })}
                    {deltaLine ? ` — ${deltaLine}` : ''}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-content-faint">
                    Market price unavailable for comparison — see{' '}
                    <code className="text-xs">ALPHA_VANTAGE_API_KEY</code> in{' '}
                    <code className="text-xs">.env</code>.
                  </p>
                )}
              </div>

              <details className="rounded-card border border-line bg-paper">
                <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-content">
                  Year-by-year projection
                </summary>
                <div className="overflow-x-auto border-t border-line px-4 pb-4 pt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-content-faint">
                        <th className="py-1.5 pr-4">Year</th>
                        <th className="py-1.5 pr-4">Projected FCF</th>
                        <th className="py-1.5">Present value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dcfResult.years.map((y) => (
                        <tr key={y.year} className="border-t border-line">
                          <td className="py-1.5 pr-4 tabular">{y.year}</td>
                          <td className="py-1.5 pr-4 tabular">
                            {formatMoney(y.projectedFcfPence, { currency: 'USD' })}
                          </td>
                          <td className="py-1.5 tabular">{formatMoney(y.presentValuePence, { currency: 'USD' })}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-line text-content-muted">
                        <td className="py-1.5 pr-4">Terminal value</td>
                        <td className="py-1.5 pr-4 tabular">
                          {formatMoney(dcfResult.terminalValuePence, { currency: 'USD' })}
                        </td>
                        <td className="py-1.5 tabular">
                          {formatMoney(dcfResult.presentValueOfTerminalValuePence, { currency: 'USD' })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ) : null}
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <DcfForm ticker={ticker} initialInputs={dcfInputs} action={saveDcfInputs} />
        </div>
      </section>
    </AppShell>
  );
}
