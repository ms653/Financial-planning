import { describe, expect, it } from 'vitest';
import { ukHistoricalRealReturns } from './ukHistoricalReturns';
import { formatScaledDecimal } from '@/lib/portfolio/valuation';
import { RATE_SCALE } from '@/lib/retirement/engineTypes';

function toNumber(scaled: bigint): number {
  return Number(formatScaledDecimal(scaled, RATE_SCALE));
}

describe('ukHistoricalRealReturns', () => {
  it('covers 1871–2020 with no gaps and no duplicates', () => {
    const data = ukHistoricalRealReturns();
    expect(data).toHaveLength(150);
    expect(data[0]!.year).toBe(1871);
    expect(data.at(-1)!.year).toBe(2020);
    const years = data.map((row) => row.year);
    expect(new Set(years).size).toBe(years.length);
    for (let i = 1; i < years.length; i++) {
      expect(years[i]).toBe(years[i - 1]! + 1);
    }
  });

  it('is deterministic across calls (same cached data every time)', () => {
    const a = ukHistoricalRealReturns();
    const b = ukHistoricalRealReturns();
    expect(a).toBe(b); // literally the same cached array
    expect(a[10]).toEqual(b[10]);
  });

  it('every year has finite, non-NaN scaled values', () => {
    for (const row of ukHistoricalRealReturns()) {
      for (const field of ['equityRealReturn', 'giltRealReturn', 'billRealReturn', 'inflationRate'] as const) {
        expect(typeof row[field]).toBe('bigint');
      }
    }
  });

  it('applies the exact Fisher relation, not the arithmetic approximation — verified by hand for 1975', () => {
    // 1975: nominal equity return 149.6069%, CPI ratio 31.576493/25.734608.
    const row = ukHistoricalRealReturns().find((r) => r.year === 1975)!;
    const nominal = 1.496069;
    const inflation = 31.576493 / 25.734608 - 1;
    const expectedReal = (1 + nominal) / (1 + inflation) - 1;
    const actualReal = toNumber(row.equityRealReturn);
    expect(actualReal).toBeCloseTo(expectedReal, 4);

    // The arithmetic approximation (nominal - inflation) would give a measurably
    // different, wrong number here — this is exactly the high-inflation year the
    // module's own doc comment names as where the two methods diverge.
    const arithmeticApprox = nominal - inflation;
    expect(Math.abs(actualReal - arithmeticApprox)).toBeGreaterThan(0.05);
  });

  it('reproduces the well-documented 1973–74 UK equity crash', () => {
    // An independent sanity check that this is genuinely UK data: 1973–74 is one of
    // the most severe UK bear markets on record (secondary banking crisis / oil
    // shock). Both years should show large negative real equity returns.
    const data = ukHistoricalRealReturns();
    const y1973 = data.find((r) => r.year === 1973)!;
    const y1974 = data.find((r) => r.year === 1974)!;
    expect(toNumber(y1973.equityRealReturn)).toBeLessThan(-0.2);
    expect(toNumber(y1974.equityRealReturn)).toBeLessThan(-0.4);
  });

  it('matches the independently-published long-run real equity return figure', () => {
    // Geometric mean real equity return over the full series should land close to
    // the UBS Global Investment Returns Yearbook 2025's independently-cited "5.2% per
    // year in real terms" figure — not exact (different exact sample window/source),
    // but well within a sane tolerance band. This is a plausibility cross-check, not
    // a precise reproduction test.
    const data = ukHistoricalRealReturns();
    const logSum = data.reduce((sum, row) => sum + Math.log(1 + toNumber(row.equityRealReturn)), 0);
    const geometricMean = Math.exp(logSum / data.length) - 1;
    expect(geometricMean).toBeGreaterThan(0.03);
    expect(geometricMean).toBeLessThan(0.07);
  });

  it('gives gilts a lower long-run geometric mean real return than equities', () => {
    // A basic equity-risk-premium sanity check, not itself a precise figure to pin.
    const data = ukHistoricalRealReturns();
    const geo = (field: 'equityRealReturn' | 'giltRealReturn') => {
      const logSum = data.reduce((sum, row) => sum + Math.log(1 + toNumber(row[field])), 0);
      return Math.exp(logSum / data.length) - 1;
    };
    expect(geo('giltRealReturn')).toBeLessThan(geo('equityRealReturn'));
  });
});
