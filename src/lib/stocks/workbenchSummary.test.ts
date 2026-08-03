import { describe, expect, it } from 'vitest';
import { buildWorkbenchSummary } from './workbenchSummary';
import type { DcfInputsV1 } from './dcf';
import type { FmpStatements } from './fmp';

const DCF_INPUTS: DcfInputsV1 = {
  schemaVersion: 1,
  growthRatePct: '8.000',
  discountRatePct: '10.000',
  terminalGrowthRatePct: '2.500',
  projectionYears: 5,
};

function healthyStatements(overrides: Partial<FmpStatements> = {}): FmpStatements {
  return {
    incomeStatements: [{ date: '2026-06-30', weightedAverageShsOutDil: 1_000_000 }],
    balanceSheets: [{ date: '2026-06-30', totalStockholdersEquity: 10_000, netDebt: 5_000 }],
    cashFlowStatements: [{ date: '2026-06-30', freeCashFlow: 1_000 }],
    beta: 1.0,
    ratios: [{ date: '2026-06-30', netProfitMargin: 0.15, debtToEquityRatio: 1.0, currentRatio: 2.0 }],
    keyMetrics: [{ date: '2026-06-30' }],
    peers: [],
    ...overrides,
  };
}

describe('buildWorkbenchSummary', () => {
  it('computes a dcfResult, deltaLine, and an all-pass checklist for healthy, fully-covered fundamentals', () => {
    const summary = buildWorkbenchSummary(healthyStatements(), '5.00', DCF_INPUTS);
    expect(summary.marketPricePence).toBe(500n);
    expect(summary.dcfResult).not.toBeNull();
    expect(summary.deltaLine).not.toBeNull();
    expect(summary.checklist).toHaveLength(6);
    expect(summary.checklistCounts).toEqual({ pass: 6, warn: 0, fail: 0, unknown: 0 });
  });

  it('returns nulls across the board when there are no statements at all', () => {
    const summary = buildWorkbenchSummary(null, '5.00', DCF_INPUTS);
    expect(summary).toEqual({
      marketPricePence: 500n,
      dcfResult: null,
      deltaLine: null,
      checklist: null,
      checklistCounts: null,
    });
  });

  it('still computes dcfResult and checklist without a quote — only price-dependent fields go null', () => {
    const summary = buildWorkbenchSummary(healthyStatements(), null, DCF_INPUTS);
    expect(summary.marketPricePence).toBeNull();
    expect(summary.deltaLine).toBeNull();
    expect(summary.dcfResult).not.toBeNull();
    expect(summary.checklist).toHaveLength(6);
  });

  it('surfaces unknown checklist items, not a crash, when ratios are missing (the COF case)', () => {
    const summary = buildWorkbenchSummary(healthyStatements({ ratios: [] }), '5.00', DCF_INPUTS);
    expect(summary.checklistCounts).toEqual({ pass: 3, warn: 0, fail: 0, unknown: 3 });
  });
});
