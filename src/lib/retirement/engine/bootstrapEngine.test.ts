import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runDeterministicPath, simulatePath } from './deterministicCore';
import {
  aggregateSimulationResult,
  runSimulation,
  sampleReturnSequence,
  MAX_ITERATIONS,
} from './bootstrapEngine';
import { RATE_SCALE, type ResolvedPerson, type ResolvedScenario } from '../engineTypes';
import type { UkHistoricalReturnYear } from '@/lib/retirement/returns/ukHistoricalReturns';

const RATE_SCALE_DIVISOR = 10n ** BigInt(RATE_SCALE);
function pct(percent: number): bigint {
  return (BigInt(Math.round(percent * 1000)) * RATE_SCALE_DIVISOR) / 100_000n;
}

function person(overrides: Partial<ResolvedPerson> & { personId: number }): ResolvedPerson {
  return {
    currentAge: 65,
    retirementAge: 65,
    statePensionClaimAge: 100,
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
    equityAllocationRate: pct(100), // pure equity by default, unless overridden
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

/** A synthetic historical year with strictly increasing, distinguishable equity returns
 * (`index * 1000n`) and zero gilt returns, so a 100%-equity blend reproduces the equity
 * column exactly and consecutive years are trivially distinguishable by value. */
function syntheticYears(count: number): UkHistoricalReturnYear[] {
  return Array.from({ length: count }, (_, index) => ({
    year: 1900 + index,
    equityRealReturn: BigInt(index) * 1000n,
    giltRealReturn: 0n,
    billRealReturn: 0n,
    inflationRate: 0n,
  }));
}

describe('sampleReturnSequence — block contiguity', () => {
  it('draws whole contiguous blocks from the source data, not independent single years', () => {
    const years = syntheticYears(20);
    const rng = () => 0.37; // any fixed draw; contiguity holds regardless of which block is chosen
    const sequence = sampleReturnSequence(pct(100), years, rng, 5, 15);

    expect(sequence.length).toBeGreaterThanOrEqual(15);
    // Within each 5-year block, consecutive sampled values must differ by exactly 1000n
    // (the synthetic data's own step size) — true only if they came from consecutive
    // source years, not scattered independent draws.
    for (let blockStart = 0; blockStart + 5 <= sequence.length; blockStart += 5) {
      for (let i = 1; i < 5; i++) {
        expect(sequence[blockStart + i]! - sequence[blockStart + i - 1]!).toBe(1000n);
      }
    }
  });

  it('throws if the historical dataset is shorter than one block', () => {
    expect(() => sampleReturnSequence(pct(100), syntheticYears(3), () => 0, 5, 10)).toThrow();
  });
});

describe('the geometric-vs-arithmetic-mean bug class (PROPOSAL.md §2\'s own named warning)', () => {
  it('genuinely-sampled compounding differs measurably from flat compounding at the arithmetic mean', () => {
    // A classic volatility-drag example: +20%, -20%, +20%, -20% has an arithmetic mean of
    // exactly 0%, but multiplicative compounding through it is a real ~7.84% loss
    // (1.2 x 0.8 x 1.2 x 0.8 = 0.9216) — the exact bug class PROPOSAL.md §2 warns a Monte
    // Carlo engine must not silently produce by averaging returns before compounding.
    const rates = [pct(20), -pct(20), pct(20), -pct(20)];
    const s = scenario({
      startingBalancesPence: { gia: 100_000_000n },
      people: [person({ personId: 1, currentAge: 60, planEndAge: 64 })], // 4 years
    });

    const sampled = simulatePath(s, rates);
    const arithmeticMean = 0n; // sum of the four rates above is exactly 0
    const flat = runDeterministicPath(s, arithmeticMean);

    expect(sampled.path[3]!.totalBalancePence).toBe(92_160_000n);
    expect(flat.path[3]!.totalBalancePence).toBe(100_000_000n);
    expect(sampled.path[3]!.totalBalancePence).toBeLessThan(flat.path[3]!.totalBalancePence);
  });
});

describe('aggregateSimulationResult', () => {
  it('is invariant to the order of the outcomes array', () => {
    const s = scenario({
      annualSpendingPence: 3_000_000n,
      startingBalancesPence: { gia: 20_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 75 })],
    });
    // A mix of returns producing a mix of success/failure, so the aggregate is
    // non-trivial (not just "always 100%" or "always 0%").
    const outcomes = [
      simulatePath(s, Array(10).fill(pct(10))),
      simulatePath(s, Array(10).fill(pct(0))),
      simulatePath(s, Array(10).fill(-pct(10))),
      simulatePath(s, Array(10).fill(-pct(30))),
    ];

    const forward = aggregateSimulationResult(outcomes, 1, 42);
    const shuffled = aggregateSimulationResult([outcomes[3]!, outcomes[1]!, outcomes[0]!, outcomes[2]!], 1, 42);

    expect(shuffled).toEqual(forward);
  });
});

