import { describe, expect, it } from 'vitest';
import { computeContributionWaterfall, type PersonWaterfallInput, type WaterfallInput } from './waterfall';

const TODAY = '2026-08-03';

function person(overrides: Partial<PersonWaterfallInput> = {}): PersonWaterfallInput {
  return {
    personId: 1,
    name: 'Alex',
    dateOfBirth: '1985-04-12', // 41 on TODAY
    grossIncomePence: 60_000_00n,
    pensionContributions: [],
    hasFlexiblyAccessedPension: false,
    hasExistingLisa: false,
    isaUsedPence: 0n,
    lisaUsedPence: 0n,
    ...overrides,
  };
}

function baseInput(overrides: Partial<WaterfallInput> = {}): WaterfallInput {
  return {
    todayIso: TODAY,
    extraAmountPence: 1_000_00n,
    emergencyFundTargetPence: null,
    emergencyFundCurrentPence: 0n,
    debts: [],
    debtBenchmarkRatePct: '5.500',
    people: [],
    ...overrides,
  };
}

describe('computeContributionWaterfall', () => {
  it('reports the current UK tax year window alongside the result', () => {
    const result = computeContributionWaterfall(baseInput({ todayIso: '2026-08-03' }));
    expect(result.taxYearWindow).toEqual({ startIso: '2026-04-06', endIso: '2027-04-05' });
  });

  it('recommends topping up a below-target emergency fund first', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 10_000_00n,
        emergencyFundTargetPence: 15_000_00n,
        emergencyFundCurrentPence: 8_000_00n,
      }),
    );
    expect(result.steps[0]).toMatchObject({ id: 'emergency_fund', amountPence: 7_000_00n });
  });

  it('skips straight past the emergency fund once it meets the target', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 5_000_00n,
        emergencyFundTargetPence: 15_000_00n,
        emergencyFundCurrentPence: 15_000_00n,
        people: [person()],
      }),
    );
    expect(result.steps.find((s) => s.id === 'emergency_fund')).toBeUndefined();
  });

  it('does not recommend anything for the emergency fund when no target is set', () => {
    const result = computeContributionWaterfall(baseInput({ emergencyFundTargetPence: null }));
    expect(result.steps.find((s) => s.id === 'emergency_fund')).toBeUndefined();
  });

  it('orders high-interest debt above the benchmark before lower-rate debt is ignored', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 1_000_00n,
        debtBenchmarkRatePct: '5.500',
        debts: [
          { accountId: 1, name: 'Credit card', personId: 1, balancePence: 2_000_00n, interestRatePct: '24.900' },
          { accountId: 2, name: 'Mortgage', personId: 1, balancePence: 300_000_00n, interestRatePct: '4.250' },
        ],
      }),
    );
    // Only the credit card (above benchmark) gets a step; the mortgage never appears.
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ id: 'high_interest_debt', amountPence: 1_000_00n });
  });

  it('orders multiple high-interest debts by descending rate', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 5_000_00n,
        debts: [
          { accountId: 1, name: 'Card A', personId: 1, balancePence: 1_000_00n, interestRatePct: '20.000' },
          { accountId: 2, name: 'Card B', personId: 1, balancePence: 1_000_00n, interestRatePct: '30.000' },
        ],
      }),
    );
    expect(result.steps.map((s) => s.label)).toEqual(['Pay down Card B', 'Pay down Card A']);
  });

  it('treats a debt with no interest rate entered as not high-interest', () => {
    const result = computeContributionWaterfall(
      baseInput({
        debts: [{ accountId: 1, name: 'Unknown-rate loan', personId: 1, balancePence: 1_000_00n, interestRatePct: null }],
      }),
    );
    expect(result.steps.find((s) => s.id === 'high_interest_debt')).toBeUndefined();
  });

  it('is not LISA-eligible for someone 40+ with no existing LISA', () => {
    const result = computeContributionWaterfall(
      baseInput({ people: [person({ dateOfBirth: '1980-01-01' })] }), // 46 on TODAY
    );
    expect(result.steps.find((s) => s.id === 'lisa')).toBeUndefined();
  });

  it('is LISA-eligible for someone who can still open one (18-39)', () => {
    const result = computeContributionWaterfall(
      baseInput({ extraAmountPence: 500_00n, people: [person({ dateOfBirth: '2000-01-01' })] }), // 26
    );
    expect(result.steps.find((s) => s.id === 'lisa')).toMatchObject({ amountPence: 500_00n });
  });

  it('stays LISA-eligible for someone 40-49 who already has one open', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 500_00n,
        people: [person({ dateOfBirth: '1980-01-01', hasExistingLisa: true })], // 46
      }),
    );
    expect(result.steps.find((s) => s.id === 'lisa')).toMatchObject({ amountPence: 500_00n });
  });

  it('is not LISA-eligible for someone 50 or over even with an existing LISA', () => {
    const result = computeContributionWaterfall(
      baseInput({ people: [person({ dateOfBirth: '1970-01-01', hasExistingLisa: true })] }), // 56
    );
    expect(result.steps.find((s) => s.id === 'lisa')).toBeUndefined();
  });

  it('caps LISA headroom at the £4,000 sub-limit even with ISA room to spare', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 10_000_00n,
        people: [person({ dateOfBirth: '2000-01-01' })],
      }),
    );
    const lisaStep = result.steps.find((s) => s.id === 'lisa');
    expect(lisaStep?.amountPence).toBe(4_000_00n);
    // The remainder (£6,000) should land in remaining_isa for the same person.
    const isaStep = result.steps.find((s) => s.id === 'remaining_isa');
    expect(isaStep?.amountPence).toBe(6_000_00n);
  });

  it('reduces remaining ISA headroom by what has already been used this tax year', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 10_000_00n,
        people: [person({ isaUsedPence: 18_000_00n })],
      }),
    );
    expect(result.steps.find((s) => s.id === 'remaining_isa')).toMatchObject({ amountPence: 2_000_00n });
  });

  it('caps further pension by the standard £60,000 annual allowance minus what is already contributed', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 100_000_00n,
        people: [
          person({
            grossIncomePence: 100_000_00n,
            pensionContributions: [
              { amountPence: 55_000_00n, method: 'salary_sacrifice', employerAmountPence: 0n },
            ],
          }),
        ],
      }),
    );
    // 60,000 allowance - 55,000 already contributed = 5,000 headroom.
    expect(result.steps.find((s) => s.id === 'further_pension')).toMatchObject({ amountPence: 5_000_00n });
  });

  it('restricts further pension to the £10,000 MPAA once flexibly accessed', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 100_000_00n,
        people: [person({ grossIncomePence: 100_000_00n, hasFlexiblyAccessedPension: true })],
      }),
    );
    expect(result.steps.find((s) => s.id === 'further_pension')).toMatchObject({ amountPence: 10_000_00n });
  });

  it('caps further pension by relevant UK earnings when income is below the allowance', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 100_000_00n,
        people: [person({ grossIncomePence: 20_000_00n })],
      }),
    );
    expect(result.steps.find((s) => s.id === 'further_pension')).toMatchObject({ amountPence: 20_000_00n });
  });

  it('flags a data-quality warning instead of guessing when income is not entered', () => {
    const result = computeContributionWaterfall(
      baseInput({ people: [person({ grossIncomePence: null })] }),
    );
    expect(result.steps.find((s) => s.id === 'further_pension')).toBeUndefined();
    expect(result.dataQualityWarnings.some((w) => w.includes('income not entered'))).toBe(true);
  });

  it('sends everything left over to GIA once every other step is exhausted', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 1_000_00n,
        people: [person({ isaUsedPence: 20_000_00n, grossIncomePence: null })], // ISA and LISA maxed, pension unknown
      }),
    );
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ id: 'gia', amountPence: 1_000_00n });
    expect(result.unallocatedPence).toBe(0n);
  });

  it('leaves the amount unallocated when there is no one to attribute a GIA catch-all to', () => {
    const result = computeContributionWaterfall(baseInput({ extraAmountPence: 1_000_00n, people: [] }));
    expect(result.steps).toHaveLength(0);
    expect(result.unallocatedPence).toBe(1_000_00n);
  });

  it('allocates per-person steps across the whole household in ascending personId order, regardless of input order', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 8_000_00n,
        people: [
          person({ personId: 2, name: 'Blair', dateOfBirth: '2000-01-01' }),
          person({ personId: 1, name: 'Alex', dateOfBirth: '2000-01-01' }),
        ],
      }),
    );
    const lisaSteps = result.steps.filter((s) => s.id === 'lisa');
    expect(lisaSteps.map((s) => s.personId)).toEqual([1, 2]);
  });

  it('leaves a true leftover with the first person in stable order when GIA is the catch-all', () => {
    const result = computeContributionWaterfall(
      baseInput({
        extraAmountPence: 1_000_00n,
        people: [
          person({ personId: 2, name: 'Blair', isaUsedPence: 20_000_00n, grossIncomePence: null }),
          person({ personId: 1, name: 'Alex', isaUsedPence: 20_000_00n, grossIncomePence: null }),
        ],
      }),
    );
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ id: 'gia', personId: 1, amountPence: 1_000_00n });
  });
});
