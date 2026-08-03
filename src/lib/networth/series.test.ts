import { describe, expect, it } from 'vitest';
import {
  buildNetWorthSeries,
  downsamplePoints,
  isTrendRange,
  rangeStartDate,
  seriesToPath,
  seriesToSegments,
  trendDelta,
  STALE_GAP_DAYS,
  type SeriesSnapshot,
} from '@/lib/networth/series';
import { penceToNumeric } from '@/lib/money';

const TODAY = new Date('2026-07-26T12:00:00Z');

describe('rangeStartDate', () => {
  it('computes the window start for each range', () => {
    expect(rangeStartDate('1M', TODAY)).toBe('2026-06-26');
    expect(rangeStartDate('6M', TODAY)).toBe('2026-01-26');
    expect(rangeStartDate('1Y', TODAY)).toBe('2025-07-26');
    expect(rangeStartDate('All', TODAY)).toBeNull();
  });

  it('clamps to the end of a shorter month instead of rolling over', () => {
    // setUTCMonth would turn "one month before 31 March" into 3 March. That would put the
    // window boundary in the wrong month and silently shift the chart.
    expect(rangeStartDate('1M', new Date('2026-03-31T00:00:00Z'))).toBe('2026-02-28');
    expect(rangeStartDate('1M', new Date('2024-03-31T00:00:00Z'))).toBe('2024-02-29');
    expect(rangeStartDate('6M', new Date('2026-08-31T00:00:00Z'))).toBe('2026-02-28');
  });

  it('crosses a year boundary correctly', () => {
    expect(rangeStartDate('6M', new Date('2026-02-15T00:00:00Z'))).toBe('2025-08-15');
    expect(rangeStartDate('1Y', new Date('2026-01-01T00:00:00Z'))).toBe('2025-01-01');
  });

  it('recognises valid range values', () => {
    expect(isTrendRange('6M')).toBe(true);
    expect(isTrendRange('All')).toBe(true);
    expect(isTrendRange('3M')).toBe(false);
  });
});

