/**
 * Phase 4.5, Milestone 1 — the tax-status core for the Cash Allocation Advisor.
 *
 * `docs/PROPOSAL.md` §4 flags this feature as "arguably higher-risk than the Monte
 * Carlo engine, since it's rule-based UK tax logic... with hard right answers and no
 * reference-calculator excuse." This module is the first, highest-risk piece of that
 * logic, built and tested in isolation before anything wires it to real household
 * data — the same sequencing Phase 3's `deterministicCore.ts` used (engine core first,
 * `resolveScenario.ts`'s DB wiring later). Pure functions only: no DB access, no
 * `fetch`, nothing async.
 *
 * Two genuinely different HMRC tests live here, and `docs/PROPOSAL.md` §2 is explicit
 * that conflating them is a real mistake an earlier draft made: **adjusted net income**
 * (ANI) tests against the £100,000–£125,140 personal-allowance taper, and — separately —
 * the £60,000 pension annual allowance, restricted to £10,000 (the Money Purchase
 * Annual Allowance, MPAA) for anyone who has already flexibly accessed a pension. Both
 * treat `salary_sacrifice`/`net_pay`/`relief_at_source` pension contributions
 * differently, which is why every function below takes the same
 * `PensionContributionInput[]` shape rather than a single pre-summed total.
 *
 * **Disclosed simplifications, not oversights, for this milestone:**
 * 1. **Salary-only.** `grossIncomePence` is assumed to be the whole of ANI's income
 *    base. Real ANI is total taxable income (salary + dividends + savings interest +
 *    rental + benefits-in-kind) — `docs/PROPOSAL.md` §2 names this exact gap and scopes
 *    it as a documented P1 limitation, not a silent guess: this understates ANI for
 *    anyone with meaningful investment income.
 * 2. **The pension annual-allowance taper's own income test (threshold income over
 *    £200,000 AND adjusted income over £260,000, tapering £1 per £2 of adjusted income
 *    above £260,000 down to the same £10,000 floor as MPAA) is not implemented here.**
 *    Confirmed against gov.uk's own guidance
 *    (gov.uk/guidance/pension-schemes-work-out-your-tapered-annual-allowance, fetched
 *    2026-08-03) but deliberately left out of this milestone: `docs/PROPOSAL.md` §2
 *    explicitly defers the exact threshold-income/adjusted-income worksheet mechanics
 *    (in particular, salary sacrificed under arrangements set up on or after 9 July
 *    2015 is added back for threshold income but not for ANI — "a single shared formula
 *    gets this backwards for exactly the high earners this feature targets") to Phase
 *    4.5 implementation. `computeAnnualAllowanceStatus` below only applies the MPAA
 *    restriction; a future milestone adds the income-based taper as its own function
 *    once the worksheet mechanics are worked out, rather than half-building it now.
 */

import type { PensionContributionMethodValue } from '@/lib/db/schema';
import {
  MPAA_PENCE_2026_27,
  PENSION_ANNUAL_ALLOWANCE_PENCE_2026_27,
  PERSONAL_ALLOWANCE_PENCE_2026_27,
  personalAllowanceTaperCeilingPence,
  PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27,
} from '@/lib/retirement/taxYearConfig';

export interface PensionContributionInput {
  /** The member's own contribution, annual, pence. */
  amountPence: bigint;
  method: PensionContributionMethodValue;
  /** The employer's contribution, annual, pence — never subtracted from ANI, since it
   * was never the member's own income. */
  employerAmountPence: bigint;
}

/**
 * Adjusted net income (ANI) — the personal-allowance-taper test.
 *
 * `grossIncomePence` is pre-sacrifice contractual salary, matching
 * `people.annualGrossIncome`'s own documented meaning (`schema.ts`). `salary_sacrifice`
 * and `net_pay` contributions already reduce taxable pay before HMRC would assess this
 * figure, so both are subtracted at face value; `relief_at_source` contributions are
 * paid from net (post-tax) pay and are deducted **grossed up** (÷0.8, i.e. ×1.25) per
 * HMRC's ANI worksheet, since the pension scheme's own 20% basic-rate top-up is part of
 * what reduces the member's effective income. Never goes below zero.
 */