describe('runSimulation', () => {
  const baseScenario = scenario({
    annualSpendingPence: 2_000_000n,
    startingBalancesPence: { gia: 50_000_000n },
    wrapperWithdrawalOrder: ['gia'],
    people: [person({ personId: 1, currentAge: 65, planEndAge: 85 })],
  });

  it('produces a successRate within [0, 1] and the requested iteration count', () => {
    const result = runSimulation(baseScenario, { iterations: 200, seed: 42 });
    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
    expect(result.iterationCount).toBe(200);
    expect(result.scenarioId).toBe(baseScenario.scenarioId);
  });

  it('is bit-identical for a fixed seed', () => {
    const a = runSimulation(baseScenario, { iterations: 300, seed: 7 });
    const b = runSimulation(baseScenario, { iterations: 300, seed: 7 });
    expect(a).toEqual(b);
  });

  it('rejects a non-positive or non-integer iteration count', () => {
    expect(() => runSimulation(baseScenario, { iterations: 0, seed: 1 })).toThrow();
    expect(() => runSimulation(baseScenario, { iterations: -5, seed: 1 })).toThrow();
    expect(() => runSimulation(baseScenario, { iterations: 1.5, seed: 1 })).toThrow();
  });

  it('enforces the hard server-side iteration cap', () => {
    expect(() => runSimulation(baseScenario, { iterations: MAX_ITERATIONS + 1, seed: 1 })).toThrow();
    expect(() => runSimulation(baseScenario, { iterations: MAX_ITERATIONS, seed: 1 })).not.toThrow();
  });

  it('near-zero starting balance with real spending demand: mostly or entirely fails (injected all-loss years)', () => {
    // Every synthetic year a real loss, so depletion is forced regardless of which
    // blocks the RNG happens to draw — a deterministic edge case via the DI point,
    // matching the "injectable return-source override" pattern the plan calls for.
    const allLossYears = syntheticYears(20).map((y) => ({ ...y, equityRealReturn: -pct(50), giltRealReturn: -pct(50) }));
    const s = scenario({
      annualSpendingPence: 1_000_000n,
      startingBalancesPence: { gia: 2_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 70 })],
    });
    const result = runSimulation(s, { iterations: 50, seed: 1, historicalYears: allLossYears, blockLengthYears: 5 });
    expect(result.successRate).toBe(0);
  });

  it('a 100% loss year wipes the balance out regardless of which block the RNG draws', () => {
    // Every synthetic year a total wipeout — the bootstrap-layer counterpart to
    // deterministicCore.test.ts's own "100% loss year" test, named explicitly in the
    // Milestone 5 plan's own edge-case list, not just inherited implicitly from M3.
    const totalWipeoutYears = syntheticYears(20).map((y) => ({
      ...y,
      equityRealReturn: -pct(100),
      giltRealReturn: -pct(100),
    }));
    const s = scenario({
      annualSpendingPence: 1_000_000n,
      startingBalancesPence: { gia: 50_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 66 })], // 1 year
    });
    const result = runSimulation(s, { iterations: 50, seed: 2, historicalYears: totalWipeoutYears, blockLengthYears: 5 });
    expect(result.successRate).toBe(0);
    expect(result.percentileBandsPence.p50![0]).toBe(0n);
  });

  it('inflation exceeding returns for the whole horizon (persistently negative real returns) eventually depletes even a well-funded plan', () => {
    // Named explicitly in the Milestone 5 plan's edge-case list. This engine only ever
    // sees real (already inflation-adjusted) returns — see ukHistoricalReturns.ts — so
    // "inflation exceeding returns" is modelled here as a historical series whose real
    // return is negative in every year, injected via the same DI point.
    const persistentRealLossYears = syntheticYears(20).map((y) => ({
      ...y,
      equityRealReturn: -pct(3),
      giltRealReturn: -pct(2),
    }));
    const s = scenario({
      annualSpendingPence: 2_000_000n,
      startingBalancesPence: { gia: 60_000_000n }, // comfortably funded under a normal return assumption
      people: [person({ personId: 1, currentAge: 65, planEndAge: 95 })], // 30 years
    });
    const result = runSimulation(s, { iterations: 50, seed: 3, historicalYears: persistentRealLossYears, blockLengthYears: 5 });
    expect(result.successRate).toBe(0);
  });

  it('zero spending and ample balance: always succeeds regardless of sampled returns', () => {
    const s = scenario({
      annualSpendingPence: 0n,
      startingBalancesPence: { gia: 100_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 85 })],
    });
    const result = runSimulation(s, { iterations: 200, seed: 99 });
    expect(result.successRate).toBe(1);
  });

  it('single-survivor spending plumbs through a two-person scenario without error', () => {
    const s = scenario({
      annualSpendingPence: 3_000_000n,
      survivorAnnualSpendingPence: 2_000_000n,
      startingBalancesPence: { gia: 80_000_000n },
      people: [
        person({ personId: 1, currentAge: 70, planEndAge: 78 }),
        person({ personId: 2, currentAge: 65, planEndAge: 90 }),
      ],
    });
    const result = runSimulation(s, { iterations: 100, seed: 5 });
    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
    expect(result.percentileBandsPence.p50).toHaveLength(25); // 90 - 65
  });

  it('percentile bands are ordered p10 <= p50 <= p90 in every year', () => {
    const result = runSimulation(baseScenario, { iterations: 300, seed: 11 });
    const { p10, p50, p90 } = result.percentileBandsPence;
    for (let i = 0; i < p10!.length; i++) {
      expect(p10![i]!).toBeLessThanOrEqual(p50![i]!);
      expect(p50![i]!).toBeLessThanOrEqual(p90![i]!);
    }
  });
});

