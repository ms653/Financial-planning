import { describe, expect, it } from 'vitest';
import { computeTaperRescueRecommendations, type TaperRescueInput } from './taperRescue';
import type { ComparatorDebtInput } from './resolveWaterfallInput';
import type { PersonWaterfallInput } from './waterfall';

function person(overrides: Partial<PersonWaterfallInput> = {}): PersonWaterfallInput {
  return {
    personId: 1,
    name: 'Sam',
    dateOfBirth: '1985-04-12',
    grossIncomePence: 11_500_000n, // £115,000
    pensionContributions: [],
    hasFlexiblyAccessedPension: false,
    hasExistingLisa: false,
    isaUsedPence: 0n,
    lisaUsedPence: 0n,
    ...overrides,
  };
}

function debt(overrides: Partial<ComparatorDebtInput> = {}): ComparatorDebtInput {
  return {
    accountId: 1,
    name: 'Credit card',
    personId: 1,
    balancePence: 100_000n, // £1,000
    interestRatePct: '12.000',
    overpaymentAllowancePct: null,
    overpaymentAllowanceBalanceBasis: null,
    ercRatePct: null,
    ercPeriodEnd: null,
    minimumPaymentPence: 51_000n, // £510
    ...overrides,
  };
}

function baseInput(overrides: Partial<TaperRescueInput> = {}): TaperRescueInput {
  return {
    extraAmountPence: 100_000_000n, // £1,000,000 — deliberately huge, so it's never the binding cap unless a test overrides it.
    debtBenchmarkRatePct: '5.500',
    emergencyFundTargetPence: null,
    emergencyFundCurrentPence: 0n,
    people: [],
    debts: [],
    ...overrides,
  };
}

describe('computeTaperRescueRecommendations', () => {
  it('produces no entry for ANI at or below £100,000', () => {
    // Gross £100,000 exactly, no contributions -> ANI £100,000, not strictly above
    // the taper start.
    const result = computeTaperRescueRecommendations(
      baseInput({ people: [person({ grossIncomePence: 10_000_000n })] }),
    );
    expect(result.people).toHaveLength(0);
  });

  it('produces no entry for ANI above the £125,140 ceiling — a gate, not a capped entry', () => {
    const result = computeTaperRescueRecommendations(
      baseInput({ people: [person({ grossIncomePence: 14_000_000n })] }), // £140,000
    );
    expect(result.people).toHaveLength(0);
  });

  it('hand-computed regression: £115,000 ANI, no contributions, plenty of headroom and cash', () => {
    // excess = £115,000 - £100,000 = £15,000 = 1,500,000n pence. Gross RAS payment
    // needed to close it: net = ceilDiv(1,500,000 * 4, 5) = 1,200,000n (£12,000, exact).
    const result = computeTaperRescueRecommendations(baseInput({ people: [person()] }));
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({
      personId: 1,
      adjustedNetIncomePence: 11_500_000n,
      excessPence: 1_500_000n,
      recommendedGrossContributionPence: 1_500_000n,
      recommendedNetPaymentPence: 1_200_000n,
      fullyClearsTaper: true,
    });
  });

  it('hand-computed regression: capped by remaining annual-allowance headroom, not the full excess', () => {
    // £115,000 gross, an existing £55,000 EMPLOYER contribution (never touches ANI,
    // but does consume the £60,000 annual allowance): allowance headroom = £5,000,
    // well under the £15,000 excess. Capped gross = £5,000 (500,000n pence); net =
    // ceilDiv(500,000*4,5) = 400,000n (£4,000, exact).
    const result = computeTaperRescueRecommendations(
      baseInput({
        people: [
          person({
            pensionContributions: [
              { amountPence: 0n, method: 'salary_sacrifice', employerAmountPence: 5_500_000n },
            ],
          }),
        ],
      }),
    );
    expect(result.people[0]).toMatchObject({
      excessPence: 1_500_000n,
      recommendedGrossContributionPence: 500_000n,
      recommendedNetPaymentPence: 400_000n,
      fullyClearsTaper: false,
    });
  });

  it('hand-computed regression: capped by extraAmountPence, not headroom or excess', () => {
    // Only £1,000 (100,000n pence) available. Gross-equivalent = floor(100,000*5/4)
    // = 125,000n (£1,250). Net payment for that capped gross, ceiling-divided, comes
    // back to exactly the £1,000 available (round-trips exactly for this figure).
    const result = computeTaperRescueRecommendations(
      baseInput({ extraAmountPence: 100_000n, people: [person()] }),
    );
    expect(result.people[0]).toMatchObject({
      recommendedGrossContributionPence: 125_000n,
      recommendedNetPaymentPence: 100_000n,
      fullyClearsTaper: false,
    });
  });

  it('still returns an entry when the emergency fund is short, but flags it at the top level', () => {
    const result = computeTaperRescueRecommendations(
      baseInput({
        emergencyFundTargetPence: 10_000_00n,
        emergencyFundCurrentPence: 2_000_00n,
        people: [person()],
      }),
    );
    expect(result.emergencyFundOnTrack).toBe(false);
    expect(result.people).toHaveLength(1); // not hidden — the caller must caveat, not omit.
  });

  it('treats a household with no emergency-fund target as on track', () => {
    const result = computeTaperRescueRecommendations(baseInput({ people: [person()] }));
    expect(result.emergencyFundOnTrack).toBe(true);
  });

  it('compares against a high-interest debt owned by the same person', () => {
    // Reuses loanPayoff.test.ts's own hand-verified two-month vector: £1,000 at 12%,
    // £510/month -> 2 months, £15.00 total interest.
    const result = computeTaperRescueRecommendations(baseInput({ people: [person()], debts: [debt()] }));
    expect(result.people[0]!.debtComparisons).toEqual([
      { accountId: 1, name: 'Credit card', aprPct: '12.000', months: 2, totalInterestPence: 1_500n },
    ]);
  });

  it('includes a jointly-owned debt in the comparison — unlike LISA/pension, no single owner is needed to compare a cost', () => {
    const result = computeTaperRescueRecommendations(
      baseInput({ people: [person()], debts: [debt({ personId: null })] }),
    );
    expect(result.people[0]!.debtComparisons).toHaveLength(1);
  });

  it('excludes a debt owned by a different person', () => {
    const result = computeTaperRescueRecommendations(
      baseInput({ people: [person({ personId: 1 })], debts: [debt({ personId: 2 })] }),
    );
    expect(result.people[0]!.debtComparisons).toHaveLength(0);
  });

  it('excludes a debt whose rate does not beat the benchmark', () => {
    const result = computeTaperRescueRecommendations(
      baseInput({ people: [person()], debts: [debt({ interestRatePct: '4.000' })] }),
    );
    expect(result.people[0]!.debtComparisons).toHaveLength(0);
  });

  it('has no debt comparisons when the household has no debt at all', () => {
    const result = computeTaperRescueRecommendations(baseInput({ people: [person()] }));
    expect(result.people[0]!.debtComparisons).toEqual([]);
  });

  it('skips a person entirely when income has not been entered', () => {
    const result = computeTaperRescueRecommendations(
      baseInput({ people: [person({ grossIncomePence: null })] }),
    );
    expect(result.people).toHaveLength(0);
  });
});
