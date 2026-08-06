/**
 * The personal-allowance-taper-rescue recommendation — the fast-follow Phase 4.5
 * shipped without, per its own disclosed deferral note. `docs/PROPOSAL.md` §4: for
 * anyone with adjusted net income (ANI) in the £100,000–£125,140 band, the personal
 * allowance withdraws at £1 per £2, an effective ~60% marginal rate — a pension
 * contribution to pull income back under £100k is "a strong candidate to weigh, not
 * an automatic override" of the ordinary waterfall steps. `taxStatus.ts`'s
 * `computeAdjustedNetIncomePence`/`personalAllowanceTaperCeilingPence` already do the
 * tax-status math this needs; this module composes them into an actual
 * recommendation and costs it against the household's own high-interest debt.
 *
 * **A gate, not a cap.** A recommendation only fires when ANI sits strictly within
 * `(£100,000, £125,140]` — genuinely still losing allowance on the margin. Above
 * £125,140 the allowance is already fully gone; `computePersonalAllowanceTaperStatus`'s
 * own `inTaperZone` flag stays `true` indefinitely past that point (it means "was
 * affected by the taper," not "still losing allowance right now"), so relying on it
 * alone here would misleadingly frame ordinary higher-rate pension relief as this
 * specific ~60% rescue for someone who's already out of the band.
 *
 * **The gross figure and the relief-at-source net payment are both shown,
 * unambiguously labeled** — `excessPence`/`recommendedGrossContributionPence` is how
 * much ANI needs to fall; `recommendedNetPaymentPence` is what actually leaves take-
 * home pay via relief-at-source (ceiling-divided, never rounded down — undershooting
 * by a penny would leave the household still technically in the taper zone despite
 * following the advice).
 *
 * **Decoupled from `waterfall.ts`'s computed output on purpose**: this module caps
 * its own recommendation by the raw `extraAmountPence` and pension headroom, not by
 * whatever the ordinary waterfall steps left over — it answers "if this were
 * reprioritised ahead of the steps above, what would it take," not "what's left after
 * everything else." The page composing this module's output alongside
 * `waterfall.ts`'s own already-recommended pension step is what prevents this reading
 * as double-counted new money — that framing belongs at the display layer, not here.
 *
 * **Two disclosed gaps, not silent omissions:**
 * 1. "Can the household actually afford this while still servicing debt minimums" is
 *    only half-checked. The emergency-fund half is verifiable (`emergencyFundOnTrack`
 *    below) and household-level, not per-person (`waterfall.ts`'s own emergency-fund
 *    fields are household-scoped). The debt-minimums half is NOT verifiable — this
 *    app has no income/expense/cash-flow model, only annual gross salary — so a
 *    recommendation is still returned even when it might not be truly affordable, and
 *    the caller must caveat that in the UI rather than present this as unconditional.
 * 2. The Tax-Free Childcare / 30-funded-hours cliff at exactly £100k ANI —
 *    `docs/PROPOSAL.md`'s own "strongest version of this recommendation" — is NOT
 *    modeled at all. No children/dependents schema exists anywhere in this app;
 *    building that is a separate, much larger feature. A household in that situation
 *    gets the ordinary ~60% framing here, not the (much stronger, potentially >100%
 *    effective-rate) childcare-cliff framing the full spec describes.
 */

import {
  computeAdjustedNetIncomePence,
  pensionContributionHeadroomPence,
  personalAllowanceTaperCeilingPence,
} from './taxStatus';
import { PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27 } from '@/lib/retirement/taxYearConfig';
import { estimatePayoff } from './loanPayoff';
import { isHighInterestDebt, type PersonWaterfallInput } from './waterfall';
import type { ComparatorDebtInput } from './resolveWaterfallInput';

/** Ceiling division for non-negative bigints — used so the relief-at-source net
 * payment shown never rounds down and undershoots the taper threshold by a penny. */
