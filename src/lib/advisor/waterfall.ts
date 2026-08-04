/**
 * Phase 4.5, Milestone 2 — the core contribution waterfall.
 *
 * "Given this household's real accounts, debts and income, and £X extra to allocate,
 * where should it go and in what order." Pure function, no DB access — the resolver
 * (`resolveWaterfallInput.ts`) assembles `WaterfallInput` from real household data,
 * mirroring how `resolveScenario.ts` feeds the retirement engine.
 *
 * **Six steps, per the household's own scoping decision** (see the plan this shipped
 * against): emergency fund, high-interest debt, LISA, remaining ISA allowance, further
 * pension (capped), GIA. `docs/PROPOSAL.md` §4's full eight-step waterfall also
 * includes "capture the full employer match" and a personal-allowance-taper rescue —
 * both **deliberately deferred**, since neither has the schema to support it yet (no
 * employer-match-policy field, and the annual-allowance taper's own income test is
 * itself deferred from Milestone 1). This is a disclosed scope reduction, not a
 * silently incomplete waterfall — surfaced in `docs/STATUS.md` and, once Milestone 4
 * builds a results screen, in the UI itself.
 *
 * **Per-person steps (LISA, remaining ISA, further pension) are allocated across every
 * person in the household in ascending `personId` order**, each greedily filling from
 * whatever's left of the extra amount. There's no product spec for "whose contribution
 * takes priority in a two-earner household" beyond the proposal's own single-person
 * framing, so a stable, disclosed default (person creation order) stands in rather than
 * inventing an unrequested prioritisation scheme. The GIA catch-all step, similarly,
 * attributes any true leftover to the first person in that same order.
 *
 * **Carry-forward is not modeled** in the further-pension step: no historical
 * contribution data exists anywhere in this schema to compute three years of unused
 * allowance, so the cap used here is the flat current-year allowance only —
 * conservative (it may under-recommend, never over-recommend), and disclosed rather
 * than guessed at as zero silently.
 */

import { ageAsOf } from '@/lib/retirement/personAge';
import { cashIsaSubLimitPence } from '@/lib/retirement/taxYearConfig';
import { computeAnnualAllowanceStatus, type PensionContributionInput } from './taxStatus';
import { currentUkTaxYearWindow, type UkTaxYearWindow } from './taxYear';

const ISA_ALLOWANCE_PENCE = 20_000_00n;
const LISA_SUBLIMIT_PENCE = 4_000_00n;
const LISA_OPEN_MIN_AGE = 18;
const LISA_OPEN_MAX_AGE = 39;
const LISA_CONTRIBUTE_MAX_AGE = 50;

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export interface DebtInput {
  accountId: number;
  name: string;
  /** NULL means jointly owned at household level. */
  personId: number | null;
  balancePence: bigint;
  /** A percent string like "24.900", or null when the rate hasn't been entered. */
  interestRatePct: string | null;
}

export interface PersonWaterfallInput {
  personId: number;
  name: string;
  dateOfBirth: string;
  /** Pre-sacrifice contractual salary, or null when not entered — see taxStatus.ts. */
  grossIncomePence: bigint | null;
  pensionContributions: PensionContributionInput[];
  hasFlexiblyAccessedPension: boolean;
  /** True if this person already has an open LISA account — lets someone 40–49 who
   * opened one before turning 40 keep contributing, per the two-tier eligibility rule. */
  hasExistingLisa: boolean;
  /** Summed from this person's own ISA-type `regular_contribution` rows, annualised
   * pace, for the current UK tax year — see `taxYear.ts`'s module doc comment for the
   * "assumed pace, not actual contributions banked so far" simplification. */
  isaUsedPence: bigint;
  /** The subset of `isaUsedPence` attributable to this person's LISA specifically. */
  lisaUsedPence: bigint;
}

export interface WaterfallInput {
  todayIso: string;
  extraAmountPence: bigint;
  /** Null means "not set" — the emergency-fund step is skipped entirely, not treated
   * as an unlimited or zero need. */
  emergencyFundTargetPence: bigint | null;
  emergencyFundCurrentPence: bigint;
  debts: DebtInput[];
  /** The "realistic investment returns" benchmark a debt's rate must beat to count as
   * "high-interest" — a percent string like "5.500". Not hardcoded: the resolver
   * defaults this from `ukHistoricalReturns.ts`'s own UK-calibrated geometric-mean
   * real return, the same source of truth the retirement engine already uses for
   * "realistic returns", surfaced as an assumption rather than baked in silently. */
  debtBenchmarkRatePct: string;
  people: PersonWaterfallInput[];
}

export type WaterfallStepId =
  | 'emergency_fund'
  | 'high_interest_debt'
  | 'lisa'
  | 'remaining_isa'
  | 'further_pension'
  | 'gia';

export interface WaterfallStepResult {
  id: WaterfallStepId;
  /** Null for the household-level emergency-fund step; otherwise whose account this
   * allocation targets. */
  personId: number | null;
  label: string;
  amountPence: bigint;
  /** Plain-text reasoning — no formatted money embedded (that's a display concern;
   * `amountPence` carries the figure, formatted only at the UI boundary, same
   * discipline as every other pure engine module in this codebase). */
  rationale: string;
}