describe('buildNetWorthSeries', () => {
  it('returns nothing for a household with no snapshots', () => {
    const series = buildNetWorthSeries([], { start: null, today: '2026-07-26' });
    expect(series.points).toEqual([]);
    expect(series.first).toBeNull();
    expect(trendDelta(series)).toBeNull();
  });

  it('carries each account’s last known balance forward', () => {
    // The core requirement. Accounts are updated manually at different times, so summing
    // only same-day snapshots would make the chart collapse between updates.
    const snapshots: SeriesSnapshot[] = [
      { accountId: 1, amount: '100.00', snapshotDate: '2026-07-01' },
      { accountId: 2, amount: '50.00', snapshotDate: '2026-07-10' },
      { accountId: 1, amount: '120.00', snapshotDate: '2026-07-20' },
    ];
    const series = buildNetWorthSeries(snapshots, { start: null, today: '2026-07-20' });

    expect(series.points.map((point) => [point.date, penceToNumeric(point.pence)])).toEqual([
      ['2026-07-01', '100.00'],
      // Account 1 still counts on the 10th, even though only account 2 was updated.
      ['2026-07-10', '150.00'],
      ['2026-07-20', '170.00'],
    ]);
  });

  it('nets a debt account into the running total', () => {
    const series = buildNetWorthSeries(
      [
        { accountId: 1, amount: '410000.00', snapshotDate: '2026-01-01' },
        { accountId: 2, amount: '-376500.00', snapshotDate: '2026-01-01' },
        { accountId: 2, amount: '-374000.00', snapshotDate: '2026-07-01' },
      ],
      { start: null, today: '2026-07-01' },
    );

    expect(penceToNumeric(series.first!.pence)).toBe('33500.00');
    // Paying down the mortgage moves net worth up.
    expect(penceToNumeric(series.last!.pence)).toBe('36000.00');
    expect(trendDelta(series)!.direction).toBe('up');
  });

  it('anchors the window’s own start date with the carried-forward opening balance', () => {
    const snapshots: SeriesSnapshot[] = [
      { accountId: 1, amount: '10000.00', snapshotDate: '2025-01-01' },
      { accountId: 2, amount: '5000.00', snapshotDate: '2026-07-10' },
    ];
    const series = buildNetWorthSeries(snapshots, { start: '2026-06-26', today: '2026-07-26' });

    // No point dated 2025 — but the window's own start date IS plotted, carrying
    // account 1's £10,000 forward, not skipped in favour of the first in-window
    // snapshot. Without this, a household whose only in-window update lands near
    // "today" would show a chart whose leftmost point silently isn't the start of the
    // window at all, understating how long nothing changed for.
    expect(series.points.map((point) => point.date)).toEqual(['2026-06-26', '2026-07-10', '2026-07-26']);
    expect(penceToNumeric(series.points[0]!.pence)).toBe('10000.00');
    expect(penceToNumeric(series.points[1]!.pence)).toBe('15000.00');
  });

  it('adds no opening-anchor point when nothing predates the window', () => {
    // A household with no history before the window has nothing to carry forward —
    // the series should start naturally at the first real snapshot, not fabricate a
    // point at `start` with no data behind it.
    const series = buildNetWorthSeries(
      [{ accountId: 1, amount: '100.00', snapshotDate: '2026-07-10' }],
      { start: '2026-06-26', today: '2026-07-26' },
    );
    expect(series.points.map((point) => point.date)).toEqual(['2026-07-10', '2026-07-26']);
  });

  it('reproduces the real reported bug: sparse recent updates no longer stretch across the whole window', () => {
    // A backdated "opening" entry from a year ago, then no further update until a
    // single correction two days before "today" — the exact shape that produced a
    // suspiciously smooth diagonal 6-month trend line in practice. The fix is proven
    // by two things together: the window-start date IS now plotted (carrying the old
    // figure forward), and (per seriesToPath, tested separately) the recent update
    // sits close to the right edge rather than spread evenly across the full width.
    const snapshots: SeriesSnapshot[] = [
      { accountId: 1, amount: '18992.00', snapshotDate: '2025-07-27' },
      { accountId: 1, amount: '25385.26', snapshotDate: '2026-07-26' },
    ];
    const series = buildNetWorthSeries(snapshots, { start: '2026-01-28', today: '2026-07-28' });

    expect(series.points.map((point) => point.date)).toEqual([
      '2026-01-28',
      '2026-07-26',
      '2026-07-28',
    ]);
    expect(penceToNumeric(series.points[0]!.pence)).toBe('18992.00');
    expect(penceToNumeric(series.points[1]!.pence)).toBe('25385.26');
  });

  it('end-to-end: the reported-bug shape renders as mostly flat then a sharp late rise, not a smooth diagonal', () => {
    // buildNetWorthSeries and seriesToPath are each tested independently above; this
    // pipes the exact reported shape through both together, since that composition is
    // the actual bug the household saw (neither half alone was visible on screen).
    const snapshots: SeriesSnapshot[] = [
      { accountId: 1, amount: '18992.00', snapshotDate: '2025-07-27' },
      { accountId: 1, amount: '25385.26', snapshotDate: '2026-07-26' },
    ];
    const series = buildNetWorthSeries(snapshots, { start: '2026-01-28', today: '2026-07-28' });
    const path = seriesToPath(series.points, { width: 760, height: 120 })!;

    const xs = [...path.line.matchAll(/(\d+\.\d+),\d+\.\d+/g)].map((match) => Number(match[1]));
    // Window-start anchor at the left edge, both recent points crammed into the last
    // ~1% of the width — not spread evenly across three roughly-equal thirds, which is
    // what the pre-fix index-based spacing would have drawn.
    expect(xs[0]).toBeCloseTo(0, 1);
    expect(xs[1]).toBeGreaterThan(750);
    expect(xs[2]).toBeCloseTo(760, 1);
  });

  it('draws a flat line when every snapshot predates the window', () => {
    // An account nobody has updated for a year still has a balance; the chart should show
    // it holding steady, not an empty panel.
    const series = buildNetWorthSeries(
      [{ accountId: 1, amount: '12000.00', snapshotDate: '2024-01-01' }],
      { start: '2026-06-26', today: '2026-07-26' },
    );

    expect(series.points).toHaveLength(2);
    expect(series.points.map((point) => point.date)).toEqual(['2026-06-26', '2026-07-26']);
    expect(penceToNumeric(series.first!.pence)).toBe('12000.00');
    expect(penceToNumeric(series.last!.pence)).toBe('12000.00');
    expect(trendDelta(series)).toEqual({ pence: 0n, ratio: 0, direction: 'flat' });
  });

  it('extends the line to today so a maintained chart does not look stalled', () => {
    const series = buildNetWorthSeries(
      [{ accountId: 1, amount: '100.00', snapshotDate: '2026-07-01' }],
      { start: null, today: '2026-07-26' },
    );
    expect(series.points.at(-1)).toEqual({ date: '2026-07-26', pence: 10000n });
  });

  it('does not add a duplicate point when the latest snapshot is today', () => {
    const series = buildNetWorthSeries(
      [{ accountId: 1, amount: '100.00', snapshotDate: '2026-07-26' }],
      { start: null, today: '2026-07-26' },
    );
    expect(series.points).toHaveLength(1);
  });

  it('handles several accounts updated on the same date', () => {
    const series = buildNetWorthSeries(
      [
        { accountId: 1, amount: '100.00', snapshotDate: '2026-07-26' },
        { accountId: 2, amount: '200.00', snapshotDate: '2026-07-26' },
        { accountId: 3, amount: '300.00', snapshotDate: '2026-07-26' },
      ],
      { start: null, today: '2026-07-26' },
    );
    expect(series.points).toHaveLength(1);
    expect(penceToNumeric(series.points[0]!.pence)).toBe('600.00');
  });

  it('is insensitive to the order snapshots arrive in', () => {
    const rows: SeriesSnapshot[] = [
      { accountId: 1, amount: '120.00', snapshotDate: '2026-07-20' },
      { accountId: 1, amount: '100.00', snapshotDate: '2026-07-01' },
      { accountId: 2, amount: '50.00', snapshotDate: '2026-07-10' },
    ];
    const forwards = buildNetWorthSeries(rows, { start: null, today: '2026-07-20' });
    const backwards = buildNetWorthSeries([...rows].reverse(), { start: null, today: '2026-07-20' });
    expect(backwards.points).toEqual(forwards.points);
  });

  it('ends at exactly the household’s current net worth', () => {
    // The chart's right edge sits directly under the hero figure, so a mismatch would be
    // visible and would undermine both numbers.
    const snapshots: SeriesSnapshot[] = [
      { accountId: 1, amount: '186420.00', snapshotDate: '2026-07-01' },
      { accountId: 2, amount: '410000.00', snapshotDate: '2026-07-02' },
      { accountId: 3, amount: '-376500.00', snapshotDate: '2026-07-03' },
    ];
    const series = buildNetWorthSeries(snapshots, { start: null, today: '2026-07-26' });
    expect(penceToNumeric(series.last!.pence)).toBe('219920.00');
  });

  it('downsamples a long series and keeps the most recent point', () => {
    // DESIGN_SPEC.md: "Very long time series (years of daily snapshots): the chart
    // downsamples for the 'All' window rather than rendering every point."
    const snapshots: SeriesSnapshot[] = Array.from({ length: 900 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
      return { accountId: 1, amount: `${1000 + index}.00`, snapshotDate: date };
    });
    const series = buildNetWorthSeries(snapshots, { start: null, today: '2026-07-26', maxPoints: 180 });

    expect(series.downsampled).toBe(true);
    expect(series.points.length).toBeLessThanOrEqual(180);
    expect(series.points.at(-1)!.date).toBe('2026-07-26');
    expect(series.points[0]!.date).toBe('2024-01-01');
  });

  it('does not downsample a short series', () => {
    const series = buildNetWorthSeries(
      [{ accountId: 1, amount: '100.00', snapshotDate: '2026-07-01' }],
      { start: null, today: '2026-07-26' },
    );
    expect(series.downsampled).toBe(false);
  });
});

