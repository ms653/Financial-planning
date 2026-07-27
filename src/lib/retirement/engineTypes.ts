/**
 * Shared types for the deterministic (Milestone 3) and randomized bootstrap
 * (Milestone 5) simulation engines, defined once so the two can't drift onto
 * incompatible shapes — M5 is meant to be built as "M3's core plus sampled returns"
 * and cross-checked against it, which only works if they share these types.
 *
 * Money throughout is `bigint` pence, never a JS `number`, matching `src/lib/money.ts`'s
 * discipline. Rate-shaped values (inflation, returns, tax, allocation) are fixed-point
 * scaled bigints via `RATE_SCALE` below, reusing `src/lib/portfolio/valuation.ts`'s
 * `parseScaledDecimal`/`roundDiv` pattern rather than inventing a second one — the same
 * reasoning already applied to fractional-share quantities: a plain `number` compounded
 * over a multi-decade simulation is exactly the kind of silent error
 * `docs/PROPOSAL.md`'s reference-calculator tolerance test (Milestone 10) won't catch on
 * its own.
 */

import { parseScaledDecimal, roundDiv } from '@/lib/portfolio/valuation';
import type { AccountTypeValue } from '@/lib/db/schema';

/** Scale for rate-shaped values — a *fraction*, not a percent: "2.5%" is represented as
 * the fraction 0.025, scaled by `10^RATE_SCALE`. Six digits of fractional precision is
 * comfortably beyond what a UK-calibrated return/inflation/tax assumption needs. */
export const RATE_SCALE = 6;

/**
 * Convert a percent string as stored in `ScenarioAssumptionsV1` (e.g. `"2.500"` meaning
 * 2.5%) into a `RATE_SCALE`-scaled *fraction* (0.025, scaled) — the form the engine's
 * compounding maths actually wants to multiply against a pence balance.
 */
export function percentStringToScaledFraction(percent: string): bigint {
  const percentScaled = parseScaledDecimal(percent, RATE_SCALE);
  return roundDiv(percentScaled, 100n);
}

/** One person's assumptions, fully resolved — overrides from `ScenarioAssumptionsV1`
 * already applied where present, falling back to `taxYearConfig`'s current-tax-year
 * defaults where not, so the engine never has to know the difference between "the
 * household typed a State Pension age" and "we derived one from date of birth". */
export interface ResolvedPerson {
  personId: number;
  retirementAge: number;
  statePensionClaimAge: number;
  statePensionAnnualPence: bigint;
  /** `null` = this person's PCLS is never taken within the modelled horizon (deferred
   * indefinitely) — see `ScenarioAssumptionsPersonV1.pclsAge`'s own doc comment for why
   * this isn't validated against the £268,275 Lump Sum Allowance yet. */
  pclsAge: number | null;
  planEndAge: number;
}

/**
 * A scenario with every input the engine needs already resolved to concrete values —
 * no further database reads or `ScenarioAssumptionsV1` parsing once one of these
 * exists. Assembling one (reading the scenario JSONB, the household's people, and their
 * live account balances) is Milestone 3's job, not this file's — these are shared
 * *shapes*, not the resolution logic that produces them.
 */
export interface ResolvedScenario {
  scenarioId: number;
  annualSpendingPence: bigint;
  /** `null` only when `people.length === 1` — see `ScenarioAssumptionsV1`'s own note. */
  survivorAnnualSpendingPence: bigint | null;
  inflationRate: bigint;
  equityAllocationRate: bigint;
  targetSuccessRate: bigint;
  flatEffectiveTaxRate: bigint;
  /** Applied literally, in order, with no optimisation — Milestone 3's documented
   * simplification, not a half-implementation of Phase 8's wrapper-sequencing work. */
  wrapperWithdrawalOrder: AccountTypeValue[];
  people: ResolvedPerson[];
  /** Starting balance per wrapper type, aggregated live from `balance_snapshot`/
   * `holding` at run time — deliberately never stored in the scenario's own JSONB, per
   * Milestone 1's "derive, don't duplicate" design decision. */
  startingBalancesPence: Partial<Record<AccountTypeValue, bigint>>;
}

/** One simulated year, within one simulated path. */
export interface YearState {
  yearIndex: number;
  totalBalancePence: bigint;
  balancesByWrapperPence: Partial<Record<AccountTypeValue, bigint>>;
  /** True from the first year the balance is exhausted onward — once a path is
   * depleted it stays depleted; this is never reset to `false` in a later year. */
  depleted: boolean;
}

/** One full simulated path (one iteration of the Monte Carlo loop, or the single path
 * the deterministic core produces). */
export interface SimulationOutcome {
  /** `false` from the moment any `YearState.depleted` is `true` in `path`. */
  success: boolean;
  path: YearState[];
}

/** The aggregate result of a whole simulation run — what `simulation_run.result` holds
 * once a run completes. */
export interface SimulationResult {
  scenarioId: number;
  seed: number;
  iterationCount: number;
  /** Fraction in `[0, 1]`. A plain JS `number`, deliberately — this is a summary
   * statistic computed once at the end of a run, not a value that's ever compounded or
   * persisted as money; `money.ts`'s "never a float" rule is about money values
   * specifically, not every number in the codebase. */
  successRate: number;
  /** Per-year percentile balance bands for the fan chart (Milestone 9) — e.g. keys
   * `"p10"`/`"p50"`/`"p90"`, each an array of pence indexed by year. */
  percentileBandsPence: Record<string, bigint[]>;
}
