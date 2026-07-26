import type { AccountTypeValue, TaxWrapperValue } from '@/lib/db/schema';
import {
  ASSET_CLASS_LABELS,
  ASSET_CLASS_ORDER,
  TAX_WRAPPER_LABELS,
  TAX_WRAPPER_ORDER,
  accountTypeMeta,
  type AssetClass,
} from '@/lib/accounts/types';
import { numericToPence } from '@/lib/money';

/**
 * Net worth and its three breakdowns.
 *
 * Pure functions over already-fetched rows: no database, no dates, no formatting. That
 * split is deliberate — the dashboard's correctness lives almost entirely in this file, and
 * it should be testable by handing it a list of accounts, not by standing up Postgres and
 * a React renderer.
 *
 * Every total is a `bigint` of pence, summed via the money module. Nothing here converts to
 * a float, so a breakdown always sums to exactly the same total as the hero figure — which
 * is asserted in the tests, because a breakdown that disagrees with the headline number by
 * a penny would quietly undermine trust in every other number on the page.
 */

/** The minimum shape the aggregation needs. `AccountWithBalance` satisfies it. */
export interface NetWorthAccount {
  id: number;
  name: string;
  type: AccountTypeValue;
  taxWrapper: TaxWrapperValue;
  personId: number | null;
  ownerName: string | null;
  /** Latest snapshot amount, or null when the account has no balance recorded yet. */
  latestAmount: string | null;
}

export type BreakdownMode = 'person' | 'asset' | 'wrapper';

export const BREAKDOWN_MODES: readonly { value: BreakdownMode; label: string }[] = [
  { value: 'person', label: 'By person' },
  { value: 'asset', label: 'By asset class' },
  { value: 'wrapper', label: 'By tax wrapper' },
];

export function isBreakdownMode(value: string): value is BreakdownMode {
  return BREAKDOWN_MODES.some((mode) => mode.value === value);
}

export interface BreakdownSlice {
  key: string;
  label: string;
  pence: bigint;
  /**
   * Share of the positive total, 0–1, for the stacked bar's segment widths. Negative
   * slices get a share of 0: a debt cannot occupy width in a bar of what the household
   * owns, but it still appears in the legend with its real (negative) figure. This mirrors
   * the mockup, which stacks only positives and lists everything.
   */
  share: number;
}

/**
 * An account's balance in pence. An account with no snapshot yet counts as zero.
 *
 * Zero rather than "excluded" matters for the account list: a newly-added account with no
 * balance should appear, showing nothing, rather than vanish until someone updates it.
 */
export function accountPence(account: NetWorthAccount): bigint {
  return account.latestAmount === null ? 0n : numericToPence(account.latestAmount);
}

/** Household net worth: a plain sum, because liabilities are already stored negative. */
export function netWorthPence(accounts: readonly NetWorthAccount[]): bigint {
  let total = 0n;
  for (const account of accounts) total += accountPence(account);
  return total;
}

function withShares(slices: Array<Omit<BreakdownSlice, 'share'>>): BreakdownSlice[] {
  const positiveTotal = slices.reduce((sum, slice) => (slice.pence > 0n ? sum + slice.pence : sum), 0n);
  return slices.map((slice) => ({
    ...slice,
    share:
      positiveTotal > 0n && slice.pence > 0n
        ? // Only place a ratio is taken, and the result is a bar width in percent — not a
          // figure anyone reads. Scaled through bigint first so the division happens on
          // small integers rather than on pence-sized ones.
          Number((slice.pence * 10_000n) / positiveTotal) / 10_000
        : 0,
  }));
}

export interface PersonRef {
  id: number;
  name: string;
}

/**
 * Breakdown by owner, with a "Joint" slice for accounts whose `person_id` is null.
 *
 * People keep their household ordering and Joint always comes last, so the legend doesn't
 * reshuffle when balances change — a breakdown whose rows move around between visits is
 * much harder to read than one that stays put.
 */
