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
import { accountType, type AccountTypeValue } from '@/lib/db/schema';

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

/**
 * The account types a drawdown simulation can actually hold a balance in and walk a
 * withdrawal order through — every `AccountTypeValue` except `debt` and `property`,
 * neither of which is a liquid decumulation wrapper. Resolves the gap Milestone 2's
 * Fable review flagged and left for Milestone 3 to fix: `wrapperWithdrawalOrder`,
 * `startingBalancesPence` and `YearState.balancesByWrapperPence` all typed their wrapper
 * key as the full 8-value `AccountTypeValue` enum, which meant nothing stopped the engine
 * from accidentally aggregating a mortgage balance or a house valuation into a simulated
 * portfolio total. Derived from the real enum (`accountType.enumValues`), not
 * hand-copied, so a future ninth account type can't silently need a second edit here.
 */
export const DRAWDOWN_ACCOUNT_TYPES = accountType.enumValues.filter(
  (value): value is Exclude<AccountTypeValue, 'debt' | 'property'> =>
    value !== 'debt' && value !== 'property',
);

export type DrawdownAccountType = (typeof DRAWDOWN_ACCOUNT_TYPES)[number];

/** One person's assumptions, fully resolved — overrides from `ScenarioAssumptionsV1`
 * already applied where present, falling back to `taxYearConfig`'s current-tax-year
 * defaults where not, so the engine never has to know the difference between "the
 * household typed a State Pension age" and "we derived one from date of birth". */
export interface ResolvedPerson {
  personId: number;
  /**
   * This person's age at year 0 of the simulated path — not necessarily today's real
   * age. A "retire at 60 vs. 65" comparison (Milestone 9's narrow scenario-comparison
   * UI) is built by resolving *two* `ResolvedScenario`s that each start their path at a
   * different `currentAge`, not by simulating one continuous timeline through an
   * accumulation phase into decumulation — see `retirementAge`'s doc comment below for
   * why `deterministicCore.ts` never reads `retirementAge` directly.
   */
  currentAge: number;
  /**
   * The age this person stops contributing and starts drawing down (per
   * `ScenarioAssumptionsPersonV1`'s own doc comment). **Phase 4.4**: consumed by
   * `deterministicCore.ts`'s year-by-year mechanics — a person is "still working"
   * while `age < retirementAge` (contributions land, no drawdown), "retired" from
   * `age === retirementAge` onward. Before Phase 4.4, this field was carried but
   * never read (a documented, later-reversed scope narrowing — see
   * `docs/STATUS.md`'s Phase 3 Milestone 3 section for the original decision and
   * `deterministicCore.ts`'s module doc comment for how it's now used, including the
   * two disclosed simplifications that come with it).
   */
  retirementAge: number;
  statePensionClaimAge: number;
  statePensionAnnualPence: bigint;
  /** `null` = this person's PCLS is never taken within the modelled horizon (deferred
   * indefinitely) — see `ScenarioAssumptionsPersonV1.pclsAge`'s own doc comment for why
   * this isn't validated against the £268,275 Lump Sum Allowance yet. */
  pclsAge: number | null;
  planEndAge: number;
  /**
   * This person's own annual pension contribution while still working — the sum of
   * every `pension_contribution` row's `amount` + `employerAmount` (Phase 1's schema;
   * `src/lib/db/schema.ts`), resolved live the same way `startingBalancesPence` is,
   * never stored in the scenario's own JSONB. `0n` when the person has no recorded
   * contributions. **Disclosed simplification**: applied to `sipp_pension` exactly as
   * entered, with no relief-at-source grossing-up — see `deterministicCore.ts`.
   */
  annualContributionPence: bigint;
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
   * simplification, not a half-implementation of Phase 8's wrapper-sequencing work.
   * Restricted to `DrawdownAccountType` (see above) — `debt`/`property` were never
   * meaningful entries here. */
  wrapperWithdrawalOrder: DrawdownAccountType[];
  people: ResolvedPerson[];
  /** Starting balance per wrapper type, aggregated live from `balance_snapshot`/
   * `holding` at run time — deliberately never stored in the scenario's own JSONB, per
   * Milestone 1's "derive, don't duplicate" design decision. */
  startingBalancesPence: Partial<Record<DrawdownAccountType, bigint>>;
}

/** One simulated year, within one simulated path. */
export interface YearState {
  yearIndex: number;
  totalBalancePence: bigint;
  balancesByWrapperPence: Partial<Record<DrawdownAccountType, bigint>>;
  /** True from the first year drawdown demand could not be fully met from available
   * wrapper balances onward — once a path is depleted it stays depleted; this is never
   * reset to `false` in a later year. Refines Milestone 2's original wording ("the
   * balance is exhausted") now that Milestone 3 has written the algorithm that actually
   * produces this flag: depletion is keyed to unmet spending demand, not to a wrapper
   * balance merely reading zero — a household with £0 starting balance and £0 spending
   * has nothing to deplete and is not a failed path. */
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
