/**
 * Turns a household's live `person`/`account`/`regular_contribution`/`debt_terms` data
 * into the `WaterfallInput` `waterfall.ts` actually consumes — the DB-wired resolution
 * layer, the same role `resolveScenario.ts` plays for the retirement engine.
 *
 * **ISA/LISA "used" arithmetic is an assumed-pace approximation, not actual
 * contributions banked so far this tax year**: `regular_contribution` has no start
 * date, so every active row on an ISA-type account is treated as consuming its full
 * annual amount against the current tax year's allowance, regardless of when in the
 * year it is — the same disclosed simplification `taxYear.ts`'s own doc comment names.
 *
 * **Defends against joint ISA/LISA accounts**, which are legally impossible in the UK
 * but not currently blocked at the form layer (a real gap found while scoping this
 * milestone — see the plan). Any `cash_isa`/`ss_isa`/`lisa` account with `personId:
 * null` is excluded from every per-person allowance total and surfaced in `warnings`
 * instead of silently included or crashed on.
 *
 * **Also resolves `debtComparator.ts`'s inputs**, alongside (not instead of) the
 * waterfall's own `debts: DebtInput[]` — `getDebtAccountsWithTerms` already fetches
 * the full `debt_terms` row (overpayment allowance, ERC rate/period), which used to be
 * fetched and thrown away since `waterfall.ts`'s own `DebtInput` has no use for it.
 * `DebtInput`/`WaterfallInput` are deliberately NOT widened to carry these fields —
 * they're exactly the narrow contract `waterfall.ts` and its own test fixtures already
 * expect, and the comparator's needs are a superset that belongs next to it instead.
 */

import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { households, regularContributions } from '@/lib/db/schema';
import { getAccountsWithBalances, getDebtAccountsWithTerms, getPeopleWithPensions } from '@/lib/household/queries';
import { numericToPence } from '@/lib/money';
import { todayIso } from '@/lib/accounts/validation';
import { meanNominalEquityReturnPct } from '@/lib/retirement/returns/ukHistoricalReturns';
import type { DebtComparatorDebtInput } from './debtComparator';
import type { DebtInput, PersonWaterfallInput, WaterfallInput } from './waterfall';

const ISA_TYPE_SET = new Set(['cash_isa', 'ss_isa', 'lisa']);

export interface ResolvedWaterfallInput {
  input: WaterfallInput;
  /** Data-quality issues found while resolving (e.g. a joint ISA account excluded)
   * — distinct from `computeContributionWaterfall`'s own `dataQualityWarnings`
   * (which only sees already-resolved per-person totals), so a caller combines both. */
  warnings: string[];
  comparator: {
    /** Only signal available for "does this household already own a home": no
     * dedicated boolean field exists, so a `property`-type account stands in. */
    householdOwnsProperty: boolean;
    debts: DebtComparatorDebtInput[];
  };
}

/**
 * Resolves `householdId`'s waterfall input for `extraAmountPence` extra to allocate.
 * `debtBenchmarkRatePctOverride` lets a caller substitute a household-chosen "realistic
 * returns" assumption; defaults to `meanNominalEquityReturnPct()` — UK-calibrated,
 * nominal (comparable to a debt's own nominal APR — see `waterfall.ts`'s doc comment
 * on `debtBenchmarkRatePct` for why real would be the wrong figure here), already the
 * retirement engine's own source of truth for realistic returns, not invented here.
 * An override that isn't a valid finite rate is ignored (with a warning) rather than
 * silently producing `NaN` comparisons downstream.
 */
