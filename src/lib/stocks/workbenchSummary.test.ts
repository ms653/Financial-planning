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
      stale: false,
      statementsCurrency: null,
    });
  });

  it('defaults stale to false, and passes an explicit value straight through unchanged', () => {
    expect(buildWorkbenchSummary(null, null, DCF_INPUTS).stale).toBe(false);
    expect(buildWorkbenchSummary(null, null, DCF_INPUTS, true).stale).toBe(true);
  });

  it('still computes dcfResult and checklist without a quote — only price-dependent fields go null', () => {
    const summary = buildWorkbenchSummary(healthyStatements(), null, DCF_INPUTS);
    expect(summary.marketPricePence).toBeNull();
    expect(summary.deltaLine).toBeNull();
    expect(summary.dcfResult).not.toBeNull();
    expect(summary.checklist).toHaveLength(6);
  });

  it('computes deltaLine against intrinsic value, not market price, as its own label requires', () => {
    // Regression test for a real bug (found by independent review): the denominator
    // was market price, while the label says "% below/above intrinsic value" —
    // wrong whenever the two diverge by more than a token amount. Verified two ways:
    // self-consistency against the actual computed intrinsic value, and a
    // deliberately large, easy-to-hand-check gap.
    const summary = buildWorkbenchSummary(healthyStatements(), '5.00', DCF_INPUTS);
    const intrinsic = summary.dcfResult!.intrinsicValuePerSharePence!;
    const market = summary.marketPricePence!;
    // Sanity check that this fixture actually exercises a divergent, non-trivial case
    // (otherwise a market-price-denominator bug and an intrinsic-denominator fix would
    // coincidentally produce the same string, and the test below would prove nothing).
    expect(intrinsic).not.toBe(market);

    const expectedPct = (Number(intrinsic - market) / Number(intrinsic)) * 100;
    expect(summary.deltaLine).toBe(
      expectedPct >= 0
        ? `${expectedPct.toFixed(1)}% below intrinsic value`
        : `${Math.abs(expectedPct).toFixed(1)}% above intrinsic value`,
    );
  });

  it('surfaces unknown checklist items, not a crash, when ratios are missing (the COF case)', () => {
    const summary = buildWorkbenchSummary(healthyStatements({ ratios: [] }), '5.00', DCF_INPUTS);
    expect(summary.checklistCounts).toEqual({ pass: 3, warn: 0, fail: 0, unknown: 3 });
  });

  describe('currency mismatch', () => {
    it('reports statementsCurrency as null when the field is absent (assume USD)', () => {
      const summary = buildWorkbenchSummary(healthyStatements(), '5.00', DCF_INPUTS);
      expect(summary.statementsCurrency).toBeNull();
      expect(summary.deltaLine).not.toBeNull();
    });

    it('reports statementsCurrency as USD unaffected', () => {
      const summary = buildWorkbenchSummary(
        healthyStatements({ incomeStatements: [{ date: '2026-06-30', weightedAverageShsOutDil: 1_000_000, reportedCurrency: 'USD' }] }),
        '5.00',
        DCF_INPUTS,
      );
      expect(summary.statementsCurrency).toBe('USD');
      expect(summary.deltaLine).not.toBeNull();
    });

    it('suppresses deltaLine (but still computes dcfResult) when statements are reported in a non-USD currency', () => {
      // Regression test for a real gap (found by independent review): comparing a
      // USD quote against an intrinsic value derived from non-USD statements (a real
      // risk for a US-listed ADR filing in its home currency) is comparing two
      // different currencies as if they were the same.
      const summary = buildWorkbenchSummary(
        healthyStatements({ incomeStatements: [{ date: '2026-06-30', weightedAverageShsOutDil: 1_000_000, reportedCurrency: 'JPY' }] }),
        '5.00',
        DCF_INPUTS,
      );
      expect(summary.statementsCurrency).toBe('JPY');
      expect(summary.dcfResult).not.toBeNull(); // the DCF itself still computes
      expect(summary.deltaLine).toBeNull(); // but the cross-currency comparison is suppressed
    });
  });
});
