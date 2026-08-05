import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  accounts,
  balanceSnapshots,
  debtTerms,
  holdings,
  households,
  people,
  pensionContributions,
  regularContributions,
} from '@/lib/db/schema';
import type {
  AccountTypeValue,
  DebtTerms,
  Holding,
  PensionContribution,
  RegularContribution,
  TaxWrapperValue,
} from '@/lib/db/schema';

/**
 * Read queries for the household model.
 *
 * All of these run in server components. None of them take a `Date` or format anything —
 * shaping for display happens in the components, and the aggregation maths lives in
 * src/lib/networth/, which is pure and directly testable. This file is only responsible
 * for getting the right rows out of Postgres.
 *
 * NUMERIC columns stay as strings the whole way through (see src/lib/money.ts).
 */

export interface SetupState {
  householdId: number | null;
  householdName: string | null;
  /** NUMERIC string, or null when not set — Phase 4.5's emergency-fund target. */
  emergencyFundTarget: string | null;
  personCount: number;
  accountCount: number;
  /** True once there's a household, at least one person and at least one account. */
  complete: boolean;
}

/**
 * Whether Guided Setup has been completed.
 *
 * DESIGN_SPEC.md defines the Guided Setup screen as "shown only when a household exists
 * with zero people/accounts", and the first-time-setup flow requires that a first login
 * with no household lands there rather than on an empty dashboard. This is the one query
 * every protected page runs first, so it is deliberately three cheap counts.
 *
 * The household row is selected by lowest id rather than by a hardcoded `id = 1`. There is
 * only ever one in practice, but a restored dump can perfectly well have `id = 7`, and
 * `LIMIT 1` with an explicit order costs nothing to get right.
 */
export async function getSetupState(): Promise<SetupState> {
  const db = getDb();

  const [household] = await db
    .select({ id: households.id, name: households.name, emergencyFundTarget: households.emergencyFundTarget })
    .from(households)
    .orderBy(asc(households.id))
    .limit(1);

  if (!household) {
    return {
      householdId: null,
      householdName: null,
      emergencyFundTarget: null,
      personCount: 0,
      accountCount: 0,
      complete: false,
    };
  }

  const [counts] = await db
    .select({
      personCount: sql<number>`(select count(*)::int from ${people} where ${people.householdId} = ${household.id})`,
      accountCount: sql<number>`(select count(*)::int from ${accounts} where ${accounts.householdId} = ${household.id})`,
    })
    .from(households)
    .where(eq(households.id, household.id));

  const personCount = counts?.personCount ?? 0;
  const accountCount = counts?.accountCount ?? 0;

  return {
    householdId: household.id,
    householdName: household.name,
    emergencyFundTarget: household.emergencyFundTarget,
    personCount,
    accountCount,
    complete: personCount > 0 && accountCount > 0,
  };
}

export interface PersonSummary {
  id: number;
  name: string;
  dateOfBirth: string;
  annualGrossIncome: string | null;
  hasFlexiblyAccessedPension: boolean;
}

export async function getPeople(householdId: number): Promise<PersonSummary[]> {
  const db = getDb();
  return db
    .select({
      id: people.id,
      name: people.name,
      dateOfBirth: people.dateOfBirth,
      annualGrossIncome: people.annualGrossIncome,
      hasFlexiblyAccessedPension: people.hasFlexiblyAccessedPension,
    })
    .from(people)
    .where(eq(people.householdId, householdId))
    // Creation order, so the household's own mental ordering is preserved rather than
    // being alphabetised out from under them.
    .orderBy(asc(people.id));
}

export interface AccountWithBalance {
  id: number;
  name: string;
  type: AccountTypeValue;
  taxWrapper: TaxWrapperValue;
  currency: string;
  archived: boolean;
  /** Only meaningful for `type: 'cash'` — see schema.ts's doc comment on the column. */
  isEmergencyFund: boolean;
  /** NULL means jointly owned at household level. */
  personId: number | null;
  ownerName: string | null;
  /** Latest snapshot amount as a NUMERIC string, or null if none recorded yet. */
  latestAmount: string | null;
  latestSnapshotDate: string | null;
  latestCapturedAt: Date | null;
}

/**
 * Every account with its latest balance.
 *
 * The "latest balance per account" join is the query the proposal cites as a reason for
 * the `(account_id, captured_at DESC)` index, and it is the one the dashboard and accounts
 * list both hit. It uses a lateral subquery rather than a window function over all
 * snapshots because that lets Postgres walk that index and stop at the first row per
 * account, instead of sorting the household's entire balance history to throw nearly all
 * of it away.
 *
 * "Latest" is ordered by `snapshot_date DESC, captured_at DESC`: the figure shown should be
 * the one that is true for the most recent date, and only where two snapshots share a date
 * does it matter which was written later. Ordering by `captured_at` alone would mean
 * back-filling last month's balance today would overwrite today's figure on the dashboard.
 */
