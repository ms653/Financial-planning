/**
 * Turns a stored `retirement_scenario` row plus the household's live `person`/
 * `account`/`balance_snapshot` data into the `ResolvedScenario` the engine actually
 * consumes. Flagged as missing since Milestone 3 ("engineTypes.ts's original doc
 * comment attributed 'assembling a ResolvedScenario' to Milestone 3's job, but the
 * actual bullet list only ever specified the engine and its tests") and left unbuilt
 * through M5 and M6 — this is that function.
 *
 * **Judgment call**: starting balances always come from `balance_snapshot`, uniformly
 * across every account type — never priced holdings, even for `holdsSecurities`
 * accounts. `docs/STATUS.md` already documents that holdings and account balance can
 * silently drift apart (`addHolding` never touches `balance_snapshot`) and calls that
 * "wanted, not yet scoped." This function doesn't invent a hybrid heuristic to paper
 * over that gap — every other part of the app (net worth, dashboard) already treats the
 * account's recorded balance as authoritative, and this does the same, inheriting the
 * same documented limitation rather than adding a second, untested way to resolve it.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { people, pensionContributions, regularContributions, retirementScenarios } from '@/lib/db/schema';
import { getAccountsWithBalances } from '@/lib/household/queries';
import { numericToPence } from '@/lib/money';
import { todayIso } from '@/lib/accounts/validation';
import { parseScenarioAssumptions } from './scenarioAssumptions';
import {
  DRAWDOWN_ACCOUNT_TYPES,
  percentStringToScaledFraction,
  type DrawdownAccountType,
  type ResolvedPerson,
  type ResolvedScenario,
} from './engineTypes';
import { statePensionAnnualPence, statePensionDate } from './taxYearConfig';
import { ageAsOf, statePensionClaimAgeFromDate } from './personAge';

const DRAWDOWN_TYPE_SET = new Set<string>(DRAWDOWN_ACCOUNT_TYPES);

// Re-exported for existing callers/tests — the implementations now live in
// personAge.ts so Milestone 9's client-side Scenario Editor can import them without
// dragging this file's getDb()/drizzle imports into a client bundle.
export { ageAsOf, statePensionClaimAgeFromDate };

/**
 * Resolves scenario `scenarioId`, scoped to `householdId` (returns `null` if the
 * scenario doesn't exist or belongs to a different household — the same
 * not-found-vs-not-owned collapsing `getAccountDetail` already uses elsewhere).
 *
 * Throws if the scenario's own assumptions reference a `personId` no longer in the
 * household — a data-integrity problem (the scenario is stale against a deleted
 * person), not a validation error a caller should recover from silently.
 */
