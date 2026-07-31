/**
 * Phase 4 reads — mirrors `src/lib/household/queries.ts`'s established shape: plain
 * functions scoped by an already-resolved `householdId`, never throwing for a
 * not-found/empty case.
 */
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { watchlistItems } from '@/lib/db/schema';

export interface WatchlistItemView {
  id: number;
  ticker: string;
  addedAt: Date;
}

export async function getWatchlist(householdId: number): Promise<WatchlistItemView[]> {
  const db = getDb();
  return db
    .select({ id: watchlistItems.id, ticker: watchlistItems.ticker, addedAt: watchlistItems.addedAt })
    .from(watchlistItems)
    .where(eq(watchlistItems.householdId, householdId))
    // Creation order — same "household's own mental ordering" reasoning as
    // `getPeople`'s own doc comment, not an alphabetised list they didn't ask for.
    .orderBy(asc(watchlistItems.addedAt));
}
