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
    annualContributionsPence: {},
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
    jointAnnualContributionsPence: {},
    oneOffEvents: [],
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
          retirementAge: 60, // already retired — isolates the State Pension gap being tested
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

  describe('Phase 4.4 — accumulation phase', () => {
    it('a still-working person’s annual contribution lands in sipp_pension, growing the balance while retired people would be drawing down', () => {
      const s = scenario({
        annualSpendingPence: 0n,
        people: [
          person({
            personId: 1,
            currentAge: 60,
            retirementAge: 63,
            planEndAge: 65,
            annualContributionsPence: { sipp_pension: 100_000n }, // £1,000/yr
          }),
        ],
      });

      const outcome = runDeterministicPath(s, pct(0));

      // Ages 60, 61, 62: still working (age < 63) — contribution lands each year.
      expect(outcome.path[0]!.totalBalancePence).toBe(100_000n);
      expect(outcome.path[1]!.totalBalancePence).toBe(200_000n);
      expect(outcome.path[2]!.totalBalancePence).toBe(300_000n);
      // Ages 63, 64: retired — no further contribution, and no spending to draw down
      // (annualSpendingPence: 0n isolates the contribution mechanic from withdrawal).
      expect(outcome.path[3]!.totalBalancePence).toBe(300_000n);
      expect(outcome.path[4]!.totalBalancePence).toBe(300_000n);
    });

    it('contributions stop and withdrawal starts exactly at age === retirementAge, not the year before or after', () => {
      const s = scenario({
        annualSpendingPence: 500_000n, // £5,000/yr
        wrapperWithdrawalOrder: ['gia'],
        startingBalancesPence: { gia: 1_000_000n }, // £10,000
        people: [
          person({
            personId: 1,
            currentAge: 63,
            retirementAge: 64,
            planEndAge: 66, // planEndAge - currentAge = 3 simulated years (ages 63, 64, 65)
            annualContributionsPence: { sipp_pension: 200_000n }, // £2,000/yr
          }),
        ],
      });

      const outcome = runDeterministicPath(s, pct(0));

      // Age 63 (< retirementAge): contribution lands, no withdrawal despite non-zero
      // annualSpendingPence — the gate, not just "no spending configured".
      expect(outcome.path[0]!.totalBalancePence).toBe(1_200_000n); // £10,000 gia + £2,000 sipp
      // Age 64 (=== retirementAge): retired from this year — no contribution, and
      // withdrawal starts the same year, not a year late.
      expect(outcome.path[1]!.totalBalancePence).toBe(700_000n); // £5,000 gia + £2,000 sipp
      // Age 65: withdrawal continues, contributions stay stopped.
      expect(outcome.path[2]!.totalBalancePence).toBe(200_000n); // £0 gia + £2,000 sipp
    });

    it('no partial-household drawdown: a two-person household draws down nothing until every alive person has retired', () => {
      const s = scenario({
        annualSpendingPence: 500_000n, // £5,000/yr
        wrapperWithdrawalOrder: ['gia'],
        startingBalancesPence: { gia: 2_000_000n }, // £20,000
        people: [
          person({ personId: 1, currentAge: 65, retirementAge: 65, planEndAge: 68 }), // already retired
          person({ personId: 2, currentAge: 63, retirementAge: 65, planEndAge: 68 }), // retires in 2 years
        ],
      });

      const outcome = runDeterministicPath(s, pct(0));

      // Years 0–1: person 2 (age 63, 64) hasn't reached retirementAge 65 yet — no
      // withdrawal at all, even though person 1 has long since retired.
      expect(outcome.path[0]!.totalBalancePence).toBe(2_000_000n);
      expect(outcome.path[1]!.totalBalancePence).toBe(2_000_000n);
      // Year 2: person 2 turns 65 — both now retired, withdrawal starts.
      expect(outcome.path[2]!.totalBalancePence).toBe(1_500_000n);
      expect(outcome.path[3]!.totalBalancePence).toBe(1_000_000n);
    });

    it('a person contributing to more than one wrapper at once (not just sipp_pension) lands each in its own wrapper', () => {
      const s = scenario({
        annualSpendingPence: 0n,
        people: [
          person({
            personId: 1,
            currentAge: 60,
            retirementAge: 62,
            planEndAge: 63,
            annualContributionsPence: { gia: 50_000n, cash_isa: 30_000n },
          }),
        ],
      });

      const outcome = runDeterministicPath(s, pct(0));

      expect(outcome.path[0]!.balancesByWrapperPence.gia).toBe(50_000n);
      expect(outcome.path[0]!.balancesByWrapperPence.cash_isa).toBe(30_000n);
      expect(outcome.path[1]!.balancesByWrapperPence.gia).toBe(100_000n);
      expect(outcome.path[1]!.balancesByWrapperPence.cash_isa).toBe(60_000n);
      // Age 62 === retirementAge: retired, no further contribution to either wrapper.
      expect(outcome.path[2]!.balancesByWrapperPence.gia).toBe(100_000n);
      expect(outcome.path[2]!.balancesByWrapperPence.cash_isa).toBe(60_000n);
    });

    it('a joint account’s regular contribution lands while the household hasn’t fully retired, and stops the same year it has', () => {
      const s = scenario({
        annualSpendingPence: 0n, // isolates contribution from the withdrawal mechanic
        jointAnnualContributionsPence: { gia: 40_000n },
        people: [
          person({ personId: 1, currentAge: 65, retirementAge: 65, planEndAge: 68 }), // already retired
          person({ personId: 2, currentAge: 63, retirementAge: 65, planEndAge: 68 }), // retires in 2 years
        ],
      });

      const outcome = runDeterministicPath(s, pct(0));

      // Years 0–1: person 2 hasn't retired yet — household isn't fully retired, so the
      // joint contribution keeps landing regardless of person 1's own retirementAge.
      expect(outcome.path[0]!.totalBalancePence).toBe(40_000n);
      expect(outcome.path[1]!.totalBalancePence).toBe(80_000n);
      // Year 2 onward: person 2 has now retired too — household is fully retired, so
      // the joint contribution stops, same year withdrawal would start.
      expect(outcome.path[2]!.totalBalancePence).toBe(80_000n);
      expect(outcome.path[3]!.totalBalancePence).toBe(80_000n);
    });
  });

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

