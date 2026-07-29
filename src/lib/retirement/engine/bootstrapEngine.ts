/**
 * Milestone 5 — the randomized bootstrap engine: Milestone 3's deterministic core, run
 * many times over per-year real returns sampled from Milestone 4's UK historical dataset,
 * matching "Monte Carlo simulation over thousands of randomized market-return sequences"
 * (PROPOSAL.md §2). All of the actual decumulation mechanics — State Pension, PCLS,
 * wrapper withdrawal order, tax — live in `deterministicCore.ts`'s `simulatePath`; this
 * file's only job is producing the per-year return sequences to feed it and aggregating
 * the resulting paths into a `SimulationResult`.
 *
 * **Historical block bootstrap, not i.i.d. annual resampling.** PROPOSAL.md §2 requires
 * deciding this explicitly, not silently. What a block bootstrap adds over drawing
 * individual years independently is **preserved serial correlation** in the sampled
 * sequence — mean reversion and volatility clustering, which real markets show and
 * independent-year sampling erases entirely. This is a different claim from
 * "sequence-of-returns risk" (early-vs-late bad years mattering differently for a
 * decumulating portfolio): that risk already exists under plain i.i.d. resampling too,
 * since path *order* still varies per simulation either way — it is not what
 * distinguishes the two options. `DEFAULT_BLOCK_LENGTH_YEARS = 10` is chosen as a round
 * number comfortably longer than a single business cycle but short enough that 150 years
 * of UK data (M4) still offers 141 distinct starting points to draw from — long enough to
 * carry real multi-year correlation, not so long that the sampler is effectively just
 * replaying whole historical eras verbatim.
 *
 * **Every iteration draws a fixed `MAX_SIMULATION_YEARS` worth of blocks, regardless of
 * the scenario's own (shorter) horizon** — `simulatePath` only ever reads the years it
 * needs and ignores the rest. This is deliberate, not wasted work: it makes the RNG draw
 * sequence for iteration *i* identical across two `runSimulation` calls that share a seed
 * and differ only in a scenario parameter that doesn't change how many blocks get drawn
 * (starting balance, spending). Two scenarios that *do* differ in horizon (`planEndAge`)
 * then still share the same per-iteration draws up to the shorter horizon's length,
 * because they aren't determining how many blocks get drawn — the draw count is always
 * the same fixed maximum. That shared-prefix property is what makes the monotonicity
 * property-tests in `bootstrapEngine.test.ts` exact, deterministic guarantees rather than
 * statistical tendencies that could occasionally fail: given identical draws, a smaller
 * starting balance or larger spending can only reach depletion sooner or equally soon,
 * never later, in every single iteration — so it can never move `successRate` upward.
 */

import { roundDiv } from '@/lib/portfolio/valuation';
import { createRng, randomIndex } from '@/lib/retirement/rng';
import { ukHistoricalRealReturns, type UkHistoricalReturnYear } from '@/lib/retirement/returns/ukHistoricalReturns';
import { RATE_SCALE, type ResolvedScenario, type SimulationOutcome, type SimulationResult } from '../engineTypes';
import { simulatePath, totalSimulationYears } from './deterministicCore';

const RATE_SCALE_DIVISOR = 10n ** BigInt(RATE_SCALE);

/** No real scenario needs more years than this: `scenarioAssumptions.ts`'s `requireAge`
 * bounds every age field (including, by construction, whatever a resolution layer sets
 * `ResolvedPerson.currentAge`/`planEndAge` from) to 0–130, so `planEndAge - currentAge`
 * can never exceed 130. Drawing exactly this many years of blocks every iteration,
 * regardless of the actual scenario's shorter horizon, is what gives this file's
 * monotonicity guarantees (see the file doc comment above) — not a performance
 * consideration, though it is cheap: bigint arithmetic over at most 130 discarded extra
 * years per iteration is immaterial next to `simulatePath`'s own per-year work. */
const MAX_SIMULATION_YEARS = 130;

const DEFAULT_BLOCK_LENGTH_YEARS = 10;

/** Matches ProjectionLab's own cited "best-in-class Monte Carlo (10,000 runs)"
 * (PROPOSAL.md §1's competitor research) — not an arbitrary round number. A hard
 * server-side cap, per the milestone plan, so a malformed or malicious request can't
 * force an unbounded simulation. */
export const MAX_ITERATIONS = 10_000;

/** `equityAllocationRate * equity + (1 − equityAllocationRate) * gilt`, both real returns
 * for the same historical year — the blend `ScenarioAssumptionsV1.equityAllocationPct`'s
 * own doc comment already promises ("percent of the modelled portfolio treated as growth
 * assets vs. cash/bonds for the return-sampling engine (Milestone 5)",
 * `scenarioAssumptions.ts`). Gilts stand in
 * for the "cash/bonds" side: M4's dataset has no separate cash-return series, and a gilt
 * total return is the closer real proxy of the two non-equity series it does have (bill
 * rate being closer to literal cash, but a defensive-allocation return within a Monte
 * Carlo engine is conventionally read as "bonds", matching how `equityAllocationPct`
 * itself is framed everywhere else in this codebase). */
function blendedRealReturn(year: UkHistoricalReturnYear, equityAllocationRate: bigint): bigint {
  const equityPart = roundDiv(year.equityRealReturn * equityAllocationRate, RATE_SCALE_DIVISOR);
  const giltPart = roundDiv(year.giltRealReturn * (RATE_SCALE_DIVISOR - equityAllocationRate), RATE_SCALE_DIVISOR);
  return equityPart + giltPart;
}

