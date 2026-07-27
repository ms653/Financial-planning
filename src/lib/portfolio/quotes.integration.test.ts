import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';

/**
 * `ensureFreshQuotes` against a real Postgres, with an **injected fake `QuoteSource`** —
 * never real Alpha Vantage. CI has no API key and no network access, and this codebase's
 * ethos is that tests never depend on a real external service (the same reason the two
 * existing integration suites point at a scratch database rather than production).
 *
 * `TEST_DATABASE_URL` must be set (see DATABASE_URL is read by `getDb()` via
 * `src/lib/env.ts`, so this file also sets `DATABASE_URL` before importing the module
 * under test — mirroring `flow.integration.test.ts`'s pattern for the same reason: the db
 * client reads the env var at first use, not at import time, but only if it's set before
 * that first call happens).
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('ensureFreshQuotes against real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let ensureFreshQuotes: typeof import('./quotes').ensureFreshQuotes;
  let quoteCache: typeof schema.quoteCache;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });

    process.env.DATABASE_URL = connectionString;
    ({ ensureFreshQuotes } = await import('./quotes'));
    ({ quoteCache } = await import('@/lib/db/schema'));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE quote_cache RESTART IDENTITY CASCADE;');
  });

  /** A `QuoteSource` whose responses are scripted per-symbol, and which counts calls —
   * the assertion surface for "did this refetch or serve from cache." */
  function fakeSource(responses: Record<string, Awaited<ReturnType<typeof import('./quotes').fetchGlobalQuote>>>) {
    const calls: string[] = [];
    return {
      source: {
        fetchQuote: async (symbol: string) => {
          calls.push(symbol);
          return responses[symbol] ?? { status: 'not-found' as const };
        },
      },
      calls,
    };
  }

  it('fetches and caches a symbol with no existing row', async () => {
    const { source, calls } = fakeSource({
      'VUAG.LON': { status: 'ok', symbol: 'VUAG.LON', rawPrice: '107.7600' },
    });

    const result = await ensureFreshQuotes([{ symbol: 'VUAG.LON', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
    });

    expect(calls).toEqual(['VUAG.LON']);
    expect(result.get('VUAG.LON')).toMatchObject({ price: '107.7600', currency: 'GBP', stale: false });

    const rows = await db.select().from(quoteCache);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.price).toBe('107.7600');
  });

  it('does not refetch a symbol that is still fresh', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    await db.insert(quoteCache).values({
      symbol: 'VUAG.LON',
      currency: 'GBP',
      price: '107.7600',
      fetchedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1h old
    });
    const { source, calls } = fakeSource({});

    const result = await ensureFreshQuotes([{ symbol: 'VUAG.LON', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
      now,
    });

    expect(calls).toEqual([]); // never called the source at all
    expect(result.get('VUAG.LON')).toMatchObject({ price: '107.7600', stale: false });
  });

  it('refetches a symbol past the staleness threshold', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    await db.insert(quoteCache).values({
      symbol: 'VUAG.LON',
      currency: 'GBP',
      price: '100.0000',
      fetchedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000), // 25h old
    });
    const { source, calls } = fakeSource({
      'VUAG.LON': { status: 'ok', symbol: 'VUAG.LON', rawPrice: '110.0000' },
    });

    const result = await ensureFreshQuotes([{ symbol: 'VUAG.LON', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
      now,
    });

    expect(calls).toEqual(['VUAG.LON']);
    expect(result.get('VUAG.LON')).toMatchObject({ price: '110.0000', stale: false });
  });

  it('falls back to the last cached price, marked stale, on a rate-limited refetch', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    await db.insert(quoteCache).values({
      symbol: 'VUAG.LON',
      currency: 'GBP',
      price: '100.0000',
      fetchedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
    });
    const { source } = fakeSource({ 'VUAG.LON': { status: 'rate-limited' } });

    const result = await ensureFreshQuotes([{ symbol: 'VUAG.LON', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
      now,
    });

    expect(result.get('VUAG.LON')).toMatchObject({ price: '100.0000', stale: true });
    // The stale cached row is left as-is, not overwritten with nothing.
    const rows = await db.select().from(quoteCache);
    expect(rows[0]!.price).toBe('100.0000');
  });

  it('omits a symbol entirely when there is no cache and the fetch fails', async () => {
    const { source } = fakeSource({ 'VUAG.LON': { status: 'network-error', message: 'timeout' } });

    const result = await ensureFreshQuotes([{ symbol: 'VUAG.LON', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
    });

    expect(result.has('VUAG.LON')).toBe(false);
  });

  // Found by independent code review: an "ok" response with a malformed price (the
  // provider's own request, not a network/rate-limit failure) threw uncaught out of
  // `ensureFreshQuotes` and crashed the calling Server Component's render — the opposite
  // of the "provider outage must not break the page" guarantee this module claims
  // everywhere else. These two tests are the regression coverage for that fix.
  it('does not throw when the source returns a malformed price, and omits the symbol with no prior cache', async () => {
    const { source } = fakeSource({ 'VUAG.LON': { status: 'ok', symbol: 'VUAG.LON', rawPrice: 'N/A' } });

    const result = await ensureFreshQuotes([{ symbol: 'VUAG.LON', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
    });

    expect(result.has('VUAG.LON')).toBe(false);
    expect(await db.select().from(quoteCache)).toHaveLength(0); // nothing written on failure
  });

  it('falls back to the last cached price, marked stale, when a refetch returns a malformed price', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    await db.insert(quoteCache).values({
      symbol: 'VUAG.LON',
      currency: 'GBP',
      price: '100.0000',
      fetchedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000), // stale, triggers a refetch
    });
    const { source } = fakeSource({
      'VUAG.LON': { status: 'ok', symbol: 'VUAG.LON', rawPrice: '-107.7600' }, // negative: rejected
    });

    const result = await ensureFreshQuotes([{ symbol: 'VUAG.LON', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
      now,
    });

    expect(result.get('VUAG.LON')).toMatchObject({ price: '100.0000', stale: true });
    // The old cached row is left untouched, not overwritten with the bad value.
    const rows = await db.select().from(quoteCache);
    expect(rows[0]!.price).toBe('100.0000');
  });

  it('caches a confirmed not-found as a null price, and does not re-fetch it while fresh', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    const { source, calls } = fakeSource({ VANGFTSEGACC: { status: 'not-found' } });

    const first = await ensureFreshQuotes([{ symbol: 'VANGFTSEGACC', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
      now,
    });
    expect(first.get('VANGFTSEGACC')).toMatchObject({ price: null, stale: false });

    const second = await ensureFreshQuotes([{ symbol: 'VANGFTSEGACC', currency: 'GBP' }], {
      source,
      staleAfterHours: 24,
      now: new Date(now.getTime() + 60 * 60 * 1000), // 1h later, still fresh
    });
    expect(second.get('VANGFTSEGACC')).toMatchObject({ price: null, stale: false });
    expect(calls).toEqual(['VANGFTSEGACC']); // only the first call actually hit the source
  });

  it('shares one row and one fetch across two holdings of the same symbol', async () => {
    const { source, calls } = fakeSource({
      'VUAG.LON': { status: 'ok', symbol: 'VUAG.LON', rawPrice: '107.7600' },
    });

    const result = await ensureFreshQuotes(
      [
        { symbol: 'VUAG.LON', currency: 'GBP' },
        { symbol: 'VUAG.LON', currency: 'GBP' },
      ],
      { source, staleAfterHours: 24 },
    );

    expect(calls).toEqual(['VUAG.LON']); // de-duplicated, not fetched twice
    expect(result.size).toBe(1);
    expect(result.get('VUAG.LON')).toMatchObject({ price: '107.7600' });
  });
});
