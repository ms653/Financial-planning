import { describe, expect, it } from 'vitest';
import { runDeterministicPath, simulatePath } from './deterministicCore';
import { RATE_SCALE, type ResolvedPerson, type ResolvedScenario } from '../engineTypes';

const RATE_SCALE_DIVISOR = 10n ** BigInt(RATE_SCALE);
/** A `RATE_SCALE`-scaled fraction from a plain percent, e.g. `pct(3)` -> 3% -> 30_000n. */
function pct(percent: number): bigint {
  return (BigInt(Math.round(percent * 1000)) * RATE_SCALE_DIVISOR) / 100_000n;
}

function person(overrides: Partial<ResolvedPerson> & { personId: number }): ResolvedPerson {
  return {
    currentAge: 65,
    retirementAge: 65,
    statePensionClaimAge: 100, // effectively "never claims" unless overridden
    statePensionAnnualPence: 0n,
    pclsAge: null,
    planEndAge: 95,
    ...overrides,
  };
}

function scenario(overrides: Partial<ResolvedScenario> = {}): ResolvedScenario {
  return {
    scenarioId: 1,
    annualSpendingPence: 0n,
    survivorAnnualSpendingPence: null,
    inflationRate: 0n,
    equityAllocationRate: 0n,
    targetSuccessRate: 0n,
    flatEffectiveTaxRate: 0n,
    wrapperWithdrawalOrder: ['gia'],
    people: [person({ personId: 1 })],
    startingBalancesPence: {},
    ...overrides,
  };
}

describe('runDeterministicPath — closed-form exactness', () => {
  it('matches hand-computed compounding exactly at a fixed 3% real return', () => {
    const s = scenario({
      annualSpendingPence: 2_000_000n, // £20,000/yr
      wrapperWithdrawalOrder: ['gia'],
      people: [person({ personId: 1, currentAge: 65, planEndAge: 68 })], // 3 years
      startingBalancesPence: { gia: 50_000_000n }, // £500,000
    });

    const outcome = runDeterministicPath(s, pct(3));

    // Hand-computed: balance_{t+1} = balance_t * 1.03 - 2,000,000, exact (no rounding —
    // every intermediate product divides evenly by RATE_SCALE_DIVISOR at these figures).
    expect(outcome.path).toHaveLength(3);
    expect(outcome.path[0]!.totalBalancePence).toBe(49_500_000n);
    expect(outcome.path[1]!.totalBalancePence).toBe(48_985_000n);
    expect(outcome.path[2]!.totalBalancePence).toBe(48_454_550n);
    expect(outcome.success).toBe(true);
  });

  it('produces an empty, vacuously-successful path when the horizon is zero years', () => {
    const s = scenario({ people: [person({ personId: 1, currentAge: 70, planEndAge: 70 })] });
    const outcome = runDeterministicPath(s, pct(3));
    expect(outcome.path).toHaveLength(0);
    expect(outcome.success).toBe(true);
  });
});

