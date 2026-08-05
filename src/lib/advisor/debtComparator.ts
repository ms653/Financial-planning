/**
 * Phase 4.5, Milestone 3 — the debt-vs-save comparator.
 *
 * For debt whose rate does NOT beat the "realistic investment returns" benchmark
 * (`waterfall.ts`'s step 2 already handles anything that does, recommending full
 * payoff) — the classic UK case is a mortgage — the answer isn't obvious. This module
 * doesn't hand down a verdict; it shows the numbers side by side, per
 * `docs/PROPOSAL.md` §4: the debt's own APR against a small set of "investing instead"
 * options, and — separately — what it would actually cost to put a given amount toward
 * the debt once the penalty-free overpayment allowance is exceeded.
 *
 * **This-year snapshot only, not a multi-year projection.** A household chose this
 * deliberately: a deterministic compounding model here would duplicate, and likely
 * drift from, the real stochastic multi-year tool this app already has (the Phase 3
 * Monte Carlo engine). "What if I do this every year for a decade" belongs to Phase
 * 4.6's scenario planning against that engine, not a second bespoke projector.
 *
 * **"Inclusive of relief," not a fabricated rate.** The LISA bonus and pension
 * relief-at-source top-up are both flat, statutory 25%-of-net add-ons — modelled as a
 * one-off £ figure on the amount actually being considered this year, not folded into
 * an inflated annualised percentage (which would misrepresent a one-off top-up as a
 * recurring return). The underlying market-return assumption is the same
 * `debtBenchmarkRatePct` for every wrapper: which wrapper money sits in doesn't change
 * what the invested assets themselves return.
 *
 * **No invented tax logic.** There is no general marginal-tax-rate engine in this
 * codebase (`taxStatus.ts`'s own doc comment names this as a disclosed gap), so no
 * salary-sacrifice/net-pay "inclusive of relief" option is offered — only
 * `relief_at_source`'s flat basic-rate top-up, which needs no marginal-rate
 * assumption. The pension option here is also not re-checked against the person's
 * remaining annual-allowance/earnings headroom: that check belongs to the waterfall's
 * own *recommended* pension step (step 5) — this module answers a hypothetical "what
 * if," not a certified-affordable recommendation.
 */

import type { OverpaymentAllowanceBasisValue } from '@/lib/db/schema';
import { parseScaledDecimal, roundDiv } from '@/lib/portfolio/valuation';
import { ageAsOf } from '@/lib/retirement/personAge';
import { ISA_ALLOWANCE_PENCE, isLisaEligible, LISA_SUBLIMIT_PENCE, type PersonWaterfallInput } from './waterfall';

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** The flat 25% government top-up on a relief-at-source pension contribution, or the
 * 25% LISA bonus — the same statutory ×5/4 grossing `taxStatus.ts`'s
 * `memberGrossContributionPence` already uses, so there's one canonical formula for
 * "25% top-up" in this codebase, not two that could drift apart. */
function flatQuarterTopUpPence(amountPence: bigint): bigint {
  return (amountPence * 5n) / 4n - amountPence;
}

export interface DebtComparatorDebtInput {
  accountId: number;
  name: string;
  /** NULL means jointly owned at household level. */
  personId: number | null;
  balancePence: bigint;
  interestRatePct: string | null;
  overpaymentAllowancePct: string | null;
  overpaymentAllowanceBalanceBasis: OverpaymentAllowanceBasisValue | null;
  ercRatePct: string | null;
  /** YYYY-MM-DD, or null if no ERC period applies. */
  ercPeriodEnd: string | null;
}

export interface DebtComparatorInput {
  todayIso: string;
  /** The same "extra to allocate" figure the household entered for the waterfall,
   * applied identically to every below-benchmark debt shown here — not an
   * independently-editable per-debt amount in this pass. */
  extraAmountPence: bigint;
  debtBenchmarkRatePct: string;
  householdOwnsProperty: boolean;
  /** ALL household debts — this module owns its own "below benchmark" filter, the
   * same way `waterfall.ts`'s own high-interest-debt step owns its ">benchmark" one. */
  debts: DebtComparatorDebtInput[];
  people: PersonWaterfallInput[];
}

export type InvestingOptionId = 'gia_isa' | 'lisa' | 'pension_ras';

