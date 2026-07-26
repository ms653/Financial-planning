import { numericToPence } from '@/lib/money';

/**
 * The net worth trend series.
 *
 * Phase 1's chart is deliberately simple — a period-over-period line/area from
 * `balance_snapshot`, no fancy interpolation — but "simple" has one non-obvious
 * requirement: **balances must be carried forward**. Accounts are updated manually and at
 * different times, so on any given date most accounts have no snapshot. Summing only the
 * snapshots that fall on a date would produce a chart that collapses towards zero between
 * updates and spikes on the days someone happened to do data entry. The household's net
 * worth on a Tuesday is the sum of the *most recent known* balance of every account, which
 * is what this computes.
 *
 * Pure, and dateless in the sense that "today" is always passed in — so the tests are
 * deterministic rather than dependent on when they run.
 */

export type TrendRange = '1M' | '6M' | '1Y' | 'All';

export const TREND_RANGES: readonly TrendRange[] = ['1M', '6M', '1Y', 'All'];

export function isTrendRange(value: string): value is TrendRange {
  return (TREND_RANGES as readonly string[]).includes(value);
}

export const RANGE_DESCRIPTIONS: Record<TrendRange, string> = {
  '1M': 'over the last month',
  '6M': 'over 6 months',
  '1Y': 'over the last year',
  All: 'since you started',
};

/**
 * The window's start date, or null for "All".
 *
 * Month arithmetic uses UTC and clamps rather than rolling over: six months before 31
 * August is 28 or 29 February, not 2 or 3 March. `Date.setUTCMonth` rolls over by default,
 * which would put the window boundary in the wrong month and silently shift the chart.
 */