describe('runSimulation — convergence check', () => {
  it('successRate variance across repeated runs at N=2000 stays within a documented tolerance', () => {
    // Empirically measured, not guessed (matching this codebase's "verify, don't assume"
    // discipline — see e.g. Milestone 2's decision to hand-verify RNG output rather than
    // trust self-consistency alone). A scenario tuned by hand to land near 50% success —
    // the highest-variance regime, since a scenario that (almost) always succeeds or
    // always fails has near-zero variance regardless of iteration count and would make
    // this test meaningless.
    //
    // Measured across 15 independent seeds at each N (single-threaded, this machine):
    //   N=200:   range 0.085  (successRate spread across seeds)
    //   N=500:   range 0.058
    //   N=1000:  range 0.026
    //   N=2000:  range 0.0225, ~45ms per `runSimulation` call
    //   N=5000:  range 0.0198, ~114ms per call
    //   N=10000: range 0.0151, ~245ms per call (MAX_ITERATIONS)
    //
    // N=2000 is the recommended production default: variance is already within about
    // ±1.1 percentage points of the true rate, runtime is comfortably sub-100ms even
    // single-threaded, and going to 5000 or 10000 buys diminishing variance reduction at
    // meaningfully higher cost. This is the concrete number Milestone 6/7's worker
    // timeout and Milestone 9's poll interval should cite, per the plan.
    const s = scenario({
      annualSpendingPence: 2_450_000n,
      flatEffectiveTaxRate: pct(20),
      equityAllocationRate: pct(70),
      startingBalancesPence: { gia: 50_000_000n },
      people: [person({ personId: 1, currentAge: 65, planEndAge: 95 })], // 30 years
    });

    const rates: number[] = [];
    for (let seed = 0; seed < 10; seed++) {
      rates.push(runSimulation(s, { iterations: 2000, seed }).successRate);
    }
    const range = Math.max(...rates) - Math.min(...rates);
    // A generous margin over the ~0.0225 actually observed (across a larger, 15-seed
    // sample) — wide enough not to flake on run-to-run sampling noise in a 10-seed
    // subset, tight enough to still be a meaningful convergence claim.
    expect(range).toBeLessThan(0.05);
  });
});

