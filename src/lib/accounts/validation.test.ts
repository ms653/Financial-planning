import { describe, expect, it } from 'vitest';
import {
  OVERPAYMENT_BASIS_LABELS,
  PENSION_METHOD_LABELS,
  parseIsoDate,
  resolveOwnership,
  todayIso,
  validateAccountCreate,
  validateAccountEdit,
  validateBalanceUpdate,
  validateHolding,
  validateHouseholdName,
  validatePensionContribution,
  validatePerson,
} from '@/lib/accounts/validation';
import { ACCOUNT_TYPES, accountTypeMeta, taxWrapperForType } from '@/lib/accounts/types';
import { accountType, overpaymentAllowanceBasis, pensionContributionMethod } from '@/lib/db/schema';

/** Fixed "now" so future-date rules are deterministic rather than dependent on the clock. */
const NOW = new Date('2026-07-26T12:00:00Z');

const validAccount = {
  name: 'Vanguard S&S ISA',
  type: 'ss_isa',
  ownerIds: ['1'],
  openingBalance: '54110.00',
  asOfDate: '2026-07-26',
};

describe('account type metadata', () => {
  it('covers every enum value in the schema exactly once', () => {
    // Guards the failure mode where a type is added to the database enum and the UI
    // silently has no label, icon or asset class for it.
    expect(ACCOUNT_TYPES.map((meta) => meta.value).sort()).toEqual(
      [...accountType.enumValues].sort(),
    );
  });

  it('derives the tax wrapper from the type, keeping the ISA sub-types distinct', () => {
    expect(taxWrapperForType('cash_isa')).toBe('isa');
    expect(taxWrapperForType('ss_isa')).toBe('isa');
    expect(taxWrapperForType('lisa')).toBe('isa');
    expect(taxWrapperForType('sipp_pension')).toBe('pension');
    expect(taxWrapperForType('gia')).toBe('gia');
    expect(taxWrapperForType('cash')).toBe('none');
    expect(taxWrapperForType('property')).toBe('none');
    expect(taxWrapperForType('debt')).toBe('none');
  });

  it('treats the three ISA sub-types as separate account types, not one generic ISA', () => {
    // PROPOSAL.md §11: the 2027 cash-ISA cap, the transfer bar and the 22% charge on
    // uninvested cash in an S&S ISA all need the sub-type. Collapsing them would be
    // unrecoverable, so this asserts they stay distinct.
    const isaTypes = ACCOUNT_TYPES.filter((meta) => meta.taxWrapper === 'isa');
    expect(isaTypes.map((meta) => meta.value)).toEqual(['cash_isa', 'ss_isa', 'lisa']);
    expect(new Set(isaTypes.map((meta) => meta.assetClass)).size).toBeGreaterThan(1);
  });

  it('marks only debt as a liability', () => {
    const liabilities = ACCOUNT_TYPES.filter((meta) => meta.isLiability).map((m) => m.value);
    expect(liabilities).toEqual(['debt']);
  });

  it('marks exactly the security-holding types as holding securities', () => {
    const holders = ACCOUNT_TYPES.filter((meta) => meta.holdsSecurities).map((m) => m.value);
    expect(holders.sort()).toEqual(['gia', 'lisa', 'sipp_pension', 'ss_isa']);
  });

  it('throws on an unknown type rather than defaulting to an asset', () => {
    // @ts-expect-error deliberately invalid, simulating a bad database row
    expect(() => accountTypeMeta('crypto')).toThrow(/Unknown account type/);
  });
});

