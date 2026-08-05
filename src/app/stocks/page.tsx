import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { SkeletonRows } from '@/components/ui/States';
import { WatchlistForm } from '@/components/stocks/WatchlistForm';
import { getSetupState } from '@/lib/household/queries';
import { getStockAnalysesForTickers, getWatchlist } from '@/lib/stocks/queries';
import { addToWatchlist, removeFromWatchlist } from '@/lib/stocks/actions';
import { DEFAULT_DCF_INPUTS, parseDcfInputs } from '@/lib/stocks/dcf';
import { createFmpFundamentalsSource, ensureFreshFundamentals, type FundamentalsView } from '@/lib/stocks/fmp';
import { createAlphaVantageQuoteSource, ensureFreshQuotes, type QuoteView } from '@/lib/portfolio/quotes';
import { buildWorkbenchSummary, type WorkbenchSummary } from '@/lib/stocks/workbenchSummary';
import { alphaVantageApiKey, fmpApiKey, fundamentalsStaleAfterHours, quoteStaleAfterHours } from '@/lib/env';
import { formatMoney } from '@/lib/money';

/**
 * Phase 4, Milestone 5 — the last piece of Phase 4. `/stocks/[ticker]` (Milestones
 * 2–4) is already the combined workbench screen (DCF + quality/health + relative
 * valuation + a fundamentals checklist, all on one page); what this list page was
 * still missing was any use of that machinery at all — just a bare ticker name and a
 * Remove link. This page now shows, per watched ticker, the same DCF-vs-market signal
 * and checklist summary the ticker page computes, via the shared
 * `buildWorkbenchSummary` (extracted from `[ticker]/page.tsx` this milestone so the
 * two pages share one computation, not two copies).
 */

export const dynamic = 'force-dynamic';

/** Bounds worst-case external API calls (FMP + Alpha Vantage) per page load — same
 * reasoning as `[ticker]/page.tsx`'s own `MAX_PEERS`. A watchlist beyond this size is
 * unusual; rows past the cap still list with a Remove button, just without a price or
 * signal column, rather than the whole page failing to load. */
const MAX_WATCHLIST_SUMMARIES = 30;

/** Bare single-button form has nothing to render a field error into — same reasoning
 * (and same wrapper shape) as `removeHolding` in `src/app/accounts/[id]/page.tsx`. */
async function removeWatchlistItem(formData: FormData) {
  'use server';
  await removeFromWatchlist(formData);
}

export default async function StocksPage() {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  return (
    <AppShell pathname="/stocks">
      <h1 className="font-serif text-3xl leading-tight text-content">Stocks</h1>
      <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-content-muted">
        A watchlist for tickers you’re researching — separate from anything you actually
        hold (see Portfolio for that). Each row shows the DCF-vs-market signal and
        fundamentals checklist from that ticker’s own workbench page, using your saved
        assumptions where you’ve set any, or the house defaults otherwise — click a
        ticker for the full picture.
      </p>

      <section className="mt-7 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Watchlist</h2>

        <div className="mt-4">
          <Suspense fallback={<SkeletonRows rows={3} label="Loading your watchlist" />}>
            <WatchlistBody householdId={setup.householdId} />
          </Suspense>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <WatchlistForm action={addToWatchlist} />
        </div>
      </section>
    </AppShell>
  );
}

/** Tone matches `CHECKLIST_STATUS_STYLE`'s own palette (`[ticker]/page.tsx`) — worst
 * status present wins, so a single failing check colours the whole badge rather than
 * being averaged away by five passes. */
function checklistTone(counts: WorkbenchSummary['checklistCounts']): string {
  if (!counts) return 'text-content-faint';
  if (counts.fail > 0) return 'text-clay';
  if (counts.warn > 0) return 'text-brass-strong dark:text-brass';
  return 'text-sage';
}

function deltaTone(deltaLine: string | null): string {
  if (!deltaLine) return 'text-content-faint';
  return deltaLine.includes('below') ? 'text-sage' : 'text-clay';
}

