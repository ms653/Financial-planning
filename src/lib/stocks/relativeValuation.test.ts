import { describe, expect, it } from 'vitest';
import { deriveQualityMetrics, derivePeerComparison } from './relativeValuation';
import type { FmpStatementPeriod } from './fmp';

describe('deriveQualityMetrics', () => {
  const ratios: FmpStatementPeriod[] = [
    {
      date: '2025-12-31',
      grossProfitMargin: 0.45,
      netProfitMargin: 0.25,
      debtToEquityRatio: 1.5,
      currentRatio: 0.9,
    },
  ];
  const keyMetrics: FmpStatementPeriod[] = [
    { date: '2025-12-31', returnOnEquity: 1.2, returnOnInvestedCapital: 0.4, freeCashFlowYield: 0.03 },
  ];

  it('reads every field from the most recent (index 0) period', () => {
    expect(deriveQualityMetrics(ratios, keyMetrics)).toEqual({
      grossMargin: 0.45,
      netMargin: 0.25,
      returnOnEquity: 1.2,
      returnOnInvestedCapital: 0.4,
      debtToEquity: 1.5,
      currentRatio: 0.9,
      freeCashFlowYield: 0.03,
    });
  });

  it('nulls only the missing field, not the whole result, when ratios has no data', () => {
    const result = deriveQualityMetrics([], keyMetrics);
    expect(result.grossMargin).toBeNull();
    expect(result.netMargin).toBeNull();
    expect(result.debtToEquity).toBeNull();
    expect(result.currentRatio).toBeNull();
    expect(result.returnOnEquity).toBe(1.2);
    expect(result.returnOnInvestedCapital).toBe(0.4);
    expect(result.freeCashFlowYield).toBe(0.03);
  });

  it('nulls only the missing field, not the whole result, when keyMetrics has no data', () => {
    const result = deriveQualityMetrics(ratios, []);
    expect(result.returnOnEquity).toBeNull();
    expect(result.returnOnInvestedCapital).toBeNull();
    expect(result.freeCashFlowYield).toBeNull();
    expect(result.grossMargin).toBe(0.45);
  });

  it('treats a non-numeric or non-finite field as null rather than throwing', () => {
    const result = deriveQualityMetrics(
      [{ date: '2025-12-31', grossProfitMargin: 'N/A', netProfitMargin: NaN }],
      [],
    );
    expect(result.grossMargin).toBeNull();
    expect(result.netMargin).toBeNull();
  });
});

describe('derivePeerComparison', () => {
  const primary = {
    ratios: [{ date: '2025-12-31', priceToEarningsRatio: 30 }],
    keyMetrics: [{ date: '2025-12-31', evToEBITDA: 25 }],
  };

  it("builds the primary ticker's own multiples plus each peer's", () => {
    const result = derivePeerComparison(primary, [
      {
        ticker: 'MSFT',
        companyName: 'Microsoft Corporation',
        ratios: [{ date: '2025-12-31', priceToEarningsRatio: 20 }],
        keyMetrics: [{ date: '2025-12-31', evToEBITDA: 15 }],
      },
      {
        ticker: 'GOOGL',
        companyName: 'Alphabet Inc.',
        ratios: [{ date: '2025-12-31', priceToEarningsRatio: 10 }],
        keyMetrics: [{ date: '2025-12-31', evToEBITDA: 5 }],
      },
    ]);

    expect(result.primary).toEqual({ peRatio: 30, evToEbitda: 25 });
    expect(result.peers).toEqual([
      { ticker: 'MSFT', companyName: 'Microsoft Corporation', peRatio: 20, evToEbitda: 15 },
      { ticker: 'GOOGL', companyName: 'Alphabet Inc.', peRatio: 10, evToEbitda: 5 },
    ]);
    expect(result.peerAveragePeRatio).toBe(15); // (20 + 10) / 2
    expect(result.peerAverageEvToEbitda).toBe(10); // (15 + 5) / 2
  });

  it('includes a peer with no usable data as null multiples, rather than omitting it', () => {
    const result = derivePeerComparison(primary, [
      { ticker: 'COF', companyName: 'Capital One Financial Corporation', ratios: [], keyMetrics: [] },
    ]);
    expect(result.peers).toEqual([
      { ticker: 'COF', companyName: 'Capital One Financial Corporation', peRatio: null, evToEbitda: null },
    ]);
  });

  it('averages only over peers with a non-null value for that metric', () => {
    const result = derivePeerComparison(primary, [
      {
        ticker: 'MSFT',
        companyName: 'Microsoft Corporation',
        ratios: [{ date: '2025-12-31', priceToEarningsRatio: 20 }],
        keyMetrics: [],
      },
      { ticker: 'COF', companyName: 'Capital One Financial Corporation', ratios: [], keyMetrics: [] },
    ]);
    expect(result.peerAveragePeRatio).toBe(20);
    expect(result.peerAverageEvToEbitda).toBeNull();
  });

  it('returns null averages, not NaN, when zero peers have data', () => {
    const result = derivePeerComparison(primary, [
      { ticker: 'COF', companyName: 'Capital One Financial Corporation', ratios: [], keyMetrics: [] },
    ]);
    expect(result.peerAveragePeRatio).toBeNull();
    expect(result.peerAverageEvToEbitda).toBeNull();
  });

  it('handles zero peers at all', () => {
    const result = derivePeerComparison(primary, []);
    expect(result.peers).toEqual([]);
    expect(result.peerAveragePeRatio).toBeNull();
    expect(result.peerAverageEvToEbitda).toBeNull();
  });

  it("shows a peer's own real negative multiple (e.g. negative P/E from negative earnings) as-is, but excludes it from the average", () => {
    // Regression test for a real bug (found by independent review): a loss-making
    // peer's negative multiple used to be blended into peerAveragePeRatio, producing
    // a nonsensical negative "average" that read as "far cheaper than peers." The
    // per-peer figure is still shown unfiltered (a household reading the table should
    // see the real number); only the average now excludes it as unrankable.
    const result = derivePeerComparison(primary, [
      {
        ticker: 'SONY',
        companyName: 'Sony Group Corporation',
        ratios: [{ date: '2025-12-31', priceToEarningsRatio: -57.1 }],
        keyMetrics: [],
      },
    ]);
    expect(result.peers[0]!.peRatio).toBe(-57.1);
    expect(result.peerAveragePeRatio).toBeNull();
  });

  it('excludes a loss-making peer from the average while a profitable peer still counts', () => {
    const result = derivePeerComparison(primary, [
      {
        ticker: 'SONY',
        companyName: 'Sony Group Corporation',
        ratios: [{ date: '2025-12-31', priceToEarningsRatio: -57.1 }],
        keyMetrics: [],
      },
      {
        ticker: 'MSFT',
        companyName: 'Microsoft Corporation',
        ratios: [{ date: '2025-12-31', priceToEarningsRatio: 20 }],
        keyMetrics: [],
      },
    ]);
    expect(result.peerAveragePeRatio).toBe(20); // not (-57.1 + 20) / 2
  });
});
