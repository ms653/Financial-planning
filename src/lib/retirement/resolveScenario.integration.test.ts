import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import {
  accounts,
  balanceSnapshots,
  households,
  people,
  pensionContributions,
  regularContributions,
  retirementScenarios,
} from '@/lib/db/schema';
import { taxWrapperForType } from '@/lib/accounts/types';
import { todayIso } from '@/lib/accounts/validation';
import { penceToNumeric } from '@/lib/money';
import { resolveScenario, statePensionClaimAgeFromDate } from './resolveScenario';
import { statePensionDate } from './taxYearConfig';

/**
 * `resolveScenario` is the DB resolution layer M3/M5/M6 all flagged as missing —
 * turning a stored `retirement_scenario` row plus live `person`/`account`/
 * `balance_snapshot` data into the `ResolvedScenario` the engine actually consumes.
 * This is the first thing that reads real household data across three separate tables
 * and assembles it into one object, so it gets its own integration test against a real
 * Postgres rather than relying on the route-handler tests to exercise it indirectly.
 *
 * `ageAsOf`/`statePensionClaimAgeFromDate`'s own boundary-case precision is covered by
 * `resolveScenario.test.ts` (pure, no DB needed) — this file tests that `resolveScenario`
 * wires the household's real data into them correctly, not the arithmetic itself.
 */

const connectionString = process.env.TEST_DATABASE_URL;

/** A YYYY-MM-DD date of birth that makes `currentAge` exactly `years` as of today,
 * regardless of what day the test actually runs on. */