describe('downsamplePoints', () => {
  it('keeps the first and last points', () => {
    const points = Array.from({ length: 100 }, (_, index) => ({
      date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}-${index}`,
      pence: BigInt(index),
    }));
    const sampled = downsamplePoints(points, 10);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
    expect(sampled.length).toBeLessThanOrEqual(10);
  });

  it('returns the input untouched when it already fits', () => {
    const points = [{ date: '2026-01-01', pence: 1n }];
    expect(downsamplePoints(points, 10)).toBe(points);
  });
});

describe('trendDelta', () => {
  const series = (first: string, last: string) =>
    buildNetWorthSeries(
      [
        { accountId: 1, amount: first, snapshotDate: '2026-01-26' },
        { accountId: 1, amount: last, snapshotDate: '2026-07-26' },
      ],
      { start: null, today: '2026-07-26' },
    );

  it('reports an increase as an amount and a ratio', () => {
    const delta = trendDelta(series('383400.00', '412308.00'))!;
    expect(penceToNumeric(delta.pence)).toBe('28908.00');
    expect(delta.ratio).toBeCloseTo(0.0754, 4);
    expect(delta.direction).toBe('up');
  });

  it('reports a decrease', () => {
    const delta = trendDelta(series('412308.00', '383400.00'))!;
    expect(penceToNumeric(delta.pence)).toBe('-28908.00');
    expect(delta.direction).toBe('down');
  });

  it('gives no ratio from a negative starting point, only the absolute change', () => {
    // −£10,000 to −£5,000 is an improvement, but "+50%" and "−50%" are both defensible
    // renderings of it and both mislead. The amount alone is unambiguous.
    const delta = trendDelta(series('-10000.00', '-5000.00'))!;
    expect(penceToNumeric(delta.pence)).toBe('5000.00');
    expect(delta.ratio).toBeNull();
    expect(delta.direction).toBe('up');
  });

  it('gives no ratio from a zero starting point rather than dividing by zero', () => {
    const delta = trendDelta(series('0.00', '5000.00'))!;
    expect(delta.ratio).toBeNull();
    expect(Number.isNaN(delta.ratio as number)).toBe(false);
  });
});

describe('seriesToPath', () => {
  it('returns null for an empty series', () => {
    expect(seriesToPath([], { width: 760, height: 132 })).toBeNull();
  });

  it('produces a line and a closed area path within the viewBox', () => {
    const points = [
      { date: '2026-01-01', pence: 100n },
      { date: '2026-04-01', pence: 200n },
      { date: '2026-07-01', pence: 150n },
    ];
    const path = seriesToPath(points, { width: 760, height: 132 })!;

    expect(path.line.startsWith('M0.00,')).toBe(true);
    expect(path.line).toContain('L760.00,');
    expect(path.area.endsWith('Z')).toBe(true);

    // Highest value must sit at the top of the padded band, lowest at the bottom.
    const ys = [...path.line.matchAll(/,(\d+\.\d+)/g)].map((match) => Number(match[1]));
    expect(Math.min(...ys)).toBeCloseTo(4, 1);
    expect(Math.max(...ys)).toBeCloseTo(128, 1);
  });

  it('centres a flat series instead of dividing by a zero range', () => {
    const path = seriesToPath(
      [
        { date: '2026-01-01', pence: 500n },
        { date: '2026-07-01', pence: 500n },
      ],
      { width: 100, height: 100 },
    )!;
    const ys = [...path.line.matchAll(/,(\d+\.\d+)/g)].map((match) => Number(match[1]));
    expect(ys.every((y) => Math.abs(y - 50) < 1)).toBe(true);
  });

  it('places a single point in the middle horizontally', () => {
    const path = seriesToPath([{ date: '2026-01-01', pence: 500n }], { width: 100, height: 100 })!;
    expect(path.line.startsWith('M50.00,')).toBe(true);
  });

  it('spaces points by elapsed calendar time, not by index — the bug this replaces', () => {
    // Three points spanning six months, but the last two are only two days apart.
    // Index-based spacing would place them at x=0, x=380, x=760 (evenly thirds) —
    // visually implying three roughly-equal gaps. Date-based spacing must put the last
    // two hard against the right edge instead, since almost the entire six months
    // elapsed before either of them.
    const path = seriesToPath(
      [
        { date: '2026-01-28', pence: 100n },
        { date: '2026-07-26', pence: 150n },
        { date: '2026-07-28', pence: 200n },
      ],
      { width: 760, height: 100 },
    )!;

    const xs = [...path.line.matchAll(/(\d+\.\d+),\d+\.\d+/g)].map((match) => Number(match[1]));
    expect(xs[0]).toBeCloseTo(0, 1);
    expect(xs[2]).toBeCloseTo(760, 1);
    // The middle point (2026-07-26) is 179 of the 181 total days in — hard against the
    // right edge, not at the index-even midpoint (380).
    expect(xs[1]).toBeGreaterThan(700);
  });

  it('handles a negative series without producing NaN coordinates', () => {
    const path = seriesToPath(
      [
        { date: '2026-01-01', pence: -20000n },
        { date: '2026-07-01', pence: -5000n },
      ],
      { width: 100, height: 100 },
    )!;
    expect(path.line).not.toContain('NaN');
  });

  it('scales against minBaseline rather than the series own minimum, when given', () => {
    // Without a baseline, 7800n (the smaller of the two) would sit at the very
    // bottom (y = 96, per the 4px default padding) — exactly the "looks nearly paid
    // off" problem `minBaseline` exists to fix for a debt account's outstanding
    // amount, which should still read as "some way above zero," not "at zero."
    const withoutBaseline = seriesToPath(
      [
        { date: '2026-01-01', pence: 22500n },
        { date: '2026-07-01', pence: 7800n },
      ],
      { width: 100, height: 100 },
    )!;
    const withBaseline = seriesToPath(
      [
        { date: '2026-01-01', pence: 22500n },
        { date: '2026-07-01', pence: 7800n },
      ],
      { width: 100, height: 100, minBaseline: 0 },
    )!;

    const yOf = (path: string) => Number(path.match(/,(\d+\.\d+)$/)![1]);
    expect(yOf(withoutBaseline.line)).toBeCloseTo(96, 1); // at the very bottom
    expect(yOf(withBaseline.line)).toBeLessThan(96); // some way above it, with 0 below
  });

  it("doesn't let minBaseline override an actual value below it", () => {
    // A minBaseline is a floor, not a clamp — if the real data already goes below
    // it (shouldn't happen for a debt's outstanding amount, but the function
    // shouldn't silently misrender if it ever did), the true minimum still wins.
    const path = seriesToPath(
      [
        { date: '2026-01-01', pence: -500n },
        { date: '2026-07-01', pence: 1000n },
      ],
      { width: 100, height: 100, minBaseline: 0 },
    )!;
    expect(path.line).not.toContain('NaN');
    const ys = [...path.line.matchAll(/,(\d+\.\d+)/g)].map((match) => Number(match[1]));
    expect(Math.max(...ys)).toBeCloseTo(96, 1); // -500 (below the baseline) is still the true bottom
  });
});

describe('seriesToSegments', () => {
  const options = { width: 760, height: 132 };

  it('returns one segment per consecutive pair of points', () => {
    const points = [
      { date: '2026-01-01', pence: 100n },
      { date: '2026-02-01', pence: 110n },
      { date: '2026-03-01', pence: 120n },
    ];
    expect(seriesToSegments(points, options)).toHaveLength(2);
  });

  it('returns [] for zero or one points', () => {
    expect(seriesToSegments([], options)).toEqual([]);
    expect(seriesToSegments([{ date: '2026-01-01', pence: 100n }], options)).toEqual([]);
  });

  it(`flags a gap over ${STALE_GAP_DAYS} days as stale, and one at/under it as not`, () => {
    const points = [
      { date: '2026-01-01', pence: 100n },
      { date: '2026-01-01', pence: 100n }, // placeholder, overwritten per-case below
    ];

    const justUnder = seriesToSegments(
      [points[0]!, { date: '2026-03-31', pence: 100n }], // 89 days
      options,
    );
    expect(justUnder[0]!.stale).toBe(false);

    const exactlyAt = seriesToSegments(
      [points[0]!, { date: '2026-04-01', pence: 100n }], // 90 days
      options,
    );
    expect(exactlyAt[0]!.stale).toBe(false);

    const over = seriesToSegments(
      [points[0]!, { date: '2026-04-02', pence: 100n }], // 91 days
      options,
    );
    expect(over[0]!.stale).toBe(true);
  });

  it("matches seriesToPath's own coordinates for the same points and options", () => {
    const points = [
      { date: '2026-01-01', pence: 100n },
      { date: '2026-04-01', pence: 200n },
      { date: '2026-07-01', pence: 150n },
    ];
    const path = seriesToPath(points, options)!;
    const segments = seriesToSegments(points, options);

    // The full line's coordinates, in order, should equal the concatenation of each
    // segment's own two endpoints (each segment's end = the next segment's start).
    const pathCoords = path.line.replace('M', '').split(' L');
    expect(segments[0]!.path).toBe(`M${pathCoords[0]} L${pathCoords[1]}`);
    expect(segments[1]!.path).toBe(`M${pathCoords[1]} L${pathCoords[2]}`);
  });

  it('flags only the long gap in a realistic three-point series, not the short one either side', () => {
    // Mirrors the real household case this feature was built for: a recent cluster of
    // updates (a few days apart) preceded by a long quiet stretch (well over a year).
    const points = [
      { date: '2025-02-01', pence: 100_000n },
      { date: '2026-07-26', pence: 100_000n }, // ~540 days later — stale
      { date: '2026-08-03', pence: 180_000n }, // 8 days later — not stale
    ];
    const segments = seriesToSegments(points, options);
    expect(segments[0]!.stale).toBe(true);
    expect(segments[1]!.stale).toBe(false);
  });
});
