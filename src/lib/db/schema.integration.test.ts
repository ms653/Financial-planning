import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import {
  accounts,
  balanceSnapshots,
  debtTerms,
  fundamentalsCache,
  holdings,
  households,
  people,
  pensionContributions,
  quoteCache,
  retirementScenarios,
  simulationRuns,
  stockAnalyses,
  watchlistItems,
} from '@/lib/db/schema';
import { sumNumeric, penceToNumeric } from '@/lib/money';

/**
 * Schema and migration correctness, against a real Postgres.
 *
 * These assert the things that only a real database can tell you, and that the proposal
 * treats as load-bearing rather than incidental: that money columns keep their scale, that
 * `ON DELETE RESTRICT` genuinely refuses to vaporise financial history, that the
 * `(account_id, snapshot_date)` uniqueness Phase 6's write idempotency depends on is
 * actually enforced, and that the committed migration SQL applies cleanly from empty.
 * A unit test against Drizzle's builder could not catch a single one of those.
 *
 * Skipped unless `TEST_DATABASE_URL` is set, so `npm test` still passes on a laptop with
 * no Postgres running. CI sets it (see .github/workflows/ci.yml), so these do run there —
 * a skipped test that never runs anywhere would be worse than not writing it.
 *
 * The database this points at is **dropped and recreated on every run**. Point it at a
 * scratch database, never at the household's real one.
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('schema against real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });

    // Start from genuinely empty, so this also proves the committed migration applies from
    // scratch — not just that it applied once, months ago, on a developer's machine.
    //
    // Both schemas have to go. Drizzle records applied migrations in
    // `drizzle.__drizzle_migrations`, *outside* `public` — so dropping `public` alone
    // leaves the ledger claiming everything is applied, `migrate()` becomes a no-op, and
    // every test then fails with a baffling "relation does not exist".
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE balance_snapshot, holding, debt_terms, account, pension_contribution, person, household, quote_cache, simulation_run, retirement_scenario, watchlist_item, stock_analysis, fundamentals_cache RESTART IDENTITY CASCADE;',
    );
  });

  async function seedHousehold(): Promise<number> {
    const [row] = await db.insert(households).values({ name: 'Test household' }).returning();
    return row!.id;
  }

  async function seedPerson(householdId: number, name = 'Alex'): Promise<number> {
    const [row] = await db
      .insert(people)
      .values({ householdId, name, dateOfBirth: '1985-04-12' })
      .returning();
    return row!.id;
  }

  async function seedAccount(
    householdId: number,
    overrides: Partial<schema.NewAccount> = {},
  ): Promise<number> {
    const [row] = await db
      .insert(accounts)
      .values({
        householdId,
        name: 'Test account',
        type: 'cash',
        taxWrapper: 'none',
        ...overrides,
      })
      .returning();
    return row!.id;
  }

  describe('migration', () => {
    it('creates all fourteen tables', async () => {
      const { rows } = await pool.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
      );
      const names = rows.map((r) => r.table_name).filter((n) => n !== '__drizzle_migrations');
      expect(names.sort()).toEqual([
        'account',
        'backup_run',
        'balance_snapshot',
        'debt_terms',
        'fundamentals_cache',
        'holding',
        'household',
        'pension_contribution',
        'person',
        'quote_cache',
        'retirement_scenario',
        'simulation_run',
        'stock_analysis',
        'watchlist_item',
      ]);
    });

    it('gives every money column NUMERIC(14,2), never a float type', async () => {
      // The proposal's hardest data-model requirement. A `double precision` slipping in
      // here would be invisible until a Monte Carlo run produced 0.30000000000000004.
      const { rows } = await pool.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        numeric_precision: number;
        numeric_scale: number;
      }>(
        `select table_name, column_name, data_type, numeric_precision, numeric_scale
           from information_schema.columns
          where table_schema = 'public'
            and column_name in (
              'amount', 'employer_amount', 'annual_gross_income', 'cost_basis',
              'current_balance', 'minimum_payment'
            )
          order by table_name, column_name`,
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe('numeric');
        expect(row.numeric_precision, `${row.table_name}.${row.column_name}`).toBe(14);
        expect(row.numeric_scale, `${row.table_name}.${row.column_name}`).toBe(2);
      }
    });

    it('has no float columns anywhere in the schema', async () => {
      const { rows } = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
        `select table_name, column_name, data_type from information_schema.columns
          where table_schema = 'public' and data_type in ('real', 'double precision')`,
      );
      expect(rows).toEqual([]);
    });

    it('indexes balance_snapshot on (account_id, captured_at DESC)', async () => {
      // Named in the proposal as serving both the sparkline range query and the
      // "latest balance per account" query the dashboard hits constantly.
      const { rows } = await pool.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where tablename = 'balance_snapshot' and indexname = 'balance_snapshot_account_captured_at_idx'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.indexdef).toMatch(/account_id/);
      expect(rows[0]!.indexdef).toMatch(/captured_at DESC/);
    });

    it('makes person.date_of_birth NOT NULL and person.annual_gross_income nullable', async () => {
      const { rows } = await pool.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'person'`,
      );
      const nullability = Object.fromEntries(rows.map((r) => [r.column_name, r.is_nullable]));
      expect(nullability.date_of_birth).toBe('NO');
      expect(nullability.annual_gross_income).toBe('YES');
    });

    it('makes account.person_id nullable and account.household_id NOT NULL', async () => {
      // The joint-ownership case: NULL person_id, household as fallback owner.
      const { rows } = await pool.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'account'`,
      );
      const nullability = Object.fromEntries(rows.map((r) => [r.column_name, r.is_nullable]));
      expect(nullability.person_id).toBe('YES');
      expect(nullability.household_id).toBe('NO');
    });

    it('keeps the ISA sub-types as distinct enum values', async () => {
      const { rows } = await pool.query<{ enumlabel: string }>(
        `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'account_type' order by e.enumsortorder`,
      );
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'cash',
        'gia',
        'cash_isa',
        'ss_isa',
        'lisa',
        'sipp_pension',
        'property',
        'debt',
      ]);
    });

    it('keeps overpayment allowance and ERC rate as separate columns', async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'debt_terms' order by column_name`,
      );
      const columns = rows.map((r) => r.column_name);
      expect(columns).toContain('overpayment_allowance_pct');
      expect(columns).toContain('overpayment_allowance_balance_basis');
      expect(columns).toContain('erc_rate_pct');
      expect(columns).toContain('erc_period_end');
      // The field they were wrongly conflated into in an earlier draft.
      expect(columns).not.toContain('erc_limit');
    });
  });

  describe('money round-trips', () => {
    it('returns NUMERIC as a string, not a JavaScript number', async () => {
      // This is what makes the never-float promise keepable in the app layer.
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId);
      await db.insert(balanceSnapshots).values({
        accountId,
        amount: '12500.55',
        snapshotDate: '2026-07-26',
      });

      const [row] = await db.select().from(balanceSnapshots);
      expect(typeof row!.amount).toBe('string');
      expect(row!.amount).toBe('12500.55');
    });

    it('stores the largest and smallest amounts NUMERIC(14,2) allows without loss', async () => {
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId);
      await db.insert(balanceSnapshots).values([
        { accountId, amount: '999999999999.99', snapshotDate: '2026-07-01' },
        { accountId, amount: '0.01', snapshotDate: '2026-07-02' },
        { accountId, amount: '-376500.00', snapshotDate: '2026-07-03' },
      ]);

      const rows = await db.select({ amount: balanceSnapshots.amount }).from(balanceSnapshots);
      expect(rows.map((r) => r.amount).sort()).toEqual(
        ['-376500.00', '0.01', '999999999999.99'].sort(),
      );
    });

    it('sums assets and debts to an exact net worth through the money helpers', async () => {
      const householdId = await seedHousehold();
      const propertyId = await seedAccount(householdId, { name: 'Home', type: 'property' });
      const mortgageId = await seedAccount(householdId, { name: 'Mortgage', type: 'debt' });
      const cashId = await seedAccount(householdId, { name: 'Current', type: 'cash' });

      await db.insert(balanceSnapshots).values([
        { accountId: propertyId, amount: '410000.00', snapshotDate: '2026-07-26' },
        { accountId: mortgageId, amount: '-376500.00', snapshotDate: '2026-07-26' },
        { accountId: cashId, amount: '6180.33', snapshotDate: '2026-07-26' },
      ]);

      const rows = await db.select({ amount: balanceSnapshots.amount }).from(balanceSnapshots);
      expect(penceToNumeric(sumNumeric(rows.map((r) => r.amount)))).toBe('39680.33');
    });
  });

  describe('balance_snapshot daily uniqueness', () => {
    it('rejects a second snapshot for the same account and date', async () => {
      // Doing double duty: keeps the series sane, and is what makes Phase 6's queued-write
      // idempotency enforceable at the database layer rather than only by client keys.
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId);
      await db.insert(balanceSnapshots).values({ accountId, amount: '100.00', snapshotDate: '2026-07-26' });

      await expect(
        db.insert(balanceSnapshots).values({ accountId, amount: '200.00', snapshotDate: '2026-07-26' }),
      ).rejects.toThrow(/balance_snapshot_account_date_unique|duplicate key/);
    });

    it('allows the same date on different accounts', async () => {
      const householdId = await seedHousehold();
      const first = await seedAccount(householdId, { name: 'A' });
      const second = await seedAccount(householdId, { name: 'B' });
      await db.insert(balanceSnapshots).values([
        { accountId: first, amount: '100.00', snapshotDate: '2026-07-26' },
        { accountId: second, amount: '200.00', snapshotDate: '2026-07-26' },
      ]);
      expect(await db.select().from(balanceSnapshots)).toHaveLength(2);
    });

    it('supports an idempotent upsert on the constraint, which is how the app writes', async () => {
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId);
      const values = { accountId, amount: '100.00', snapshotDate: '2026-07-26' };

      await db.insert(balanceSnapshots).values(values);
      await db
        .insert(balanceSnapshots)
        .values({ ...values, amount: '250.00' })
        .onConflictDoUpdate({
          target: [balanceSnapshots.accountId, balanceSnapshots.snapshotDate],
          set: { amount: '250.00' },
        });

      const rows = await db.select().from(balanceSnapshots);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.amount).toBe('250.00');
    });
  });

  describe('joint ownership', () => {
    it('accepts an account with no person, owned by the household', async () => {
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId, {
        name: 'Joint current account',
        personId: null,
      });

      const [row] = await db.select().from(accounts);
      expect(row!.id).toBe(accountId);
      expect(row!.personId).toBeNull();
      expect(row!.householdId).toBe(householdId);
    });

    it('defaults currency to GBP on accounts and snapshots', async () => {
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId);
      await db.insert(balanceSnapshots).values({ accountId, amount: '1.00', snapshotDate: '2026-07-26' });

      const [account] = await db.select().from(accounts);
      const [snapshot] = await db.select().from(balanceSnapshots);
      expect(account!.currency).toBe('GBP');
      expect(snapshot!.currency).toBe('GBP');
    });

    it('defaults archived to false', async () => {
      const householdId = await seedHousehold();
      await seedAccount(householdId);
      const [account] = await db.select().from(accounts);
      expect(account!.archived).toBe(false);
    });
  });

  describe('delete behaviour protects financial history', () => {
    it('refuses to delete a person who owns an account', async () => {
      // Quoted from the proposal: "deleting a person with accounts should be an explicit
      // ownership migration, not a cascade that silently vaporizes financial history".
      const householdId = await seedHousehold();
      const personId = await seedPerson(householdId);
      await seedAccount(householdId, { personId });

      await expect(db.delete(people).where(eq(people.id, personId))).rejects.toThrow(
        /violates foreign key constraint/,
      );
      expect(await db.select().from(accounts)).toHaveLength(1);
    });

    it('refuses to delete a household that still has people', async () => {
      const householdId = await seedHousehold();
      await seedPerson(householdId);

      await expect(db.delete(households).where(eq(households.id, householdId))).rejects.toThrow(
        /violates foreign key constraint/,
      );
    });

    it('refuses to delete a household that still has accounts', async () => {
      const householdId = await seedHousehold();
      await seedAccount(householdId);

      await expect(db.delete(households).where(eq(households.id, householdId))).rejects.toThrow(
        /violates foreign key constraint/,
      );
    });

    it('refuses to delete a person who has pension contributions', async () => {
      const householdId = await seedHousehold();
      const personId = await seedPerson(householdId);
      await db
        .insert(pensionContributions)
        .values({ personId, amount: '4800.00', method: 'salary_sacrifice', employerAmount: '3200.00' });

      await expect(db.delete(people).where(eq(people.id, personId))).rejects.toThrow(
        /violates foreign key constraint/,
      );
    });

    it('does cascade an account’s own snapshots, holdings and terms when it is deleted', async () => {
      // Unlike ownership, these are dependent parts of the account rather than history that
      // outlives it — and the app archives rather than deletes, so this only fires on a
      // deliberate manual delete, where orphans would be the worse outcome.
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId, { name: 'Mortgage', type: 'debt' });
      await db.insert(balanceSnapshots).values({ accountId, amount: '-1.00', snapshotDate: '2026-07-26' });
      await db.insert(holdings).values({ accountId, ticker: 'VWRL', quantity: '10', costBasis: '900.00' });
      await db.insert(debtTerms).values({ accountId, interestRate: '4.250' });

      await db.delete(accounts).where(eq(accounts.id, accountId));

      expect(await db.select().from(balanceSnapshots)).toHaveLength(0);
      expect(await db.select().from(holdings)).toHaveLength(0);
      expect(await db.select().from(debtTerms)).toHaveLength(0);
    });

    it('allows deleting a person once their accounts have been reassigned', async () => {
      // The "explicit ownership migration" the RESTRICT is there to force.
      const householdId = await seedHousehold();
      const leaving = await seedPerson(householdId, 'Leaving');
      const staying = await seedPerson(householdId, 'Staying');
      const accountId = await seedAccount(householdId, { personId: leaving });

      await db.update(accounts).set({ personId: staying }).where(eq(accounts.id, accountId));
      await db.delete(people).where(eq(people.id, leaving));

      expect(await db.select().from(people)).toHaveLength(1);
      expect(await db.select().from(accounts)).toHaveLength(1);
    });

    it('refuses to delete a household that still has retirement scenarios', async () => {
      const householdId = await seedHousehold();
      await db.insert(retirementScenarios).values({
        householdId,
        name: 'Baseline',
        assumptions: { schemaVersion: 1 },
      });

      await expect(db.delete(households).where(eq(households.id, householdId))).rejects.toThrow(
        /violates foreign key constraint/,
      );
    });

    it('does cascade a scenario’s own simulation runs when the scenario is deleted', async () => {
      // Unlike the scenario’s own ownership-by-household edge, a run has no meaning
      // without the scenario it simulated and can always be recomputed — cascade is
      // correct here the same way it is for holding/debt_terms above.
      const householdId = await seedHousehold();
      const [scenario] = await db
        .insert(retirementScenarios)
        .values({ householdId, name: 'Baseline', assumptions: { schemaVersion: 1 } })
        .returning();
      await db.insert(simulationRuns).values({
        retirementScenarioId: scenario!.id,
        seed: 42,
        iterationCount: 1000,
      });

      await db.delete(retirementScenarios).where(eq(retirementScenarios.id, scenario!.id));

      expect(await db.select().from(simulationRuns)).toHaveLength(0);
    });
  });

  describe('retirement_scenario / simulation_run (Phase 3)', () => {
    it('round-trips a nested JSONB assumptions object exactly, not just top-level keys', async () => {
      const householdId = await seedHousehold();
      const assumptions = {
        schemaVersion: 1,
        annualSpending: '30000.00',
        wrapperWithdrawalOrder: ['ss_isa', 'gia'],
        people: [{ personId: 1, retirementAge: 65, planEndAge: 95, pclsAge: 57 }],
      };
      await db.insert(retirementScenarios).values({ householdId, name: 'Baseline', assumptions });

      const [row] = await db.select().from(retirementScenarios);
      expect(row!.assumptions).toEqual(assumptions);
    });

    it('defaults status to running and allows null result until a run completes', async () => {
      const householdId = await seedHousehold();
      const [scenario] = await db
        .insert(retirementScenarios)
        .values({ householdId, name: 'Baseline', assumptions: { schemaVersion: 1 } })
        .returning();

      await db.insert(simulationRuns).values({
        retirementScenarioId: scenario!.id,
        seed: 7,
        iterationCount: 2000,
      });

      const [run] = await db.select().from(simulationRuns);
      expect(run!.status).toBe('running');
      expect(run!.result).toBeNull();
    });

    it('enforces the simulation_run_status enum', async () => {
      const { rows } = await pool.query<{ enumlabel: string }>(
        `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'simulation_run_status' order by e.enumsortorder`,
      );
      expect(rows.map((r) => r.enumlabel)).toEqual(['running', 'complete', 'failed', 'cancelled']);
    });

    it('indexes simulation_run on (retirement_scenario_id, created_at DESC)', async () => {
      const { rows } = await pool.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where tablename = 'simulation_run' and indexname = 'simulation_run_scenario_created_at_idx'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.indexdef).toMatch(/retirement_scenario_id/);
      expect(rows[0]!.indexdef).toMatch(/created_at DESC/);
    });
  });

  describe('debt_terms is one-to-one with its account', () => {
    it('rejects a second terms row for the same account', async () => {
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId, { type: 'debt' });
      await db.insert(debtTerms).values({ accountId, interestRate: '4.250' });

      await expect(db.insert(debtTerms).values({ accountId, interestRate: '5.000' })).rejects.toThrow(
        /debt_terms_account_unique|duplicate key/,
      );
    });

    it('accepts a terms row with only some fields filled in', async () => {
      // The deferrable-fields case from the design spec.
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId, { type: 'debt' });
      await db.insert(debtTerms).values({ accountId, interestRate: '4.250' });

      const [row] = await db.select().from(debtTerms);
      expect(row!.interestRate).toBe('4.250');
      expect(row!.overpaymentAllowancePct).toBeNull();
      expect(row!.ercRatePct).toBeNull();
      expect(row!.ercPeriodEnd).toBeNull();
    });

    it('stores percentages at NUMERIC(6,3) precision', async () => {
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId, { type: 'debt' });
      await db
        .insert(debtTerms)
        .values({ accountId, interestRate: '4.125', overpaymentAllowancePct: '10.000', ercRatePct: '3.500' });

      const [row] = await db.select().from(debtTerms);
      expect(row!.interestRate).toBe('4.125');
      expect(row!.overpaymentAllowancePct).toBe('10.000');
      expect(row!.ercRatePct).toBe('3.500');
    });
  });

  describe('enums are enforced by the database', () => {
    it('rejects an account type outside the enum', async () => {
      const householdId = await seedHousehold();
      await expect(
        pool.query(
          `insert into account (household_id, name, type, tax_wrapper) values ($1, 'X', 'crypto', 'none')`,
          [householdId],
        ),
      ).rejects.toThrow(/invalid input value for enum/);
    });

    it('rejects a pension contribution method outside the enum', async () => {
      const householdId = await seedHousehold();
      const personId = await seedPerson(householdId);
      await expect(
        pool.query(
          `insert into pension_contribution (person_id, amount, method, employer_amount) values ($1, '1.00', 'salary_exchange', '0.00')`,
          [personId],
        ),
      ).rejects.toThrow(/invalid input value for enum/);
    });

    it('requires an employer amount on a pension contribution', async () => {
      const householdId = await seedHousehold();
      const personId = await seedPerson(householdId);
      await expect(
        pool.query(
          `insert into pension_contribution (person_id, amount, method) values ($1, '1.00', 'net_pay')`,
          [personId],
        ),
      ).rejects.toThrow(/null value in column "employer_amount"/);
    });
  });

  describe('holding quantity precision', () => {
    it('keeps six decimal places for fractional shares', async () => {
      const householdId = await seedHousehold();
      const accountId = await seedAccount(householdId, { type: 'ss_isa', taxWrapper: 'isa' });
      await db.insert(holdings).values({ accountId, ticker: 'VWRL', quantity: '12.345678', costBasis: '1200.00' });

      const [row] = await db.select().from(holdings);
      expect(row!.quantity).toBe('12.345678');
      expect(typeof row!.quantity).toBe('string');
    });
  });

  describe('quote_cache (Phase 2)', () => {
    it('stores price at NUMERIC(14,4) precision, sub-penny, not the 2dp money scale', async () => {
      const { rows } = await pool.query<{ numeric_precision: number; numeric_scale: number }>(
        `select numeric_precision, numeric_scale from information_schema.columns
          where table_schema = 'public' and table_name = 'quote_cache' and column_name = 'price'`,
      );
      expect(rows[0]!.numeric_precision).toBe(14);
      expect(rows[0]!.numeric_scale).toBe(4);
    });

    it('allows a null price — a confirmed "no quote for this symbol" result, not an error', async () => {
      await db.insert(quoteCache).values({
        symbol: 'VANGFTSEGACC',
        currency: 'GBP',
        price: null,
        fetchedAt: new Date(),
      });
      const [row] = await db.select().from(quoteCache);
      expect(row!.price).toBeNull();
    });

    it('rejects a second row for the same symbol', async () => {
      const fetchedAt = new Date();
      await db.insert(quoteCache).values({ symbol: 'VUAG.LON', currency: 'GBP', price: '107.7600', fetchedAt });

      await expect(
        db.insert(quoteCache).values({ symbol: 'VUAG.LON', currency: 'GBP', price: '108.0000', fetchedAt }),
      ).rejects.toThrow(/quote_cache_symbol_unique|duplicate key/);
    });

    it('supports an idempotent upsert on the symbol constraint, which is how ensureFreshQuotes writes', async () => {
      const fetchedAt = new Date();
      await db.insert(quoteCache).values({ symbol: 'VUAG.LON', currency: 'GBP', price: '107.7600', fetchedAt });
      await db
        .insert(quoteCache)
        .values({ symbol: 'VUAG.LON', currency: 'GBP', price: '110.0000', fetchedAt })
        .onConflictDoUpdate({ target: quoteCache.symbol, set: { price: '110.0000', fetchedAt } });

      const rows = await db.select().from(quoteCache);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.price).toBe('110.0000');
    });

    it('has no FK to account or holding — it belongs to no household', async () => {
      const { rows } = await pool.query<{ constraint_name: string }>(
        `select constraint_name from information_schema.table_constraints
          where table_schema = 'public' and table_name = 'quote_cache' and constraint_type = 'FOREIGN KEY'`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe('watchlist_item / stock_analysis / fundamentals_cache (Phase 4)', () => {
    it('refuses to delete a household that still has a watchlist item', async () => {
      const householdId = await seedHousehold();
      await db.insert(watchlistItems).values({ householdId, ticker: 'AAPL' });

      await expect(db.delete(households).where(eq(households.id, householdId))).rejects.toThrow(
        /violates foreign key constraint/,
      );
    });

    it('refuses to delete a household that still has a stock analysis', async () => {
      const householdId = await seedHousehold();
      await db.insert(stockAnalyses).values({ householdId, ticker: 'AAPL', inputs: { schemaVersion: 1 } });

      await expect(db.delete(households).where(eq(households.id, householdId))).rejects.toThrow(
        /violates foreign key constraint/,
      );
    });

    it('rejects a second watchlist row for the same household and ticker', async () => {
      const householdId = await seedHousehold();
      await db.insert(watchlistItems).values({ householdId, ticker: 'AAPL' });

      await expect(db.insert(watchlistItems).values({ householdId, ticker: 'AAPL' })).rejects.toThrow(
        /watchlist_item_household_ticker_unique|duplicate key/,
      );
    });

    it('rejects a second stock_analysis row for the same household and ticker', async () => {
      const householdId = await seedHousehold();
      await db.insert(stockAnalyses).values({ householdId, ticker: 'AAPL', inputs: { schemaVersion: 1 } });

      await expect(
        db.insert(stockAnalyses).values({ householdId, ticker: 'AAPL', inputs: { schemaVersion: 1 } }),
      ).rejects.toThrow(/stock_analysis_household_ticker_unique|duplicate key/);
    });

    it('allows a null statements value on fundamentals_cache — a confirmed "no data for this ticker" result, not an error', async () => {
      await db.insert(fundamentalsCache).values({ ticker: 'NOTATICKER', statements: null, fetchedAt: new Date() });
      const [row] = await db.select().from(fundamentalsCache);
      expect(row!.statements).toBeNull();
    });

    it('rejects a second fundamentals_cache row for the same ticker', async () => {
      const fetchedAt = new Date();
      await db.insert(fundamentalsCache).values({ ticker: 'AAPL', statements: { a: 1 }, fetchedAt });

      await expect(
        db.insert(fundamentalsCache).values({ ticker: 'AAPL', statements: { a: 2 }, fetchedAt }),
      ).rejects.toThrow(/fundamentals_cache_ticker_unique|duplicate key/);
    });

    it('supports an idempotent upsert on the ticker constraint, which is how ensureFreshFundamentals writes', async () => {
      const fetchedAt = new Date();
      await db.insert(fundamentalsCache).values({ ticker: 'AAPL', statements: { a: 1 }, fetchedAt });
      await db
        .insert(fundamentalsCache)
        .values({ ticker: 'AAPL', statements: { a: 2 }, fetchedAt })
        .onConflictDoUpdate({ target: fundamentalsCache.ticker, set: { statements: { a: 2 }, fetchedAt } });

      const rows = await db.select().from(fundamentalsCache);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.statements).toEqual({ a: 2 });
    });

    it('has no FK to household on fundamentals_cache — a ticker\'s fundamentals belong to no household', async () => {
      const { rows } = await pool.query<{ constraint_name: string }>(
        `select constraint_name from information_schema.table_constraints
          where table_schema = 'public' and table_name = 'fundamentals_cache' and constraint_type = 'FOREIGN KEY'`,
      );
      expect(rows).toEqual([]);
    });
  });
});