async function WatchlistBody({ householdId }: { householdId: number }) {
  const watchlist = await getWatchlist(householdId);

  if (watchlist.length === 0) {
    return <p className="text-sm text-content-faint">Nothing on your watchlist yet.</p>;
  }

  const summarized = watchlist.slice(0, MAX_WATCHLIST_SUMMARIES);
  const tickers = summarized.map((item) => item.ticker);

  const fmpKey = fmpApiKey();
  const avKey = alphaVantageApiKey();

  const [fundamentals, quotes, savedAnalyses] = await Promise.all([
    fmpKey && tickers.length > 0
      ? ensureFreshFundamentals(tickers, {
          source: createFmpFundamentalsSource(fmpKey),
          staleAfterHours: fundamentalsStaleAfterHours(),
        })
      : Promise.resolve(new Map<string, FundamentalsView>()),
    avKey && tickers.length > 0
      ? ensureFreshQuotes(
          tickers.map((ticker) => ({ symbol: ticker, currency: 'USD' })),
          { source: createAlphaVantageQuoteSource(avKey), staleAfterHours: quoteStaleAfterHours() },
        )
      : Promise.resolve(new Map<string, QuoteView>()),
    getStockAnalysesForTickers(householdId, tickers),
  ]);

  const summaries = new Map<string, WorkbenchSummary>();
  for (const ticker of tickers) {
    const statements = fundamentals.get(ticker)?.statements ?? null;
    const quotePrice = quotes.get(ticker)?.price ?? null;

    // Reflects saved assumptions if any exist, or the generic house defaults
    // otherwise — deliberately not the data-driven suggestions `[ticker]/page.tsx`
    // prefills a first visit with, which would mean fetching per-ticker FCF-history
    // and beta suggestions for every watchlist row just to show a badge. Visiting the
    // ticker page is what surfaces those suggestions.
    let dcfInputs = DEFAULT_DCF_INPUTS;
    const saved = savedAnalyses.get(ticker);
    if (saved) {
      try {
        dcfInputs = parseDcfInputs(saved.inputs);
      } catch {
        // Malformed/future-schema row — fall back to defaults, same posture as
        // `[ticker]/page.tsx`.
      }
    }

    const stale = (fundamentals.get(ticker)?.stale ?? false) || (quotes.get(ticker)?.stale ?? false);
    summaries.set(ticker, buildWorkbenchSummary(statements, quotePrice, dcfInputs, stale));
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-content-faint">
            <th className="py-1.5 pr-4">Ticker</th>
            <th className="py-1.5 pr-4">Price</th>
            <th className="py-1.5 pr-4">DCF signal</th>
            <th className="py-1.5 pr-4">Checklist</th>
            <th className="py-1.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {watchlist.map((item) => {
            const summary = summaries.get(item.ticker);
            const counts = summary?.checklistCounts ?? null;
            const checklistLabel = counts ? `${counts.pass}/${counts.pass + counts.warn + counts.fail + counts.unknown} pass` : '—';

            return (
              <tr key={item.id} className="border-t border-line">
                <td className="py-2.5 pr-4">
                  <Link
                    href={`/stocks/${item.ticker}`}
                    className="font-medium tabular text-content underline-offset-2 hover:underline"
                  >
                    {item.ticker}
                  </Link>
                  {summary?.stale ? (
                    <span
                      title="Showing the last successfully fetched data — a fresh check just now didn’t go through"
                      aria-label="data may be out of date"
                      className="ml-1.5 text-xs text-content-faint"
                    >
                      ⟳
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4 tabular text-content-muted">
                  {summary?.marketPricePence != null
                    ? formatMoney(summary.marketPricePence, { showPence: true, currency: 'USD' })
                    : '—'}
                </td>
                <td className={`py-2.5 pr-4 ${deltaTone(summary?.deltaLine ?? null)}`}>
                  {summary?.deltaLine ?? '—'}
                </td>
                <td className={`py-2.5 pr-4 tabular ${checklistTone(counts)}`}>{checklistLabel}</td>
                <td className="py-2.5">
                  <form action={removeWatchlistItem}>
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-content-muted underline underline-offset-2 hover:text-content"
                    >
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {watchlist.length > MAX_WATCHLIST_SUMMARIES ? (
        <p className="mt-3 text-xs text-content-faint">
          Showing price and signal data for the first {MAX_WATCHLIST_SUMMARIES} tickers only.
        </p>
      ) : null}
      {!fmpKey && !avKey ? (
        <p className="mt-3 text-xs text-content-faint">
          No market-data providers configured — see{' '}
          <code className="text-xs">FMP_API_KEY</code> and{' '}
          <code className="text-xs">ALPHA_VANTAGE_API_KEY</code> in{' '}
          <code className="text-xs">.env</code>.
        </p>
      ) : null}
    </div>
  );
}