export function computeAdjustedNetIncomePence(
  grossIncomePence: bigint,
  contributions: readonly PensionContributionInput[],
): bigint {
  let ani = grossIncomePence;
  for (const contribution of contributions) {
    if (contribution.method === 'relief_at_source') {
      ani -= (contribution.amountPence * 5n) / 4n;
    } else {
      ani -= contribution.amountPence;
    }
  }
  return ani < 0n ? 0n : ani;
}

export interface PersonalAllowanceTaperStatus {
  adjustedNetIncomePence: bigint;
  fullPersonalAllowancePence: bigint;
  /** How much of the full personal allowance has been withdrawn by the taper — £1 per
   * £2 of ANI above the start point, clamped so it never exceeds the full allowance. */
  personalAllowanceWithdrawnPence: bigint;
  remainingPersonalAllowancePence: bigint;
  /** True whenever ANI sits strictly above the taper's start point — including once
   * fully withdrawn, since the household is still in the ~60%-effective-marginal-rate
   * consequence of that, not just the withdrawal band itself. */
  inTaperZone: boolean;
}

/**
 * The personal-allowance taper, per `docs/PROPOSAL.md` §2/§4: ANI above £100,000
 * withdraws the personal allowance at £1 per £2, gone entirely by £125,140. This is the
 * band the Cash Allocation Advisor's waterfall step 3 (a pension-contribution
 * recommendation to pull income back under £100k) reacts to.
 */
export function computePersonalAllowanceTaperStatus(
  grossIncomePence: bigint,
  contributions: readonly PensionContributionInput[],
): PersonalAllowanceTaperStatus {
  const adjustedNetIncomePence = computeAdjustedNetIncomePence(grossIncomePence, contributions);
  const excessPence = adjustedNetIncomePence - PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27;
  const rawWithdrawnPence = excessPence > 0n ? excessPence / 2n : 0n;
  const personalAllowanceWithdrawnPence =
    rawWithdrawnPence > PERSONAL_ALLOWANCE_PENCE_2026_27 ? PERSONAL_ALLOWANCE_PENCE_2026_27 : rawWithdrawnPence;

  return {
    adjustedNetIncomePence,
    fullPersonalAllowancePence: PERSONAL_ALLOWANCE_PENCE_2026_27,
    personalAllowanceWithdrawnPence,
    remainingPersonalAllowancePence: PERSONAL_ALLOWANCE_PENCE_2026_27 - personalAllowanceWithdrawnPence,
    inTaperZone: adjustedNetIncomePence > PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27,
  };
}

export interface AnnualAllowanceStatus {
  /** £60,000 — before any MPAA restriction. The income-based taper (threshold/adjusted
   * income) is not applied here; see this module's doc comment. */
  standardAllowancePence: bigint;
  mpaaRestricted: boolean;
  /** min(standardAllowancePence, MPAA) when restricted, else standardAllowancePence. */
  effectiveAllowancePence: bigint;
}

/**
 * The pension annual allowance, MPAA-restricted only (see this module's doc comment
 * for what's deliberately not yet included). `hasFlexiblyAccessedPension` has no
 * schema field yet — accepted as an explicit parameter so this function doesn't need
 * to know where that fact will eventually come from (Milestone 2's job).
 */
export function computeAnnualAllowanceStatus(hasFlexiblyAccessedPension: boolean): AnnualAllowanceStatus {
  return {
    standardAllowancePence: PENSION_ANNUAL_ALLOWANCE_PENCE_2026_27,
    mpaaRestricted: hasFlexiblyAccessedPension,
    effectiveAllowancePence: hasFlexiblyAccessedPension
      ? MPAA_PENCE_2026_27
      : PENSION_ANNUAL_ALLOWANCE_PENCE_2026_27,
  };
}

// Re-exported so callers of this module don't need a second import from
// taxYearConfig.ts just to read the ceiling used above.
export { personalAllowanceTaperCeilingPence };
