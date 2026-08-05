import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { DcfForm } from '@/components/stocks/DcfForm';
import { getSetupState } from '@/lib/household/queries';
import { getStockAnalysis } from '@/lib/stocks/queries';
import { saveDcfInputs } from '@/lib/stocks/actions';
import { DEFAULT_DCF_INPUTS, parseDcfInputs, suggestDiscountRatePct, suggestGrowthRatePct } from '@/lib/stocks/dcf';
import {
  createFmpFundamentalsSource,
  ensureFreshFundamentals,
  fetchRatiosAndKeyMetrics,
  type RatiosAndKeyMetrics,
} from '@/lib/stocks/fmp';
import { deriveQualityMetrics, derivePeerComparison } from '@/lib/stocks/relativeValuation';
import type { ChecklistItem } from '@/lib/stocks/checklist';
import { buildWorkbenchSummary } from '@/lib/stocks/workbenchSummary';
import { createAlphaVantageQuoteSource, ensureFreshQuotes } from '@/lib/portfolio/quotes';
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

/** Both formatters return an em dash for `null` rather than "0%"/"0.0x" — a missing
 * figure and a genuine zero must never look the same. */
function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}
function formatMultiple(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}x`;
}

/** How many of a ticker's FMP-identified peers to show/fetch — bounds the worst-case
 * API calls per fresh page load (each peer needs its own `ratios`/`key-metrics` fetch)
 * to a fixed number regardless of how many peers FMP returns (seen up to 9 live). */
const MAX_PEERS = 5;

/** Glyph + colour per checklist status — reuses the tri-tone vocabulary already used
 * elsewhere on this page (sage/brass/clay), not a new palette. Glyph is `aria-hidden`;
 * the status word itself carries the meaning for anyone who can't see colour. */
const CHECKLIST_STATUS_STYLE: Record<ChecklistItem['status'], { glyph: string; tone: string; word: string }> = {
  pass: { glyph: '✓', tone: 'text-sage', word: 'Pass' },
  warn: { glyph: '!', tone: 'text-brass-strong dark:text-brass', word: 'Warning' },
  fail: { glyph: '✕', tone: 'text-clay', word: 'Fail' },
  unknown: { glyph: '–', tone: 'text-content-faint', word: 'Unknown' },
};

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

  // Data-driven suggestions for the two assumptions that are actually derivable from
  // fetched fundamentals — see `dcf.ts`'s own doc comment on why terminal growth and
  // projection years have no equivalent (one's a fixed convention, the other a
  // genuine preference). `null` whenever the underlying data isn't computable/present
  // (e.g. no FMP key, ticker not covered, too little FCF history, no beta) — always
  // passed through to `DcfForm` regardless, `null` and all, so the form can render
  // "no suggestion available" rather than nothing.
  const suggestedGrowthRatePct = fundamentalsView?.statements
    ? suggestGrowthRatePct(fundamentalsView.statements.cashFlowStatements)
    : null;
  const suggestedDiscountRatePct = fundamentalsView?.statements
    ? suggestDiscountRatePct(fundamentalsView.statements.beta ?? null)
    : null;

  let dcfInputs = DEFAULT_DCF_INPUTS;
  if (analysis) {
    try {
      dcfInputs = parseDcfInputs(analysis.inputs);
    } catch {
      // A malformed or future-schema-version row shouldn't crash the page — fall back
      // to defaults, same posture as every other JSONB read in this codebase.
    }
  } else {
    // First visit for this ticker — nothing saved yet, so prefill with the
    // data-driven suggestions where available rather than the generic hardcoded
    // defaults. Once the household saves anything, their saved values always win;
    // this only ever affects what an unvisited ticker's form starts out showing.
    //
    // Routed through parseDcfInputs — not handed to computeDcf directly — so the
    // `terminalGrowthRatePct < discountRatePct` invariant is enforced here too, not
    // just on a saved/user-submitted payload. Today `suggestDiscountRatePct` always
    // lands above `DEFAULT_DCF_INPUTS.terminalGrowthRatePct` given the current
    // risk-free-rate constant, so this was unreachable in practice — but only by
    // construction of that one constant, not by anything actually checking it here,
    // which is exactly the kind of invariant that should never depend on a caller
    // getting it right by accident.
    const suggested = {
      ...DEFAULT_DCF_INPUTS,
      growthRatePct: suggestedGrowthRatePct ?? DEFAULT_DCF_INPUTS.growthRatePct,
      discountRatePct: suggestedDiscountRatePct ?? DEFAULT_DCF_INPUTS.discountRatePct,
    };
    try {
      dcfInputs = parseDcfInputs(suggested);
    } catch {
      dcfInputs = DEFAULT_DCF_INPUTS;
    }
  }

  const workbenchSummary = buildWorkbenchSummary(
    fundamentalsView?.statements ?? null,
    quoteView?.price ?? null,
    dcfInputs,
    (fundamentalsView?.stale ?? false) || (quoteView?.stale ?? false),
  );
  const { marketPricePence, dcfResult, deltaLine, checklist, checklistCounts, statementsCurrency } = workbenchSummary;
  const currencyMismatch = statementsCurrency !== null && statementsCurrency !== 'USD';

  // Milestone 3: quality/balance-sheet health (no peer data needed) and relative
  // valuation (needs each peer's own ratios/key-metrics only — fetchRatiosAndKeyMetrics,
  // not the full 7-call fetchFundamentals set; see that function's own doc comment for
  // why this is deliberately uncached rather than routed through ensureFreshFundamentals).
  const cappedPeers = fundamentalsView?.statements?.peers.slice(0, MAX_PEERS) ?? [];
  const fmpKey = fmpApiKey();
  const peerFundamentals: Map<string, RatiosAndKeyMetrics> = new Map(
    fmpKey && cappedPeers.length > 0
      ? await Promise.all(
          cappedPeers.map(async (peer) => [peer.ticker, await fetchRatiosAndKeyMetrics(peer.ticker, fmpKey)] as const),
        )
      : [],
  );

  const qualityMetrics = fundamentalsView?.statements
    ? deriveQualityMetrics(fundamentalsView.statements.ratios, fundamentalsView.statements.keyMetrics)
    : null;

  const peerComparison = fundamentalsView?.statements
    ? derivePeerComparison(
        { ratios: fundamentalsView.statements.ratios, keyMetrics: fundamentalsView.statements.keyMetrics },
        cappedPeers.map((peer) => {
          const peerRatios = peerFundamentals.get(peer.ticker);
          return {
            ticker: peer.ticker,
            companyName: peer.companyName,
            ratios: peerRatios?.ratios ?? [],
            keyMetrics: peerRatios?.keyMetrics ?? [],
          };
        }),
      )
    : null;

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

      {fundamentalsView?.stale || quoteView?.stale ? (
        <p
          role="status"
          className="mt-3 rounded-card border border-line bg-paper-sunken px-3.5 py-2.5 text-xs text-content-muted"
        >
          Showing the last successfully fetched data below — a fresh check just now
          didn’t go through (a provider rate limit or network issue), so some figures
          may be a little out of date.
        </p>
      ) : null}

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
                  worth being conservative rather than optimistic. Pre-filled where
                  possible from the company’s own historical FCF growth — treat it as
                  a starting point to sanity-check, not a fact.
                </li>
                <li>
                  <strong className="font-medium text-content">Discount rate</strong> —
                  the annual return you’d want to make this worth the risk (sometimes
                  called the “required rate of return”). A higher discount rate makes
                  future cash worth less today, which lowers the estimated value. Many
                  investors use somewhere around 8–12% for an established company.
                  Pre-filled where possible using CAPM (a standard formula: the return
                  on a safe investment, plus the company’s risk relative to the market
                  as a whole) — again a starting point, not a fact.
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
          ) : fundamentalsView === null ? (
            <p className="text-sm text-content-faint">
              Couldn’t fetch fundamentals for {ticker} right now — this is usually
              temporary (a rate limit or network issue), not a sign the ticker doesn’t
              exist. Try reloading in a minute.
            </p>
          ) : fundamentalsView.statements === null ? (
            <p className="text-sm text-content-faint">
              No fundamentals available for {ticker} — either this ticker isn’t
              recognised, or it needs a paid FMP plan. This happens even for some
              large, well-known companies — FMP’s free tier only covers a subset of
              tickers for financial statements specifically, and which ones isn’t
              published anywhere to check in advance.
            </p>
          ) : !dcfResult ? (
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
                    ? formatMoney(dcfResult.intrinsicValuePerSharePence, {
                        showPence: true,
                        // A currency code not in this codebase's small known-symbol map
                        // (GBP/USD/EUR) falls back to a plain "XYZ " prefix rather than
                        // guessing at a symbol — exactly what's wanted here, since this
                        // figure is genuinely not in USD when there's a mismatch.
                        currency: currencyMismatch && statementsCurrency ? statementsCurrency : 'USD',
                      })
                    : '—'}
                </p>
                {currencyMismatch ? (
                  <p className="mt-1 text-xs text-content-faint">
                    {ticker}’s statements are reported in {statementsCurrency}, but the market quote above is
                    USD — this workbench doesn’t convert between currencies yet, so the two can’t be honestly
                    compared. The intrinsic value figure is in {statementsCurrency}, not USD, despite the symbol.
                  </p>
                ) : marketPricePence !== null ? (
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
          <DcfForm
            ticker={ticker}
            initialInputs={dcfInputs}
            action={saveDcfInputs}
            suggestions={{ growthRatePct: suggestedGrowthRatePct, discountRatePct: suggestedDiscountRatePct }}
          />
        </div>
      </section>

      <section className="mt-6 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Quality &amp; balance-sheet health</h2>
        <p className="mt-0.5 text-xs text-content-faint">
          How profitably {ticker} runs its business, and how much financial cushion it
          has — independent of any price or valuation assumption.
        </p>

        <details className="mt-4 rounded-card border border-line bg-paper">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-content">
            How to read this
          </summary>
          <div className="space-y-1.5 border-t border-line px-4 pb-4 pt-3 text-sm leading-relaxed text-content-muted">
            <ul className="list-disc space-y-1.5 pl-4">
              <li>
                <strong className="font-medium text-content">Gross/net margin</strong> —
                how much of every pound of revenue is left after costs. Higher is
                generally better, but what “good” looks like varies a lot by industry —
                only compare margins within the same kind of business.
              </li>
              <li>
                <strong className="font-medium text-content">Return on equity (ROE) / return on invested capital (ROIC)</strong>{' '}
                — how efficiently the company turns shareholders’ money (ROE) or all
                its capital, including debt (ROIC), into profit. Consistently high
                figures are a hallmark of a genuinely strong business, not just a
                cheap one.
              </li>
              <li>
                <strong className="font-medium text-content">Debt/equity</strong> — how
                much the company relies on borrowing rather than shareholder capital.
                Higher isn’t automatically bad (some industries run on more debt than
                others), but it means more risk if earnings fall.
              </li>
              <li>
                <strong className="font-medium text-content">Current ratio</strong> —
                short-term assets divided by short-term liabilities; a rough gauge of
                whether the company can cover its near-term bills. Below 1 isn’t
                automatically alarming for a mature, cash-generative business, but
                it’s worth noticing.
              </li>
              <li>
                <strong className="font-medium text-content">Free cash flow yield</strong>{' '}
                — free cash flow relative to the company’s market value; a higher
                figure means more cash generated per pound of price paid.
              </li>
            </ul>
          </div>
        </details>

        <div className="mt-5">
          {!fmpApiKey() ? (
            <p className="text-sm text-content-faint">
              No FMP API key configured — fundamentals can’t be fetched yet.
            </p>
          ) : fundamentalsView?.statements == null ? (
            <p className="text-sm text-content-faint">
              No fundamentals available for {ticker} — see the DCF section above for why.
            </p>
          ) : (
            qualityMetrics && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-content-faint">Gross margin</dt>
                  <dd className="mt-0.5 tabular text-content">{formatPercent(qualityMetrics.grossMargin)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-content-faint">Net margin</dt>
                  <dd className="mt-0.5 tabular text-content">{formatPercent(qualityMetrics.netMargin)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-content-faint">Return on equity</dt>
                  <dd className="mt-0.5 tabular text-content">{formatPercent(qualityMetrics.returnOnEquity)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-content-faint">Return on invested capital</dt>
                  <dd className="mt-0.5 tabular text-content">
                    {formatPercent(qualityMetrics.returnOnInvestedCapital)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-content-faint">Debt/equity</dt>
                  <dd className="mt-0.5 tabular text-content">{formatMultiple(qualityMetrics.debtToEquity)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-content-faint">Current ratio</dt>
                  <dd className="mt-0.5 tabular text-content">{formatMultiple(qualityMetrics.currentRatio)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-content-faint">Free cash flow yield</dt>
                  <dd className="mt-0.5 tabular text-content">
                    {formatPercent(qualityMetrics.freeCashFlowYield)}
                  </dd>
                </div>
              </dl>
            )
          )}
        </div>
      </section>

      <section className="mt-6 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Relative valuation</h2>
        <p className="mt-0.5 text-xs text-content-faint">
          {ticker}’s own P/E and EV/EBITDA multiples, next to peers FMP identifies for
          it.
        </p>

        <details className="mt-4 rounded-card border border-line bg-paper">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-content">
            How to read this
          </summary>
          <div className="space-y-2 border-t border-line px-4 pb-4 pt-3 text-sm leading-relaxed text-content-muted">
            <p>
              <strong className="font-medium text-content">P/E (price/earnings)</strong>{' '}
              and <strong className="font-medium text-content">EV/EBITDA</strong>{' '}
              (enterprise value / earnings before interest, tax, depreciation and
              amortisation) are two common shortcuts for “is this expensive relative to
              its earnings?” — cheaper to compute than a DCF, but only meaningful next
              to comparable companies, which is why they’re shown against peers rather
              than alone.
            </p>
            <p>
              The peers below are FMP’s own algorithmic determination, not hand-picked
              — worth sanity-checking whether they’re genuinely comparable businesses
              before trusting the comparison. A lower multiple than peers isn’t
              automatically “cheap” — it can also mean the market expects slower
              growth or sees more risk. Treat this as one input among several, not a
              verdict.
            </p>
          </div>
        </details>

        <div className="mt-5">
          {!fmpApiKey() ? (
            <p className="text-sm text-content-faint">
              No FMP API key configured — fundamentals can’t be fetched yet.
            </p>
          ) : fundamentalsView?.statements == null ? (
            <p className="text-sm text-content-faint">
              No fundamentals available for {ticker} — see the DCF section above for why.
            </p>
          ) : !peerComparison ||
            (peerComparison.peers.length === 0 &&
              peerComparison.primary.peRatio === null &&
              peerComparison.primary.evToEbitda === null) ? (
            <p className="text-sm text-content-faint">
              No P/E, EV/EBITDA, or peer data available for {ticker}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-content-faint">
                    <th className="py-1.5 pr-4">Ticker</th>
                    <th className="py-1.5 pr-4">P/E</th>
                    <th className="py-1.5">EV/EBITDA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line font-medium text-content">
                    <td className="py-1.5 pr-4">{ticker} (this stock)</td>
                    <td className="py-1.5 pr-4 tabular">{formatMultiple(peerComparison.primary.peRatio)}</td>
                    <td className="py-1.5 tabular">{formatMultiple(peerComparison.primary.evToEbitda)}</td>
                  </tr>
                  {peerComparison.peers.map((peer) => (
                    <tr key={peer.ticker} className="border-t border-line">
                      <td className="py-1.5 pr-4 text-content-muted">
                        {peer.ticker} — {peer.companyName}
                      </td>
                      <td className="py-1.5 pr-4 tabular">{formatMultiple(peer.peRatio)}</td>
                      <td className="py-1.5 tabular">{formatMultiple(peer.evToEbitda)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line font-medium text-content">
                    <td className="py-1.5 pr-4">Peer average</td>
                    <td className="py-1.5 pr-4 tabular">{formatMultiple(peerComparison.peerAveragePeRatio)}</td>
                    <td className="py-1.5 tabular">{formatMultiple(peerComparison.peerAverageEvToEbitda)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Fundamentals checklist</h2>
        <p className="mt-0.5 text-xs text-content-faint">
          A pre-flight check on the raw numbers behind the sections above, before you
          trust them.
        </p>

        <details className="mt-4 rounded-card border border-line bg-paper">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-content">
            How to read this
          </summary>
          <div className="space-y-2 border-t border-line px-4 pb-4 pt-3 text-sm leading-relaxed text-content-muted">
            <p>
              A failed or warning check isn’t “don’t buy this stock” — it’s “here’s a
              reason to look closer before trusting the DCF or valuation numbers
              above.” The thresholds (e.g. debt/equity under 2x) are conventional
              rules of thumb, not tailored to this specific company or its industry —
              treat them as a starting point for questions, not a verdict.
            </p>
            <p>
              <strong className="font-medium text-content">Unknown</strong> means the
              underlying figure wasn’t available for this ticker, not that it failed —
              the same free-tier gating already noted elsewhere on this page.
            </p>
          </div>
        </details>

        <div className="mt-5">
          {!fmpApiKey() ? (
            <p className="text-sm text-content-faint">
              No FMP API key configured — fundamentals can’t be fetched yet.
            </p>
          ) : fundamentalsView?.statements == null ? (
            <p className="text-sm text-content-faint">
              No fundamentals available for {ticker} — see the DCF section above for why.
            </p>
          ) : checklist && checklistCounts ? (
            <div className="space-y-3">
              <p className="text-sm text-content-muted">
                {checklistCounts.pass} of {checklist.length} checks pass
                {checklistCounts.warn > 0 ? `, ${checklistCounts.warn} warning${checklistCounts.warn === 1 ? '' : 's'}` : ''}
                {checklistCounts.fail > 0 ? `, ${checklistCounts.fail} failed` : ''}
                {checklistCounts.unknown > 0 ? `, ${checklistCounts.unknown} unknown` : ''}.
              </p>
              <ul className="space-y-2">
                {checklist.map((item) => {
                  const style = CHECKLIST_STATUS_STYLE[item.status];
                  return (
                    <li key={item.id} className="flex items-start gap-3 rounded-card border border-line bg-paper p-3">
                      <span aria-hidden="true" className={`mt-0.5 font-medium ${style.tone}`}>
                        {style.glyph}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-content">
                          {item.label} <span className={`text-xs font-normal ${style.tone}`}>({style.word})</span>
                        </p>
                        <p className="mt-0.5 text-xs text-content-muted">{item.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
