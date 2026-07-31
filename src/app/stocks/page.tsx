import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { WatchlistForm } from '@/components/stocks/WatchlistForm';
import { getSetupState } from '@/lib/household/queries';
import { getWatchlist } from '@/lib/stocks/queries';
import { addToWatchlist, removeFromWatchlist } from '@/lib/stocks/actions';

/**
 * Phase 4, Milestone 1 — the watchlist. Deliberately the *only* thing this page does:
 * no DCF/relative-valuation/checklist content yet (Milestones 2–4), no fundamentals
 * fetch triggered from here yet either. Its job is proving the schema, the FMP
 * provider boundary, and the CRUD layer work end to end — the same "ship the
 * foundation, not the whole feature" shape Phase 3's own M1–M2 took before any engine
 * logic existed.
 */

export const dynamic = 'force-dynamic';

/** Bare single-button form has nothing to render a field error into — same reasoning
 * (and same wrapper shape) as `removeHolding` in `src/app/accounts/[id]/page.tsx`. */
async function removeWatchlistItem(formData: FormData) {
  'use server';
  await removeFromWatchlist(formData);
}

export default async function StocksPage() {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const watchlist = await getWatchlist(setup.householdId);

  return (
    <AppShell pathname="/stocks">
      <h1 className="font-serif text-3xl leading-tight text-content">Stocks</h1>
      <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-content-muted">
        A watchlist for tickers you’re researching — separate from anything you actually
        hold (see Portfolio for that). DCF, relative valuation, and a fundamentals
        checklist are coming in later milestones; for now this just tracks what you’re
        keeping an eye on.
      </p>

      <section className="mt-7 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Watchlist</h2>

        {watchlist.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {watchlist.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-3"
              >
                <span className="text-sm font-medium tabular text-content">{item.ticker}</span>
                <form action={removeWatchlistItem}>
                  <input type="hidden" name="id" value={item.id} />
                  <button
                    type="submit"
                    className="text-xs font-medium text-content-muted underline underline-offset-2 hover:text-content"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-content-faint">Nothing on your watchlist yet.</p>
        )}

        <div className="mt-6 border-t border-line pt-5">
          <WatchlistForm action={addToWatchlist} />
        </div>
      </section>
    </AppShell>
  );
}
