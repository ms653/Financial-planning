/**
 * Debt amortization — how long a debt takes to clear, and the total interest paid
 * along the way, given its balance, rate, and a monthly payment.
 *
 * No amortization math existed anywhere in this codebase before this module — built
 * for `taperRescue.ts`'s "one-off tax relief vs. this debt's recurring cost over its
 * expected payoff duration" comparison (`docs/PROPOSAL.md` §4).
 *
 * An iterative month-by-month bigint simulation, not a closed-form log formula:
 * every other money calculation in this codebase stays in exact fixed-point
 * arithmetic (`src/lib/money.ts`'s own doc comment is explicit about never touching a
 * float for money), and a simulation loop is both easier to verify by hand and easier
 * to reason about than inverting a logarithm.
 *
 * **Disclosed simplification**: the monthly rate is a flat `APR ÷ 12`, not a true
 * monthly-compounded-effective rate. A card whose real APR already compounds monthly
 * will have its true cost slightly understated here — acceptable for a "roughly how
 * long, roughly how much" comparison, not presented as an authoritative amortization
 * schedule.
 */

import { parseScaledDecimal, roundDiv } from '@/lib/portfolio/valuation';

const MAX_MONTHS = 1200; // 100 years — see the module doc comment on why this is a genuine signal, not just loop-safety.

export type PayoffResult =
  | { ok: true; months: number; totalInterestPence: bigint }
  | { ok: false; reason: 'payment-below-interest' | 'exceeds-horizon' };

/**
 * Simulates paying `monthlyPaymentPence` off `balancePence` at a flat `aprPct ÷ 12`
 * monthly rate until the balance clears.
 *
 * `payment-below-interest`: the very first month's interest already meets or exceeds
 * the payment, so the balance would never shrink — not a loop-safety fallback, a real
 * "this payment doesn't even cover the interest" signal.
 *
 * `exceeds-horizon`: once past that guard, the balance is provably strictly
 * decreasing every month (this month's interest is never more than last month's,
 * which was already less than the payment), so `MAX_MONTHS` is a genuine "not
 * realistically payable off" signal too, not an infinite-loop guard.
 */
export function estimatePayoff(balancePence: bigint, aprPct: string, monthlyPaymentPence: bigint): PayoffResult {
  const rateScaled = parseScaledDecimal(aprPct, 3);
  let balance = balancePence;
  let totalInterestPence = 0n;
  let months = 0;

  const firstMonthInterest = roundDiv(balance * rateScaled, 1_200_000n);
  if (monthlyPaymentPence <= firstMonthInterest) {
    return { ok: false, reason: 'payment-below-interest' };
  }

  while (balance > 0n) {
    const interest = roundDiv(balance * rateScaled, 1_200_000n);
    totalInterestPence += interest;
    balance = balance + interest - monthlyPaymentPence;
    if (balance < 0n) balance = 0n;
    months++;
    if (months > MAX_MONTHS) {
      return { ok: false, reason: 'exceeds-horizon' };
    }
  }

  return { ok: true, months, totalInterestPence };
}