describe('runDeterministicPath — named edge cases from PROPOSAL.md Testing strategy', () => {
  it('zero spending: balance never decreases', () => {
    const s = scenario({
      annualSpendingPence: 0n,
      startingBalancesPence: { gia: 10_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 85 })],
    });

    for (const rate of [pct(0), pct(5)]) {
      const outcome = runDeterministicPath(s, rate);
      for (let i = 1; i < outcome.path.length; i++) {
        expect(outcome.path[i]!.totalBalancePence).toBeGreaterThanOrEqual(
          outcome.path[i - 1]!.totalBalancePence,
        );
      }
      expect(outcome.success).toBe(true);
    }
  });

  it('spending exactly equal to guaranteed income: balance flat in real terms', () => {
    const s = scenario({
      annualSpendingPence: 1_500_000n,
      startingBalancesPence: { gia: 20_000_000n },
      people: [
        person({
          personId: 1,
          currentAge: 68,
          planEndAge: 90,
          statePensionClaimAge: 67, // already claiming from year 0
          statePensionAnnualPence: 1_500_000n,
        }),
      ],
    });

    const outcome = runDeterministicPath(s, pct(0));
    for (const year of outcome.path) {
      expect(year.totalBalancePence).toBe(20_000_000n);
    }
    expect(outcome.success).toBe(true);
  });

  it('retirement age before State Pension age: a funding gap until the claim year, then flat', () => {
    const s = scenario({
      annualSpendingPence: 1_000_000n,
      startingBalancesPence: { cash: 100_000_000n },
      wrapperWithdrawalOrder: ['cash'],
      people: [
        person({
          personId: 1,
          currentAge: 60,
          planEndAge: 70,
          statePensionClaimAge: 67,
          statePensionAnnualPence: 1_000_000n,
        }),
      ],
    });

    const outcome = runDeterministicPath(s, pct(0));
    // Ages 60..66 (yearIndex 0..6): no State Pension yet, £1,000,000 drawn each year.
    expect(outcome.path[0]!.totalBalancePence).toBe(99_000_000n);
    expect(outcome.path[6]!.totalBalancePence).toBe(100_000_000n - 7n * 1_000_000n);
    // Age 67 onward (yearIndex 7+): State Pension exactly covers spending — flat.
    expect(outcome.path[7]!.totalBalancePence).toBe(outcome.path[6]!.totalBalancePence);
    expect(outcome.path[9]!.totalBalancePence).toBe(outcome.path[6]!.totalBalancePence);
  });

  it('retirement age after State Pension age: guaranteed income present from year 0', () => {
    const s = scenario({
      annualSpendingPence: 1_000_000n,
      startingBalancesPence: { cash: 50_000_000n },
      wrapperWithdrawalOrder: ['cash'],
      people: [
        person({
          personId: 1,
          currentAge: 70,
          planEndAge: 80,
          statePensionClaimAge: 67,
          statePensionAnnualPence: 1_000_000n,
        }),
      ],
    });

    const outcome = runDeterministicPath(s, pct(0));
    for (const year of outcome.path) {
      expect(year.totalBalancePence).toBe(50_000_000n);
    }
  });

  it('PCLS taken at the modelled age: a one-off 25% transfer from pension to cash', () => {
    const s = scenario({
      annualSpendingPence: 0n,
      startingBalancesPence: { sipp_pension: 40_000_000n },
      people: [person({ personId: 1, currentAge: 50, planEndAge: 60, pclsAge: 55 })],
    });

    const outcome = runDeterministicPath(s, pct(0));

    // Before age 55 (yearIndex < 5): untouched.
    expect(outcome.path[4]!.balancesByWrapperPence.sipp_pension).toBe(40_000_000n);
    expect(outcome.path[4]!.balancesByWrapperPence.cash ?? 0n).toBe(0n);

    // At age 55 (yearIndex 5): 25% moves to cash, tax-free.
    expect(outcome.path[5]!.balancesByWrapperPence.sipp_pension).toBe(30_000_000n);
    expect(outcome.path[5]!.balancesByWrapperPence.cash).toBe(10_000_000n);

    // After: stays moved, no second event.
    expect(outcome.path[9]!.balancesByWrapperPence.sipp_pension).toBe(30_000_000n);
    expect(outcome.path[9]!.balancesByWrapperPence.cash).toBe(10_000_000n);
  });

  it('PCLS deferred indefinitely (pclsAge: null): no transfer ever happens', () => {
    const s = scenario({
      annualSpendingPence: 0n,
      startingBalancesPence: { sipp_pension: 40_000_000n },
      people: [person({ personId: 1, currentAge: 50, planEndAge: 60, pclsAge: null })],
    });

    const outcome = runDeterministicPath(s, pct(0));
    for (const year of outcome.path) {
      expect(year.balancesByWrapperPence.sipp_pension).toBe(40_000_000n);
      expect(year.balancesByWrapperPence.cash ?? 0n).toBe(0n);
    }
  });

  it(
    'scope-decision regression lock: retirementAge has zero effect on the simulated path ' +
      "(NOT a substitute for PROPOSAL.md's 'contributions continuing past assumed " +
      "retirement' edge case — see deterministicCore.ts's doc comment: M3 deliberately " +
      'defers accumulation-phase modelling rather than building it, and this test only ' +
      "guards against that deferral being silently half-undone, e.g. someone wiring " +
      'retirementAge into a future change without also building real contribution flows)',
    () => {
      const base = scenario({
        annualSpendingPence: 1_000_000n,
        startingBalancesPence: { gia: 30_000_000n },
      });
      const retiresEarly = {
        ...base,
        people: [person({ personId: 1, currentAge: 65, planEndAge: 85, retirementAge: 60 })],
      };
      const retiresLate = {
        ...base,
        people: [person({ personId: 1, currentAge: 65, planEndAge: 85, retirementAge: 90 })],
      };

      expect(runDeterministicPath(retiresEarly, pct(3))).toEqual(runDeterministicPath(retiresLate, pct(3)));
    },
  );

  it('withdrawal order exhausting one wrapper entirely moves on to the next within the same year', () => {
    const s = scenario({
      annualSpendingPence: 5_000_000n,
      wrapperWithdrawalOrder: ['cash', 'gia'],
      startingBalancesPence: { cash: 2_000_000n, gia: 50_000_000n },
    });

    const outcome = runDeterministicPath(s, pct(0));
    expect(outcome.path[0]!.balancesByWrapperPence.cash).toBe(0n);
    expect(outcome.path[0]!.balancesByWrapperPence.gia).toBe(47_000_000n);
    expect(outcome.path[0]!.depleted).toBe(false);
  });

  it('zero balance and zero spending is not depletion — nothing was ever owed', () => {
    const s = scenario({ annualSpendingPence: 0n, startingBalancesPence: {} });
    const outcome = runDeterministicPath(s, pct(3));
    for (const year of outcome.path) {
      expect(year.totalBalancePence).toBe(0n);
      expect(year.depleted).toBe(false);
    }
    expect(outcome.success).toBe(true);
  });

  it('near-zero balance unable to meet spending is a genuine, sticky depletion', () => {
    const s = scenario({
      annualSpendingPence: 2_000_000n,
      startingBalancesPence: { gia: 1_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 70 })],
    });

    const outcome = runDeterministicPath(s, pct(0));
    expect(outcome.path[0]!.depleted).toBe(true);
    expect(outcome.path.every((year) => year.depleted)).toBe(true); // sticky
    expect(outcome.success).toBe(false);
  });

  it('a 100% loss year wipes the balance out, causing depletion the moment spending is due', () => {
    const s = scenario({
      annualSpendingPence: 1_000_000n,
      startingBalancesPence: { gia: 10_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 66 })],
    });

    const outcome = simulatePath(s, [-RATE_SCALE_DIVISOR]); // -100%
    expect(outcome.path[0]!.totalBalancePence).toBe(0n);
    expect(outcome.path[0]!.depleted).toBe(true);
    expect(outcome.success).toBe(false);
  });

  it('inflation exceeding returns for the whole horizon (a negative real return) eventually depletes', () => {
    const s = scenario({
      annualSpendingPence: 3_000_000n,
      startingBalancesPence: { gia: 20_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 95 })], // 30 years
    });

    const outcome = runDeterministicPath(s, -pct(5));
    expect(outcome.success).toBe(false);
    // Once depleted it never recovers.
    const firstDepletedIndex = outcome.path.findIndex((year) => year.depleted);
    expect(firstDepletedIndex).toBeGreaterThanOrEqual(0);
    expect(outcome.path.slice(firstDepletedIndex).every((year) => year.depleted)).toBe(true);
  });

  it('single-survivor spending: household spending drops once one person passes their planEndAge', () => {
    const s = scenario({
      annualSpendingPence: 4_000_000n,
      survivorAnnualSpendingPence: 2_500_000n,
      wrapperWithdrawalOrder: ['gia'],
      startingBalancesPence: { gia: 200_000_000n },
      people: [
        person({ personId: 1, currentAge: 70, planEndAge: 75 }), // alive through yearIndex 5
        person({ personId: 2, currentAge: 65, planEndAge: 85 }), // alive through yearIndex 20
      ],
    });

    const outcome = runDeterministicPath(s, pct(0));
    // Both alive: full spending drawn.
    expect(outcome.path[0]!.totalBalancePence).toBe(200_000_000n - 4_000_000n);
    expect(outcome.path[5]!.totalBalancePence).toBe(200_000_000n - 6n * 4_000_000n);
    // Person 1 gone from yearIndex 6 (age 76): survivor spending applies.
    expect(outcome.path[6]!.totalBalancePence).toBe(outcome.path[5]!.totalBalancePence - 2_500_000n);
    expect(outcome.path[19]!.totalBalancePence).toBe(outcome.path[18]!.totalBalancePence - 2_500_000n);
  });
});

