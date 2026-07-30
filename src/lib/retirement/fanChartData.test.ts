import { describe, expect, it } from 'vitest';
import { buildFanChartSeries, fanChartAccessibleSummary, toFanChartData } from './fanChartData';

describe('buildFanChartSeries', () => {
  it('zips p10/p50/p90 by index and computes bandWidth', () => {
    const points = buildFanChartSeries(
      { p10: ['100000', '110000'], p50: ['200000', '220000'], p90: ['300000', '330000'] },
      65,
    );
    expect(points).toEqual([
      { yearIndex: 0, age: 65, p10Pence: 100000n, p50Pence: 200000n, p90Pence: 300000n, bandWidthPence: 200000n },
      { yearIndex: 1, age: 66, p10Pence: 110000n, p50Pence: 220000n, p90Pence: 330000n, bandWidthPence: 220000n },
    ]);
  });

  it('computes age from the passed-in referenceAgeAtYearZero, not any notion of today', () => {
    const points = buildFanChartSeries({ p10: ['0'], p50: ['0'], p90: ['0'] }, 40);
    expect(points[0]!.age).toBe(40);
  });

  it('returns an empty series for empty bands', () => {
    expect(buildFanChartSeries({ p10: [], p50: [], p90: [] }, 65)).toEqual([]);
  });
});

describe('toFanChartData', () => {
  it('converts pence to plain-number chart coordinates and pre-formatted labels', () => {
    const points = buildFanChartSeries({ p10: ['8000000'], p50: ['42000000'], p90: ['89000000'] }, 65);
    const data = toFanChartData(points);
    expect(data).toEqual([
      {
        age: 65,
        p10: 80_000,
        p50: 420_000,
        bandWidth: 810_000,
        p10Label: '£80,000',
        p50Label: '£420,000',
        p90Label: '£890,000',
      },
    ]);
  });
});

describe('fanChartAccessibleSummary', () => {
  it('matches the exact shape from docs/DESIGN_SPEC.md\'s own example', () => {
    const points = buildFanChartSeries(
      { p10: ['8000000'], p50: ['42000000'], p90: ['89000000'] },
      90,
    );
    expect(fanChartAccessibleSummary(points)).toBe(
      'Median outcome: £420,000 at age 90; 10th percentile: £80,000; 90th percentile: £890,000.',
    );
  });

  it('returns null for an empty series', () => {
    expect(fanChartAccessibleSummary([])).toBeNull();
  });
});