/**
 * One block-bootstrapped return sequence, always `>= totalDrawYears` long (a whole number
 * of `blockLengthYears`-sized blocks). Each block's starting year is drawn uniformly from
 * every position that leaves a full block on the table (`historicalYears.length -
 * blockLengthYears + 1` choices), so blocks may overlap across draws and across
 * iterations — standard overlapping block bootstrap, not a once-only partition of the
 * source data.
 *
 * Exported for direct unit testing of the block-contiguity property (that consecutive
 * sampled values really do come from consecutive historical years), independent of the
 * full `runSimulation` pipeline.
 */
export function sampleReturnSequence(
  equityAllocationRate: bigint,
  historicalYears: readonly UkHistoricalReturnYear[],
  rng: () => number,
  blockLengthYears: number,
  totalDrawYears: number,
): bigint[] {
  if (historicalYears.length < blockLengthYears) {
    throw new Error(
      `historicalYears (${historicalYears.length} years) is shorter than blockLengthYears (${blockLengthYears})`,
    );
  }

  const sequence: bigint[] = [];
  const startChoices = historicalYears.length - blockLengthYears + 1;
  while (sequence.length < totalDrawYears) {
    const startIndex = randomIndex(rng, startChoices);
    for (let offset = 0; offset < blockLengthYears; offset++) {
      sequence.push(blendedRealReturn(historicalYears[startIndex + offset]!, equityAllocationRate));
    }
  }
  return sequence;
}

const PERCENTILES: readonly { key: string; p: number }[] = [
  { key: 'p10', p: 0.1 },
  { key: 'p50', p: 0.5 },
  { key: 'p90', p: 0.9 },
];

/** Nearest-rank percentile from an already-ascending-sorted array. */
function percentileValue(sortedValues: readonly bigint[], p: number): bigint {
  const rank = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(p * sortedValues.length) - 1));
  return sortedValues[rank]!;
}

function computePercentileBands(
  outcomes: readonly SimulationOutcome[],
  totalYears: number,
): Record<string, bigint[]> {
  const bands: Record<string, bigint[]> = {};
  for (const { key } of PERCENTILES) bands[key] = [];

  for (let yearIndex = 0; yearIndex < totalYears; yearIndex++) {
    const valuesThisYear = outcomes
      .map((outcome) => outcome.path[yearIndex]!.totalBalancePence)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const { key, p } of PERCENTILES) {
      bands[key]!.push(percentileValue(valuesThisYear, p));
    }
  }

  return bands;
}

/**
 * Aggregate a batch of already-simulated paths into a `SimulationResult`. Pure and
 * order-independent by construction — `successRate` is a plain count/total and
 * `percentileBandsPence` sorts each year's values before selecting a rank, so shuffling
 * `outcomes` beforehand cannot change the result (asserted directly in
 * `bootstrapEngine.test.ts`'s iteration-order-invariance test). Exported separately from
 * `runSimulation` so that invariance property is testable without re-running the sampler.
 */
export function aggregateSimulationResult(
  outcomes: readonly SimulationOutcome[],
  scenarioId: number,
  seed: number,
): SimulationResult {
  const successCount = outcomes.filter((outcome) => outcome.success).length;
  const successRate = outcomes.length === 0 ? 0 : successCount / outcomes.length;
  const totalYears = outcomes.length === 0 ? 0 : outcomes[0]!.path.length;

  return {
    scenarioId,
    seed,
    iterationCount: outcomes.length,
    successRate,
    percentileBandsPence: computePercentileBands(outcomes, totalYears),
  };
}

export interface RunSimulationOptions {
  iterations: number;
  seed: number;
  /** Dependency-injection point, same pattern as `fetchGlobalQuote`'s `fetchImpl`
   * (`src/lib/portfolio/quotes.ts`) — defaults to the real UK dataset
   * (`ukHistoricalReturns.ts`). Tests inject a short synthetic series to force a
   * deterministic edge case (e.g. every year a loss) without depending on which real
   * historical blocks the RNG happens to draw. */
  historicalYears?: readonly UkHistoricalReturnYear[];
  blockLengthYears?: number;
}

/**
 * Run a full Monte Carlo batch: `iterations` independent block-bootstrapped paths through
 * `deterministicCore.ts`'s `simulatePath`, aggregated into one `SimulationResult`. A
 * single seeded RNG is threaded through every iteration in sequence, so the whole batch
 * is bit-identical for a fixed `(scenario, iterations, seed)` — required for the
 * property-based tests in `bootstrapEngine.test.ts` and, per PROPOSAL.md's Compute
 * execution model, for a re-run to be diagnosable rather than silently different.
 */
export function runSimulation(scenario: ResolvedScenario, options: RunSimulationOptions): SimulationResult {
  const { iterations, seed } = options;
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error(`iterations must be a positive integer, got ${iterations}`);
  }
  if (iterations > MAX_ITERATIONS) {
    throw new Error(`iterations (${iterations}) exceeds the hard server-side cap of ${MAX_ITERATIONS}`);
  }

  const historicalYears = options.historicalYears ?? ukHistoricalRealReturns();
  const blockLengthYears = options.blockLengthYears ?? DEFAULT_BLOCK_LENGTH_YEARS;
  const targetYears = totalSimulationYears(scenario);
  if (targetYears > MAX_SIMULATION_YEARS) {
    throw new Error(
      `scenario needs ${targetYears} simulated years, more than the ${MAX_SIMULATION_YEARS}-year cap this sampler draws`,
    );
  }

  const rng = createRng(seed);
  const outcomes: SimulationOutcome[] = [];
  for (let i = 0; i < iterations; i++) {
    const sequence = sampleReturnSequence(
      scenario.equityAllocationRate,
      historicalYears,
      rng,
      blockLengthYears,
      MAX_SIMULATION_YEARS,
    );
    outcomes.push(simulatePath(scenario, sequence));
  }

  return aggregateSimulationResult(outcomes, scenario.scenarioId, seed);
}