describe('runDeterministicPath — tax treatment', () => {
  it('grosses up a taxable-wrapper withdrawal so the net delivered matches the shortfall', () => {
    const s = scenario({
      annualSpendingPence: 800_000n,
      flatEffectiveTaxRate: pct(20),
      wrapperWithdrawalOrder: ['gia'],
      startingBalancesPence: { gia: 50_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 66 })],
    });

    const outcome = runDeterministicPath(s, pct(0));
    // £8,000 net at 20% tax needs a gross withdrawal of £10,000 (800,000 / 0.8 = 1,000,000).
    expect(outcome.path[0]!.balancesByWrapperPence.gia).toBe(50_000_000n - 1_000_000n);
    expect(outcome.path[0]!.depleted).toBe(false);
  });

  it('does not tax ISA or cash withdrawals', () => {
    const s = scenario({
      annualSpendingPence: 800_000n,
      flatEffectiveTaxRate: pct(20),
      wrapperWithdrawalOrder: ['cash'],
      startingBalancesPence: { cash: 50_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 66 })],
    });

    const outcome = runDeterministicPath(s, pct(0));
    // Net need met 1:1, no gross-up.
    expect(outcome.path[0]!.balancesByWrapperPence.cash).toBe(50_000_000n - 800_000n);
  });

  it('a 100%-effective-tax wrapper can never net a positive amount, and is skipped rather than dividing by zero', () => {
    const s = scenario({
      annualSpendingPence: 1_000_000n,
      flatEffectiveTaxRate: RATE_SCALE_DIVISOR, // 100%
      wrapperWithdrawalOrder: ['gia'],
      startingBalancesPence: { gia: 50_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 66 })],
    });

    expect(() => runDeterministicPath(s, pct(0))).not.toThrow();
    const outcome = runDeterministicPath(s, pct(0));
    expect(outcome.path[0]!.balancesByWrapperPence.gia).toBe(50_000_000n); // untouched
    expect(outcome.path[0]!.depleted).toBe(true);
  });
});

describe('simulatePath', () => {
  it('throws if handed fewer return rates than the scenario needs years', () => {
    const s = scenario({ people: [person({ personId: 1, currentAge: 65, planEndAge: 70 })] });
    expect(() => simulatePath(s, [pct(3), pct(3)])).toThrow();
  });
});
