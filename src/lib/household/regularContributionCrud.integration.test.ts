import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The actions call revalidatePath, which needs a Next request scope that doesn't exist
// in a plain test — same convention as watchlistCrud.integration.test.ts.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import { accounts, households, regularContributions, type AccountTypeValue } from '@/lib/db/schema';
import { addRegularContribution, deleteRegularContribution, updateRegularContribution } from '@/lib/household/actions';
import { taxWrapperForType } from '@/lib/accounts/types';

/**
 * Exercises the real exported `addRegularContribution`/`updateRegularContribution`/
 * `deleteRegularContribution` Server Actions directly against a real Postgres —
 * Phase 4.4's follow-up, mirroring `dcfCrud.integration.test.ts`'s convention of
 * driving the actual functions a form would call rather than re-implementing their
 * logic here.
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('regular contribution CRUD against a real Postgres', () => {
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
    await pool.query('TRUNCATE TABLE regular_contribution, account, household RESTART IDENTITY CASCADE;');
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    householdId = household!.id;
  });

  async function seedAccount(type: AccountTypeValue): Promise<number> {
    const [account] = await db
      .insert(accounts)
      .values({ householdId, name: `Test ${type}`, type, taxWrapper: taxWrapperForType(type) })
      .returning();
    return account!.id;
  }

  function formData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  it('adds a regular contribution with a ticker to a GIA', async () => {
    const accountId = await seedAccount('gia');
    const result = await addRegularContribution(formData({ accountId: String(accountId), amount: '2400', ticker: 'vwrl' }));
    expect(result.ok).toBe(true);

    const rows = await db.select().from(regularContributions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticker).toBe('VWRL'); // uppercased, same convention as watchlist/holding
    expect(rows[0]!.amount).toBe('2400.00');
  });

  it('adds a plain cash contribution (blank ticker) to a Cash ISA', async () => {
    const accountId = await seedAccount('cash_isa');
    const result = await addRegularContribution(formData({ accountId: String(accountId), amount: '3600', ticker: '' }));
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(regularContributions);
    expect(row!.ticker).toBeNull();
  });

  it.each(['debt', 'property', 'sipp_pension'] as const)(
    'rejects a %s account — not a valid regular-contribution wrapper',
    async (type) => {
      const accountId = await seedAccount(type);
      const result = await addRegularContribution(formData({ accountId: String(accountId), amount: '2400', ticker: '' }));
      expect(result.ok).toBe(false);
      expect(await db.select().from(regularContributions)).toHaveLength(0);
    },
  );

  it('rejects a blank amount with a field error, and writes nothing', async () => {
    const accountId = await seedAccount('gia');
    const result = await addRegularContribution(formData({ accountId: String(accountId), amount: '', ticker: '' }));
    expect(result).toEqual({ ok: false, errors: { amount: 'Enter a yearly contribution amount.' } });
    expect(await db.select().from(regularContributions)).toHaveLength(0);
  });

  it('updates an existing contribution in place, not a duplicate row', async () => {
    const accountId = await seedAccount('gia');
    await addRegularContribution(formData({ accountId: String(accountId), amount: '2400', ticker: 'vwrl' }));
    const [existing] = await db.select().from(regularContributions);

    const result = await updateRegularContribution(
      formData({ contributionId: String(existing!.id), accountId: String(accountId), amount: '3000', ticker: 'vwrp' }),
    );

    expect(result.ok).toBe(true);
    const rows = await db.select().from(regularContributions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('3000.00');
    expect(rows[0]!.ticker).toBe('VWRP');
  });

  it('deletes a contribution', async () => {
    const accountId = await seedAccount('gia');
    await addRegularContribution(formData({ accountId: String(accountId), amount: '2400', ticker: '' }));
    const [existing] = await db.select().from(regularContributions);

    const result = await deleteRegularContribution(formData({ contributionId: String(existing!.id) }));

    expect(result.ok).toBe(true);
    expect(await db.select().from(regularContributions)).toHaveLength(0);
  });

  it('rejects deleting a non-existent id', async () => {
    // Unlike removeFromWatchlist's raw DELETE, this mirrors deleteHolding's own
    // pattern: an existence check scoped by household runs first, so a stale or
    // forged id fails loudly rather than silently matching zero rows.
    const result = await deleteRegularContribution(formData({ contributionId: '999999' }));
    expect(result.ok).toBe(false);
  });
});