export function breakdownByPerson(
  accounts: readonly NetWorthAccount[],
  people: readonly PersonRef[],
): BreakdownSlice[] {
  const slices = people.map((person) => ({
    key: `person-${person.id}`,
    label: person.name,
    pence: netWorthPence(accounts.filter((account) => account.personId === person.id)),
  }));

  const joint = accounts.filter((account) => account.personId === null);
  if (joint.length > 0) {
    slices.push({ key: 'joint', label: 'Joint', pence: netWorthPence(joint) });
  }

  // A person with no accounts at all is dropped: an empty row teaches the reader nothing.
  // Joint is kept whenever any joint account exists, even at zero, because its absence
  // would otherwise be ambiguous with "we have no joint accounts".
  return withShares(slices.filter((slice) => slice.key === 'joint' || slice.pence !== 0n));
}

export function breakdownByAssetClass(accounts: readonly NetWorthAccount[]): BreakdownSlice[] {
  const totals = new Map<AssetClass, bigint>();
  for (const account of accounts) {
    const { assetClass } = accountTypeMeta(account.type);
    totals.set(assetClass, (totals.get(assetClass) ?? 0n) + accountPence(account));
  }

  return withShares(
    ASSET_CLASS_ORDER.filter((assetClass) => totals.has(assetClass)).map((assetClass) => ({
      key: `asset-${assetClass}`,
      label: ASSET_CLASS_LABELS[assetClass],
      pence: totals.get(assetClass) ?? 0n,
    })),
  );
}

export function breakdownByTaxWrapper(accounts: readonly NetWorthAccount[]): BreakdownSlice[] {
  const totals = new Map<TaxWrapperValue, bigint>();
  for (const account of accounts) {
    totals.set(account.taxWrapper, (totals.get(account.taxWrapper) ?? 0n) + accountPence(account));
  }

  return withShares(
    TAX_WRAPPER_ORDER.filter((wrapper) => totals.has(wrapper)).map((wrapper) => ({
      key: `wrapper-${wrapper}`,
      // "No wrapper" reads better than the badge's em dash in a legend, where there's no
      // column header to make an em dash meaningful.
      label: wrapper === 'none' ? 'No wrapper' : TAX_WRAPPER_LABELS[wrapper],
      pence: totals.get(wrapper) ?? 0n,
    })),
  );
}

export function breakdown(
  mode: BreakdownMode,
  accounts: readonly NetWorthAccount[],
  people: readonly PersonRef[],
): BreakdownSlice[] {
  switch (mode) {
    case 'person':
      return breakdownByPerson(accounts, people);
    case 'asset':
      return breakdownByAssetClass(accounts);
    case 'wrapper':
      return breakdownByTaxWrapper(accounts);
  }
}

export interface OwnerGroup {
  key: string;
  label: string;
  pence: bigint;
  accounts: NetWorthAccount[];
}

/**
 * Accounts grouped by owner for the ledger list, sorted by balance descending within each
 * group, per DESIGN_SPEC.md's Net Worth Dashboard and Accounts List specs.
 *
 * A joint account appears **once**, in the Joint group — explicitly not duplicated under
 * both people (the design spec's Accounts List edge case). That falls out of the schema
 * having one nullable owner column rather than a many-to-many, which is the other reason
 * that shape was the right one.
 */
export function groupAccountsByOwner(
  accounts: readonly NetWorthAccount[],
  people: readonly PersonRef[],
): OwnerGroup[] {
  const groups: OwnerGroup[] = people.map((person) => ({
    key: `person-${person.id}`,
    label: person.name,
    pence: 0n,
    accounts: accounts.filter((account) => account.personId === person.id),
  }));

  const joint = accounts.filter((account) => account.personId === null);
  if (joint.length > 0) {
    groups.push({ key: 'joint', label: 'Joint', pence: 0n, accounts: joint });
  }

  return groups
    .filter((group) => group.accounts.length > 0)
    .map((group) => ({
      ...group,
      pence: netWorthPence(group.accounts),
      accounts: [...group.accounts].sort((a, b) => {
        const difference = accountPence(b) - accountPence(a);
        // Comparators must return a number, and pence differences overflow nothing here —
        // but a bigint can't be returned, so it's reduced to a sign.
        if (difference > 0n) return 1;
        if (difference < 0n) return -1;
        return a.name.localeCompare(b.name);
      }),
    }));
}