export async function resolveScenario(
  scenarioId: number,
  householdId: number,
): Promise<ResolvedScenario | null> {
  const db = getDb();

  const [scenarioRow] = await db
    .select()
    .from(retirementScenarios)
    .where(and(eq(retirementScenarios.id, scenarioId), eq(retirementScenarios.householdId, householdId)));
  if (!scenarioRow) return null;

  const assumptions = parseScenarioAssumptions(scenarioRow.assumptions);

  const personIds = assumptions.people.map((p) => p.personId);
  const personRows = await db
    .select({ id: people.id, dateOfBirth: people.dateOfBirth })
    .from(people)
    .where(and(eq(people.householdId, householdId), inArray(people.id, personIds)));
  const dobById = new Map(personRows.map((row) => [row.id, row.dateOfBirth]));

  // Phase 4.4: every pension_contribution row for a referenced person, summed
  // (amount + employerAmount) into pence — a person can have more than one recorded
  // pension, and both the member's own and their employer's contribution land in the
  // same sipp_pension wrapper during accumulation (deterministicCore.ts).
  const pensionContributionRows = await db
    .select({
      personId: pensionContributions.personId,
      amount: pensionContributions.amount,
      employerAmount: pensionContributions.employerAmount,
    })
    .from(pensionContributions)
    .where(inArray(pensionContributions.personId, personIds));
  const pensionContributionPenceByPersonId = new Map<number, bigint>();
  for (const row of pensionContributionRows) {
    const rowTotalPence = numericToPence(row.amount) + numericToPence(row.employerAmount);
    pensionContributionPenceByPersonId.set(
      row.personId,
      (pensionContributionPenceByPersonId.get(row.personId) ?? 0n) + rowTotalPence,
    );
  }

  // Archived accounts are excluded by getAccountsWithBalances's own default — an
  // archived account shouldn't feed a live simulation's starting balance or its
  // regular contributions, same as it's already excluded from the net worth total and
  // trend chart. Fetched before resolving people/contributions below, since both need
  // to know each account's owner and wrapper type.
  const accountsWithBalances = await getAccountsWithBalances(householdId);
  const accountOwnerById = new Map(accountsWithBalances.map((account) => [account.id, account.personId]));
  const accountTypeById = new Map(accountsWithBalances.map((account) => [account.id, account.type]));

  // Phase 4.4's follow-up: every regular_contribution row (Cash/GIA/ISA/LISA — never
  // sipp_pension, that's the pension_contribution query above), split by the owning
  // account's personId. A personal account's own owner isn't necessarily one of
  // `assumptions.people` — that contribution is simply never read below (no
  // retirementAge to gate it by), not guessed at. A joint account (personId null) has
  // no single owner to gate on at all, so it goes into the household-wide bucket
  // instead, gated in the engine on `householdFullyRetired` rather than an age.
  const personalContributionsByPersonId = new Map<number, Partial<Record<DrawdownAccountType, bigint>>>();
  const jointAnnualContributionsPence: Partial<Record<DrawdownAccountType, bigint>> = {};
  if (accountsWithBalances.length > 0) {
    const regularContributionRows = await db
      .select({ accountId: regularContributions.accountId, amount: regularContributions.amount })
      .from(regularContributions)
      .where(
        inArray(
          regularContributions.accountId,
          accountsWithBalances.map((account) => account.id),
        ),
      );
    for (const row of regularContributionRows) {
      const type = accountTypeById.get(row.accountId);
      if (!type || !DRAWDOWN_TYPE_SET.has(type)) continue; // defensive; write-time already excludes debt/property
      const drawdownType = type as DrawdownAccountType;
      const amountPence = numericToPence(row.amount);
      const ownerId = accountOwnerById.get(row.accountId) ?? null;

      if (ownerId === null) {
        jointAnnualContributionsPence[drawdownType] = (jointAnnualContributionsPence[drawdownType] ?? 0n) + amountPence;
      } else {
        const existing = personalContributionsByPersonId.get(ownerId) ?? {};
        existing[drawdownType] = (existing[drawdownType] ?? 0n) + amountPence;
        personalContributionsByPersonId.set(ownerId, existing);
      }
    }
  }

  const today = todayIso();

  const resolvedPeople: ResolvedPerson[] = assumptions.people.map((person) => {
    const dob = dobById.get(person.personId);
    if (!dob) {
      throw new Error(
        `Scenario ${scenarioId} references person ${person.personId}, not found in household ${householdId}`,
      );
    }
    const pensionPence = pensionContributionPenceByPersonId.get(person.personId);
    // Sums onto any existing `sipp_pension` key rather than overwriting it — a plain
    // object-spread here previously let a `regular_contribution` row that had wrongly
    // ended up on a `sipp_pension` account (possible before the account-edit guard in
    // `household/actions.ts` was added) silently clobber the real
    // `pension_contribution` figure, or vice versa, instead of the two combining.
    const annualContributionsPence: Partial<Record<DrawdownAccountType, bigint>> = {
      ...personalContributionsByPersonId.get(person.personId),
    };
    if (pensionPence) {
      annualContributionsPence.sipp_pension = (annualContributionsPence.sipp_pension ?? 0n) + pensionPence;
    }
    return {
      personId: person.personId,
      currentAge: ageAsOf(dob, today),
      retirementAge: person.retirementAge,
      statePensionClaimAge:
        person.statePensionClaimAge ?? statePensionClaimAgeFromDate(dob, statePensionDate(dob)),
      statePensionAnnualPence: person.statePensionAnnualOverride
        ? numericToPence(person.statePensionAnnualOverride)
        : statePensionAnnualPence(),
      pclsAge: person.pclsAge ?? null,
      planEndAge: person.planEndAge,
      annualContributionsPence,
    };
  });

  const startingBalancesPence: Partial<Record<DrawdownAccountType, bigint>> = {};
  for (const account of accountsWithBalances) {
    if (!DRAWDOWN_TYPE_SET.has(account.type)) continue; // excludes debt/property
    const type = account.type as DrawdownAccountType;
    const pence = account.latestAmount ? numericToPence(account.latestAmount) : 0n;
    startingBalancesPence[type] = (startingBalancesPence[type] ?? 0n) + pence;
  }

  return {
    scenarioId,
    annualSpendingPence: numericToPence(assumptions.annualSpending),
    survivorAnnualSpendingPence: assumptions.survivorAnnualSpending
      ? numericToPence(assumptions.survivorAnnualSpending)
      : null,
    inflationRate: percentStringToScaledFraction(assumptions.inflationPct),
    equityAllocationRate: percentStringToScaledFraction(assumptions.equityAllocationPct),
    targetSuccessRate: percentStringToScaledFraction(assumptions.targetSuccessRatePct),
    flatEffectiveTaxRate: percentStringToScaledFraction(assumptions.flatEffectiveTaxRatePct),
    wrapperWithdrawalOrder: assumptions.wrapperWithdrawalOrder,
    people: resolvedPeople,
    startingBalancesPence,
    jointAnnualContributionsPence,
    oneOffEvents: (assumptions.oneOffEvents ?? []).map((event) => ({
      personId: event.personId,
      age: event.age,
      amountPence: numericToPence(event.amount),
    })),
  };
}
