import { describe, expect, it } from 'vitest';
import { orderDebts, type OrderableDebt } from './debtOrdering';

function debt(overrides: Partial<OrderableDebt> = {}): OrderableDebt {
  return {
    accountId: 1,
    name: 'Debt',
    personId: 1,
    balancePence: 1_000_00n,
    interestRatePct: '10.000',
    minimumPaymentPence: 50_00n,
    ...overrides,
  };
}

describe('orderDebts', () => {
  it('orders avalanche by descending interest rate', () => {
    const debts = [
      debt({ accountId: 1, interestRatePct: '5.000' }),
      debt({ accountId: 2, interestRatePct: '24.900' }),
      debt({ accountId: 3, interestRatePct: '12.500' }),
    ];
    expect(orderDebts(debts, 'avalanche').map((d) => d.accountId)).toEqual([2, 3, 1]);
  });

  it('orders snowball by ascending balance', () => {
    const debts = [
      debt({ accountId: 1, balancePence: 5_000_00n }),
      debt({ accountId: 2, balancePence: 500_00n }),
      debt({ accountId: 3, balancePence: 2_000_00n }),
    ];
    expect(orderDebts(debts, 'snowball').map((d) => d.accountId)).toEqual([2, 3, 1]);
  });

  it('sorts a debt with no interest rate last under avalanche', () => {
    const debts = [
      debt({ accountId: 1, interestRatePct: '2.000' }),
      debt({ accountId: 2, interestRatePct: null }),
    ];
    expect(orderDebts(debts, 'avalanche').map((d) => d.accountId)).toEqual([1, 2]);
  });

  it('excludes a debt with a zero or negative balance from either ordering', () => {
    const debts = [debt({ accountId: 1, balancePence: 0n }), debt({ accountId: 2, balancePence: 100_00n })];
    expect(orderDebts(debts, 'avalanche').map((d) => d.accountId)).toEqual([2]);
    expect(orderDebts(debts, 'snowball').map((d) => d.accountId)).toEqual([2]);
  });

  it('stable-tiebreaks equal rates/balances by accountId', () => {
    const debts = [
      debt({ accountId: 3, interestRatePct: '5.000', balancePence: 1_000_00n }),
      debt({ accountId: 1, interestRatePct: '5.000', balancePence: 1_000_00n }),
      debt({ accountId: 2, interestRatePct: '5.000', balancePence: 1_000_00n }),
    ];
    expect(orderDebts(debts, 'avalanche').map((d) => d.accountId)).toEqual([1, 2, 3]);
    expect(orderDebts(debts, 'snowball').map((d) => d.accountId)).toEqual([1, 2, 3]);
  });

  it('orders a mixed household of above- and below-benchmark debts together — not benchmark-filtered', () => {
    // orderDebts has no concept of a benchmark at all; this proves it by mixing a
    // high-rate card with a low-rate mortgage and confirming both appear, ordered.
    const debts = [
      debt({ accountId: 1, name: 'Mortgage', interestRatePct: '4.250', balancePence: 300_000_00n }),
      debt({ accountId: 2, name: 'Credit card', interestRatePct: '24.900', balancePence: 2_000_00n }),
    ];
    expect(orderDebts(debts, 'avalanche').map((d) => d.name)).toEqual(['Credit card', 'Mortgage']);
    expect(orderDebts(debts, 'snowball').map((d) => d.name)).toEqual(['Credit card', 'Mortgage']);
  });
});
