import { describe, expect, it } from 'vitest';
import {
  aggregateByTicker,
  currentValuePence,
  formatScaledDecimal,
  gainLoss,
  parseScaledDecimal,
} from './valuation';

describe('parseScaledDecimal / formatScaledDecimal', () => {
  it('round-trips a plain decimal at its declared scale', () => {
    expect(parseScaledDecimal('107.7600', 4)).toBe(1077600n);
    expect(formatScaledDecimal(1077600n, 4)).toBe('107.7600');
  });

  it('pads a shorter fraction rather than mis-scaling it', () => {
    // '1.5' at scale 6 must become 1_500_000, not 15 or 1_500.
    expect(parseScaledDecimal('1.5', 6)).toBe(1_500_000n);
  });

  it('handles a whole number with no decimal point', () => {
    expect(parseScaledDecimal('120', 6)).toBe(120_000_000n);
  });

  it('handles negative values', () => {
    expect(parseScaledDecimal('-4.50', 2)).toBe(-450n);
    expect(formatScaledDecimal(-450n, 2)).toBe('-4.50');
  });

  it('rejects more fractional digits than the declared scale allows', () => {
    expect(() => parseScaledDecimal('1.23456789', 4)).toThrow(/too many decimal places/i);
  });

  it('rejects non-numeric garbage', () => {
    expect(() => parseScaledDecimal('not-a-number', 4)).toThrow(/not a decimal value/i);
  });
});

describe('currentValuePence', () => {
  it('multiplies quantity by price without float error', () => {
    // 120.5 shares at £107.76 = £12,985.08 = 1,298,508 pence, exactly.
    expect(currentValuePence('120.5', '107.7600')).toBe(1_298_508n);
  });

  it('handles fractional shares at full precision', () => {
    // 0.123456 shares at £79.5200 = £9.81722112 -> rounds to 982 pence.
    expect(currentValuePence('0.123456', '79.5200')).toBe(982n);
  });

  it('rounds half up rather than truncating', () => {
    // 1 share at a price landing exactly on a half-penny boundary.
    expect(currentValuePence('1', '10.005')).toBe(1001n); // £10.005 -> 1000.5p -> 1001p
  });

  it('is zero for a zero quantity', () => {
    expect(currentValuePence('0', '107.7600')).toBe(0n);
  });
});

describe('gainLoss', () => {
  it('reports a gain as positive with an "up" direction', () => {
    const result = gainLoss(1_000_00n, 1_200_00n); // £1,000 cost, £1,200 now
    expect(result.amountPence).toBe(20_000n);
    expect(result.percent).toBe('20.00');
    expect(result.direction).toBe('up');
  });

  it('reports a loss as negative with a "down" direction', () => {
    const result = gainLoss(1_000_00n, 800_00n);
    expect(result.amountPence).toBe(-20_000n);
    expect(result.percent).toBe('-20.00');
    expect(result.direction).toBe('down');
  });

  it('reports no change as "flat" with a zero percent', () => {
    const result = gainLoss(1_000_00n, 1_000_00n);
    expect(result.amountPence).toBe(0n);
    expect(result.percent).toBe('0.00');
    expect(result.direction).toBe('flat');
  });

  it('returns a null percent when cost basis is zero, rather than dividing by it', () => {
    const result = gainLoss(0n, 500_00n);
    expect(result.amountPence).toBe(500_00n);
    expect(result.percent).toBeNull();
    expect(result.direction).toBe('up');
  });
});

describe('aggregateByTicker', () => {
  it('sums quantity and cost basis across accounts sharing a ticker and currency', () => {
    const [aggregate] = aggregateByTicker([
      { accountId: 1, ticker: 'VUAG', quantity: '10.5', costBasisPence: 1_000_00n, accountCurrency: 'GBP' },
      { accountId: 2, ticker: 'VUAG', quantity: '4.5', costBasisPence: 400_00n, accountCurrency: 'GBP' },
    ]);
    expect(aggregate).toEqual({
      ticker: 'VUAG',
      currency: 'GBP',
      totalQuantity: '15.000000',
      totalCostBasisPence: 1_400_00n,
      accountIds: [1, 2],
    });
  });

  it('keeps different tickers as separate rows', () => {
    const result = aggregateByTicker([
      { accountId: 1, ticker: 'VUAG', quantity: '10', costBasisPence: 1_000_00n, accountCurrency: 'GBP' },
      { accountId: 1, ticker: 'VHYG', quantity: '5', costBasisPence: 500_00n, accountCurrency: 'GBP' },
    ]);
    expect(result.map((r) => r.ticker).sort()).toEqual(['VHYG', 'VUAG']);
  });

  it('does NOT merge the same bare ticker held under two different account currencies', () => {
    // Real-world case a bare ticker regex permits: Vodafone trades as "VOD" both as an
    // LSE line (GBP) and a NYSE ADR (USD). Merging these would sum 150 shares and price
    // them all against one quote — silently mixing currencies into one wrong number,
    // rather than the "Price unavailable"/excluded-with-a-label outcome this app promises
    // everywhere else. Currency is part of the grouping key precisely to prevent that.
    const result = aggregateByTicker([
      { accountId: 1, ticker: 'VOD', quantity: '100', costBasisPence: 100_000n, accountCurrency: 'GBP' },
      { accountId: 2, ticker: 'VOD', quantity: '50', costBasisPence: 50_000n, accountCurrency: 'USD' },
    ]);

    expect(result).toHaveLength(2);
    const gbp = result.find((r) => r.currency === 'GBP');
    const usd = result.find((r) => r.currency === 'USD');
    expect(gbp).toMatchObject({ ticker: 'VOD', totalQuantity: '100.000000', accountIds: [1] });
    expect(usd).toMatchObject({ ticker: 'VOD', totalQuantity: '50.000000', accountIds: [2] });
  });

  it('returns an empty array for no holdings', () => {
    expect(aggregateByTicker([])).toEqual([]);
  });
});