function dobYearsAgo(years: number): string {
  const now = new Date();
  const y = now.getUTCFullYear() - years;
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe.skipIf(!connectionString)('resolveScenario against a real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });

    // resolveScenario calls the app's own getDb()/getPool() singleton internally, a
    // separate connection from this file's own `db` (used only for seeding) — it reads
    // DATABASE_URL lazily on first use, so it must be set before resolveScenario is
    // ever called, same convention every other *.integration.test.ts file follows.
    process.env.DATABASE_URL = connectionString;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE balance_snapshot, account, retirement_scenario, person, household RESTART IDENTITY CASCADE;',
    );
  });

  async function seedAccount(
    householdId: number,
    personId: number | null,
    type: schema.AccountTypeValue,
    balancePence: bigint,
    overrides: Partial<{ archived: boolean }> = {},
  ): Promise<void> {
    const [account] = await db
      .insert(accounts)
      .values({
        householdId,
        personId,
        name: `Test ${type}`,
        type,
        taxWrapper: taxWrapperForType(type),
        archived: overrides.archived ?? false,
      })
      .returning();
    await db.insert(balanceSnapshots).values({
      accountId: account!.id,
      amount: penceToNumeric(balancePence),
      snapshotDate: todayIso(),
    });
  }

  it('resolves money, percent, and per-person fields, aggregates balances by type, and excludes debt/property/archived', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const householdId = household!.id;

    const [alex] = await db
      .insert(people)
      .values({ householdId, name: 'Alex', dateOfBirth: dobYearsAgo(65) })
      .returning();
    // Born in the flat-68 band relative to any plausible test run date (2078+ cutoff is
    // decades away) so statePensionDate always lands on a clean birthday — matches the
    // household's own real people per Milestone 1's finding, keeping this deterministic.
    const [jordan] = await db
      .insert(people)
      .values({ householdId, name: 'Jordan', dateOfBirth: '1990-03-20' })
      .returning();

    // Two cash_isa accounts, to prove same-type balances sum rather than overwrite.
    await seedAccount(householdId, alex!.id, 'cash_isa', 10_000_00n);
    await seedAccount(householdId, jordan!.id, 'cash_isa', 5_000_00n);
    await seedAccount(householdId, null, 'gia', 50_000_00n);
    // Must be excluded from startingBalancesPence entirely.
    await seedAccount(householdId, null, 'debt', -20_000_00n);
    await seedAccount(householdId, null, 'property', 300_000_00n);
    await seedAccount(householdId, alex!.id, 'sipp_pension', 999_999_00n, { archived: true });

    const assumptions = {
      schemaVersion: 1,
      annualSpending: '30000.00',
      survivorAnnualSpending: '20000.00',
      inflationPct: '2.500',
      equityAllocationPct: '60.000',
      targetSuccessRatePct: '90.000',
      flatEffectiveTaxRatePct: '20.000',
      wrapperWithdrawalOrder: ['gia', 'cash_isa'],
      people: [
        { personId: alex!.id, retirementAge: 65, planEndAge: 95 }, // no overrides
        {
          personId: jordan!.id,
          retirementAge: 60,
          planEndAge: 95,
          statePensionClaimAge: 70, // explicit override
          statePensionAnnualOverride: '8000.00',
          pclsAge: 57,
        },
      ],
    };
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({ householdId, name: 'Baseline', assumptions })
      .returning();

    const resolved = await resolveScenario(scenario!.id, householdId);

    expect(resolved).not.toBeNull();
    expect(resolved!.scenarioId).toBe(scenario!.id);
    expect(resolved!.annualSpendingPence).toBe(3_000_000n);
    expect(resolved!.survivorAnnualSpendingPence).toBe(2_000_000n);
    expect(resolved!.wrapperWithdrawalOrder).toEqual(['gia', 'cash_isa']);

    // Percent -> RATE_SCALE-scaled fraction: 2.5% -> 0.025, scaled by 10^6 -> 25000n.
    expect(resolved!.inflationRate).toBe(25_000n);
    expect(resolved!.equityAllocationRate).toBe(600_000n);

    // Alex: no overrides -> currentAge derived from DOB, State Pension defaulted.
    const alexResolved = resolved!.people.find((p) => p.personId === alex!.id)!;
    expect(alexResolved.currentAge).toBe(65);
    expect(alexResolved.pclsAge).toBeNull();
    const expectedAlexClaimAge = statePensionClaimAgeFromDate(
      dobYearsAgo(65),
      statePensionDate(dobYearsAgo(65)),
    );
    expect(alexResolved.statePensionClaimAge).toBe(expectedAlexClaimAge);
    expect(alexResolved.statePensionAnnualPence).toBeGreaterThan(0n); // taxYearConfig default

    // Jordan: every optional field overridden.
    const jordanResolved = resolved!.people.find((p) => p.personId === jordan!.id)!;
    expect(jordanResolved.statePensionClaimAge).toBe(70);
    expect(jordanResolved.statePensionAnnualPence).toBe(800_000n);
    expect(jordanResolved.pclsAge).toBe(57);

    // Balances: two cash_isa accounts summed (£10,000 + £5,000), one gia. debt/property
    // can't appear at all — Partial<Record<DrawdownAccountType, bigint>> excludes them
    // at the type level (DRAWDOWN_ACCOUNT_TYPES), not just by a runtime check. Archived
    // sipp_pension is excluded by getAccountsWithBalances's own default.
    expect(resolved!.startingBalancesPence.cash_isa).toBe(1_500_000n);
    expect(resolved!.startingBalancesPence.gia).toBe(5_000_000n);
    expect(resolved!.startingBalancesPence.sipp_pension).toBeUndefined();
    expect(Object.keys(resolved!.startingBalancesPence).sort()).toEqual(['cash_isa', 'gia']);
  });

  it('sums pension_contribution rows (amount + employerAmount) per person into annualContributionPence, defaulting to 0 with none', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const householdId = household!.id;

    const [alex] = await db
      .insert(people)
      .values({ householdId, name: 'Alex', dateOfBirth: dobYearsAgo(40) })
      .returning();
    const [jordan] = await db
      .insert(people)
      .values({ householdId, name: 'Jordan', dateOfBirth: dobYearsAgo(38) })
      .returning();

    // Alex has two recorded pensions (e.g. a workplace scheme plus an old one) — both
    // should be summed, not just the most recent.
    await db.insert(pensionContributions).values([
      { personId: alex!.id, amount: '5000.00', employerAmount: '2000.00', method: 'relief_at_source' },
      { personId: alex!.id, amount: '1000.00', employerAmount: '0.00', method: 'net_pay' },
    ]);
    // Jordan has none recorded at all.

    const assumptions = {
      schemaVersion: 1,
      annualSpending: '30000.00',
      survivorAnnualSpending: '20000.00',
      inflationPct: '2.500',
      equityAllocationPct: '60.000',
      targetSuccessRatePct: '90.000',
      flatEffectiveTaxRatePct: '20.000',
      wrapperWithdrawalOrder: ['gia'],
      people: [
        { personId: alex!.id, retirementAge: 65, planEndAge: 95 },
        { personId: jordan!.id, retirementAge: 65, planEndAge: 95 },
      ],
    };
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({ householdId, name: 'Baseline', assumptions })
      .returning();

    const resolved = await resolveScenario(scenario!.id, householdId);

    const alexResolved = resolved!.people.find((p) => p.personId === alex!.id)!;
    const jordanResolved = resolved!.people.find((p) => p.personId === jordan!.id)!;
    expect(alexResolved.annualContributionsPence.sipp_pension).toBe(800_000n); // (5000+2000+1000+0) * 100
    expect(jordanResolved.annualContributionsPence).toEqual({});
  });

  it('sums regular_contribution rows into personal or joint contributions, by the owning account, skipping an owner not in this scenario', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const householdId = household!.id;

    const [alex] = await db
      .insert(people)
      .values({ householdId, name: 'Alex', dateOfBirth: dobYearsAgo(40) })
      .returning();
    const [jordan] = await db
      .insert(people)
      .values({ householdId, name: 'Jordan', dateOfBirth: dobYearsAgo(38) })
      .returning();

    // Alex's own GIA: a regular purchase (ticker set) and a plain cash top-up
    // (ticker null) — both should sum into the same gia key.
    const [alexGia] = await db
      .insert(accounts)
      .values({ householdId, personId: alex!.id, name: 'Alex GIA', type: 'gia', taxWrapper: 'gia' })
      .returning();
    await db.insert(regularContributions).values([
      { accountId: alexGia!.id, ticker: 'VWRL', amount: '1200.00' },
      { accountId: alexGia!.id, ticker: null, amount: '300.00' },
    ]);

    // A joint Cash ISA — no single owner, so this should land in the household-wide
    // bucket, not either person's own contributions.
    const [jointIsa] = await db
      .insert(accounts)
      .values({ householdId, personId: null, name: 'Joint Cash ISA', type: 'cash_isa', taxWrapper: 'isa' })
      .returning();
    await db.insert(regularContributions).values([{ accountId: jointIsa!.id, ticker: null, amount: '2400.00' }]);

    // Jordan's own account, but Jordan isn't included in this scenario's people below
    // — this contribution has no retirementAge to gate on and must be skipped, not
    // guessed at.
    const [jordanGia] = await db
      .insert(accounts)
      .values({ householdId, personId: jordan!.id, name: 'Jordan GIA', type: 'gia', taxWrapper: 'gia' })
      .returning();
    await db.insert(regularContributions).values([{ accountId: jordanGia!.id, ticker: null, amount: '999.00' }]);

    const assumptions = {
      schemaVersion: 1,
      annualSpending: '30000.00',
      inflationPct: '2.500',
      equityAllocationPct: '60.000',
      targetSuccessRatePct: '90.000',
      flatEffectiveTaxRatePct: '20.000',
      wrapperWithdrawalOrder: ['gia'],
      people: [{ personId: alex!.id, retirementAge: 65, planEndAge: 95 }], // Jordan deliberately excluded
    };
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({ householdId, name: 'Baseline', assumptions })
      .returning();

    const resolved = await resolveScenario(scenario!.id, householdId);

    const alexResolved = resolved!.people.find((p) => p.personId === alex!.id)!;
    expect(alexResolved.annualContributionsPence.gia).toBe(150_000n); // (1200 + 300) * 100
    expect(resolved!.jointAnnualContributionsPence.cash_isa).toBe(240_000n);
  });

  it('returns null for a scenario that does not exist', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    expect(await resolveScenario(999_999, household!.id)).toBeNull();
  });

  it('returns null when the given householdId does not own the scenario', async () => {
    // This app enforces exactly one household row ever (household_singleton, Phase 1) —
    // there's no way to seed a second *real* household to test against. The scoping
    // check is still real defense-in-depth (same posture as deleteHolding/
    // deletePensionContribution's ownership joins: "not exploitable in a
    // single-household deployment... but a latent gap" per docs/STATUS.md's Phase 1
    // review), so this proves the query's AND condition actually excludes a mismatched
    // id, rather than silently ignoring it.
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const [person] = await db
      .insert(people)
      .values({ householdId: household!.id, name: 'A', dateOfBirth: dobYearsAgo(50) })
      .returning();
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({
        householdId: household!.id,
        name: 'Scenario A',
        assumptions: {
          schemaVersion: 1,
          annualSpending: '10000.00',
          inflationPct: '2.000',
          equityAllocationPct: '50.000',
          targetSuccessRatePct: '90.000',
          flatEffectiveTaxRatePct: '20.000',
          wrapperWithdrawalOrder: ['gia'],
          people: [{ personId: person!.id, retirementAge: 65, planEndAge: 90 }],
        },
      })
      .returning();

    expect(await resolveScenario(scenario!.id, household!.id + 1)).toBeNull();
  });

  it('throws if the scenario references a person no longer in the household', async () => {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({
        householdId: household!.id,
        name: 'Orphaned',
        assumptions: {
          schemaVersion: 1,
          annualSpending: '10000.00',
          inflationPct: '2.000',
          equityAllocationPct: '50.000',
          targetSuccessRatePct: '90.000',
          flatEffectiveTaxRatePct: '20.000',
          wrapperWithdrawalOrder: ['gia'],
          people: [{ personId: 424_242, retirementAge: 65, planEndAge: 90 }],
        },
      })
      .returning();

    await expect(resolveScenario(scenario!.id, household!.id)).rejects.toThrow(/not found in household/);
  });
});
