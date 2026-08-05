/**
 * Phase 4.5, Milestone 3 — avalanche/snowball debt ordering.
 *
 * Orders every household debt with a positive balance, household-wide, regardless of
 * whether `waterfall.ts`'s benchmark already flags it high-interest: both methods are
 * applied to the whole pool of debt in practice — a household throws whatever's spare
 * at one debt at a time, not per-person and not scoped to only the debts the
 * comparator has an opinion on. Per `docs/PROPOSAL.md` §4, avalanche (highest rate
 * first) is mathematically optimal; snowball (smallest balance first) is a
 * user-selectable alternative for the psychological win — neither is "right," so this
 * module just orders, it doesn't recommend one over the other.
 */

export type DebtOrderingMode = 'avalanche' | 'snowball';

export interface OrderableDebt {
  accountId: number;
  name: string;
  personId: number | null;
  balancePence: bigint;
  interestRatePct: string | null;
  /** Carried through for display only — neither ordering mode sorts on this. */
  minimumPaymentPence: bigint | null;
}

/**
 * `avalanche`: highest interest rate first (a missing rate sorts last — it can't be
 * prioritised by rate at all). `snowball`: smallest balance first. Both stable-tiebreak
 * by `accountId`, the same "stable, disclosed default" discipline `waterfall.ts`'s own
 * ascending-`personId` ordering already uses, rather than leaving tied debts in
 * whatever order the database happened to return them.
 */
export function orderDebts(debts: OrderableDebt[], mode: DebtOrderingMode): OrderableDebt[] {
  const withBalance = debts.filter((debt) => debt.balancePence > 0n);

  if (mode === 'avalanche') {
    return [...withBalance].sort((a, b) => {
      const rateA = a.interestRatePct !== null ? Number(a.interestRatePct) : -Infinity;
      const rateB = b.interestRatePct !== null ? Number(b.interestRatePct) : -Infinity;
      if (rateA !== rateB) return rateB - rateA;
      return a.accountId - b.accountId;
    });
  }

  return [...withBalance].sort((a, b) => {
    if (a.balancePence !== b.balancePence) return a.balancePence < b.balancePence ? -1 : 1;
    return a.accountId - b.accountId;
  });
}
