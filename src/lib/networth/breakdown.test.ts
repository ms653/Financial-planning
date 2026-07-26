import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_MODES,
  accountPence,
  breakdown,
  breakdownByAssetClass,
  breakdownByPerson,
  breakdownByTaxWrapper,
  groupAccountsByOwner,
  isBreakdownMode,
  netWorthPence,
  type NetWorthAccount,
} from '@/lib/networth/breakdown';
import { formatMoney, penceToNumeric } from '@/lib/money';

/**
 * The household in these tests mirrors the mockup's example: two people with pensions and
 * ISAs, plus a joint current account, a jointly-owned house and a joint mortgage. It's the
 * shape the proposal calls a UK norm, so it's the shape worth testing against.
 */
const ALEX = { id: 1, name: 'Alex' };
const JORDAN = { id: 2, name: 'Jordan' };
const PEOPLE = [ALEX, JORDAN];

function account(overrides: Partial<NetWorthAccount> & { id: number }): NetWorthAccount {
  return {
    name: `Account ${overrides.id}`,
    type: 'cash',
    taxWrapper: 'none',
    personId: null,
    ownerName: null,
    latestAmount: '0.00',
    ...overrides,
  };
}

const HOUSEHOLD: NetWorthAccount[] = [
  account({ id: 1, name: 'Vanguard SIPP', type: 'sipp_pension', taxWrapper: 'pension', personId: 1, ownerName: 'Alex', latestAmount: '186420.00' }),
  account({ id: 2, name: 'Vanguard S&S ISA', type: 'ss_isa', taxWrapper: 'isa', personId: 1, ownerName: 'Alex', latestAmount: '54110.00' }),
  account({ id: 3, name: 'Cash ISA', type: 'cash_isa', taxWrapper: 'isa', personId: 1, ownerName: 'Alex', latestAmount: '11300.00' }),
  account({ id: 4, name: 'Workplace pension', type: 'sipp_pension', taxWrapper: 'pension', personId: 2, ownerName: 'Jordan', latestAmount: '97860.00' }),
  account({ id: 5, name: 'Freetrade S&S ISA', type: 'ss_isa', taxWrapper: 'isa', personId: 2, ownerName: 'Jordan', latestAmount: '22940.00' }),
  account({ id: 6, name: 'Joint current account', type: 'cash', taxWrapper: 'none', personId: null, latestAmount: '6180.00' }),
  account({ id: 7, name: 'Home — 14 Elm Grove', type: 'property', taxWrapper: 'none', personId: null, latestAmount: '410000.00' }),
  account({ id: 8, name: 'Mortgage — 14 Elm Grove', type: 'debt', taxWrapper: 'none', personId: null, latestAmount: '-376500.00' }),
];

describe('netWorthPence', () => {
  it('nets liabilities against assets', () => {
    expect(penceToNumeric(netWorthPence(HOUSEHOLD))).toBe('412310.00');
  });

  it('is zero for no accounts', () => {
    expect(netWorthPence([])).toBe(0n);
  });

  it('treats an account with no snapshot yet as zero rather than excluding it', () => {
    const withUnpriced = [...HOUSEHOLD, account({ id: 9, latestAmount: null })];
    expect(netWorthPence(withUnpriced)).toBe(netWorthPence(HOUSEHOLD));
    expect(accountPence(account({ id: 9, latestAmount: null }))).toBe(0n);
  });

  it('can be negative for a mortgage-heavy household', () => {
    const earlyDays = [
      account({ id: 1, type: 'property', latestAmount: '300000.00' }),
      account({ id: 2, type: 'debt', latestAmount: '-320000.00' }),
    ];
    expect(penceToNumeric(netWorthPence(earlyDays))).toBe('-20000.00');
    expect(formatMoney(netWorthPence(earlyDays), { parentheses: true })).toBe('(£20,000)');
  });
});

