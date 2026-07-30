/**
 * Maps a simulation's achieved success rate to the plain-language band
 * `docs/DESIGN_SPEC.md`'s Results screen calls for ("Strong"/"On track"/"At risk"),
 * relative to that scenario's own `targetSuccessRatePct` rather than a fixed global bar
 * — a scenario with a deliberately conservative 95% target and one with a looser 80%
 * target should not be graded on the same fixed line. Confirmed with the household as
 * the intended behaviour before implementation (a scenario targeting ≥90% makes
 * "strong" near-unreachable by design — the margin doesn't relax just because the
 * target is already ambitious).
 */

export type SuccessBand = 'strong' | 'on-track' | 'at-risk';

/** Percentage points above target required for "Strong" — mirrors
 * `docs/PROPOSAL.md`'s own "target 85–95%" framing (a ~10pp spread around a target bar),
 * applied per-scenario instead of as a hardcoded absolute line. */
export const STRONG_MARGIN_PP = 10;

/**
 * @param achievedRate `SimulationResult.successRate` — a fraction in `[0, 1]`.
 * @param targetSuccessRatePct `ScenarioAssumptionsV1.targetSuccessRatePct` — a decimal
 *   percent string, e.g. `"90.000"`.
 */
export function successBandFor(achievedRate: number, targetSuccessRatePct: string): SuccessBand {
  const achievedPct = achievedRate * 100;
  const targetPct = Number(targetSuccessRatePct);
  if (achievedPct >= targetPct + STRONG_MARGIN_PP) return 'strong';
  if (achievedPct >= targetPct) return 'on-track';
  return 'at-risk';
}
