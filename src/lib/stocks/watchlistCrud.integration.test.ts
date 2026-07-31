import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The actions call revalidatePath, which needs a Next request scope that doesn't exist
// in a plain test — same convention as scenarioCrud.integration.test.ts.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import { households } from '@/lib/db/schema';
import { addToWatchlist, removeFromWatchlist } from '@/lib/stocks/actions';
import { getWatchlist } from '@/lib/stocks/queries';

/**
 * Exercises the real exported Server Actions and read query directly against a real
 * Postgres, mirroring `scenarioCrud.integration.test.ts`'s convention of driving the
 * actual functions a form would call rather than re-implementing their logic here.
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('watchlist CRUD against a real Postgres', () => {
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
    await pool.query('TRUNCATE TABLE watchlist_item, household RESTART IDENTITY CASCADE;');
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    householdId = household!.id;
  });

  function formData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  it('adds a ticker, uppercasing it, and it appears in getWatchlist', async () => {
    const result = await addToWatchlist(formData({ ticker: 'aapl' }));
    expect(result.ok).toBe(true);

    const list = await getWatchlist(householdId);
    expect(list).toHaveLength(1);
    expect(list[0]!.ticker).toBe('AAPL');
  });

  it('rejects a blank ticker with a field error, and writes nothing', async () => {
    const result = await addToWatchlist(formData({ ticker: '  ' }));
    expect(result).toEqual({ ok: false, errors: { ticker: 'Enter a ticker, like AAPL.' } });
    expect(await getWatchlist(householdId)).toHaveLength(0);
  });

  it('rejects a malformed ticker with a field error', async () => {
    const result = await addToWatchlist(formData({ ticker: 'not a ticker!' }));
    expect(result).toEqual({
      ok: false,
      errors: { ticker: 'Tickers are letters, digits, dots and dashes.' },
    });
  });

  it('adding an already-watched ticker is a no-op, not a duplicate row', async () => {
    await addToWatchlist(formData({ ticker: 'AAPL' }));
    const second = await addToWatchlist(formData({ ticker: 'AAPL' }));

    expect(second.ok).toBe(true);
    expect(await getWatchlist(householdId)).toHaveLength(1);
  });

  it('removes a watched ticker', async () => {
    await addToWatchlist(formData({ ticker: 'AAPL' }));
    const [item] = await getWatchlist(householdId);

    const result = await removeFromWatchlist(formData({ id: String(item!.id) }));

    expect(result.ok).toBe(true);
    expect(await getWatchlist(householdId)).toHaveLength(0);
  });

  it('removing a non-existent id is a safe no-op, not an error', async () => {
    // household_singleton (schema.ts) means this app can never have a second household
    // to test true cross-household isolation against — there is only ever one row in
    // `household`, so `requireHouseholdId()` always resolves to it. What *is* real and
    // worth covering: `removeFromWatchlist`'s `WHERE id = ... AND household_id = ...`
    // matching zero rows (a stale id, or one already removed) must report success, the
    // same as Postgres's own "DELETE matched 0 rows" is not an error — not throw or
    // silently misbehave.
    const result = await removeFromWatchlist(formData({ id: '999999' }));

    expect(result.ok).toBe(true);
  });
});