export async function getAccountsWithBalances(
  householdId: number,
  options: { includeArchived?: boolean } = {},
): Promise<AccountWithBalance[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      taxWrapper: accounts.taxWrapper,
      currency: accounts.currency,
      archived: accounts.archived,
      isEmergencyFund: accounts.isEmergencyFund,
      personId: accounts.personId,
      ownerName: people.name,
    })
    .from(accounts)
    .leftJoin(people, eq(people.id, accounts.personId))
    .where(
      options.includeArchived
        ? eq(accounts.householdId, householdId)
        : and(eq(accounts.householdId, householdId), eq(accounts.archived, false)),
    )
    .orderBy(asc(accounts.id));

  if (rows.length === 0) return [];

  // `DISTINCT ON` in a second query, rather than a lateral join in the first. Postgres can
  // satisfy this straight from the (account_id, captured_at DESC) index and stop at the first
  // row per account; the alternative — a window function over the whole snapshot table — sorts
  // the household's entire balance history in order to discard nearly all of it.
  //
  // Note the `captured_at` type. Drizzle's *typed* `select()` maps a `timestamptz` column to a
  // JS `Date`, but `execute()` with raw SQL hands back whatever the driver produced — for
  // timestamps, a string like '2026-07-26 13:18:26.618+00'. Declaring it as `Date` here compiles
  // happily and then throws `capturedAt.getTime is not a function` at render time. It is typed as
  // a string and converted explicitly below, so the boundary is visible rather than assumed.
  const latest = await db.execute<{
    account_id: number;
    amount: string;
    snapshot_date: string;
    captured_at: string;
  }>(sql`
    select distinct on (${balanceSnapshots.accountId})
           ${balanceSnapshots.accountId} as account_id,
           ${balanceSnapshots.amount} as amount,
           ${balanceSnapshots.snapshotDate} as snapshot_date,
           ${balanceSnapshots.capturedAt} as captured_at
      from ${balanceSnapshots}
     where ${balanceSnapshots.accountId} in ${rows.map((row) => row.id)}
     order by ${balanceSnapshots.accountId},
              ${balanceSnapshots.snapshotDate} desc,
              ${balanceSnapshots.capturedAt} desc
  `);

  const latestByAccount = new Map(latest.rows.map((row) => [row.account_id, row]));

  return rows.map((row) => {
    const snapshot = latestByAccount.get(row.id);
    return {
      ...row,
      // A left join would leave a person's name attached to a row whose personId is null only
      // if the join were wrong, but normalising here means the "Joint" decision is made in one
      // place rather than trusted from the query shape.
      ownerName: row.personId === null ? null : row.ownerName,
      latestAmount: snapshot?.amount ?? null,
      latestSnapshotDate: snapshot?.snapshot_date ?? null,
      latestCapturedAt: snapshot ? new Date(snapshot.captured_at) : null,
    };
  });
}

export interface AccountDetail extends AccountWithBalance {
  householdId: number;
  history: Array<{ id: number; amount: string; snapshotDate: string; capturedAt: Date }>;
  holdings: Holding[];
  debtTerms: DebtTerms | null;
  regularContributions: RegularContribution[];
}

/**
 * One account, with everything Account Detail renders.
 *
 * Returns null rather than throwing for a missing id, so the route can answer with
 * Next's `notFound()` — a stale bookmark to a deleted account should be a 404, not a 500.
 */
export async function getAccountDetail(
  householdId: number,
  accountId: number,
): Promise<AccountDetail | null> {
  const db = getDb();

  const [account] = await db
    .select({
      id: accounts.id,
      householdId: accounts.householdId,
      name: accounts.name,
      type: accounts.type,
      taxWrapper: accounts.taxWrapper,
      currency: accounts.currency,
      archived: accounts.archived,
      isEmergencyFund: accounts.isEmergencyFund,
      personId: accounts.personId,
      ownerName: people.name,
    })
    .from(accounts)
    .leftJoin(people, eq(people.id, accounts.personId))
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
    .limit(1);

  if (!account) return null;

  const history = await db
    .select({
      id: balanceSnapshots.id,
      amount: balanceSnapshots.amount,
      snapshotDate: balanceSnapshots.snapshotDate,
      capturedAt: balanceSnapshots.capturedAt,
    })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.accountId, accountId))
    .orderBy(asc(balanceSnapshots.snapshotDate));

  const accountHoldings = await db
    .select()
    .from(holdings)
    .where(eq(holdings.accountId, accountId))
    .orderBy(asc(holdings.ticker));

  const [terms] = await db.select().from(debtTerms).where(eq(debtTerms.accountId, accountId)).limit(1);

  const accountRegularContributions = await db
    .select()
    .from(regularContributions)
    .where(eq(regularContributions.accountId, accountId))
    .orderBy(asc(regularContributions.id));

  const latest = history.at(-1) ?? null;

  return {
    ...account,
    ownerName: account.personId === null ? null : account.ownerName,
    latestAmount: latest?.amount ?? null,
    latestSnapshotDate: latest?.snapshotDate ?? null,
    latestCapturedAt: latest?.capturedAt ?? null,
    history,
    holdings: accountHoldings,
    debtTerms: terms ?? null,
    regularContributions: accountRegularContributions,
  };
}

