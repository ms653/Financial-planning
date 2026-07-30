/**
 * Turns `SerializedSimulationResult.percentileBandsPence` (already-JSON-safe
 * decimal-pence strings, per `simulationResultCodec.ts`) into the per-year points the
 * Fan Chart component plots, plus the accessible text-equivalent summary
 * `docs/DESIGN_SPEC.md` requires alongside it. Deliberately kept out of the chart
 * component so it's unit-testable without React/jsdom.
 *
 * **Age is computed by the caller, not here** — from the run's own `createdAt`, not
 * "today". `ResolvedScenario.people[0].currentAge` is baked into a run's simulated path
 * at the moment `resolveScenario` ran (when the run was created); recomputing an age
 * from today's date on every later page view would silently drift the x-axis out of
 * sync with what the engine actually simulated. Callers pass the already-resolved
 * `referenceAgeAtYearZero` (typically `ageAsOf(dob, run.createdAt)`), keeping this module
 * free of any notion of "now".
 */

import { formatMoney } from '@/lib/money';

export interface FanChartPoint {
  yearIndex: number;
  age: number;
  p10Pence: bigint;
  p50Pence: bigint;
  p90Pence: bigint;
  /** `p90Pence - p10Pence` — a chart-coordinate convenience for a stacked-area band,
   * not a figure ever displayed on its own (same "derived pixel value, not money"
   * exception `networth/series.ts`'s `seriesToPath` already documents). */
  bandWidthPence: bigint;
}

export function buildFanChartSeries(
  percentileBandsPence: Record<string, readonly string[]>,
  referenceAgeAtYearZero: number,
): FanChartPoint[] {
  const p10 = percentileBandsPence.p10 ?? [];
  const p50 = percentileBandsPence.p50 ?? [];
  const p90 = percentileBandsPence.p90 ?? [];
  const length = Math.max(p10.length, p50.length, p90.length);

  const points: FanChartPoint[] = [];
  for (let i = 0; i < length; i += 1) {
    const p10Pence = BigInt(p10[i] ?? '0');
    const p50Pence = BigInt(p50[i] ?? '0');
    const p90Pence = BigInt(p90[i] ?? '0');
    points.push({
      yearIndex: i,
      age: referenceAgeAtYearZero + i,
      p10Pence,
      p50Pence,
      p90Pence,
      bandWidthPence: p90Pence - p10Pence,
    });
  }
  return points;
}

/** Chart-ready data for `FanChart.tsx` — plain numbers/strings only, no `bigint`. Next's
 * server-to-client component boundary (React Flight) can't serialize a `bigint` prop, so
 * this conversion has to happen before a `FanChartPoint[]` ever reaches a `'use client'`
 * component; kept here (not inline in the component) so it stays covered by this file's
 * own plain unit tests rather than requiring jsdom. */
export interface FanChartDatum {
  age: number;
  /** Chart-coordinate pounds — the one place a plain `number` derived from money is
   * allowed, same exception `networth/series.ts`'s `seriesToPath` already documents.
   * Never displayed directly; the `*Label` fields below are what's shown. */
  p10: number;
  p50: number;
  bandWidth: number;
  p10Label: string;
  p50Label: string;
  p90Label: string;
}

function penceToChartPounds(pence: bigint): number {
  return Number(pence) / 100;
}

export function toFanChartData(points: readonly FanChartPoint[]): FanChartDatum[] {
  return points.map((point) => ({
    age: point.age,
    p10: penceToChartPounds(point.p10Pence),
    p50: penceToChartPounds(point.p50Pence),
    bandWidth: penceToChartPounds(point.bandWidthPence),
    p10Label: formatMoney(point.p10Pence),
    p50Label: formatMoney(point.p50Pence),
    p90Label: formatMoney(point.p90Pence),
  }));
}

/**
 * The always-visible one-sentence accessible summary, matching
 * `docs/DESIGN_SPEC.md`'s own example shape exactly: "Median outcome: £420,000 at age
 * 90; 10th percentile: £80,000; 90th percentile: £890,000." Uses the final simulated
 * year — the point a household most wants a plain-language answer for ("what happens by
 * the end of the plan"). Returns `null` for an empty series (nothing to summarise).
 */
export function fanChartAccessibleSummary(points: readonly FanChartPoint[]): string | null {
  if (points.length === 0) return null;
  const final = points[points.length - 1]!;
  return (
    `Median outcome: ${formatMoney(final.p50Pence)} at age ${final.age}; ` +
    `10th percentile: ${formatMoney(final.p10Pence)}; ` +
    `90th percentile: ${formatMoney(final.p90Pence)}.`
  );
}
