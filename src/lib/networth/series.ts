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

  const totalOf = (balances: Map<number, bigint>): bigint => {
    let total = 0n;
    for (const value of balances.values()) total += value;
    return total;
  };

  // Fold in every pre-window snapshot first, then plot ONE point at the window's own
  // start date using the resulting carried-forward total — rather than only using that
  // total to seed later balances and never plotting it. Skipping this point used to mean
  // the chart's leftmost plotted point was "whenever the first in-window snapshot
  // happens to be", not "the start of the window" — for a household whose only in-window
  // updates land in the final day or two (a real, not hypothetical, case: e.g. one
  // backdated entry a year ago plus one recent correction, both months before "6M"
  // begins except the correction itself), that made the true multi-month gap invisible
  // and, combined with seriesToPath's index-based x-axis below, stretched a one- or
  // two-day change across the entire chart width — a smooth-looking trend line that
  // never actually happened. No point is added when there's nothing to carry forward
  // (a household with no history predating the window has nothing to plot there).
  for (const snapshot of ordered) {
    if (start !== null && snapshot.snapshotDate < start) {
      latestByAccount.set(snapshot.accountId, numericToPence(snapshot.amount));
    }
  }
  if (start !== null && latestByAccount.size > 0) {
    byDate.set(start, totalOf(latestByAccount));
  }

  for (const snapshot of ordered) {
    if (start !== null && snapshot.snapshotDate < start) continue; // already folded in above
    latestByAccount.set(snapshot.accountId, numericToPence(snapshot.amount));
    byDate.set(snapshot.snapshotDate, totalOf(latestByAccount));
  }

  // `byDate` is guaranteed non-empty here: every snapshot in `ordered` (at least one,
  // per the early return above) either predates the window — in which case it seeded
  // `latestByAccount`, which the block above always turns into a point at `start` — or
  // falls at/after `start`, which the loop above always plots at its own date.

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

export interface PixelCoordinate {
  x: number;
  y: number;
}

/** Public wrapper around `computeCoordinates`, for callers that need a point's pixel
 * position without the full path string (e.g. a hover tooltip positioning itself
 * against a specific point) — never exposes `bigint` itself, only derived pixels, so
 * this is safe to compute server-side and hand plain numbers across to a client
 * component alongside separately-formatted display text. */
export function pointPixelCoordinates(
  points: readonly SeriesPoint[],
  options: { width: number; height: number; padding?: number; minBaseline?: number },
): PixelCoordinate[] {
  if (points.length === 0) return [];
  return computeCoordinates(points, options);
}

/**
 * Shared pixel-scaling math for `seriesToPath` and `seriesToSegments` — extracted so
 * the two can never silently disagree about where a given point lands.
 *
 * This is the one place a `number` is allowed to hold something derived from money:
 * the output is a pixel coordinate, where a sub-penny rounding error is invisible.
 * Nothing displayed as a figure comes from here.
 *
 * X position is proportional to elapsed calendar time between the first and last
 * point, not point index. A household whose only recent updates land a day or two
 * apart, after a long stretch with no snapshot at all, has genuinely sparse data —
 * plotting those points at evenly-spaced indices regardless of the real gap between
 * their dates would stretch that day or two across the *entire* chart width, drawing
 * a smooth-looking trend line over what was actually a long flat stretch followed by
 * a sudden change. `buildNetWorthSeries` always anchors the window's actual start
 * with a real point (its own doc comment explains why); this is the other half of the
 * same fix — the anchor point only tells the honest story if its x position reflects
 * how much real time separates it from what follows. A flat series or single-date
 * series has no range/span to scale against — centred rather than divided by zero.
 *
 * `minBaseline`, when given, is folded into the range the y-axis scales against
 * (`Math.min(minBaseline, ...values)`) rather than always using the series' own
 * lowest value. Without it, a debt account's chart scales its bottom edge to
 * whatever the smallest *recorded* balance happens to be — which reads as "nearly
 * paid off" even when a substantial amount is still owed, since the chart has no way
 * to show how far that figure still is from genuinely zero. The account-detail page
 * passes `0` for a debt account's outstanding-amount series for exactly this reason;
 * every other caller leaves it unset and keeps today's auto-scaled behaviour.
 */
