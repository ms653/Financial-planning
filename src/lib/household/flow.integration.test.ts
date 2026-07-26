import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';

/**
 * The whole Phase 1 write-and-read path, executed against a real Postgres.
 *
 * This drives the actual Server Actions — the same functions the forms call — and then reads
 * back through the same queries and aggregation the dashboard uses. It is the server half of the
 * "guided setup, then see a dashboard with real data" journey: household created, people added,
 * accounts of several types created including a joint one and a mortgage, balances updated, and
 * the resulting net worth, breakdowns and trend checked.
 *
 * The Playwright spec in e2e/ covers the same journey through a browser (clicks, focus, the
 * redirect from an empty household into setup). The two are complementary rather than redundant:
 * this one runs in CI on every push without needing a browser download, and it can assert things
 * a browser can't easily see, like `debt_terms.current_balance` staying in step with the
 * snapshot series.
 *
 * Skipped unless TEST_DATABASE_URL is set. The database is dropped and recreated.
 */

// The actions call revalidatePath, which needs a Next request scope that doesn't exist in a
// plain Vitest process. Stubbed rather than avoided: cache revalidation is Next's concern, and
// what is under test here is which rows get written.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${path}`), { digest: `NEXT_REDIRECT;${path}` });
  }),
  notFound: vi.fn(),
}));

const connectionString = process.env.TEST_DATABASE_URL;

/** Build a FormData the way a browser form would, including repeated owner entries. */
function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((entry) => data.append(key, entry));
    else data.set(key, value);
  }
  return data;
}