export interface PortfolioHoldingRow {
  id: number;
  ticker: string;
  /** NUMERIC(18,6) string. */
  quantity: string;
  /** NUMERIC(14,2) string. */
  costBasis: string;
  accountId: number;
  accountName: string;
  accountCurrency: string;
  /** null = jointly owned by the household, same convention as `AccountWithBalance`. */
  ownerName: string | null;
  /** NUMERIC(14,2) string, annual — this account's own `regular_contribution` row for
   * this exact ticker, if any. Read-only here; managed on the account detail page. */
  regularContributionAmount: string | null;
}

/**
 * Every holding across every live investment account in the household, with just enough
 * account context for the Portfolio View to group by ticker and still show which
 * account(s) each one lives in (DESIGN_SPEC.md: "Each row expandable to show which
 * account(s) it's held in").
 *
 * Not filtered by account type: only `holdsSecurities` account types ever get a holding
 * row in the first place (the Add Holding form only renders on those account types), so
 * there is nothing to additionally filter here — trusting that invariant rather than
 * re-deriving it, the same way the rest of this file trusts `debt_terms` only existing on
 * debt accounts.
 */
export async function getPortfolioHoldings(householdId: number): Promise<PortfolioHoldingRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: holdings.id,
      ticker: holdings.ticker,
      quantity: holdings.quantity,
      costBasis: holdings.costBasis,
      accountId: accounts.id,
      accountName: accounts.name,
      accountCurrency: accounts.currency,
      personId: accounts.personId,
      ownerName: people.name,
    })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .leftJoin(people, eq(people.id, accounts.personId))
    .where(and(eq(accounts.householdId, householdId), eq(accounts.archived, false)))
    .orderBy(asc(holdings.ticker));

  // Regular contributions targeting a specific ticker (not a plain cash contribution,
  // which has nothing to attach to a holding row) — matched by (accountId, ticker), the
  // same soft pairing `regular_contribution.ticker` was designed around rather than a
  // foreign key to `holding` (a regular purchase can be recorded before the first
  // purchase lands as a holding at all).
  const contributionRows = await db
    .select({ accountId: regularContributions.accountId, ticker: regularContributions.ticker, amount: regularContributions.amount })
    .from(regularContributions)
    .innerJoin(accounts, eq(accounts.id, regularContributions.accountId))
    .where(and(eq(accounts.householdId, householdId), isNotNull(regularContributions.ticker)));
  const contributionByAccountAndTicker = new Map(
    contributionRows.map((row) => [`${row.accountId}:${row.ticker}`, row.amount]),
  );

  return rows.map((row) => ({
    ...row,
    ownerName: row.personId === null ? null : row.ownerName,
    regularContributionAmount: contributionByAccountAndTicker.get(`${row.accountId}:${row.ticker}`) ?? null,
  }));
}

export interface SnapshotPoint {
  accountId: number;
  amount: string;
  snapshotDate: string;
}

/**
 * Snapshots for the trend chart, for every live account in the household.
 *
 * `since` is nullable for the "All" window. One snapshot *before* the window start is also
 * needed per account, otherwise an account last updated three months ago would appear to
 * be worth nothing at the left edge of a 1-month chart — the series builder carries the
 * last known balance forward, and it can only do that if it's given the row to carry.
 * That is what the `union` below is for.
 */
export async function getSnapshotsForTrend(
  householdId: number,
  since: string | null,
): Promise<SnapshotPoint[]> {
  const db = getDb();

  const liveAccountIds = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.archived, false)));

  if (liveAccountIds.length === 0) return [];
  const ids = liveAccountIds.map((row) => row.id);

  const inWindow = await db
    .select({
      accountId: balanceSnapshots.accountId,
      amount: balanceSnapshots.amount,
      snapshotDate: balanceSnapshots.snapshotDate,
    })
    .from(balanceSnapshots)
    .where(
      since
        ? and(inArray(balanceSnapshots.accountId, ids), gte(balanceSnapshots.snapshotDate, since))
        : inArray(balanceSnapshots.accountId, ids),
    )
    .orderBy(asc(balanceSnapshots.snapshotDate));

  if (!since) return inWindow;

  // The most recent snapshot before the window, per account, so balances can be carried
  // forward from before the left edge.
  const carried = await db.execute<{
    account_id: number;
    amount: string;
    snapshot_date: string;
  }>(sql`
    select distinct on (${balanceSnapshots.accountId})
           ${balanceSnapshots.accountId} as account_id,
           ${balanceSnapshots.amount} as amount,
           ${balanceSnapshots.snapshotDate} as snapshot_date
      from ${balanceSnapshots}
     where ${balanceSnapshots.accountId} in ${ids}
       and ${balanceSnapshots.snapshotDate} < ${since}
     order by ${balanceSnapshots.accountId}, ${balanceSnapshots.snapshotDate} desc
  `);

  return [
    ...carried.rows.map((row) => ({
      accountId: row.account_id,
      amount: row.amount,
      snapshotDate: row.snapshot_date,
    })),
    ...inWindow,
  ];
}