describe('runDeterministicPath — Phase 4.6, one-off events', () => {
  it('an expense fires during accumulation, not gated by householdFullyRetired', () => {
    // Regression test for the highest-risk detail in this feature: spendingPence is
    // unconditionally zero pre-retirement, but a one-off expense (a house purchase is
    // one of this feature's own two named examples) must still be payable before
    // retirement. Person retires at 70, event fires at 65 — ordinary drawdown is
    // correctly zero that year, but the balance must still drop by exactly the event
    // amount.
    const s = scenario({
      annualSpendingPence: 500_000n, // would be drawn if retired — isolates the gate
      wrapperWithdrawalOrder: ['gia'],
      startingBalancesPence: { gia: 10_000_000n },
      people: [person({ personId: 1, currentAge: 65, retirementAge: 70, planEndAge: 71 })],
      oneOffEvents: [{ personId: 1, age: 65, amountPence: -300_000n }], // £3,000 expense
    });

    const outcome = runDeterministicPath(s, pct(0));
    // Age 65: still working (65 < 70), so ordinary spending is correctly zero — the
    // balance drop must be exactly the event amount, nothing more.
    expect(outcome.path[0]!.totalBalancePence).toBe(10_000_000n - 300_000n);
  });

  it('an injection lands directly in cash, independent of wrapperWithdrawalOrder', () => {
    const s = scenario({
      annualSpendingPence: 0n,
      wrapperWithdrawalOrder: ['gia', 'cash'], // cash deliberately not first
      startingBalancesPence: {},
      people: [person({ personId: 1, currentAge: 65, planEndAge: 66 })],
      oneOffEvents: [{ personId: 1, age: 65, amountPence: 500_000n }], // £5,000 windfall
    });

    const outcome = runDeterministicPath(s, pct(0));
    expect(outcome.path[0]!.balancesByWrapperPence.cash).toBe(500_000n);
    expect(outcome.path[0]!.balancesByWrapperPence.gia ?? 0n).toBe(0n);
  });

  it('an expense is grossed up through the same tax formula as ordinary shortfall — no second tax path', () => {
    const s = scenario({
      annualSpendingPence: 0n,
      flatEffectiveTaxRate: pct(20),
      wrapperWithdrawalOrder: ['gia'],
      startingBalancesPence: { gia: 50_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 66 })],
      oneOffEvents: [{ personId: 1, age: 65, amountPence: -800_000n }], // £8,000 net expense
    });

    const outcome = runDeterministicPath(s, pct(0));
    // £8,000 net at 20% tax needs a gross withdrawal of £10,000 — the exact same
    // formula the ordinary-shortfall tax test above uses.
    expect(outcome.path[0]!.balancesByWrapperPence.gia).toBe(50_000_000n - 1_000_000n);
  });

  it('same-year PCLS lands in cash before an expense event drains it, so the expense is met tax-free', () => {
    const s = scenario({
      annualSpendingPence: 0n,
      flatEffectiveTaxRate: pct(20), // would matter if the expense fell through to gia
      wrapperWithdrawalOrder: ['cash', 'gia'],
      startingBalancesPence: { sipp_pension: 40_000_000n, gia: 50_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 66, pclsAge: 65 })],
      oneOffEvents: [{ personId: 1, age: 65, amountPence: -5_000_000n }], // £50,000 expense
    });

    const outcome = runDeterministicPath(s, pct(0));
    // PCLS: 25% of £400,000 pension = £100,000 moves to cash before the expense event
    // runs. The £50,000 expense is met entirely from that tax-free cash, not gia.
    expect(outcome.path[0]!.balancesByWrapperPence.cash).toBe(10_000_000n - 5_000_000n);
    expect(outcome.path[0]!.balancesByWrapperPence.gia).toBe(50_000_000n); // untouched
    expect(outcome.path[0]!.balancesByWrapperPence.sipp_pension).toBe(30_000_000n);
  });
});

describe('simulatePath', () => {
  it('throws if handed fewer return rates than the scenario needs years', () => {
    const s = scenario({ people: [person({ personId: 1, currentAge: 65, planEndAge: 70 })] });
    expect(() => simulatePath(s, [pct(3), pct(3)])).toThrow();
  });
});