describe('breakdownByPerson', () => {
  it('groups by owner and puts Joint last', () => {
    const slices = breakdownByPerson(HOUSEHOLD, PEOPLE);
    expect(slices.map((slice) => slice.label)).toEqual(['Alex', 'Jordan', 'Joint']);
  });

  it('totals each person’s accounts', () => {
    const slices = breakdownByPerson(HOUSEHOLD, PEOPLE);
    expect(penceToNumeric(slices[0]!.pence)).toBe('251830.00');
    expect(penceToNumeric(slices[1]!.pence)).toBe('120800.00');
    // Joint: 6,180 + 410,000 − 376,500
    expect(penceToNumeric(slices[2]!.pence)).toBe('39680.00');
  });

  it('drops a person with no accounts but keeps an existing Joint group at zero', () => {
    const withNewcomer = breakdownByPerson(HOUSEHOLD, [...PEOPLE, { id: 3, name: 'Newcomer' }]);
    expect(withNewcomer.map((slice) => slice.label)).not.toContain('Newcomer');

    const balancedJoint = [
      account({ id: 1, personId: 1, latestAmount: '100.00' }),
      account({ id: 2, type: 'property', latestAmount: '1000.00' }),
      account({ id: 3, type: 'debt', latestAmount: '-1000.00' }),
    ];
    const slices = breakdownByPerson(balancedJoint, [ALEX]);
    expect(slices.map((slice) => slice.label)).toEqual(['Alex', 'Joint']);
    expect(slices[1]!.pence).toBe(0n);
  });

  it('has no Joint slice when nothing is jointly owned', () => {
    const soleOwner = [account({ id: 1, personId: 1, latestAmount: '100.00' })];
    expect(breakdownByPerson(soleOwner, [ALEX]).map((s) => s.label)).toEqual(['Alex']);
  });
});

describe('breakdownByAssetClass', () => {
  it('rolls account types up into asset classes in a fixed order', () => {
    const slices = breakdownByAssetClass(HOUSEHOLD);
    expect(slices.map((slice) => slice.label)).toEqual([
      'Pensions',
      'Investments (ISA/GIA)',
      'Property',
      'Cash',
      'Debt',
    ]);
  });

  it('counts a Cash ISA as cash and an S&S ISA as investments', () => {
    // The reason the ISA sub-types are distinct types rather than one generic isa.
    const slices = breakdownByAssetClass(HOUSEHOLD);
    const byLabel = Object.fromEntries(slices.map((slice) => [slice.label, slice.pence]));
    expect(penceToNumeric(byLabel.Cash!)).toBe('17480.00'); // 6,180 joint + 11,300 cash ISA
    expect(penceToNumeric(byLabel['Investments (ISA/GIA)']!)).toBe('77050.00'); // 54,110 + 22,940
    expect(penceToNumeric(byLabel.Pensions!)).toBe('284280.00');
  });

  it('shows property gross and debt separately, so the classes sum to net worth', () => {
    const slices = breakdownByAssetClass(HOUSEHOLD);
    const byLabel = Object.fromEntries(slices.map((slice) => [slice.label, slice.pence]));
    expect(penceToNumeric(byLabel.Property!)).toBe('410000.00');
    expect(penceToNumeric(byLabel.Debt!)).toBe('-376500.00');
  });
});

describe('breakdownByTaxWrapper', () => {
  it('groups by wrapper with pensions first and no-wrapper last', () => {
    const slices = breakdownByTaxWrapper(HOUSEHOLD);
    expect(slices.map((slice) => slice.label)).toEqual(['Pension', 'ISA', 'No wrapper']);
  });

  it('adds all three ISA sub-types into one ISA wrapper total', () => {
    const slices = breakdownByTaxWrapper(HOUSEHOLD);
    const isa = slices.find((slice) => slice.label === 'ISA')!;
    // 54,110 + 11,300 + 22,940 — the sub-types roll up here even though they're
    // distinct account types, which is exactly why both concepts exist.
    expect(penceToNumeric(isa.pence)).toBe('88350.00');
  });

  it('includes a GIA as its own wrapper', () => {
    const withGia = [...HOUSEHOLD, account({ id: 9, type: 'gia', taxWrapper: 'gia', personId: 1, latestAmount: '5000.00' })];
    expect(breakdownByTaxWrapper(withGia).map((slice) => slice.label)).toEqual([
      'Pension',
      'ISA',
      'GIA',
      'No wrapper',
    ]);
  });
});