export interface WaterfallResult {
  steps: WaterfallStepResult[];
  /** Whatever's left of `extraAmountPence` after every step. Surfaced explicitly
   * rather than assumed to be zero — GIA is a catch-all only when there's at least one
   * person to attribute it to. */
  unallocatedPence: bigint;
  dataQualityWarnings: string[];
  /** Which UK tax year the ISA/LISA/pension figures above are being computed against
   * — for display ("this tax year: 6 April 2026 – 5 April 2027"), since every figure
   * here is otherwise silent about which year's allowance it's counting against. */
  taxYearWindow: UkTaxYearWindow;
}

function isLisaEligible(age: number, hasExistingLisa: boolean): boolean {
  const canOpen = age >= LISA_OPEN_MIN_AGE && age <= LISA_OPEN_MAX_AGE;
  const canStillContribute = age < LISA_CONTRIBUTE_MAX_AGE;
  return (hasExistingLisa || canOpen) && canStillContribute;
}

export function computeContributionWaterfall(input: WaterfallInput): WaterfallResult {
  let remaining = input.extraAmountPence;
  const steps: WaterfallStepResult[] = [];
  const dataQualityWarnings: string[] = [];

  function allocate(id: WaterfallStepId, personId: number | null, label: string, headroomPence: bigint, rationale: string) {
    if (remaining <= 0n || headroomPence <= 0n) return;
    const amountPence = headroomPence < remaining ? headroomPence : remaining;
    steps.push({ id, personId, label, amountPence, rationale });
    remaining -= amountPence;
  }

  // 1. Emergency fund.
  if (input.emergencyFundTargetPence !== null) {
    const shortfall = input.emergencyFundTargetPence - input.emergencyFundCurrentPence;
    allocate(
      'emergency_fund',
      null,
      'Top up emergency fund',
      shortfall > 0n ? shortfall : 0n,
      'Below the household’s emergency-fund target.',
    );
  }

  // 2. High-interest debt — any debt whose rate beats the benchmark, highest rate first.
  const benchmark = Number(input.debtBenchmarkRatePct);
  const highInterestDebts = input.debts
    .filter((debt) => debt.interestRatePct !== null && Number(debt.interestRatePct) > benchmark)
    .sort((a, b) => Number(b.interestRatePct) - Number(a.interestRatePct));
  for (const debt of highInterestDebts) {
    allocate(
      'high_interest_debt',
      debt.personId,
      `Pay down ${debt.name}`,
      debt.balancePence,
      `${debt.interestRatePct}% APR beats the ${input.debtBenchmarkRatePct}% realistic-returns benchmark.`,
    );
  }

  const orderedPeople = [...input.people].sort((a, b) => a.personId - b.personId);

  // 3. LISA, per eligible person.
  for (const person of orderedPeople) {
    const age = ageAsOf(person.dateOfBirth, input.todayIso);
    if (!isLisaEligible(age, person.hasExistingLisa)) continue;
    const headroom = minBigint(
      LISA_SUBLIMIT_PENCE - person.lisaUsedPence,
      ISA_ALLOWANCE_PENCE - person.isaUsedPence,
    );
    allocate(
      'lisa',
      person.personId,
      `${person.name}: LISA`,
      headroom > 0n ? headroom : 0n,
      '25% government bonus, within this tax year’s £4,000 LISA sub-limit.',
    );
  }

  // 4. Remaining ISA allowance, per person.
  for (const person of orderedPeople) {
    const headroom = ISA_ALLOWANCE_PENCE - person.isaUsedPence;
    const cashCap = cashIsaSubLimitPence(input.todayIso, person.dateOfBirth);
    const rationale =
      cashCap !== null
        ? 'Remaining £20,000 ISA allowance this tax year. A dated Cash ISA sub-limit applies for anyone under 65 from 6 April 2027.'
        : 'Remaining £20,000 ISA allowance this tax year.';
    allocate('remaining_isa', person.personId, `${person.name}: ISA`, headroom > 0n ? headroom : 0n, rationale);
  }

  // 5. Further pension, capped by the annual allowance (MPAA-restricted where it
  // applies) and 100% of relevant UK earnings — no carry-forward.
  for (const person of orderedPeople) {
    if (person.grossIncomePence === null) {
      dataQualityWarnings.push(
        `${person.name}: income not entered, so a further-pension recommendation can’t be made.`,
      );
      continue;
    }
    const annualAllowance = computeAnnualAllowanceStatus(person.hasFlexiblyAccessedPension);
    const alreadyContributedPence = person.pensionContributions.reduce(
      (sum, c) => sum + c.amountPence + c.employerAmountPence,
      0n,
    );
    const cap = minBigint(annualAllowance.effectiveAllowancePence, person.grossIncomePence);
    const headroom = cap - alreadyContributedPence;
    allocate(
      'further_pension',
      person.personId,
      `${person.name}: pension`,
      headroom > 0n ? headroom : 0n,
      annualAllowance.mpaaRestricted
        ? 'Capped by the £10,000 Money Purchase Annual Allowance. No carry-forward modelled.'
        : 'Capped by the £60,000 annual allowance and relevant UK earnings. No carry-forward modelled.',
    );
  }

  // 6. GIA — catch-all for whatever remains.
  if (remaining > 0n) {
    const recipient = orderedPeople[0];
    if (recipient) {
      allocate(
        'gia',
        recipient.personId,
        `${recipient.name}: GIA`,
        remaining,
        'Everything else, once tax-advantaged room is used up.',
      );
    } else {
      dataQualityWarnings.push('No one in this scenario to attribute the remaining amount to.');
    }
  }

  return {
    steps,
    unallocatedPence: remaining,
    dataQualityWarnings,
    taxYearWindow: currentUkTaxYearWindow(input.todayIso),
  };
}