export async function resolveWaterfallInput(
  householdId: number,
  extraAmountPence: bigint,
  options: { now?: Date; debtBenchmarkRatePctOverride?: string } = {},
): Promise<ResolvedWaterfallInput> {
  const db = getDb();
  const today = todayIso(options.now);
  const warnings: string[] = [];

  const [people, accountsWithBalances, debts, [household]] = await Promise.all([
    getPeopleWithPensions(householdId),
    getAccountsWithBalances(householdId),
    getDebtAccountsWithTerms(householdId),
    db
      .select({ emergencyFundTarget: households.emergencyFundTarget })
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1),
  ]);

  const emergencyFundCurrentPence = accountsWithBalances
    .filter((account) => account.type === 'cash' && account.isEmergencyFund)
    .reduce((sum, account) => sum + (account.latestAmount ? numericToPence(account.latestAmount) : 0n), 0n);

  const isaUsedPenceByPersonId = new Map<number, bigint>();
  const lisaUsedPenceByPersonId = new Map<number, bigint>();
  const hasExistingLisaByPersonId = new Map<number, boolean>();

  // Every ISA-type account is checked for the joint-ownership defect here, in one
  // place, regardless of whether it has any `regular_contribution` rows — a joint
  // account with zero contributions was previously excluded from `hasExistingLisa`
  // with no warning at all, silently rather than flagged. `isaTypeAccountIds` below
  // (used for the contribution-summing query) is pre-filtered to non-joint accounts
  // only, so nothing downstream needs to re-check `personId` a second time.
  for (const account of accountsWithBalances) {
    if (!ISA_TYPE_SET.has(account.type)) continue;
    if (account.personId === null) {
      warnings.push(
        `${account.name} is a jointly-owned ${account.type === 'lisa' ? 'LISA' : 'ISA'} account, which isn’t legally possible in the UK — it was excluded from every allowance total.`,
      );
      continue;
    }
    if (account.type === 'lisa') {
      hasExistingLisaByPersonId.set(account.personId, true);
    }
  }

  const isaTypeAccountIds = accountsWithBalances
    .filter((account) => ISA_TYPE_SET.has(account.type) && account.personId !== null)
    .map((account) => account.id);

  if (isaTypeAccountIds.length > 0) {
    const accountById = new Map(accountsWithBalances.map((account) => [account.id, account]));
    const rows = await db
      .select({ accountId: regularContributions.accountId, amount: regularContributions.amount })
      .from(regularContributions)
      .where(inArray(regularContributions.accountId, isaTypeAccountIds));

    for (const row of rows) {
      const account = accountById.get(row.accountId);
      if (!account) continue; // defensive; can't happen given the id list above
      // account.personId is guaranteed non-null: isaTypeAccountIds already excludes
      // joint accounts above.
      const personId = account.personId!;
      const amountPence = numericToPence(row.amount);
      isaUsedPenceByPersonId.set(personId, (isaUsedPenceByPersonId.get(personId) ?? 0n) + amountPence);
      if (account.type === 'lisa') {
        lisaUsedPenceByPersonId.set(personId, (lisaUsedPenceByPersonId.get(personId) ?? 0n) + amountPence);
      }
    }
  }

  let debtBenchmarkRatePct = meanNominalEquityReturnPct();
  if (options.debtBenchmarkRatePctOverride !== undefined) {
    if (Number.isFinite(Number(options.debtBenchmarkRatePctOverride))) {
      debtBenchmarkRatePct = options.debtBenchmarkRatePctOverride;
    } else {
      warnings.push(
        `The debt-benchmark rate override ("${options.debtBenchmarkRatePctOverride}") isn't a valid rate, so the UK-calibrated default was used instead.`,
      );
    }
  }

  const resolvedPeople: PersonWaterfallInput[] = people.map((person) => ({
    personId: person.id,
    name: person.name,
    dateOfBirth: person.dateOfBirth,
    grossIncomePence: person.annualGrossIncome ? numericToPence(person.annualGrossIncome) : null,
    pensionContributions: person.pensionContributions.map((c) => ({
      amountPence: numericToPence(c.amount),
      method: c.method,
      employerAmountPence: numericToPence(c.employerAmount),
    })),
    hasFlexiblyAccessedPension: person.hasFlexiblyAccessedPension,
    hasExistingLisa: hasExistingLisaByPersonId.get(person.id) ?? false,
    isaUsedPence: isaUsedPenceByPersonId.get(person.id) ?? 0n,
    lisaUsedPence: lisaUsedPenceByPersonId.get(person.id) ?? 0n,
  }));

  const resolvedDebts: DebtInput[] = debts.map((debt) => ({
    accountId: debt.accountId,
    name: debt.accountName,
    personId: debt.personId,
    balancePence: debt.terms?.currentBalance ? numericToPence(debt.terms.currentBalance) : 0n,
    interestRatePct: debt.terms?.interestRate ?? null,
  }));

  const comparatorDebts: DebtComparatorDebtInput[] = debts.map((debt) => ({
    accountId: debt.accountId,
    name: debt.accountName,
    personId: debt.personId,
    balancePence: debt.terms?.currentBalance ? numericToPence(debt.terms.currentBalance) : 0n,
    interestRatePct: debt.terms?.interestRate ?? null,
    overpaymentAllowancePct: debt.terms?.overpaymentAllowancePct ?? null,
    overpaymentAllowanceBalanceBasis: debt.terms?.overpaymentAllowanceBalanceBasis ?? null,
    ercRatePct: debt.terms?.ercRatePct ?? null,
    ercPeriodEnd: debt.terms?.ercPeriodEnd ?? null,
  }));

  const householdOwnsProperty = accountsWithBalances.some((account) => account.type === 'property');

  return {
    input: {
      todayIso: today,
      extraAmountPence,
      emergencyFundTargetPence: household?.emergencyFundTarget
        ? numericToPence(household.emergencyFundTarget)
        : null,
      emergencyFundCurrentPence,
      debts: resolvedDebts,
      debtBenchmarkRatePct,
      people: resolvedPeople,
    },
    warnings,
    comparator: {
      householdOwnsProperty,
      debts: comparatorDebts,
    },
  };
}