describe('every breakdown sums to the hero figure', () => {
  // The property that matters most on this screen: if a breakdown disagreed with the
  // headline total by even a penny, every other number on the page becomes suspect.
  const total = netWorthPence(HOUSEHOLD);

  it.each(BREAKDOWN_MODES.map((mode) => mode.value))('mode %s', (mode) => {
    const slices = breakdown(mode, HOUSEHOLD, PEOPLE);
    const sum = slices.reduce((accumulated, slice) => accumulated + slice.pence, 0n);
    expect(penceToNumeric(sum)).toBe(penceToNumeric(total));
  });

  it('holds for a household with only debt', () => {
    const debtOnly = [account({ id: 1, type: 'debt', personId: 1, latestAmount: '-15000.00' })];
    for (const { value } of BREAKDOWN_MODES) {
      const sum = breakdown(value, debtOnly, [ALEX]).reduce((a, s) => a + s.pence, 0n);
      expect(penceToNumeric(sum)).toBe('-15000.00');
    }
  });

  it('holds for an empty household', () => {
    for (const { value } of BREAKDOWN_MODES) {
      expect(breakdown(value, [], PEOPLE)).toEqual([]);
    }
  });
});

describe('stacked bar shares', () => {
  it('gives positive slices a share of the positive total and negatives zero', () => {
    // The mockup stacks only positives and lists everything in the legend.
    const slices = breakdownByAssetClass(HOUSEHOLD);
    const debt = slices.find((slice) => slice.label === 'Debt')!;
    expect(debt.share).toBe(0);

    const positiveShare = slices
      .filter((slice) => slice.pence > 0n)
      .reduce((sum, slice) => sum + slice.share, 0);
    expect(positiveShare).toBeCloseTo(1, 3);
  });

  it('does not divide by zero when everything is zero or negative', () => {
    const slices = breakdownByAssetClass([account({ id: 1, type: 'debt', latestAmount: '-100.00' })]);
    expect(slices[0]!.share).toBe(0);
    expect(Number.isFinite(slices[0]!.share)).toBe(true);
  });
});

describe('groupAccountsByOwner', () => {
  it('lists a joint account once, in the Joint group', () => {
    // DESIGN_SPEC.md: "Joint accounts: shown once, in the 'Joint' group, not duplicated
    // under both people."
    const groups = groupAccountsByOwner(HOUSEHOLD, PEOPLE);
    const appearances = groups.flatMap((group) => group.accounts).filter((a) => a.id === 6);
    expect(appearances).toHaveLength(1);
    expect(groups.find((group) => group.accounts.some((a) => a.id === 6))!.label).toBe('Joint');
  });

  it('sorts by balance descending within a group', () => {
    const groups = groupAccountsByOwner(HOUSEHOLD, PEOPLE);
    const alex = groups.find((group) => group.label === 'Alex')!;
    expect(alex.accounts.map((a) => a.name)).toEqual([
      'Vanguard SIPP',
      'Vanguard S&S ISA',
      'Cash ISA',
    ]);
  });

  it('puts a debt last within its group, since it sorts below every asset', () => {
    const groups = groupAccountsByOwner(HOUSEHOLD, PEOPLE);
    const joint = groups.find((group) => group.label === 'Joint')!;
    expect(joint.accounts.map((a) => a.name)).toEqual([
      'Home — 14 Elm Grove',
      'Joint current account',
      'Mortgage — 14 Elm Grove',
    ]);
  });

  it('breaks ties by name so the order is stable between renders', () => {
    const tied = [
      account({ id: 1, name: 'Zebra', personId: 1, latestAmount: '100.00' }),
      account({ id: 2, name: 'Aardvark', personId: 1, latestAmount: '100.00' }),
    ];
    expect(groupAccountsByOwner(tied, [ALEX])[0]!.accounts.map((a) => a.name)).toEqual([
      'Aardvark',
      'Zebra',
    ]);
  });

  it('omits people with no accounts', () => {
    const groups = groupAccountsByOwner(
      [account({ id: 1, personId: 1, latestAmount: '1.00' })],
      PEOPLE,
    );
    expect(groups.map((group) => group.label)).toEqual(['Alex']);
  });

  it('totals each group', () => {
    const groups = groupAccountsByOwner(HOUSEHOLD, PEOPLE);
    expect(penceToNumeric(groups.find((g) => g.label === 'Joint')!.pence)).toBe('39680.00');
  });
});

describe('isBreakdownMode', () => {
  it('accepts the three modes and rejects anything else', () => {
    expect(isBreakdownMode('person')).toBe(true);
    expect(isBreakdownMode('asset')).toBe(true);
    expect(isBreakdownMode('wrapper')).toBe(true);
    expect(isBreakdownMode('by-person')).toBe(false);
    expect(isBreakdownMode('')).toBe(false);
  });
});
