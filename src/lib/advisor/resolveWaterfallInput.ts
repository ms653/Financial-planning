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
 */

import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, regularContributions } from '@/lib/db/schema';
import {
  getAccountsWithBalances,
  getDebtAccountsWithTerms,
  getPeopleWithPensions,
  getSetupState,
} from '@/lib/household/queries';
import { numericToPence } from '@/lib/money';
import { todayIso } from '@/lib/accounts/validation';
import { meanRealEquityReturnPct } from '@/lib/retirement/returns/ukHistoricalReturns';
import type { DebtInput, PersonWaterfallInput, WaterfallInput } from './waterfall';

const ISA_TYPE_SET = new Set(['cash_isa', 'ss_isa', 'lisa']);

export interface ResolvedWaterfallInput {
  input: WaterfallInput;
  /** Data-quality issues found while resolving (e.g. a joint ISA account excluded)
   * — distinct from `computeContributionWaterfall`'s own `dataQualityWarnings`
   * (which only sees already-resolved per-person totals), so a caller combines both. */
  warnings: string[];
}

/**
 * Resolves `householdId`'s waterfall input for `extraAmountPence` extra to allocate.
 * `debtBenchmarkRatePctOverride` lets a caller substitute a household-chosen "realistic
 * returns" assumption; defaults to `meanRealEquityReturnPct()` — UK-calibrated, already
 * the retirement engine's own source of truth for realistic returns, not invented here.
 */
export async function resolveWaterfallInput(
  householdId: number,
  extraAmountPence: bigint,
  options: { now?: Date; debtBenchmarkRatePctOverride?: string } = {},
): Promise<ResolvedWaterfallInput> {
  const db = getDb();
  const today = todayIso(options.now);
  const warnings: string[] = [];

  const [people, accountsWithBalances, debts] = await Promise.all([
    getPeopleWithPensions(householdId),
    getAccountsWithBalances(householdId),
    getDebtAccountsWithTerms(householdId),
  ]);

  const emergencyFundCurrentPence = accountsWithBalances
    .filter((account) => account.type === 'cash' && account.isEmergencyFund)
    .reduce((sum, account) => sum + (account.latestAmount ? numericToPence(account.latestAmount) : 0n), 0n);

  const isaTypeAccountIds = accountsWithBalances
    .filter((account) => ISA_TYPE_SET.has(account.type))
    .map((account) => account.id);

  const isaUsedPenceByPersonId = new Map<number, bigint>();
  const lisaUsedPenceByPersonId = new Map<number, bigint>();
  const hasExistingLisaByPersonId = new Map<number, boolean>();

  for (const account of accountsWithBalances) {
    if (account.type === 'lisa' && account.personId !== null) {
      hasExistingLisaByPersonId.set(account.personId, true);
    }
  }

  if (isaTypeAccountIds.length > 0) {
    const accountById = new Map(accountsWithBalances.map((account) => [account.id, account]));
    const rows = await db
      .select({ accountId: regularContributions.accountId, amount: regularContributions.amount })
      .from(regularContributions)
      .where(inArray(regularContributions.accountId, isaTypeAccountIds));

    for (const row of rows) {
      const account = accountById.get(row.accountId);
      if (!account) continue; // defensive; can't happen given the id list above

      if (account.personId === null) {
        warnings.push(
          `${account.name} is a jointly-owned ${account.type === 'lisa' ? 'LISA' : 'ISA'} account, which isn’t legally possible in the UK — its regular contribution was excluded from every allowance total.`,
        );
        continue;
      }

      const amountPence = numericToPence(row.amount);
      isaUsedPenceByPersonId.set(
        account.personId,
        (isaUsedPenceByPersonId.get(account.personId) ?? 0n) + amountPence,
      );
      if (account.type === 'lisa') {
        lisaUsedPenceByPersonId.set(
          account.personId,
          (lisaUsedPenceByPersonId.get(account.personId) ?? 0n) + amountPence,
        );
      }
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

  const setup = await getSetupState();

  return {
    input: {
      todayIso: today,
      extraAmountPence,
      emergencyFundTargetPence: setup.emergencyFundTarget ? numericToPence(setup.emergencyFundTarget) : null,
      emergencyFundCurrentPence,
      debts: resolvedDebts,
      debtBenchmarkRatePct: options.debtBenchmarkRatePctOverride ?? meanRealEquityReturnPct(),
      people: resolvedPeople,
    },
    warnings,
  };
}