function computeCoordinates(
  points: readonly SeriesPoint[],
  options: { width: number; height: number; padding?: number; minBaseline?: number },
): PixelCoordinate[] {
  const { width, height, padding = 4, minBaseline } = options;
  const values = points.map((point) => Number(point.pence));
  const min = minBaseline === undefined ? Math.min(...values) : Math.min(minBaseline, ...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const usableHeight = height - padding * 2;

  const firstMs = dateToMs(points[0]!.date);
  const lastMs = dateToMs(points.at(-1)!.date);
  const timeSpanMs = lastMs - firstMs || 1;

  return points.map((point) => {
    const x =
      points.length === 1 || lastMs === firstMs
        ? width / 2
        : ((dateToMs(point.date) - firstMs) / timeSpanMs) * width;
    const ratio = max === min ? 0.5 : (Number(point.pence) - min) / span;
    const y = padding + (1 - ratio) * usableHeight;
    return { x, y };
  });
}

function dateToMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Map the series onto a single, continuous SVG path (and its filled area), in a
 * fixed viewBox — see `computeCoordinates` for the pixel-scaling reasoning shared
 * with `seriesToSegments` below. */
export function seriesToPath(
  points: readonly SeriesPoint[],
  options: { width: number; height: number; padding?: number; minBaseline?: number },
): { line: string; area: string } | null {
  if (points.length === 0) return null;

  const { width, height } = options;
  const coordinates = computeCoordinates(points, options).map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`);

  const line = `M${coordinates.join(' L')}`;
  const area = `${line} L${width.toFixed(2)},${height} L0,${height} Z`;
  return { line, area };
}

/** A gap longer than this between two consecutive *plotted* points is rendered
 * visually distinct (dashed, lower opacity) rather than as a confident solid line —
 * see `seriesToSegments`'s own doc comment for the full reasoning and its known
 * limitation. */
export const STALE_GAP_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PathSegment {
  /** A two-point `M x,y L x,y` path for exactly one consecutive pair of points. */
  path: string;
  /** True when the gap between this pair's dates exceeds `STALE_GAP_DAYS` — i.e. the
   * value carried into this segment was last confirmed a long time before it's drawn,
   * not freshly recorded. */
  stale: boolean;
}

/**
 * Splits the same line `seriesToPath` would draw into one path per consecutive pair
 * of points, each flagged `stale` when the real calendar gap between that pair is
 * long — so a caller can render a long, carried-forward gap (e.g. one account update
 * that landed over a year after its last one) as visually distinct from a genuine
 * closely-tracked trend, without inventing a smoothed value for what happened during
 * the gap. Reuses `computeCoordinates`, so every segment endpoint lands at exactly
 * the pixel `seriesToPath`'s own single path would have used.
 *
 * **Known, deliberate limitation**: staleness is judged by the gap between plotted
 * *net-worth* points, not by how old any one contributing account's own balance is.
 * `buildNetWorthSeries` adds a plotted point every time *any* account updates — so a
 * household where some accounts update often would see frequent plotted points (no
 * gap flagged) even while one particular account's own contribution is quietly very
 * stale underneath. Catching that properly would mean threading per-account staleness
 * through the series itself, a materially bigger change than this function makes —
 * not done here because it isn't how this household's actual data looks (a handful of
 * accounts that tend to get updated in bursts, not a large portfolio with constant
 * partial activity masking one stale holding).
 */
export function seriesToSegments(
  points: readonly SeriesPoint[],
  options: { width: number; height: number; padding?: number; minBaseline?: number },
): PathSegment[] {
  if (points.length < 2) return [];

  const coordinates = computeCoordinates(points, options);
  const segments: PathSegment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = coordinates[i - 1]!;
    const to = coordinates[i]!;
    const gapDays = (dateToMs(points[i]!.date) - dateToMs(points[i - 1]!.date)) / MS_PER_DAY;
    segments.push({
      path: `M${from.x.toFixed(2)},${from.y.toFixed(2)} L${to.x.toFixed(2)},${to.y.toFixed(2)}`,
      stale: gapDays > STALE_GAP_DAYS,
    });
  }
  return segments;
}
