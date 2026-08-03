import { describe, expect, it } from 'vitest';
import { buildFundamentalsChecklist } from './checklist';
import type { FmpStatements } from './fmp';

const NOW = new Date('2026-08-03T00:00:00Z');

function statements(overrides: Partial<FmpStatements> = {}): FmpStatements {
  return {
    incomeStatements: [{ date: '2026-06-30' }],
    balanceSheets: [{ date: '2026-06-30', totalStockholdersEquity: 10_000 }],
    cashFlowStatements: [{ date: '2026-06-30', freeCashFlow: 1_000 }],
    beta: 1.0,
    ratios: [{ date: '2026-06-30', netProfitMargin: 0.15, debtToEquityRatio: 1.0, currentRatio: 2.0 }],
    keyMetrics: [{ date: '2026-06-30' }],
    peers: [],
    ...overrides,
  };
}

function itemById(items: ReturnType<typeof buildFundamentalsChecklist>, id: string) {
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error(`no checklist item with id ${id}`);
  return item;
}

describe('buildFundamentalsChecklist', () => {
  it('passes every check for healthy, recent fundamentals', () => {
    const items = buildFundamentalsChecklist(statements(), NOW);
    expect(items).toHaveLength(6);
    for (const item of items) expect(item.status).toBe('pass');
  });

  describe('data recency', () => {
    it('warns between 18 and 30 months old', () => {
      const item = itemById(buildFundamentalsChecklist(statements({ incomeStatements: [{ date: '2025-01-01' }] }), NOW), 'data-recency');
      expect(item.status).toBe('warn');
    });

    it('fails beyond 30 months old', () => {
      const item = itemById(buildFundamentalsChecklist(statements({ incomeStatements: [{ date: '2022-01-01' }] }), NOW), 'data-recency');
      expect(item.status).toBe('fail');
    });

    it('is unknown with no date', () => {
      const item = itemById(buildFundamentalsChecklist(statements({ incomeStatements: [{}] }), NOW), 'data-recency');
      expect(item.status).toBe('unknown');
    });
  });

  describe('free cash flow', () => {
    it('fails for negative FCF', () => {
      const item = itemById(
        buildFundamentalsChecklist(statements({ cashFlowStatements: [{ date: '2026-06-30', freeCashFlow: -500 }] }), NOW),
        'free-cash-flow',
      );
      expect(item.status).toBe('fail');
    });

    it('is unknown when no cash flow statement exists', () => {
      const item = itemById(buildFundamentalsChecklist(statements({ cashFlowStatements: [] }), NOW), 'free-cash-flow');
      expect(item.status).toBe('unknown');
    });
  });

  describe('profitability', () => {
    it('fails for a negative net margin', () => {
      const item = itemById(
        buildFundamentalsChecklist(statements({ ratios: [{ date: '2026-06-30', netProfitMargin: -0.05 }] }), NOW),
        'profitability',
      );
      expect(item.status).toBe('fail');
    });

    it('is unknown with no ratios (the COF case)', () => {
      const item = itemById(buildFundamentalsChecklist(statements({ ratios: [] }), NOW), 'profitability');
      expect(item.status).toBe('unknown');
    });
  });

  describe('debt level', () => {
    it('warns between 2x and 4x debt/equity', () => {
      const item = itemById(
        buildFundamentalsChecklist(statements({ ratios: [{ date: '2026-06-30', debtToEquityRatio: 3.0 }] }), NOW),
        'debt-level',
      );
      expect(item.status).toBe('warn');
    });

    it('fails above 4x debt/equity', () => {
      const item = itemById(
        buildFundamentalsChecklist(statements({ ratios: [{ date: '2026-06-30', debtToEquityRatio: 5.5 }] }), NOW),
        'debt-level',
      );
      expect(item.status).toBe('fail');
    });
  });

  describe('liquidity', () => {
    it('warns between 1.0 and 1.5 current ratio', () => {
      const item = itemById(
        buildFundamentalsChecklist(statements({ ratios: [{ date: '2026-06-30', currentRatio: 1.2 }] }), NOW),
        'liquidity',
      );
      expect(item.status).toBe('warn');
    });

    it('fails below 1.0 current ratio', () => {
      const item = itemById(
        buildFundamentalsChecklist(statements({ ratios: [{ date: '2026-06-30', currentRatio: 0.7 }] }), NOW),
        'liquidity',
      );
      expect(item.status).toBe('fail');
    });
  });

  describe('shareholder equity', () => {
    it('fails for negative book equity', () => {
      const item = itemById(
        buildFundamentalsChecklist(statements({ balanceSheets: [{ date: '2026-06-30', totalStockholdersEquity: -1_000 }] }), NOW),
        'shareholder-equity',
      );
      expect(item.status).toBe('fail');
    });

    it('is unknown when no balance sheet exists', () => {
      const item = itemById(buildFundamentalsChecklist(statements({ balanceSheets: [] }), NOW), 'shareholder-equity');
      expect(item.status).toBe('unknown');
    });
  });
});
