import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';

/**
 * `ensureFreshFundamentals` against a real Postgres, with an **injected fake
 * `FundamentalsSource`** — never real FMP, mirroring
 * `src/lib/portfolio/quotes.integration.test.ts`'s exact structure and reasoning (CI
 * has no API key or network access, and this codebase's tests never depend on a real
 * external service).
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('ensureFreshFundamentals against real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let ensureFreshFundamentals: typeof import('./fmp').ensureFreshFundamentals;
  let fundamentalsCache: typeof schema.fundamentalsCache;

  const STATEMENTS = {
    incomeStatements: [{ date: '2025-12-31', revenue: 1000 }],
    balanceSheets: [{ date: '2025-12-31', totalStockholdersEquity: 500 }],
    cashFlowStatements: [{ date: '2025-12-31', freeCashFlow: 200 }],
    beta: 1.1,
    ratios: [{ date: '2025-12-31', priceToEarningsRatio: 20 }],
    keyMetrics: [{ date: '2025-12-31', evToEBITDA: 15 }],
    peers: [{ ticker: 'MSFT', companyName: 'Microsoft Corporation' }],
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });

    process.env.DATABASE_URL = connectionString;
    ({ ensureFreshFundamentals } = await import('./fmp'));
    ({ fundamentalsCache } = await import('@/lib/db/schema'));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE fundamentals_cache RESTART IDENTITY CASCADE;');
  });

  /** A `FundamentalsSource` whose responses are scripted per-ticker, and which counts
   * calls — the assertion surface for "did this refetch or serve from cache." */
  function fakeSource(
    responses: Record<string, Awaited<ReturnType<typeof import('./fmp').fetchFundamentals>>>,
  ) {
    const calls: string[] = [];
    return {
      source: {
        fetchFundamentals: async (ticker: string) => {
          calls.push(ticker);
          return responses[ticker] ?? { status: 'not-found' as const };
        },
      },
      calls,
    };
  }

  it('fetches and caches a ticker with no existing row', async () => {
    const { source, calls } = fakeSource({
      AAPL: { status: 'ok', ticker: 'AAPL', ...STATEMENTS },
    });

    const result = await ensureFreshFundamentals(['AAPL'], { source, staleAfterHours: 24 });

    expect(calls).toEqual(['AAPL']);
    expect(result.get('AAPL')).toMatchObject({ statements: STATEMENTS, stale: false });

    const rows = await db.select().from(fundamentalsCache);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statements).toEqual(STATEMENTS);
  });

  it('does not refetch a ticker that is still fresh', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    await db.insert(fundamentalsCache).values({
      ticker: 'AAPL',
      statements: STATEMENTS,
      fetchedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1h old
    });
    const { source, calls } = fakeSource({});

    const result = await ensureFreshFundamentals(['AAPL'], { source, staleAfterHours: 24, now });

    expect(calls).toEqual([]); // never called the source at all
    expect(result.get('AAPL')).toMatchObject({ statements: STATEMENTS, stale: false });
  });

  it('refetches a ticker past the staleness threshold', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    await db.insert(fundamentalsCache).values({
      ticker: 'AAPL',
      statements: STATEMENTS,
      fetchedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000), // 25h old
    });
    const updated = { ...STATEMENTS, incomeStatements: [{ date: '2026-12-31', revenue: 2000 }] };
    const { source, calls } = fakeSource({ AAPL: { status: 'ok', ticker: 'AAPL', ...updated } });

    const result = await ensureFreshFundamentals(['AAPL'], { source, staleAfterHours: 24, now });

    expect(calls).toEqual(['AAPL']);
    expect(result.get('AAPL')).toMatchObject({ statements: updated, stale: false });
  });

  it('falls back to the last cached statements, marked stale, on a rate-limited refetch', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    await db.insert(fundamentalsCache).values({
      ticker: 'AAPL',
      statements: STATEMENTS,
      fetchedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
    });
    const { source } = fakeSource({ AAPL: { status: 'rate-limited' } });

    const result = await ensureFreshFundamentals(['AAPL'], { source, staleAfterHours: 24, now });

    expect(result.get('AAPL')).toMatchObject({ statements: STATEMENTS, stale: true });
    const rows = await db.select().from(fundamentalsCache);
    expect(rows[0]!.statements).toEqual(STATEMENTS); // left as-is, not overwritten with nothing
  });

  it('omits a ticker entirely when there is no cache and the fetch fails', async () => {
    const { source } = fakeSource({ AAPL: { status: 'network-error', message: 'timeout' } });

    const result = await ensureFreshFundamentals(['AAPL'], { source, staleAfterHours: 24 });

    expect(result.has('AAPL')).toBe(false);
  });

  it('caches a confirmed not-found ticker as null statements, and does not re-fetch it while fresh', async () => {
    const now = new Date('2026-07-27T12:00:00Z');
    const { source, calls } = fakeSource({ NOTATICKER: { status: 'not-found' } });

    const first = await ensureFreshFundamentals(['NOTATICKER'], { source, staleAfterHours: 24, now });
    expect(first.get('NOTATICKER')).toMatchObject({ statements: null, stale: false });

    const second = await ensureFreshFundamentals(['NOTATICKER'], {
      source,
      staleAfterHours: 24,
      now: new Date(now.getTime() + 60 * 60 * 1000), // 1h later, still fresh
    });
    expect(second.get('NOTATICKER')).toMatchObject({ statements: null, stale: false });
    expect(calls).toEqual(['NOTATICKER']); // only the first call actually hit the source
  });

  it('de-duplicates a repeated ticker into one fetch', async () => {
    const { source, calls } = fakeSource({ AAPL: { status: 'ok', ticker: 'AAPL', ...STATEMENTS } });

    const result = await ensureFreshFundamentals(['AAPL', 'AAPL'], { source, staleAfterHours: 24 });

    expect(calls).toEqual(['AAPL']);
    expect(result.size).toBe(1);
  });
});
