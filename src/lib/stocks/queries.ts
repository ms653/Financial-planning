/**
 * Phase 4 reads — mirrors `src/lib/household/queries.ts`'s established shape: plain
 * functions scoped by an already-resolved `householdId`, never throwing for a
 * not-found/empty case.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { stockAnalyses, watchlistItems } from '@/lib/db/schema';

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

export interface StockAnalysisView {
  /** Raw `unknown` — the only code path allowed to read this as a typed shape is
   * `parseDcfInputs` (`src/lib/stocks/dcf.ts`), same "validate through a typed parser,
   * don't trust the column type" posture as `retirement_scenario.assumptions`. */
  inputs: unknown;
}

/** Milestone 2's first real caller of `stock_analysis` — M1 left the table unread since
 * nothing consumed it yet. `null` when this household has never saved DCF (or any
 * other) inputs for this ticker; the caller falls back to defaults. */
export async function getStockAnalysis(householdId: number, ticker: string): Promise<StockAnalysisView | null> {
  const db = getDb();
  const [row] = await db
    .select({ inputs: stockAnalyses.inputs })
    .from(stockAnalyses)
    .where(and(eq(stockAnalyses.householdId, householdId), eq(stockAnalyses.ticker, ticker)));
  return row ?? null;
}

/** Batch form of `getStockAnalysis`, for a page (the watchlist, Milestone 5) that
 * needs saved DCF assumptions for many tickers at once rather than issuing one query
 * per row. A ticker with no saved row simply has no entry in the returned map — the
 * caller falls back to defaults per ticker, same as `getStockAnalysis`'s own `null`. */
export async function getStockAnalysesForTickers(
  householdId: number,
  tickers: string[],
): Promise<Map<string, StockAnalysisView>> {
  if (tickers.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({ ticker: stockAnalyses.ticker, inputs: stockAnalyses.inputs })
    .from(stockAnalyses)
    .where(and(eq(stockAnalyses.householdId, householdId), inArray(stockAnalyses.ticker, tickers)));

  return new Map(rows.map((row) => [row.ticker, { inputs: row.inputs }]));
}