export interface PersonWithPensions extends PersonSummary {
  pensionContributions: PensionContribution[];
}

/** People with their pension contributions, for the household settings screen. */
export async function getPeopleWithPensions(householdId: number): Promise<PersonWithPensions[]> {
  const db = getDb();
  const roster = await getPeople(householdId);
  if (roster.length === 0) return [];

  const contributions = await db
    .select()
    .from(pensionContributions)
    .where(
      inArray(
        pensionContributions.personId,
        roster.map((person) => person.id),
      ),
    )
    .orderBy(asc(pensionContributions.id));

  return roster.map((person) => ({
    ...person,
    pensionContributions: contributions.filter((row) => row.personId === person.id),
  }));
}

export interface RegularContributionAmount {
  /** null = a jointly-owned account's contribution — no single person to attribute it to. */
  personId: number | null;
  /** NUMERIC(14,2) string — left unsummed, matching this file's own "NUMERIC stays a
   * string here" convention; a caller sums via numericToPence, same as it already does
   * for pensionContributions. */
  amount: string;
}

/** Every `regular_contribution` row across the household, with just enough account
 * context (`personId`) to attribute it to a person or the joint bucket — for the
 * retirement results page's "Before retirement" note (Phase 4.4's follow-up). Not
 * filtered by account type: only non-pension, non-debt, non-property accounts ever get
 * a row in the first place (enforced at the action layer), same trust-the-invariant
 * posture `getPortfolioHoldings` already takes toward `holdsSecurities`. **Is** filtered
 * by `archived`, matching `getAccountsWithBalances`'s own default: `resolveScenario.ts`
 * sources contributions through that same archived-excluding query, so an archived
 * account's contribution used to appear in this note while the engine silently
 * excluded it from the simulation — a real UI/engine divergence, fixed by agreeing on
 * the same "live accounts only" scope here. */
export async function getRegularContributionAmounts(householdId: number): Promise<RegularContributionAmount[]> {
  const db = getDb();
  return db
    .select({ personId: accounts.personId, amount: regularContributions.amount })
    .from(regularContributions)
    .innerJoin(accounts, eq(accounts.id, regularContributions.accountId))
    .where(and(eq(accounts.householdId, householdId), eq(accounts.archived, false)));
}

export interface DebtAccountWithTerms {
  accountId: number;
  accountName: string;
  /** NULL means jointly owned at household level — same convention as everywhere else. */
  personId: number | null;
  terms: DebtTerms | null;
}

/**
 * Every `debt`-type account in the household, with its `debt_terms` row if it has one
 * (terms are optional per account — see `validateDebtTerms`'s own doc comment).
 * `getAccountDetail` only joins this for a single account; Phase 4.5's debt-vs-save
 * comparator and avalanche/snowball ordering need the whole household's debts at once.
 */
export async function getDebtAccountsWithTerms(householdId: number): Promise<DebtAccountWithTerms[]> {
  const db = getDb();
  const rows = await db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      personId: accounts.personId,
      terms: debtTerms,
    })
    .from(accounts)
    .leftJoin(debtTerms, eq(debtTerms.accountId, accounts.id))
    .where(and(eq(accounts.householdId, householdId), eq(accounts.type, 'debt'), eq(accounts.archived, false)));

  return rows.map((row) => ({ ...row, terms: row.terms ?? null }));
}

/**
 * Count of accounts owned by a person, for the archive/ownership-change confirmations.
 *
 * Exists because `ON DELETE RESTRICT` means a delete attempt fails with a Postgres foreign
 * key error, and showing a household member a raw constraint violation is not an answer.
 * The UI checks first and explains.
 */
export async function countAccountsForPerson(personId: number): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.personId, personId));
  return row?.count ?? 0;
}

/** Accounts with no individual owner — the "Joint" group. Used by tests and the ledger. */
export async function getJointAccountCount(householdId: number): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), isNull(accounts.personId)));
  return row?.count ?? 0;
}
