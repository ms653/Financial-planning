import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import {
  accounts,
  balanceSnapshots,
  debtTerms,
  households,
  pensionContributions,
  people,
  regularContributions,
} from '@/lib/db/schema';
import { taxWrapperForType } from '@/lib/accounts/types';
import { todayIso } from '@/lib/accounts/validation';
import { penceToNumeric } from '@/lib/money';
import { meanNominalEquityReturnPct } from '@/lib/retirement/returns/ukHistoricalReturns';
import { resolveWaterfallInput } from './resolveWaterfallInput';

/**
 * `resolveWaterfallInput` is the first thing that reads real household data across
 * `person`/`account`/`regular_contribution`/`debt_terms` and assembles it for the
 * waterfall engine — the same reasoning `resolveScenario.integration.test.ts` gives
 * for testing this kind of function against a real Postgres rather than only via
 * route-handler tests.
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('resolveWaterfallInput against a real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

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
    await pool.query(
      'TRUNCATE TABLE balance_snapshot, debt_terms, regular_contribution, pension_contribution, account, person, household RESTART IDENTITY CASCADE;',
    );
  });

  async function seedAccount(
    householdId: number,
    personId: number | null,
    type: schema.AccountTypeValue,
    balancePence: bigint,
    overrides: Partial<{ isEmergencyFund: boolean; name: string }> = {},
  ) {
    const [account] = await db
      .insert(accounts)
      .values({
        householdId,
        personId,
        name: overrides.name ?? `Test ${type}`,
        type,
        taxWrapper: taxWrapperForType(type),
        isEmergencyFund: overrides.isEmergencyFund ?? false,
      })
      .returning();
    await db.insert(balanceSnapshots).values({
      accountId: account!.id,
      amount: penceToNumeric(balancePence),
      snapshotDate: todayIso(),
    });
    return account!;
  }

  it('resolves emergency fund, debts, ISA usage, and per-person income/pension fields', async () => {
    const [household] = await db
      .insert(households)
      .values({ name: 'Test household', emergencyFundTarget: '15000.00' })
      .returning();
    const householdId = household!.id;

    const [alex] = await db
      .insert(people)
      .values({
        householdId,
        name: 'Alex',
        dateOfBirth: '1985-04-12',
        annualGrossIncome: '60000.00',
        hasFlexiblyAccessedPension: true,
      })
      .returning();

    await db.insert(pensionContributions).values({
      personId: alex!.id,
      amount: '3000.00',
      method: 'salary_sacrifice',
      employerAmount: '1500.00',
    });

    // Emergency fund: two cash accounts, only one tagged.
    await seedAccount(householdId, alex!.id, 'cash', 5_000_00n, { isEmergencyFund: true });
    await seedAccount(householdId, alex!.id, 'cash', 9_999_00n, { isEmergencyFund: false });

    // ISA usage: a personal Cash ISA with a regular contribution.
    const cashIsa = await seedAccount(householdId, alex!.id, 'cash_isa', 2_000_00n);
    await db.insert(regularContributions).values({ accountId: cashIsa.id, amount: '3000.00' });

    // A LISA the person already has open, with its own contribution.
    const lisa = await seedAccount(householdId, alex!.id, 'lisa', 500_00n);
    await db.insert(regularContributions).values({ accountId: lisa.id, amount: '1000.00' });

    // A debt with full terms, including the overpayment/ERC fields the comparator
    // needs — `waterfall.ts`'s own `DebtInput` has no use for these, so nothing
    // asserted on them reaching the resolver's output until this test.
    const debtAccount = await seedAccount(householdId, alex!.id, 'debt', -2_000_00n);
    await db.insert(debtTerms).values({
      accountId: debtAccount.id,
      interestRate: '24.900',
      currentBalance: '2000.00',
      minimumPayment: '50.00',
      overpaymentAllowancePct: '10.000',
      overpaymentAllowanceBalanceBasis: 'current_balance',
      ercRatePct: '2.000',
      ercPeriodEnd: '2030-01-01',
    });

    const { input, warnings, comparator } = await resolveWaterfallInput(householdId, 10_000_00n);

    expect(warnings).toEqual([]);
    expect(input.extraAmountPence).toBe(10_000_00n);
    expect(input.emergencyFundTargetPence).toBe(15_000_00n);
    // Only the tagged cash account counts.
    expect(input.emergencyFundCurrentPence).toBe(5_000_00n);

    expect(input.debts).toHaveLength(1);
    expect(input.debts[0]).toMatchObject({
      name: 'Test debt',
      personId: alex!.id,
      balancePence: 2_000_00n,
      interestRatePct: '24.900',
    });

    expect(input.debtBenchmarkRatePct).toBe(meanNominalEquityReturnPct());

    expect(input.people).toHaveLength(1);
    const resolvedAlex = input.people[0]!;
    expect(resolvedAlex.grossIncomePence).toBe(60_000_00n);
    expect(resolvedAlex.hasFlexiblyAccessedPension).toBe(true);
    expect(resolvedAlex.hasExistingLisa).toBe(true);
    // ISA usage: £3,000 (Cash ISA) + £1,000 (LISA) = £4,000.
    expect(resolvedAlex.isaUsedPence).toBe(4_000_00n);
    expect(resolvedAlex.lisaUsedPence).toBe(1_000_00n);
    expect(resolvedAlex.pensionContributions).toEqual([
      { amountPence: 3_000_00n, method: 'salary_sacrifice', employerAmountPence: 1_500_00n },
    ]);

    // No property account seeded in this household.
    expect(comparator.householdOwnsProperty).toBe(false);
    expect(comparator.debts).toHaveLength(1);
    expect(comparator.debts[0]).toMatchObject({
      name: 'Test debt',
      personId: alex!.id,
      balancePence: 2_000_00n,
      interestRatePct: '24.900',
      overpaymentAllowancePct: '10.000',
      overpaymentAllowanceBalanceBasis: 'current_balance',
      ercRatePct: '2.000',
      ercPeriodEnd: '2030-01-01',
      minimumPaymentPence: 50_00n,
    });
  });

  it('reports minimumPaymentPence as null (not 0n) when no debt_terms row exists at all', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const householdId = household!.id;
    const [alex] = await db
      .insert(people)
      .values({ householdId, name: 'Alex', dateOfBirth: '1985-04-12' })
      .returning();
    // A debt account with no debt_terms row at all — a real state (the account exists,
    // its terms haven't been entered yet).
    await seedAccount(householdId, alex!.id, 'debt', -1_000_00n);

    const { comparator } = await resolveWaterfallInput(householdId, 1_000_00n);
    expect(comparator.debts).toHaveLength(1);
    expect(comparator.debts[0]).toMatchObject({
      balancePence: 0n, // no debt_terms row means no currentBalance either — the resolver's own existing behavior.
      minimumPaymentPence: null,
    });
  });

  it('reports householdOwnsProperty true when a property account exists', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const householdId = household!.id;
    const [alex] = await db
      .insert(people)
      .values({ householdId, name: 'Alex', dateOfBirth: '1985-04-12' })
      .returning();
    await seedAccount(householdId, alex!.id, 'property', 300_000_00n);

    const { comparator } = await resolveWaterfallInput(householdId, 1_000_00n);
    expect(comparator.householdOwnsProperty).toBe(true);
  });

  it('excludes a joint ISA/LISA account from every allowance total and flags it', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const householdId = household!.id;
    const [alex] = await db
      .insert(people)
      .values({ householdId, name: 'Alex', dateOfBirth: '1985-04-12' })
      .returning();

    // A jointly-owned Cash ISA — legally impossible in the UK, but not blocked at the
    // form layer (the real gap this milestone found).
    const jointIsa = await seedAccount(householdId, null, 'cash_isa', 1_000_00n, { name: 'Joint Cash ISA' });
    await db.insert(regularContributions).values({ accountId: jointIsa.id, amount: '2000.00' });

    const { input, warnings } = await resolveWaterfallInput(householdId, 5_000_00n);

    expect(input.people[0]!.isaUsedPence).toBe(0n);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Joint Cash ISA');
    expect(warnings[0]).toContain('jointly-owned');
  });

  it('flags a jointly-owned LISA even when it has no regular_contribution row', async () => {
    // Regression test: the joint-account warning previously only fired inside the
    // regular_contribution loop, so a joint LISA with zero contributions was silently
    // excluded from hasExistingLisa with no warning at all.
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const householdId = household!.id;
    await db.insert(people).values({ householdId, name: 'Alex', dateOfBirth: '1985-04-12' });

    await seedAccount(householdId, null, 'lisa', 500_00n, { name: 'Joint LISA' });

    const { input, warnings } = await resolveWaterfallInput(householdId, 5_000_00n);

    expect(input.people[0]!.hasExistingLisa).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Joint LISA');
    expect(warnings[0]).toContain('jointly-owned');
  });

  it('accepts an explicit debt-benchmark-rate override instead of the default', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const { input } = await resolveWaterfallInput(household!.id, 1_000_00n, {
      debtBenchmarkRatePctOverride: '7.000',
    });
    expect(input.debtBenchmarkRatePct).toBe('7.000');
  });

  it('falls back to the default rate, with a warning, on an invalid override', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const { input, warnings } = await resolveWaterfallInput(household!.id, 1_000_00n, {
      debtBenchmarkRatePctOverride: 'not-a-rate',
    });
    expect(input.debtBenchmarkRatePct).toBe(meanNominalEquityReturnPct());
    expect(warnings.some((w) => w.includes('not-a-rate'))).toBe(true);
  });

  it('treats a household with no emergency-fund target set as null, not zero', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const { input } = await resolveWaterfallInput(household!.id, 1_000_00n);
    expect(input.emergencyFundTargetPence).toBeNull();
  });

  // A dedicated "reads the target of the householdId actually passed in, not some
  // other household's" test isn't expressible here: `household_singleton` (a
  // `uniqueIndex` on `sql\`(true)\`` — see schema.ts) hard-limits this table to one
  // row app-wide, so a second household can't even be inserted to prove the scoping
  // against. The fix (querying `households` by `eq(households.id, householdId)`
  // instead of via `getSetupState()`'s always-lowest-id lookup) is still correct and
  // exercised by every test above, which all pass a real `householdId` through.
});