export interface InvestingOptionResult {
  id: InvestingOptionId;
  label: string;
  /** The underlying market-return assumption — the same figure for every option,
   * since wrapper choice doesn't change what invested assets return. */
  returnRatePct: string;
  beatsDebtRate: boolean;
  /** A one-off £ top-up on the amount considered this year (LISA bonus / RAS relief).
   * Null for `gia_isa`, which has no such top-up. */
  oneOffBonusPence: bigint | null;
  /** Populated only for `id === 'lisa'` when the household already owns a home: an
   * early LISA withdrawal for anything but a first home purchase or age-60 access
   * costs a 25% government charge — a net loss on the original contribution, not just
   * a clawback of the bonus. Null otherwise. */
  lisaLockInWarning: string | null;
}

export interface DebtComparatorResult {
  accountId: number;
  name: string;
  personId: number | null;
  debtRatePct: string;
  amountConsideredPence: bigint;
  /** Null when no overpayment-allowance percentage is on file — an unknown, not zero. */
  penaltyFreeAllowancePence: bigint | null;
  /** True when the allowance's balance basis isn't `current_balance`: the schema has
   * no separate original-balance/annual-opening-balance snapshot, so the current
   * balance stands in — conservative by construction for an amortising debt (current
   * balance is never more than the original or a prior year's opening balance), so
   * this can only understate the true allowance, never overstate it. */
  penaltyFreeAllowanceApproximated: boolean;
  withinAllowancePence: bigint | null;
  aboveAllowancePence: bigint | null;
  /** Null when there's a nonzero amount above the allowance but no ERC rate on file. */
  ercCostPence: bigint | null;
  ercStillApplies: boolean;
  investingOptions: InvestingOptionResult[];
  warnings: string[];
}

export interface DebtComparatorUncomparableDebt {
  accountId: number;
  name: string;
  reason: string;
}

export interface DebtComparatorOutput {
  comparable: DebtComparatorResult[];
  uncomparable: DebtComparatorUncomparableDebt[];
  warnings: string[];
}

function computeAllowanceAndErc(
  debt: DebtComparatorDebtInput,
  amountConsideredPence: bigint,
  todayIso: string,
  warnings: string[],
): Pick<
  DebtComparatorResult,
  | 'penaltyFreeAllowancePence'
  | 'penaltyFreeAllowanceApproximated'
  | 'withinAllowancePence'
  | 'aboveAllowancePence'
  | 'ercCostPence'
  | 'ercStillApplies'
> {
  if (debt.overpaymentAllowancePct === null) {
    warnings.push(`${debt.name}: no penalty-free overpayment allowance on file, so how much of this would be free can't be shown.`);
    return {
      penaltyFreeAllowancePence: null,
      penaltyFreeAllowanceApproximated: false,
      withinAllowancePence: null,
      aboveAllowancePence: null,
      ercCostPence: null,
      ercStillApplies: false,
    };
  }

  const approximated = debt.overpaymentAllowanceBalanceBasis !== 'current_balance';
  if (approximated) {
    warnings.push(
      `${debt.name}: the penalty-free allowance is based on ${debt.overpaymentAllowanceBalanceBasis ?? 'an unrecorded basis'}, which isn't tracked separately from the current balance — using the current balance as a conservative estimate, so the true allowance may be higher.`,
    );
  }
  const allowancePence = roundDiv(debt.balancePence * parseScaledDecimal(debt.overpaymentAllowancePct, 3), 100_000n);
  const withinAllowancePence = minBigint(amountConsideredPence, allowancePence);
  const aboveAllowancePence = amountConsideredPence - withinAllowancePence;

  const ercStillApplies = !(debt.ercPeriodEnd !== null && debt.ercPeriodEnd < todayIso);

  let ercCostPence: bigint | null = 0n;
  if (aboveAllowancePence > 0n) {
    if (!ercStillApplies) {
      warnings.push(
        `${debt.name}: the early-repayment-charge period ended on ${debt.ercPeriodEnd}, so the amount above the nominal allowance is penalty-free now.`,
      );
      ercCostPence = 0n;
    } else if (debt.ercRatePct === null) {
      warnings.push(
        `${debt.name}: an amount above the penalty-free allowance is being considered but no early-repayment-charge rate is on file, so its true cost can't be shown.`,
      );
      ercCostPence = null;
    } else {
      ercCostPence = roundDiv(aboveAllowancePence * parseScaledDecimal(debt.ercRatePct, 3), 100_000n);
    }
  }

  return {
    penaltyFreeAllowancePence: allowancePence,
    penaltyFreeAllowanceApproximated: approximated,
    withinAllowancePence,
    aboveAllowancePence,
    ercCostPence,
    ercStillApplies,
  };
}