describe.skipIf(!connectionString)('Phase 1 end-to-end flow', () => {
  let pool: Pool;
  let actions: typeof import('@/lib/household/actions');
  let queries: typeof import('@/lib/household/queries');
  let breakdownModule: typeof import('@/lib/networth/breakdown');
  let seriesModule: typeof import('@/lib/networth/series');
  let money: typeof import('@/lib/money');

  beforeAll(async () => {
    process.env.DATABASE_URL = connectionString;

    pool = new Pool({ connectionString, max: 4 });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(drizzle(pool, { schema }), { migrationsFolder: './drizzle' });

    // Imported after DATABASE_URL is set, since the db client reads it at first use.
    actions = await import('@/lib/household/actions');
    queries = await import('@/lib/household/queries');
    breakdownModule = await import('@/lib/networth/breakdown');
    seriesModule = await import('@/lib/networth/series');
    money = await import('@/lib/money');
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE balance_snapshot, holding, debt_terms, account, pension_contribution, person, household RESTART IDENTITY CASCADE;',
    );
  });

  /** Walk guided setup exactly as the UI does, returning the ids it created. */
  async function completeGuidedSetup() {
    expect((await actions.createHousehold(form({ name: 'The Elm Grove household' }))).ok).toBe(true);

    expect(
      (await actions.addPerson(form({ name: 'Alex', dateOfBirth: '1985-04-12', annualGrossIncome: '62000' }))).ok,
    ).toBe(true);
    expect(
      (await actions.addPerson(form({ name: 'Jordan', dateOfBirth: '1987-09-30' }))).ok,
    ).toBe(true);

    const setup = await queries.getSetupState();
    const people = await queries.getPeople(setup.householdId!);
    const [alex, jordan] = people as [typeof people[number], typeof people[number]];

    // Alex's SIPP.
    expect(
      (await actions.createAccount(
        form({
          name: 'Vanguard SIPP',
          type: 'sipp_pension',
          ownerIds: [String(alex.id)],
          openingBalance: '186420',
          asOfDate: '2026-07-01',
        }),
      )).ok,
    ).toBe(true);

    // Alex's S&S ISA.
    expect(
      (await actions.createAccount(
        form({
          name: 'Vanguard S&S ISA',
          type: 'ss_isa',
          ownerIds: [String(alex.id)],
          openingBalance: '54110',
          asOfDate: '2026-07-01',
        }),
      )).ok,
    ).toBe(true);

    // Jordan's workplace pension.
    expect(
      (await actions.createAccount(
        form({
          name: 'Workplace pension',
          type: 'sipp_pension',
          ownerIds: [String(jordan.id)],
          openingBalance: '97860',
          asOfDate: '2026-07-01',
        }),
      )).ok,
    ).toBe(true);

    // A joint current account: both owners selected.
    expect(
      (await actions.createAccount(
        form({
          name: 'Joint current account',
          type: 'cash',
          ownerIds: [String(alex.id), String(jordan.id)],
          openingBalance: '6180',
          asOfDate: '2026-07-01',
        }),
      )).ok,
    ).toBe(true);

    // The house, jointly held.
    expect(
      (await actions.createAccount(
        form({
          name: 'Home — 14 Elm Grove',
          type: 'property',
          ownerIds: [String(alex.id), String(jordan.id)],
          openingBalance: '410000',
          asOfDate: '2026-07-01',
        }),
      )).ok,
    ).toBe(true);

    // The mortgage, with terms. Entered as a positive amount outstanding.
    expect(
      (await actions.createAccount(
        form({
          name: 'Mortgage — 14 Elm Grove',
          type: 'debt',
          ownerIds: [String(alex.id), String(jordan.id)],
          openingBalance: '376500',
          asOfDate: '2026-07-01',
          interestRate: '4.25',
          minimumPayment: '1450',
          overpaymentAllowancePct: '10',
          overpaymentAllowanceBalanceBasis: 'annual_opening_balance',
          ercRatePct: '3',
          ercPeriodEnd: '2028-06-30',
        }),
      )).ok,
    ).toBe(true);

    return { householdId: setup.householdId!, alex, jordan };
  }

  describe('guided setup', () => {
    it('reports setup incomplete until there is a household, a person and an account', async () => {
      let state = await queries.getSetupState();
      expect(state).toMatchObject({ householdId: null, personCount: 0, accountCount: 0, complete: false });

      await actions.createHousehold(form({ name: 'Test household' }));
      state = await queries.getSetupState();
      expect(state.householdId).not.toBeNull();
      expect(state.complete).toBe(false);

      await actions.addPerson(form({ name: 'Alex', dateOfBirth: '1985-04-12' }));
      state = await queries.getSetupState();
      expect(state.personCount).toBe(1);
      // Still incomplete: no accounts yet, so the dashboard would be empty.
      expect(state.complete).toBe(false);

      const people = await queries.getPeople(state.householdId!);
      await actions.createAccount(
        form({
          name: 'Current account',
          type: 'cash',
          ownerIds: [String(people[0]!.id)],
          openingBalance: '1000',
          asOfDate: '2026-07-01',
        }),
      );
      state = await queries.getSetupState();
      expect(state.complete).toBe(true);
    });

    it('refuses to create a second household', async () => {
      await actions.createHousehold(form({ name: 'First' }));
      await actions.createHousehold(form({ name: 'Second' }));

      const { rows } = await pool.query<{ count: string }>('select count(*) from household');
      expect(rows[0]!.count).toBe('1');
    });

    it('stays a singleton under two concurrent submissions, not just sequential ones', async () => {
      // The sequential test above can't exercise the race the app-level check-then-insert
      // is vulnerable to: two requests that both read "no household yet" before either
      // writes. Firing both without awaiting between them reproduces that ordering, and the
      // `household_singleton` unique index (not the app-level check) is what's actually
      // relied on to keep this at one row.
      const [first, second] = await Promise.all([
        actions.createHousehold(form({ name: 'Race A' })),
        actions.createHousehold(form({ name: 'Race B' })),
      ]);

      // Both requests report success — the loser of the race is told "already done" rather
      // than shown an error, since from the household's point of view setup did complete.
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const { rows } = await pool.query<{ count: string }>('select count(*) from household');
      expect(rows[0]!.count).toBe('1');
    });

    it('rejects a person with no date of birth, and writes nothing', async () => {
      await actions.createHousehold(form({ name: 'Test household' }));
      const result = await actions.addPerson(form({ name: 'Alex', dateOfBirth: '' }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.dateOfBirth).toBeDefined();

      const { rows } = await pool.query<{ count: string }>('select count(*) from person');
      expect(rows[0]!.count).toBe('0');
    });

    it('stores a blank income as NULL, not zero', async () => {
      await actions.createHousehold(form({ name: 'Test household' }));
      await actions.addPerson(form({ name: 'Alex', dateOfBirth: '1985-04-12', annualGrossIncome: '' }));

      const state = await queries.getSetupState();
      const [person] = await queries.getPeople(state.householdId!);
      expect(person!.annualGrossIncome).toBeNull();
    });
  });

  describe('the dashboard a household sees after setup', () => {
    it('shows a net worth total that nets the mortgage against the assets', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);

      expect(accounts).toHaveLength(6);
      // 186,420 + 54,110 + 97,860 + 6,180 + 410,000 − 376,500
      expect(money.penceToNumeric(breakdownModule.netWorthPence(accounts))).toBe('378070.00');
    });

    it('stores the mortgage as a negative balance from a positive entry', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const mortgage = accounts.find((account) => account.type === 'debt')!;

      expect(mortgage.latestAmount).toBe('-376500.00');
    });

    it('returns latestCapturedAt as a real Date, not the driver’s raw string', async () => {
      // Regression test. The "latest balance per account" query uses db.execute with raw SQL, and
      // Drizzle only maps timestamptz to a Date for *typed* selects — execute hands back the
      // driver's string. That mismatch compiled fine and then threw
      // "capturedAt.getTime is not a function" while rendering the dashboard's freshness line.
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);

      for (const account of accounts) {
        expect(account.latestCapturedAt).toBeInstanceOf(Date);
        expect(Number.isNaN(account.latestCapturedAt!.getTime())).toBe(false);
      }
    });

    it('returns snapshot dates as plain YYYY-MM-DD strings', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);

      for (const account of accounts) {
        expect(account.latestSnapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('records the joint accounts with no individual owner', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);

      const joint = accounts.filter((account) => account.personId === null);
      expect(joint.map((account) => account.name).sort()).toEqual([
        'Home — 14 Elm Grove',
        'Joint current account',
        'Mortgage — 14 Elm Grove',
      ]);
      for (const account of joint) expect(account.ownerName).toBeNull();
      expect(await queries.getJointAccountCount(householdId)).toBe(3);
    });

    it('groups the ledger by owner with a Joint group, each account appearing once', async () => {
      const { householdId } = await completeGuidedSetup();
      const [accounts, people] = await Promise.all([
        queries.getAccountsWithBalances(householdId),
        queries.getPeople(householdId),
      ]);

      const groups = breakdownModule.groupAccountsByOwner(accounts, people);
      expect(groups.map((group) => group.label)).toEqual(['Alex', 'Jordan', 'Joint']);

      const listed = groups.flatMap((group) => group.accounts.map((account) => account.id));
      expect(new Set(listed).size).toBe(accounts.length);
    });

    it('derives the tax wrapper from the type for every account', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);

      const byName = Object.fromEntries(accounts.map((a) => [a.name, a.taxWrapper]));
      expect(byName['Vanguard SIPP']).toBe('pension');
      expect(byName['Vanguard S&S ISA']).toBe('isa');
      expect(byName['Joint current account']).toBe('none');
      expect(byName['Mortgage — 14 Elm Grove']).toBe('none');
    });

    it('produces all three breakdowns, each summing to the total', async () => {
      const { householdId } = await completeGuidedSetup();
      const [accounts, people] = await Promise.all([
        queries.getAccountsWithBalances(householdId),
        queries.getPeople(householdId),
      ]);
      const total = breakdownModule.netWorthPence(accounts);

      for (const mode of ['person', 'asset', 'wrapper'] as const) {
        const slices = breakdownModule.breakdown(mode, accounts, people);
        expect(slices.length).toBeGreaterThan(0);
        const sum = slices.reduce((accumulated, slice) => accumulated + slice.pence, 0n);
        expect(money.penceToNumeric(sum)).toBe(money.penceToNumeric(total));
      }
    });

    it('builds a trend series ending at the current net worth', async () => {
      const { householdId } = await completeGuidedSetup();
      const snapshots = await queries.getSnapshotsForTrend(householdId, '2026-01-01');
      const accounts = await queries.getAccountsWithBalances(householdId);

      const series = seriesModule.buildNetWorthSeries(snapshots, {
        start: '2026-01-01',
        today: '2026-07-26',
      });

      expect(series.points.length).toBeGreaterThan(0);
      expect(money.penceToNumeric(series.last!.pence)).toBe(
        money.penceToNumeric(breakdownModule.netWorthPence(accounts)),
      );
    });

    it('writes the debt terms, keeping the allowance and the ERC rate distinct', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const mortgage = accounts.find((account) => account.type === 'debt')!;

      const detail = await queries.getAccountDetail(householdId, mortgage.id);
      expect(detail!.debtTerms).toMatchObject({
        interestRate: '4.250',
        minimumPayment: '1450.00',
        overpaymentAllowancePct: '10.000',
        overpaymentAllowanceBalanceBasis: 'annual_opening_balance',
        ercRatePct: '3.000',
        ercPeriodEnd: '2028-06-30',
        // Positive here, negative in the snapshot — written from the same input.
        currentBalance: '376500.00',
      });
    });
  });

  describe('manual balance update', () => {
    it('appends a snapshot and moves the dashboard total', async () => {
      const { householdId } = await completeGuidedSetup();
      let accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      const result = await actions.updateBalance(
        form({ accountId: String(isa.id), amount: '56000', snapshotDate: '2026-07-26' }),
      );
      expect(result.ok).toBe(true);

      accounts = await queries.getAccountsWithBalances(householdId);
      expect(accounts.find((account) => account.id === isa.id)!.latestAmount).toBe('56000.00');
      // 378,070 + (56,000 − 54,110)
      expect(money.penceToNumeric(breakdownModule.netWorthPence(accounts))).toBe('379960.00');

      const detail = await queries.getAccountDetail(householdId, isa.id);
      expect(detail!.history).toHaveLength(2);
    });

    it('replaces rather than duplicates a balance entered twice for the same date', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      await actions.updateBalance(
        form({ accountId: String(isa.id), amount: '56000', snapshotDate: '2026-07-26' }),
      );
      // A corrected typo on the same day.
      await actions.updateBalance(
        form({ accountId: String(isa.id), amount: '55000', snapshotDate: '2026-07-26' }),
      );

      const detail = await queries.getAccountDetail(householdId, isa.id);
      expect(detail!.history).toHaveLength(2); // the opening one, plus today's
      expect(detail!.latestAmount).toBe('55000.00');
    });

    it('negates a debt balance and keeps debt_terms.current_balance in step', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const mortgage = accounts.find((account) => account.type === 'debt')!;

      await actions.updateBalance(
        form({ accountId: String(mortgage.id), amount: '374000', snapshotDate: '2026-07-26' }),
      );

      const detail = await queries.getAccountDetail(householdId, mortgage.id);
      expect(detail!.latestAmount).toBe('-374000.00');
      expect(detail!.debtTerms!.currentBalance).toBe('374000.00');
    });

    it('rejects a negative balance on a non-debt account and writes nothing', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      const result = await actions.updateBalance(
        form({ accountId: String(isa.id), amount: '-100', snapshotDate: '2026-07-26' }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.amount).toBe('Balance can’t be negative for this account type');

      const detail = await queries.getAccountDetail(householdId, isa.id);
      expect(detail!.history).toHaveLength(1);
      expect(detail!.latestAmount).toBe('54110.00');
    });

    it('shows the most recent as-of date, not the most recently typed', async () => {
      // Back-filling last month's figure today must not overwrite today's on the dashboard.
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      await actions.updateBalance(
        form({ accountId: String(isa.id), amount: '56000', snapshotDate: '2026-07-20' }),
      );
      await actions.updateBalance(
        form({ accountId: String(isa.id), amount: '50000', snapshotDate: '2026-06-15' }),
      );

      const refreshed = await queries.getAccountsWithBalances(householdId);
      expect(refreshed.find((account) => account.id === isa.id)!.latestAmount).toBe('56000.00');
    });
  });

  describe('archive, not delete', () => {
    it('removes an archived account from totals but keeps its history', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      const result = await actions.setAccountArchived(
        form({ accountId: String(isa.id), archived: 'true' }),
      );
      expect(result.ok).toBe(true);

      const live = await queries.getAccountsWithBalances(householdId);
      expect(live.map((account) => account.id)).not.toContain(isa.id);
      expect(money.penceToNumeric(breakdownModule.netWorthPence(live))).toBe('323960.00');

      // The row and its snapshots are still there — this was not a delete.
      const withArchived = await queries.getAccountsWithBalances(householdId, { includeArchived: true });
      expect(withArchived.map((account) => account.id)).toContain(isa.id);
      const detail = await queries.getAccountDetail(householdId, isa.id);
      expect(detail!.archived).toBe(true);
      expect(detail!.history).toHaveLength(1);
    });

    it('restores an archived account back into the totals', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      await actions.setAccountArchived(form({ accountId: String(isa.id), archived: 'true' }));
      await actions.setAccountArchived(form({ accountId: String(isa.id), archived: 'false' }));

      const live = await queries.getAccountsWithBalances(householdId);
      expect(money.penceToNumeric(breakdownModule.netWorthPence(live))).toBe('378070.00');
    });

    it('never exposes a delete for an account', () => {
      // The design spec's decision, asserted structurally: there is no such action to call.
      expect(Object.keys(actions)).not.toContain('deleteAccount');
    });
  });

  describe('editing an account', () => {
    it('moves ownership from one person to another', async () => {
      const { householdId, jordan } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const sipp = accounts.find((account) => account.name === 'Vanguard SIPP')!;

      const result = await actions.updateAccount(
        form({
          accountId: String(sipp.id),
          name: 'Vanguard SIPP',
          type: 'sipp_pension',
          ownerIds: [String(jordan.id)],
        }),
      );
      expect(result.ok).toBe(true);

      const detail = await queries.getAccountDetail(householdId, sipp.id);
      expect(detail!.personId).toBe(jordan.id);
      expect(detail!.ownerName).toBe('Jordan');
    });

    it('turns a single-owner account joint when both owners are selected', async () => {
      const { householdId, alex, jordan } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const sipp = accounts.find((account) => account.name === 'Vanguard SIPP')!;

      await actions.updateAccount(
        form({
          accountId: String(sipp.id),
          name: 'Vanguard SIPP',
          type: 'sipp_pension',
          ownerIds: [String(alex.id), String(jordan.id)],
        }),
      );

      const detail = await queries.getAccountDetail(householdId, sipp.id);
      expect(detail!.personId).toBeNull();
    });

    it('updates the wrapper when the type is corrected', async () => {
      const { householdId, alex } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      await actions.updateAccount(
        form({
          accountId: String(isa.id),
          name: 'Vanguard GIA',
          type: 'gia',
          ownerIds: [String(alex.id)],
        }),
      );

      const detail = await queries.getAccountDetail(householdId, isa.id);
      expect(detail!.type).toBe('gia');
      expect(detail!.taxWrapper).toBe('gia');
    });

    it('refuses to change a debt account to a non-debt type, since its history is signed the other way', async () => {
      const { householdId, alex } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const mortgage = accounts.find((account) => account.type === 'debt')!;

      const result = await actions.updateAccount(
        form({
          accountId: String(mortgage.id),
          name: 'Mortgage — 14 Elm Grove',
          type: 'cash',
          ownerIds: [String(alex.id)],
        }),
      );

      expect(result.ok).toBe(false);

      // Nothing changed: type, debt_terms row, and the signed snapshot are all untouched.
      const detail = await queries.getAccountDetail(householdId, mortgage.id);
      expect(detail!.type).toBe('debt');
      const { rows } = await pool.query<{ count: string }>(
        'select count(*) from debt_terms where account_id = $1',
        [mortgage.id],
      );
      expect(rows[0]!.count).toBe('1');
    });

    it('refuses to change a non-debt account to debt, for the same reason', async () => {
      const { householdId, alex } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      const result = await actions.updateAccount(
        form({
          accountId: String(isa.id),
          name: 'Vanguard S&S ISA',
          type: 'debt',
          ownerIds: [String(alex.id)],
        }),
      );

      expect(result.ok).toBe(false);
      const detail = await queries.getAccountDetail(householdId, isa.id);
      expect(detail!.type).toBe('ss_isa');
    });
  });

  describe('holdings', () => {
    it('adds and removes a manually-entered holding', async () => {
      const { householdId } = await completeGuidedSetup();
      const accounts = await queries.getAccountsWithBalances(householdId);
      const isa = accounts.find((account) => account.name === 'Vanguard S&S ISA')!;

      expect(
        (await actions.addHolding(
          form({ accountId: String(isa.id), ticker: 'vwrl', quantity: '120.5', costBasis: '9400' }),
        )).ok,
      ).toBe(true);

      let detail = await queries.getAccountDetail(householdId, isa.id);
      expect(detail!.holdings).toHaveLength(1);
      expect(detail!.holdings[0]).toMatchObject({
        ticker: 'VWRL',
        quantity: '120.500000',
        costBasis: '9400.00',
      });

      await actions.deleteHolding(
        form({ holdingId: String(detail!.holdings[0]!.id), accountId: String(isa.id) }),
      );
      detail = await queries.getAccountDetail(householdId, isa.id);
      expect(detail!.holdings).toHaveLength(0);
    });
  });

  describe('pension contributions', () => {
    it('records amount, method and employer amount separately', async () => {
      const { householdId, alex } = await completeGuidedSetup();

      const result = await actions.addPensionContribution(
        form({
          personId: String(alex.id),
          amount: '4800',
          method: 'salary_sacrifice',
          employerAmount: '3200',
        }),
      );
      expect(result.ok).toBe(true);

      const people = await queries.getPeopleWithPensions(householdId);
      const contributions = people.find((person) => person.id === alex.id)!.pensionContributions;
      expect(contributions).toHaveLength(1);
      expect(contributions[0]).toMatchObject({
        amount: '4800.00',
        method: 'salary_sacrifice',
        employerAmount: '3200.00',
      });
    });

    it('rejects a contribution with no method', async () => {
      const { alex } = await completeGuidedSetup();
      const result = await actions.addPensionContribution(
        form({ personId: String(alex.id), amount: '4800', employerAmount: '0' }),
      );

      expect(result.ok).toBe(false);
      const { rows } = await pool.query<{ count: string }>('select count(*) from pension_contribution');
      expect(rows[0]!.count).toBe('0');
    });
  });

  describe('ownership migration is explicit, not a cascade', () => {
    it('refuses to delete a person who still owns an account, then allows it once reassigned', async () => {
      const { householdId, alex, jordan } = await completeGuidedSetup();

      await expect(pool.query('delete from person where id = $1', [alex.id])).rejects.toThrow(
        /violates foreign key constraint/,
      );

      // Reassign Alex's accounts to Jordan, the way the edit form does.
      const accounts = await queries.getAccountsWithBalances(householdId);
      for (const account of accounts.filter((entry) => entry.personId === alex.id)) {
        await actions.updateAccount(
          form({
            accountId: String(account.id),
            name: account.name,
            type: account.type,
            ownerIds: [String(jordan.id)],
          }),
        );
      }

      expect(await queries.countAccountsForPerson(alex.id)).toBe(0);
      await expect(pool.query('delete from person where id = $1', [alex.id])).resolves.toBeTruthy();

      // Nothing was lost: the accounts and their history moved rather than disappearing.
      const after = await queries.getAccountsWithBalances(householdId);
      expect(after).toHaveLength(6);
      expect(money.penceToNumeric(breakdownModule.netWorthPence(after))).toBe('378070.00');
    });
  });
});