function ceilDiv(numerator: bigint, divisor: bigint): bigint {
  return (numerator + divisor - 1n) / divisor;
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export interface TaperRescueDebtComparison {
  accountId: number;
  name: string;
  aprPct: string;
  months: number;
  totalInterestPence: bigint;
}

export interface TaperRescuePersonResult {
  personId: number;
  personName: string;
  adjustedNetIncomePence: bigint;
  /** How far into the £100,000–£125,140 band this person's ANI sits — always > 0 and
   * <= £25,140 given the gate in this module's doc comment. */
  excessPence: bigint;
  /** Capped by remaining pension headroom and by `extraAmountPence`'s gross-
   * equivalent — an upper bound on "if you redirected everything here instead," not
   * a claim it doesn't overlap the waterfall's own further-pension step. */
  recommendedGrossContributionPence: bigint;
  /** The relief-at-source net payment for `recommendedGrossContributionPence`,
   * safety-clamped to `extraAmountPence` regardless of rounding direction. */
  recommendedNetPaymentPence: bigint;
  fullyClearsTaper: boolean;
  /** Comparisons against this person's own or jointly-owned high-interest debt —
   * `waterfall.ts`'s own step-2 payoff candidates. Empty is a valid, expected state
   * (no debt, or none with the rate/minimum-payment data this needs). */
  debtComparisons: TaperRescueDebtComparison[];
}

export interface TaperRescueResult {
  people: TaperRescuePersonResult[];
  /** The one affordability precondition this module can actually verify — see the
   * module doc comment for what it can't. */
  emergencyFundOnTrack: boolean;
}

export interface TaperRescueInput {
  extraAmountPence: bigint;
  debtBenchmarkRatePct: string;
  emergencyFundTargetPence: bigint | null;
  emergencyFundCurrentPence: bigint;
  people: PersonWaterfallInput[];
  debts: ComparatorDebtInput[];
}

export function computeTaperRescueRecommendations(input: TaperRescueInput): TaperRescueResult {
  const emergencyFundOnTrack =
    input.emergencyFundTargetPence === null
      ? true
      : input.emergencyFundCurrentPence >= input.emergencyFundTargetPence;

  const taperCeilingPence = personalAllowanceTaperCeilingPence();
  const affordableGrossPence = (input.extraAmountPence * 5n) / 4n; // floor: never overstate what's affordable.

  const people: TaperRescuePersonResult[] = [];

  for (const person of input.people) {
    if (person.grossIncomePence === null) continue; // can't compute ANI without income entered.

    const adjustedNetIncomePence = computeAdjustedNetIncomePence(
      person.grossIncomePence,
      person.pensionContributions,
    );
    if (adjustedNetIncomePence <= PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27) continue;
    if (adjustedNetIncomePence > taperCeilingPence) continue; // gate, not cap — see module doc comment.

    const excessPence = adjustedNetIncomePence - PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27;

    const headroomPence = pensionContributionHeadroomPence(
      person.grossIncomePence,
      person.pensionContributions,
      person.hasFlexiblyAccessedPension,
    );

    let recommendedGrossContributionPence = minBigint(excessPence, minBigint(headroomPence, affordableGrossPence));
    if (recommendedGrossContributionPence < 0n) recommendedGrossContributionPence = 0n;

    const recommendedNetPaymentPence = minBigint(
      ceilDiv(recommendedGrossContributionPence * 4n, 5n),
      input.extraAmountPence,
    );

    const debtComparisons: TaperRescueDebtComparison[] = [];
    for (const debt of input.debts) {
      if (debt.personId !== null && debt.personId !== person.personId) continue; // this person's own or joint debt only.
      if (!isHighInterestDebt(debt.interestRatePct, input.debtBenchmarkRatePct)) continue;
      if (debt.interestRatePct === null || debt.minimumPaymentPence === null || debt.balancePence <= 0n) continue;

      const payoff = estimatePayoff(debt.balancePence, debt.interestRatePct, debt.minimumPaymentPence);
      if (payoff.ok) {
        debtComparisons.push({
          accountId: debt.accountId,
          name: debt.name,
          aprPct: debt.interestRatePct,
          months: payoff.months,
          totalInterestPence: payoff.totalInterestPence,
        });
      }
    }

    people.push({
      personId: person.personId,
      personName: person.name,
      adjustedNetIncomePence,
      excessPence,
      recommendedGrossContributionPence,
      recommendedNetPaymentPence,
      fullyClearsTaper: recommendedGrossContributionPence >= excessPence,
      debtComparisons,
    });
  }

  return { people, emergencyFundOnTrack };
}