describe('runSimulation — monotonicity (property-based, fast-check)', () => {
  // Every iteration draws a fixed MAX_SIMULATION_YEARS worth of blocks regardless of the
  // scenario's own horizon (see bootstrapEngine.ts's file doc comment) — so for a shared
  // seed, two scenarios differing only in starting balance, spending, or horizon consume
  // byte-identical RNG draws. That makes these properties exact per-iteration guarantees,
  // not statistical tendencies — safe to assert with a plain >=/<=, no flakiness risk.

  it('success rate is non-decreasing in starting balance', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 200_000_000n }), fc.bigInt({ min: 0n, max: 200_000_000n }), (a, b) => {
        const [lower, higher] = a <= b ? [a, b] : [b, a];
        const base = scenario({
          annualSpendingPence: 2_000_000n,
          people: [person({ personId: 1, currentAge: 65, planEndAge: 85 })],
        });
        const lowResult = runSimulation({ ...base, startingBalancesPence: { gia: lower } }, { iterations: 30, seed: 123 });
        const highResult = runSimulation({ ...base, startingBalancesPence: { gia: higher } }, { iterations: 30, seed: 123 });
        expect(highResult.successRate).toBeGreaterThanOrEqual(lowResult.successRate);
      }),
      { numRuns: 20 },
    );
  });

  it('success rate is non-increasing in spending', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 5_000_000n }), fc.bigInt({ min: 0n, max: 5_000_000n }), (a, b) => {
        const [lower, higher] = a <= b ? [a, b] : [b, a];
        const base = scenario({
          startingBalancesPence: { gia: 50_000_000n },
          people: [person({ personId: 1, currentAge: 65, planEndAge: 85 })],
        });
        const lowSpendResult = runSimulation({ ...base, annualSpendingPence: lower }, { iterations: 30, seed: 456 });
        const highSpendResult = runSimulation({ ...base, annualSpendingPence: higher }, { iterations: 30, seed: 456 });
        expect(highSpendResult.successRate).toBeLessThanOrEqual(lowSpendResult.successRate);
      }),
      { numRuns: 20 },
    );
  });

  it('success rate is non-increasing in retirement horizon length', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 20 }), (shortYears, extraYears) => {
        const currentAge = 65;
        const base = scenario({
          annualSpendingPence: 2_000_000n,
          startingBalancesPence: { gia: 30_000_000n },
        });
        const shortResult = runSimulation(
          { ...base, people: [person({ personId: 1, currentAge, planEndAge: currentAge + shortYears })] },
          { iterations: 30, seed: 789 },
        );
        const longResult = runSimulation(
          { ...base, people: [person({ personId: 1, currentAge, planEndAge: currentAge + shortYears + extraYears })] },
          { iterations: 30, seed: 789 },
        );
        expect(longResult.successRate).toBeLessThanOrEqual(shortResult.successRate);
      }),
      { numRuns: 20 },
    );
  });
});