export function rangeStartDate(range: TrendRange, today: Date): string | null {
  if (range === 'All') return null;

  const months = range === '1M' ? 1 : range === '6M' ? 6 : 12;
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const day = today.getUTCDate();

  const targetMonth = month - months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalisedMonth = ((targetMonth % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, normalisedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);

  return new Date(Date.UTC(targetYear, normalisedMonth, clampedDay)).toISOString().slice(0, 10);
}

export interface SeriesSnapshot {
  accountId: number;
  amount: string;
  snapshotDate: string;
}

export interface SeriesPoint {
  date: string;
  pence: bigint;
}

export interface NetWorthSeries {
  points: SeriesPoint[];
  /** First and last points, for the "+£8,240 (2.0%) over 6 months" delta line. */
  first: SeriesPoint | null;
  last: SeriesPoint | null;
  /** Whether points were dropped to keep the chart renderable. */
  downsampled: boolean;
}

/**
 * Build the series.
 *
 * `snapshots` may include rows dated *before* `start` — they're needed to establish each
 * account's opening balance at the left edge, and are used for that and then excluded from
 * the plotted points. `getSnapshotsForTrend` fetches exactly that.
 *
 * `maxPoints` downsamples the "All" window, per the design spec's edge case: "Very long
 * time series (years of daily snapshots): the chart downsamples for the 'All' window rather
 * than rendering every point." The most recent point always survives downsampling, because
 * the right-hand end of the line is the household's current position and must agree with
 * the hero figure above it.
 */
export function buildNetWorthSeries(
  snapshots: readonly SeriesSnapshot[],
  options: { start: string | null; today: string; maxPoints?: number },
): NetWorthSeries {
  const { start, today, maxPoints = 180 } = options;

  if (snapshots.length === 0) {
    return { points: [], first: null, last: null, downsampled: false };
  }

  const ordered = [...snapshots].sort((a, b) =>
    a.snapshotDate === b.snapshotDate ? a.accountId - b.accountId : a.snapshotDate.localeCompare(b.snapshotDate),
  );

  // Running latest-known balance per account, updated as the walk moves forward in time.
  const latestByAccount = new Map<number, bigint>();
  const byDate = new Map<string, bigint>();

  for (const snapshot of ordered) {
    latestByAccount.set(snapshot.accountId, numericToPence(snapshot.amount));
    if (start !== null && snapshot.snapshotDate < start) {
      // Establishes the opening position without plotting a point outside the window.
      continue;
    }
    let total = 0n;
    for (const value of latestByAccount.values()) total += value;
    byDate.set(snapshot.snapshotDate, total);
  }

  // If every snapshot predates the window, the household still has a position throughout
  // it — a flat line at the carried-forward total, not an empty chart.
  if (byDate.size === 0) {
    let total = 0n;
    for (const value of latestByAccount.values()) total += value;
    const openingDate = start ?? today;
    const flat: SeriesPoint[] = [
      { date: openingDate, pence: total },
      { date: today, pence: total },
    ];
    return { points: flat, first: flat[0]!, last: flat[1]!, downsampled: false };
  }

  let points: SeriesPoint[] = [...byDate.entries()]
    .map(([date, pence]) => ({ date, pence }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Extend the line to today so the chart's right edge is "now" rather than "the last time
  // anyone typed something in", which would make a well-maintained household's chart look
  // like it stopped.
  const last = points.at(-1)!;
  if (last.date < today) points.push({ date: today, pence: last.pence });

  const downsampled = points.length > maxPoints;
  if (downsampled) points = downsamplePoints(points, maxPoints);

  return {
    points,
    first: points[0] ?? null,
    last: points.at(-1) ?? null,
    downsampled,
  };
}

/**
 * Evenly thin a series to at most `maxPoints`, always keeping the first and last.
 *
 * Deliberately not an average or an LTTB-style peak-preserving reduction: this is a
 * monotonically-updated balance series, not a noisy signal, so sampling is honest here and
 * averaging would invent values that were never a real net worth on any real date.
 */
export function downsamplePoints(points: SeriesPoint[], maxPoints: number): SeriesPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;

  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: SeriesPoint[] = [];
  for (let index = 0; index < maxPoints - 1; index += 1) {
    sampled.push(points[Math.round(index * step)]!);
  }
  sampled.push(points.at(-1)!);

  // Rounding can pick the same index twice at small sizes; de-duplicate by date.
  return sampled.filter((point, index) => index === 0 || point.date !== sampled[index - 1]!.date);
}

export interface TrendDelta {
  pence: bigint;
  /** Fractional change, or null when the starting figure was zero or negative. */
  ratio: number | null;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Change across the window.
 *
 * `ratio` is null when the opening figure is zero or negative, because a percentage change
 * from a negative base is not meaningful in the way a reader would assume: a household
 * going from −£10,000 to −£5,000 has improved, but "+50%" and "−50%" are both defensible
 * renderings of it and both would mislead. The UI shows the absolute change alone in that
 * case, which is unambiguous. (A mortgage-heavy household starting at negative net worth is
 * explicitly a normal state per the design spec, not an edge case to shrug at.)
 */
export function trendDelta(series: NetWorthSeries): TrendDelta | null {
  if (!series.first || !series.last) return null;
  const pence = series.last.pence - series.first.pence;
  const ratio = series.first.pence > 0n ? Number(pence) / Number(series.first.pence) : null;
  return {
    pence,
    ratio,
    direction: pence > 0n ? 'up' : pence < 0n ? 'down' : 'flat',
  };
}

/**
 * Map the series onto an SVG path, in a fixed viewBox.
 *
 * This is the one place a `number` is allowed to hold something derived from money: the
 * output is a pixel coordinate, where a sub-penny rounding error is invisible. Nothing
 * displayed as a figure comes from here.
 */
export function seriesToPath(
  points: readonly SeriesPoint[],
  options: { width: number; height: number; padding?: number },
): { line: string; area: string } | null {
  if (points.length === 0) return null;

  const { width, height, padding = 4 } = options;
  const values = points.map((point) => Number(point.pence));
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series has no range to scale against; centre it rather than dividing by zero.
  const span = max - min || 1;
  const usableHeight = height - padding * 2;

  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const ratio = max === min ? 0.5 : (Number(point.pence) - min) / span;
    const y = padding + (1 - ratio) * usableHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M${coordinates.join(' L')}`;
  const area = `${line} L${width.toFixed(2)},${height} L0,${height} Z`;
  return { line, area };
}
