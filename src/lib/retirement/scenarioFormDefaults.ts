/**
 * UK-calibrated starting values for a brand-new Scenario Editor form — "pre-filled with
 * sensible defaults, not blank fields demanding research" per `docs/DESIGN_SPEC.md`'s
 * Scenario Editor spec. Pure and client-safe (no `getDb`), so the Editor can compute
 * these on first paint with no server round trip.
 *
 * Every non-obvious number here is a documented judgment call, not a value the design
 * spec or proposal states outright (only the 3.0–3.5% UK withdrawal-rate range and the
 * 85–95% success-rate target bar are actually sourced in `docs/PROPOSAL.md`) — chosen to
 * match what this codebase's own existing engine tests already treat as canonical
 * (`scenarioAssumptions.test.ts`, `resolveScenario.integration.test.ts`), so a fresh
 * scenario's defaults aren't a third, disagreeing set of numbers.
 */

import { ageAsOf, statePensionClaimAgeFromDate } from './personAge';
import { statePensionDate } from './taxYearConfig';
import type { DrawdownAccountType } from './engineTypes';
import type { ScenarioAssumptionsPersonV1, ScenarioAssumptionsV1 } from './scenarioAssumptions';

export interface PersonForDefaults {
  personId: number;
  dateOfBirth: string; // YYYY-MM-DD
}

/** Default retirement age: the later of "already past this age" (in which case, now) or
 * 65 — a round, widely-recognised UK retirement age, comfortably inside the ≥current-age
 * bound the Editor's own validation enforces. Immediately editable, like every default
 * here. */
const DEFAULT_RETIREMENT_AGE_FLOOR = 65;

/** Default plan-end (mortality/horizon) age — a conservative-but-not-extreme planning
 * horizon; ONS cohort life expectancy for someone in their 40s today comfortably clears
 * this, and it stays inside `requireAge`'s 130-year sanity bound with room for a
 * household to extend it. */
const DEFAULT_PLAN_END_AGE = 95;

const DEFAULT_INFLATION_PCT = '2.500';
const DEFAULT_EQUITY_ALLOCATION_PCT = '60.000';
/** Midpoint of `docs/PROPOSAL.md`'s own "target a 85–95% simulation success rate" bar. */
const DEFAULT_TARGET_SUCCESS_RATE_PCT = '90.000';
/** UK basic-rate income tax, as the single flat rate applied to taxable drawdown —
 * `scenarioAssumptions.ts`'s own doc comment notes no default is specified anywhere in
 * the source proposal and leaves the choice to this milestone. */
const DEFAULT_FLAT_EFFECTIVE_TAX_RATE_PCT = '20.000';

/** The one genuinely arbitrary figure here — no existing precedent in this codebase to
 * anchor to. Immediately editable; every other default at least matches a sourced range
 * or an existing test's canonical value. */
const DEFAULT_ANNUAL_SPENDING = '30000.00';

/** A common single-survivor budgeting rule of thumb (household costs don't halve when
 * household size does) — applied only when `survivorAnnualSpending` is actually required
 * (more than one person modelled). */
const SURVIVOR_SPENDING_FRACTION = 0.75;

/** Spend the cash buffer first, then the taxable GIA (using CGT/dividend allowances
 * while other income is low), then the ISAs (already tax-free, so no urgency either
 * way), pension last (tax-deferred growth, IHT-efficient to preserve) — a common UK
 * decumulation convention, not the engine's own recommendation: `engineTypes.ts`'s own
 * doc comment is explicit that the engine applies whatever order it's given literally,
 * with no optimisation. */
export const DEFAULT_WRAPPER_WITHDRAWAL_ORDER: DrawdownAccountType[] = [
  'cash',
  'gia',
  'cash_isa',
  'ss_isa',
  'lisa',
  'sipp_pension',
];

function defaultPerson(person: PersonForDefaults, todayIsoDate: string): ScenarioAssumptionsPersonV1 {
  const currentAge = ageAsOf(person.dateOfBirth, todayIsoDate);
  const spDate = statePensionDate(person.dateOfBirth);
  return {
    personId: person.personId,
    retirementAge: Math.max(currentAge, DEFAULT_RETIREMENT_AGE_FLOOR),
    statePensionClaimAge: statePensionClaimAgeFromDate(person.dateOfBirth, spDate),
    planEndAge: DEFAULT_PLAN_END_AGE,
  };
}

/** Builds a full `ScenarioAssumptionsV1` for a brand-new scenario, given the household's
 * people and today's date (`todayIso()` from `@/lib/accounts/validation`, passed in
 * rather than read here so this stays pure and testable with a fixed date). */
export function defaultAssumptionsFor(
  people: readonly PersonForDefaults[],
  todayIsoDate: string,
): ScenarioAssumptionsV1 {
  return {
    schemaVersion: 1,
    annualSpending: DEFAULT_ANNUAL_SPENDING,
    survivorAnnualSpending:
      people.length > 1
        ? (Number(DEFAULT_ANNUAL_SPENDING) * SURVIVOR_SPENDING_FRACTION).toFixed(2)
        : undefined,
    inflationPct: DEFAULT_INFLATION_PCT,
    equityAllocationPct: DEFAULT_EQUITY_ALLOCATION_PCT,
    targetSuccessRatePct: DEFAULT_TARGET_SUCCESS_RATE_PCT,
    flatEffectiveTaxRatePct: DEFAULT_FLAT_EFFECTIVE_TAX_RATE_PCT,
    wrapperWithdrawalOrder: DEFAULT_WRAPPER_WITHDRAWAL_ORDER,
    people: people.map((person) => defaultPerson(person, todayIsoDate)),
  };
}