describe('parseIsoDate', () => {
  it('accepts real dates', () => {
    expect(parseIsoDate('2026-07-26')?.toISOString()).toBe('2026-07-26T00:00:00.000Z');
    expect(parseIsoDate('2024-02-29')).not.toBeNull(); // leap year
  });

  it('rejects dates that JS would silently roll over', () => {
    // new Date('2025-02-30') is 2 March. Accepting it would land a snapshot on the wrong
    // day, breaking (account_id, snapshot_date) idempotency in a way nobody would notice.
    expect(parseIsoDate('2025-02-30')).toBeNull();
    expect(parseIsoDate('2025-13-01')).toBeNull();
    expect(parseIsoDate('2023-02-29')).toBeNull();
  });

  it('rejects other formats', () => {
    expect(parseIsoDate('26/07/2026')).toBeNull();
    expect(parseIsoDate('2026-7-6')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });
});

describe('resolveOwnership', () => {
  it('maps one selected person to that person', () => {
    expect(resolveOwnership([3])).toBe(3);
  });

  it('maps two or more selected people to a joint (null) owner', () => {
    // The nullable person_id / household-fallback case the proposal calls a UK norm.
    expect(resolveOwnership([1, 2])).toBeNull();
    expect(resolveOwnership([1, 2, 3])).toBeNull();
  });

  it('maps nothing selected to null, but validation rejects that case separately', () => {
    expect(resolveOwnership([])).toBeNull();
  });
});

describe('validateAccountCreate', () => {
  it('accepts a well-formed account', () => {
    const result = validateAccountCreate(validAccount, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('Vanguard S&S ISA');
    expect(result.value.type).toBe('ss_isa');
    expect(result.value.personId).toBe(1);
    expect(result.value.openingBalance).toBe('54110.00');
    expect(result.value.debtTerms).toBeNull();
  });

  it('requires an explicit owner rather than defaulting to the first person', () => {
    const result = validateAccountCreate({ ...validAccount, ownerIds: [] }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.ownerIds).toBe('Choose who owns this account.');
  });

  it('treats more than one selected owner as a joint account', () => {
    const result = validateAccountCreate({ ...validAccount, ownerIds: ['1', '2'] }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.personId).toBeNull();
    expect(result.value.ownerIds).toEqual([1, 2]);
  });

  it('rejects a negative balance on a non-debt account with the spec’s copy', () => {
    const result = validateAccountCreate({ ...validAccount, openingBalance: '-100' }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.openingBalance).toBe('Balance can’t be negative for this account type');
  });

  it('stores a debt balance negative from a positive "amount outstanding" entry', () => {
    // The correctness trap: a user types 376500 for a mortgage. If that landed as +£376,500
    // the household's net worth would be overstated by twice the mortgage.
    const result = validateAccountCreate(
      { ...validAccount, name: 'Mortgage', type: 'debt', openingBalance: '376500' },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.openingBalance).toBe('-376500.00');
  });

  it('rejects a negative entry on a debt account rather than double-negating it', () => {
    const result = validateAccountCreate(
      { ...validAccount, type: 'debt', openingBalance: '-376500' },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.openingBalance).toBe('Enter the amount outstanding as a positive number.');
  });

  it('rejects a future as-of date', () => {
    const result = validateAccountCreate({ ...validAccount, asOfDate: '2026-07-27' }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.asOfDate).toBe('That date is in the future.');
  });

  it('accepts today and past dates', () => {
    expect(validateAccountCreate({ ...validAccount, asOfDate: '2026-07-26' }, NOW).ok).toBe(true);
    expect(validateAccountCreate({ ...validAccount, asOfDate: '2019-01-01' }, NOW).ok).toBe(true);
  });

  it('requires a name and a type', () => {
    const result = validateAccountCreate({ ...validAccount, name: '  ', type: '' }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe('Give this account a name.');
    expect(result.errors.type).toBe('Choose an account type.');
  });

  it('reports every bad field at once, not just the first', () => {
    // The form shows inline errors per field, so partial validation would leave a user
    // fixing one problem at a time.
    const result = validateAccountCreate(
      { name: '', type: 'nonsense', ownerIds: [], openingBalance: 'abc', asOfDate: 'nope' },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      'asOfDate',
      'name',
      'openingBalance',
      'ownerIds',
      'type',
    ]);
  });

  describe('conditional debt fields', () => {
    const debtBase = { ...validAccount, name: 'Mortgage', type: 'debt', openingBalance: '376500' };

    it('ignores debt fields entirely for non-debt types', () => {
      const result = validateAccountCreate(
        { ...validAccount, interestRate: '4.25', minimumPayment: '1450' },
        NOW,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.debtTerms).toBeNull();
    });

    it('accepts a debt account with no terms at all — they are deferrable', () => {
      const result = validateAccountCreate(debtBase, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.debtTerms).toEqual({
        interestRate: null,
        minimumPayment: null,
        overpaymentAllowancePct: null,
        overpaymentAllowanceBalanceBasis: null,
        ercRatePct: null,
        ercPeriodEnd: null,
      });
    });

    it('keeps the overpayment allowance and the ERC rate as separate values', () => {
      // These were conflated as one "erc_limit" field in an earlier draft of the proposal
      // and split after review. This asserts they don't get recombined.
      const result = validateAccountCreate(
        {
          ...debtBase,
          interestRate: '4.25',
          minimumPayment: '1450',
          overpaymentAllowancePct: '10',
          overpaymentAllowanceBalanceBasis: 'annual_opening_balance',
          ercRatePct: '3',
          ercPeriodEnd: '2028-06-30',
        },
        NOW,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.debtTerms).toEqual({
        interestRate: '4.25',
        minimumPayment: '1450.00',
        overpaymentAllowancePct: '10',
        overpaymentAllowanceBalanceBasis: 'annual_opening_balance',
        ercRatePct: '3',
        ercPeriodEnd: '2028-06-30',
      });
    });

    it('requires a basis when an overpayment allowance percentage is given', () => {
      const result = validateAccountCreate({ ...debtBase, overpaymentAllowancePct: '10' }, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.overpaymentAllowanceBalanceBasis).toBe(
        'Choose what that percentage applies to.',
      );
    });

    it('rejects a rate that looks like a misplaced decimal point', () => {
      const result = validateAccountCreate({ ...debtBase, interestRate: '425' }, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.interestRate).toBe('Enter a rate between 0 and 100.');
    });

    it('accepts a percentage typed with a % sign', () => {
      const result = validateAccountCreate({ ...debtBase, interestRate: '4.25%' }, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.debtTerms?.interestRate).toBe('4.25');
    });

    it('accepts an ERC period end in the past — an expired period is meaningful', () => {
      const result = validateAccountCreate({ ...debtBase, ercPeriodEnd: '2020-01-01' }, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.debtTerms?.ercPeriodEnd).toBe('2020-01-01');
    });

    it('covers every basis enum value with a label', () => {
      expect(Object.keys(OVERPAYMENT_BASIS_LABELS).sort()).toEqual(
        [...overpaymentAllowanceBasis.enumValues].sort(),
      );
    });
  });
});

describe('validateAccountEdit', () => {
  it('accepts a change of owner and type without a balance', () => {
    const result = validateAccountEdit({ name: 'Cash ISA', type: 'cash_isa', ownerIds: ['2'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.personId).toBe(2);
  });

  it('does not accept or require balance fields — those go through Update balance', () => {
    const result = validateAccountEdit({ name: 'Cash ISA', type: 'cash_isa', ownerIds: ['2'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty('openingBalance');
  });

  it('still validates debt terms when the type is debt', () => {
    const result = validateAccountEdit({
      name: 'Mortgage',
      type: 'debt',
      ownerIds: ['1', '2'],
      interestRate: '999',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.interestRate).toBeDefined();
  });
});

describe('validateBalanceUpdate', () => {
  it('accepts a balance for an asset account', () => {
    const result = validateBalanceUpdate({ amount: '12500.50', snapshotDate: '2026-07-26' }, 'cash', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ amount: '12500.50', snapshotDate: '2026-07-26' });
  });

  it('rejects a negative balance for an asset account with the spec’s copy', () => {
    const result = validateBalanceUpdate({ amount: '-1', snapshotDate: '2026-07-26' }, 'cash', NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.amount).toBe('Balance can’t be negative for this account type');
  });

  it('negates a debt balance so paying down moves net worth up', () => {
    const result = validateBalanceUpdate({ amount: '374000', snapshotDate: '2026-07-26' }, 'debt', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toBe('-374000.00');
  });

  it('accepts a zero balance — a cleared debt or an emptied account', () => {
    expect(validateBalanceUpdate({ amount: '0', snapshotDate: '2026-07-26' }, 'debt', NOW).ok).toBe(true);
    expect(validateBalanceUpdate({ amount: '0', snapshotDate: '2026-07-26' }, 'cash', NOW).ok).toBe(true);
  });

  it('rejects a future snapshot date', () => {
    const result = validateBalanceUpdate({ amount: '100', snapshotDate: '2030-01-01' }, 'cash', NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.snapshotDate).toBe('That date is in the future.');
  });

  it('rejects a non-numeric amount instead of coercing it', () => {
    const result = validateBalanceUpdate({ amount: 'twelve thousand', snapshotDate: '2026-07-26' }, 'cash', NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.amount).toBe('Enter an amount like 12500.');
  });
});

describe('validatePerson', () => {
  it('accepts a name and date of birth, with income optional', () => {
    const result = validatePerson({ name: 'Alex', dateOfBirth: '1985-04-12' }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      name: 'Alex',
      dateOfBirth: '1985-04-12',
      annualGrossIncome: null,
    });
  });

  it('requires a date of birth', () => {
    const result = validatePerson({ name: 'Alex' }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.dateOfBirth).toContain('State Pension age');
  });

  it('rejects a future or implausible date of birth', () => {
    expect(validatePerson({ name: 'A', dateOfBirth: '2030-01-01' }, NOW).ok).toBe(false);
    expect(validatePerson({ name: 'A', dateOfBirth: '1850-01-01' }, NOW).ok).toBe(false);
  });

  it('records income as a NUMERIC string when given', () => {
    const result = validatePerson(
      { name: 'Alex', dateOfBirth: '1985-04-12', annualGrossIncome: '£62,000' },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.annualGrossIncome).toBe('62000.00');
  });

  it('keeps a blank income as null rather than zero', () => {
    // A 0 would tell Phase 4.5's tax-band derivation "earns nothing", which is a claim;
    // null says "not entered", which is the truth.
    const result = validatePerson(
      { name: 'Alex', dateOfBirth: '1985-04-12', annualGrossIncome: '  ' },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.annualGrossIncome).toBeNull();
  });
});

describe('validatePensionContribution', () => {
  it('accepts amount, method and employer amount', () => {
    const result = validatePensionContribution({
      amount: '4800',
      method: 'salary_sacrifice',
      employerAmount: '3200',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      amount: '4800.00',
      method: 'salary_sacrifice',
      employerAmount: '3200.00',
    });
  });

  it('requires the method, with no default', () => {
    const result = validatePensionContribution({ amount: '4800', employerAmount: '0' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.method).toBe('Choose how this contribution is made.');
  });

  it('rejects a method outside the enum', () => {
    const result = validatePensionContribution({
      amount: '4800',
      method: 'salary_exchange',
      employerAmount: '0',
    });
    expect(result.ok).toBe(false);
  });

  it('requires an explicit employer amount, accepting 0', () => {
    const missing = validatePensionContribution({ amount: '4800', method: 'net_pay' });
    expect(missing.ok).toBe(false);

    const zero = validatePensionContribution({
      amount: '4800',
      method: 'net_pay',
      employerAmount: '0',
    });
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.value.employerAmount).toBe('0.00');
  });

  it('covers every method enum value with a label', () => {
    expect(Object.keys(PENSION_METHOD_LABELS).sort()).toEqual(
      [...pensionContributionMethod.enumValues].sort(),
    );
  });
});

describe('validateHolding', () => {
  it('accepts a fractional quantity and upper-cases the ticker', () => {
    const result = validateHolding({ ticker: 'vwrl', quantity: '12.5', costBasis: '1200' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ ticker: 'VWRL', quantity: '12.5', costBasis: '1200.00' });
  });

  it('rejects a zero quantity', () => {
    const result = validateHolding({ ticker: 'VWRL', quantity: '0', costBasis: '1200' });
    expect(result.ok).toBe(false);
  });

  it('rejects more precision than NUMERIC(18,6) holds', () => {
    const result = validateHolding({ ticker: 'VWRL', quantity: '1.1234567', costBasis: '1200' });
    expect(result.ok).toBe(false);
  });
});

describe('validateHouseholdName', () => {
  it('requires a name', () => {
    expect(validateHouseholdName({ name: '' }).ok).toBe(false);
    expect(validateHouseholdName({ name: 'The Strutton household' }).ok).toBe(true);
  });
});

describe('todayIso', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayIso(NOW)).toBe('2026-07-26');
  });
});
