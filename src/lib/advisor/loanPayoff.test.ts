import { describe, expect, it } from 'vitest';
import { estimatePayoff } from './loanPayoff';

describe('estimatePayoff', () => {
  it('pays off a clean two-month case with exact division at every step', () => {
    // £1,000 balance, 12% APR (1% monthly, exact). Month 1: interest = £10.00,
    // balance -> £1,000 + £10 - £510 = £500. Month 2: interest = £5.00,
    // balance -> £500 + £5 - £510 = -£5 -> floors to £0. Total interest £15.00.
    const result = estimatePayoff(100_000n, '12.000', 51_000n);
    expect(result).toEqual({ ok: true, months: 2, totalInterestPence: 1_500n });
  });

  it('reports payment-below-interest when the first month’s interest already meets the payment', () => {
    // £1,000 at 24% APR (2% monthly) = £20.00 interest in month 1, exactly equal to
    // the £20.00 payment — the balance would never shrink.
    const result = estimatePayoff(100_000n, '24.000', 2_000n);
    expect(result).toEqual({ ok: false, reason: 'payment-below-interest' });
  });

  it('hand-computed three-month case that exercises roundDiv’s actual rounding', () => {
    // £600 at 12% APR, £205/month.
    // Month 1: interest = £6.00 exact. Balance £600 + £6 - £205 = £401.
    // Month 2: interest = £401 * 0.01 = £4.01 exact. Balance £401 + £4.01 - £205 = £200.01.
    // Month 3: interest = £200.01 * 0.01 = £2.0001 -> rounds to £2.00. Balance
    //   £200.01 + £2.00 - £205 = -£2.99 -> floors to £0. Total interest £12.01.
    const result = estimatePayoff(60_000n, '12.000', 20_500n);
    expect(result).toEqual({ ok: true, months: 3, totalInterestPence: 1_201n });
  });

  it('reports exceeds-horizon for a payment that clears interest by only a penny on a huge balance', () => {
    // £1,000,000,000 balance at 20% APR: first month's interest is exactly
    // £16,666,666.67, rounding to 1,666,666,667 pence. A payment just 1 penny above
    // that clears the interest test but takes far more than 1,200 months to actually
    // shrink the balance to zero.
    const result = estimatePayoff(100_000_000_000n, '20.000', 1_666_666_668n);
    expect(result).toEqual({ ok: false, reason: 'exceeds-horizon' });
  });

  it('handles a debt that pays off in a single month', () => {
    // £100.00 balance at 10.000% APR: interest = 100_00 * 10000 / 1_200_000 = 83.33,
    // rounds to 83n. Balance = 10,000 + 83 - 10,100 = -17 -> floors to 0.
    const result = estimatePayoff(10_000n, '10.000', 10_100n);
    expect(result).toEqual({ ok: true, months: 1, totalInterestPence: 83n });
  });
});
