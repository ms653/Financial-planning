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

        <details open className="mt-4 rounded-card border border-line bg-paper">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-content">
            How to read this
          </summary>
          <div className="space-y-4 border-t border-line px-4 pb-4 pt-3 text-sm leading-relaxed text-content-muted">
            <p>
              A DCF estimates what a company might actually be worth, based on the cash
              it’s expected to generate — rather than just its current share price,
              which can move on sentiment and short-term news as much as on the
              business itself. The idea: a business is worth the cash it produces for
              its owners over time, adjusted for the fact that money today is worth
              more than the same money years from now.
            </p>
            <p>
              This is only ever an estimate, and a sensitive one — small changes to the
              assumptions below can swing the result a lot. That’s the reason this
              workbench is meant to show several valuation methods side by side once
              they’re built, not treat any single number as a verdict.
            </p>
            <div>
              <p className="font-medium text-content">The assumptions</p>
              <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
                <li>
                  <strong className="font-medium text-content">FCF growth rate</strong> —
                  how fast you expect free cash flow (cash left over after running and
                  reinvesting in the business) to grow each year during the projection
                  period. Higher assumptions produce a higher estimated value, so it’s
                  worth being conservative rather than optimistic.
                </li>
                <li>
                  <strong className="font-medium text-content">Discount rate</strong> —
                  the annual return you’d want to make this worth the risk (sometimes
                  called the “required rate of return”). A higher discount rate makes
                  future cash worth less today, which lowers the estimated value. Many
                  investors use somewhere around 8–12% for an established company.
                </li>
                <li>
                  <strong className="font-medium text-content">Terminal growth rate</strong>{' '}
                  — after the projection years end, the model assumes cash flow keeps
                  growing at this slower, sustainable rate forever. Keep it
                  conservative — often close to long-run inflation or GDP growth
                  (2–3%), never as high as the earlier growth-phase years.
                </li>
                <li>
                  <strong className="font-medium text-content">Projection years</strong>{' '}
                  — how many years to forecast explicitly before switching to the
                  terminal-value shortcut. Confidently predicting cash flow gets harder
                  the further out you go, which is exactly why the terminal value
                  exists rather than projecting forever.
                </li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-content">The result</p>
              <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
                <li>
                  <strong className="font-medium text-content">Intrinsic value per share</strong>{' '}
                  — what this calculation estimates the stock is worth, given the
                  assumptions above. Not a price prediction — an estimate of the
                  underlying business’s value.
                </li>
                <li>
                  <strong className="font-medium text-content">vs. market price</strong> —
                  if the intrinsic value is higher than the market price, that reads as
                  “undervalued” (the market price sits below what the maths says the
                  business is worth); if lower, “overvalued.” Treat this as one input
                  among several, not a verdict.
                </li>
                <li>
                  <strong className="font-medium text-content">Year-by-year projection</strong>{' '}
                  — each year’s projected free cash flow, and what that’s worth in
                  today’s money once discounted.
                </li>
                <li>
                  <strong className="font-medium text-content">Terminal value</strong> — a
                  single estimate covering all the cash flow beyond the projection
                  years. It’s often the majority of the total value, which is worth
                  knowing — the terminal growth rate assumption matters more than it
                  might look.
                </li>
              </ul>
            </div>
          </div>
        </details>

        <div className="mt-5">
          {!fmpApiKey() ? (
            <p className="text-sm text-content-faint">
              No FMP API key configured — fundamentals can’t be fetched yet. See{' '}
              <code className="text-xs">FMP_API_KEY</code> in <code className="text-xs">.env</code>.
            </p>
          ) : fundamentalsView?.statements == null ? (
            <p className="text-sm text-content-faint">
              No fundamentals available for {ticker} — either this ticker isn’t
              recognised, or it needs a paid FMP plan. This happens even for some
              large, well-known companies — FMP’s free tier only covers a subset of
              tickers for financial statements specifically, and which ones isn’t
              published anywhere to check in advance.
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
