import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The action calls revalidatePath, which needs a Next request scope that doesn't exist
// in a plain test — same convention as watchlistCrud.integration.test.ts.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { households, stockAnalyses } from '@/lib/db/schema';
import { saveDcfInputs } from '@/lib/stocks/actions';
import { getStockAnalysesForTickers } from '@/lib/stocks/queries';

/**
 * Exercises the real exported `saveDcfInputs` Server Action directly against a real
 * Postgres, mirroring `watchlistCrud.integration.test.ts`'s convention.
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('saveDcfInputs against a real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let householdId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });
    process.env.DATABASE_URL = connectionString;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE stock_analysis, household RESTART IDENTITY CASCADE;');
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    householdId = household!.id;
  });

  function validInputsJson(overrides: Partial<Record<string, unknown>> = {}): string {
    return JSON.stringify({
      schemaVersion: 1,
      growthRatePct: '8.000',
      discountRatePct: '10.000',
      terminalGrowthRatePct: '2.500',
      projectionYears: 5,
      ...overrides,
    });
  }

  function formData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  it('creates a stock_analysis row on first save', async () => {
    const result = await saveDcfInputs(formData({ ticker: 'aapl', inputs: validInputsJson() }));
    expect(result.ok).toBe(true);

    const rows = await db.select().from(stockAnalyses);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticker).toBe('AAPL'); // uppercased, same convention as watchlist
    expect(rows[0]!.inputs).toEqual({
      schemaVersion: 1,
      growthRatePct: '8.000',
      discountRatePct: '10.000',
      terminalGrowthRatePct: '2.500',
      projectionYears: 5,
    });
  });

  it('updates the same row in place on a second save, not a duplicate', async () => {
    await saveDcfInputs(formData({ ticker: 'AAPL', inputs: validInputsJson() }));
    const result = await saveDcfInputs(
      formData({ ticker: 'AAPL', inputs: validInputsJson({ growthRatePct: '12.000' }) }),
    );

    expect(result.ok).toBe(true);
    const rows = await db.select().from(stockAnalyses);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.inputs as { growthRatePct: string }).growthRatePct).toBe('12.000');
  });

  it('rejects an invalid ticker with a field error, and writes nothing', async () => {
    const result = await saveDcfInputs(formData({ ticker: '', inputs: validInputsJson() }));
    expect(result).toEqual({ ok: false, errors: { ticker: 'Enter a ticker, like AAPL.' } });
    expect(await db.select().from(stockAnalyses)).toHaveLength(0);
  });

  it('rejects terminalGrowthRatePct >= discountRatePct with a form error, and writes nothing', async () => {
    const result = await saveDcfInputs(
      formData({ ticker: 'AAPL', inputs: validInputsJson({ terminalGrowthRatePct: '10.000' }) }),
    );
    expect(result.ok).toBe(false);
    expect((result as { formError?: string }).formError).toMatch(/terminalGrowthRatePct must be less than/);
    expect(await db.select().from(stockAnalyses)).toHaveLength(0);
  });

  it('rejects malformed JSON with a form error', async () => {
    const result = await saveDcfInputs(formData({ ticker: 'AAPL', inputs: '{not json' }));
    expect(result.ok).toBe(false);
    expect((result as { formError?: string }).formError).toBe('DCF inputs must be valid JSON.');
  });

  it('two tickers for the same household each get their own row', async () => {
    await saveDcfInputs(formData({ ticker: 'AAPL', inputs: validInputsJson() }));
    await saveDcfInputs(formData({ ticker: 'MSFT', inputs: validInputsJson() }));

    const rows = await db.select().from(stockAnalyses).orderBy(stockAnalyses.ticker);
    expect(rows.map((r) => r.ticker)).toEqual(['AAPL', 'MSFT']);
  });

  it('does not affect other columns (created_at) when updating', async () => {
    await saveDcfInputs(formData({ ticker: 'AAPL', inputs: validInputsJson() }));
    const [before] = await db.select().from(stockAnalyses).where(eq(stockAnalyses.ticker, 'AAPL'));

    await saveDcfInputs(formData({ ticker: 'AAPL', inputs: validInputsJson({ growthRatePct: '1.000' }) }));
    const [after] = await db.select().from(stockAnalyses).where(eq(stockAnalyses.ticker, 'AAPL'));

    expect(after!.createdAt).toEqual(before!.createdAt);
  });

  describe('getStockAnalysesForTickers', () => {
    it('returns one query for many tickers, keyed by ticker, omitting tickers with no saved row', async () => {
      await saveDcfInputs(formData({ ticker: 'AAPL', inputs: validInputsJson() }));
      await saveDcfInputs(formData({ ticker: 'MSFT', inputs: validInputsJson({ growthRatePct: '3.000' }) }));

      const result = await getStockAnalysesForTickers(householdId, ['AAPL', 'MSFT', 'GOOG']);

      expect(result.size).toBe(2);
      expect((result.get('AAPL')!.inputs as { growthRatePct: string }).growthRatePct).toBe('8.000');
      expect((result.get('MSFT')!.inputs as { growthRatePct: string }).growthRatePct).toBe('3.000');
      expect(result.has('GOOG')).toBe(false);
    });

    it('returns an empty map for an empty ticker list, without querying', async () => {
      await saveDcfInputs(formData({ ticker: 'AAPL', inputs: validInputsJson() }));

      const result = await getStockAnalysesForTickers(householdId, []);

      expect(result.size).toBe(0);
    });
  });
});
