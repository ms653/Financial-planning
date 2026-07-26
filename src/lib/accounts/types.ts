import type { AccountTypeValue, TaxWrapperValue } from '@/lib/db/schema';

/**
 * Account-type metadata — the single place that knows what each of the eight account
 * types means to the UI.
 *
 * This exists because the type drives five separate behaviours, and having them derived
 * from one table rather than scattered across five `switch` statements is what stops a
 * future type (a Junior ISA, say) from being added correctly in four places and wrongly
 * in the fifth:
 *  - which tax wrapper the account gets (derived, never asked — see below)
 *  - which extra fields the Add/Edit form shows (debt terms, LISA note)
 *  - whether holdings are relevant (investment types only)
 *  - which asset class it rolls up into on the dashboard breakdown
 *  - whether its balance is a liability, and so stored negative
 *
 * **Tax wrapper is derived from the type, not entered by the user.** The proposal keeps
 * `tax_wrapper` as its own column because reporting reads it directly, but the mapping is
 * total and fixed — a Cash ISA is always an ISA wrapper — and DESIGN_SPEC.md's Add/Edit
 * Account form correspondingly lists no wrapper field. Asking would invite a Cash ISA
 * tagged `none`, which would then silently drop out of every wrapper-aware calculation
 * from Phase 4.5 onward.
 */

/** Roll-up categories for the dashboard's "By asset class" breakdown. */
export type AssetClass = 'pensions' | 'investments' | 'property' | 'cash' | 'debt';

export interface AccountTypeMeta {
  value: AccountTypeValue;
  /** Label used everywhere the type is shown, per the design spec's badge component. */
  label: string;
  /** One line for the type-picker grid — these are meaningfully different concepts. */
  blurb: string;
  /** Single letter for the compact badge/icon, matching the mockup's account rows. */
  initial: string;
  taxWrapper: TaxWrapperValue;
  assetClass: AssetClass;
  /** GIA/ISA/SIPP hold securities, so Account Detail shows a holdings table. */
  holdsSecurities: boolean;
  /** A liability: its balance is stored negative and it gets a `debt_terms` row. */
  isLiability: boolean;
}

/**
 * Ordered for the picker grid: everyday accounts first, then wrappers by how commonly a
 * UK household opens them, then the two that behave differently (property, debt) last.
 */
export const ACCOUNT_TYPES: readonly AccountTypeMeta[] = [
  {
    value: 'cash',
    label: 'Cash',
    blurb: 'Current account, savings, premium bonds',
    initial: 'C',
    taxWrapper: 'none',
    assetClass: 'cash',
    holdsSecurities: false,
    isLiability: false,
  },
  {
    value: 'cash_isa',
    label: 'Cash ISA',
    blurb: 'Tax-free savings',
    initial: 'C',
    taxWrapper: 'isa',
    assetClass: 'cash',
    holdsSecurities: false,
    isLiability: false,
  },
  {
    value: 'ss_isa',
    label: 'S&S ISA',
    blurb: 'Stocks and shares ISA',
    initial: 'S',
    taxWrapper: 'isa',
    assetClass: 'investments',
    holdsSecurities: true,
    isLiability: false,
  },
  {
    value: 'lisa',
    label: 'LISA',
    blurb: 'Lifetime ISA',
    initial: 'L',
    taxWrapper: 'isa',
    assetClass: 'investments',
    holdsSecurities: true,
    isLiability: false,
  },
  {
    value: 'sipp_pension',
    label: 'SIPP / Pension',
    blurb: 'SIPP or workplace pension',
    initial: 'P',
    taxWrapper: 'pension',
    assetClass: 'pensions',
    holdsSecurities: true,
    isLiability: false,
  },
  {
    value: 'gia',
    label: 'GIA',
    blurb: 'General investment account, unwrapped',
    initial: 'G',
    taxWrapper: 'gia',
    assetClass: 'investments',
    holdsSecurities: true,
    isLiability: false,
  },
  {
    value: 'property',
    label: 'Property',
    blurb: 'Home or buy-to-let, at estimated value',
    initial: 'H',
    taxWrapper: 'none',
    assetClass: 'property',
    holdsSecurities: false,
    isLiability: false,
  },
  {
    value: 'debt',
    label: 'Debt',
    blurb: 'Mortgage, loan or credit card',
    initial: 'D',
    taxWrapper: 'none',
    assetClass: 'debt',
    holdsSecurities: false,
    isLiability: true,
  },
];

const BY_VALUE = new Map<AccountTypeValue, AccountTypeMeta>(
  ACCOUNT_TYPES.map((meta) => [meta.value, meta]),
);

/**
 * Look up a type's metadata.
 *
 * Throws on an unknown type rather than returning a default. A `cash`-shaped fallback for
 * an unrecognised value would mean a mis-migrated account silently rendering as an asset
 * with no wrapper — wrong in the direction that inflates net worth.
 */
export function accountTypeMeta(type: AccountTypeValue): AccountTypeMeta {
  const meta = BY_VALUE.get(type);
  if (!meta) throw new Error(`Unknown account type: ${type}`);
  return meta;
}

export function taxWrapperForType(type: AccountTypeValue): TaxWrapperValue {
  return accountTypeMeta(type).taxWrapper;
}

export function isLiabilityType(type: AccountTypeValue): boolean {
  return accountTypeMeta(type).isLiability;
}

export function holdsSecurities(type: AccountTypeValue): boolean {
  return accountTypeMeta(type).holdsSecurities;
}

/** Human label for a wrapper badge. `none` renders as an em dash, as in the mockup. */
export const TAX_WRAPPER_LABELS: Record<TaxWrapperValue, string> = {
  isa: 'ISA',
  pension: 'Pension',
  gia: 'GIA',
  none: '—',
};

/**
 * Asset-class labels for the breakdown legend.
 *
 * Deliberately *not* the mockup's "Property equity" wording. The mockup nets the mortgage
 * off the property value for that row and then also lists the mortgage as its own row,
 * which double-counts — its figures don't sum to its own hero total. Showing property at
 * gross value with debt as a separate negative class means the breakdown always sums
 * exactly to net worth, which is a property worth being able to assert in a test.
 */
export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  pensions: 'Pensions',
  investments: 'Investments (ISA/GIA)',
  property: 'Property',
  cash: 'Cash',
  debt: 'Debt',
};

/** Display order for breakdown rows: largest-typical-holding first, debt last. */
export const ASSET_CLASS_ORDER: readonly AssetClass[] = [
  'pensions',
  'investments',
  'property',
  'cash',
  'debt',
];

export const TAX_WRAPPER_ORDER: readonly TaxWrapperValue[] = ['pension', 'isa', 'gia', 'none'];

/**
 * The LISA note from DESIGN_SPEC.md's Add/Edit Account spec: "an inline note explaining
 * the £4,000/year sub-limit and 25% bonus (brief, one line, not a wall of text) so the
 * distinct type feels justified rather than arbitrary."
 */
export const LISA_NOTE =
  'A LISA has its own £4,000 yearly limit inside your £20,000 ISA allowance, and the government adds a 25% bonus on what you pay in.';