function buildInvestingOptions(
  debt: DebtComparatorDebtInput,
  amountConsideredPence: bigint,
  debtRate: number,
  debtBenchmarkRatePct: string,
  todayIso: string,
  householdOwnsProperty: boolean,
  peopleById: Map<number, PersonWaterfallInput>,
): InvestingOptionResult[] {
  const options: InvestingOptionResult[] = [];
  const beatsDebtRate = Number(debtBenchmarkRatePct) > debtRate;

  options.push({
    id: 'gia_isa',
    label: 'Invest in a GIA/ISA',
    returnRatePct: debtBenchmarkRatePct,
    beatsDebtRate,
    oneOffBonusPence: null,
    lisaLockInWarning: null,
  });

  const person = debt.personId !== null ? peopleById.get(debt.personId) : undefined;
  if (person) {
    const age = ageAsOf(person.dateOfBirth, todayIso);
    if (isLisaEligible(age, person.hasExistingLisa)) {
      const headroom = minBigint(
        LISA_SUBLIMIT_PENCE - person.lisaUsedPence,
        ISA_ALLOWANCE_PENCE - person.isaUsedPence,
      );
      if (headroom > 0n) {
        const lisaAmount = minBigint(amountConsideredPence, headroom);
        options.push({
          id: 'lisa',
          label: `${person.name}: LISA`,
          returnRatePct: debtBenchmarkRatePct,
          beatsDebtRate,
          oneOffBonusPence: flatQuarterTopUpPence(lisaAmount),
          lisaLockInWarning: householdOwnsProperty
            ? 'A 25% government charge applies to any early withdrawal that isn’t a first home purchase or from age 60 — that’s a net loss on the original contribution, not just a clawback of this bonus.'
            : null,
        });
      }
    }

    options.push({
      id: 'pension_ras',
      label: `${person.name}: pension (relief at source)`,
      returnRatePct: debtBenchmarkRatePct,
      beatsDebtRate,
      oneOffBonusPence: flatQuarterTopUpPence(amountConsideredPence),
      lisaLockInWarning: null,
    });
  }

  return options;
}

/**
 * Compares each below-benchmark debt's APR against investing alternatives, and costs
 * out `input.extraAmountPence` against the debt's penalty-free overpayment allowance
 * and ERC rate. Debts already flagged high-interest by `waterfall.ts` (rate beats the
 * benchmark) are silently excluded — that's the waterfall's own full-payoff territory,
 * not an error state here.
 */
export function compareDebtVsSave(input: DebtComparatorInput): DebtComparatorOutput {
  const benchmark = Number(input.debtBenchmarkRatePct);
  if (!Number.isFinite(benchmark)) {
    return {
      comparable: [],
      uncomparable: [],
      warnings: [
        `The debt interest-rate benchmark ("${input.debtBenchmarkRatePct}") isn't a valid rate, so no debt-vs-save comparison could be made.`,
      ],
    };
  }

  const peopleById = new Map(input.people.map((p) => [p.personId, p]));
  const comparable: DebtComparatorResult[] = [];
  const uncomparable: DebtComparatorUncomparableDebt[] = [];

  for (const debt of input.debts) {
    if (debt.balancePence <= 0n) {
      uncomparable.push({ accountId: debt.accountId, name: debt.name, reason: 'No balance entered.' });
      continue;
    }
    const debtRate = debt.interestRatePct !== null ? Number(debt.interestRatePct) : NaN;
    if (!Number.isFinite(debtRate)) {
      uncomparable.push({
        accountId: debt.accountId,
        name: debt.name,
        reason: 'No interest rate entered, so it can’t be compared against investing returns.',
      });
      continue;
    }
    if (debtRate > benchmark) continue; // waterfall.ts's high-interest-debt step already covers this one.

    const warnings: string[] = [];
    const allowanceAndErc = computeAllowanceAndErc(debt, input.extraAmountPence, input.todayIso, warnings);
    const investingOptions = buildInvestingOptions(
      debt,
      input.extraAmountPence,
      debtRate,
      input.debtBenchmarkRatePct,
      input.todayIso,
      input.householdOwnsProperty,
      peopleById,
    );

    comparable.push({
      accountId: debt.accountId,
      name: debt.name,
      personId: debt.personId,
      debtRatePct: debt.interestRatePct as string,
      amountConsideredPence: input.extraAmountPence,
      ...allowanceAndErc,
      investingOptions,
      warnings,
    });
  }

  return { comparable, uncomparable, warnings: [] };
}
