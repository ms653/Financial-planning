import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The actions call revalidatePath, which needs a Next request scope that doesn't exist
// in a plain test — same convention as watchlistCrud.integration.test.ts.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import { accounts, holdings, households, regularContributions, type AccountTypeValue } from '@/lib/db/schema';
import { addRegularContribution, deleteRegularContribution, updateRegularContribution } from '@/lib/household/actions';
import { getPortfolioHoldings, getRegularContributionAmounts } from '@/lib/household/queries';
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

  async function seedAccount(type: AccountTypeValue, overrides: Partial<{ archived: boolean }> = {}): Promise<number> {
    const [account] = await db
      .insert(accounts)
      .values({
        householdId,
        name: `Test ${type}`,
        type,
        taxWrapper: taxWrapperForType(type),
        archived: overrides.archived ?? false,
      })
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

describe.skipIf(!connectionString)('getRegularContributionAmounts against a real Postgres', () => {
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

  it('excludes an archived account’s contribution — matching resolveScenario.ts, which never simulates it', async () => {
    // Regression test: this query had no archived filter, so an archived account's
    // regular contribution appeared in the retirement results page's disclosure note
    // while resolveScenario.ts (sourced via getAccountsWithBalances, which does
    // exclude archived accounts) never simulated it — a real UI/engine divergence.
    const [live] = await db
      .insert(accounts)
      .values({ householdId, name: 'Live GIA', type: 'gia', taxWrapper: taxWrapperForType('gia') })
      .returning();
    const [archived] = await db
      .insert(accounts)
      .values({ householdId, name: 'Archived ISA', type: 'cash_isa', taxWrapper: taxWrapperForType('cash_isa'), archived: true })
      .returning();
    await db.insert(regularContributions).values([
      { accountId: live!.id, amount: '2400.00' },
      { accountId: archived!.id, amount: '3600.00' },
    ]);

    const rows = await getRegularContributionAmounts(householdId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('2400.00');
  });
});

describe.skipIf(!connectionString)('getPortfolioHoldings against a real Postgres', () => {
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
    await pool.query('TRUNCATE TABLE holding, regular_contribution, account, household RESTART IDENTITY CASCADE;');
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    householdId = household!.id;
  });

  it('sums two regular_contribution rows for the same (account, ticker), rather than showing only the last one', async () => {
    // Regression test for a real bug (found by independent review): the lookup Map
    // was keyed by (accountId, ticker) with no summing, so a second contribution row
    // for the same ticker on the same account silently overwrote the first instead of
    // adding to it — resolveScenario.ts (the retirement engine) already summed both
    // correctly, so the portfolio table was under-reporting relative to what's
    // actually simulated.
    const [gia] = await db
      .insert(accounts)
      .values({ householdId, name: 'GIA', type: 'gia', taxWrapper: taxWrapperForType('gia') })
      .returning();
    await db.insert(holdings).values({ accountId: gia!.id, ticker: 'VWRL', quantity: '10', costBasis: '1000.00' });
    await db.insert(regularContributions).values([
      { accountId: gia!.id, ticker: 'VWRL', amount: '1200.00' },
      { accountId: gia!.id, ticker: 'VWRL', amount: '600.00' },
    ]);

    const rows = await getPortfolioHoldings(householdId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.regularContributionAmount).toBe('1800.00');
  });

  it('reports null, not "0.00", when a holding has no regular contribution at all', async () => {
    const [gia] = await db
      .insert(accounts)
      .values({ householdId, name: 'GIA', type: 'gia', taxWrapper: taxWrapperForType('gia') })
      .returning();
    await db.insert(holdings).values({ accountId: gia!.id, ticker: 'VWRL', quantity: '10', costBasis: '1000.00' });

    const rows = await getPortfolioHoldings(householdId);

    expect(rows[0]!.regularContributionAmount).toBeNull();
  });
});
