import { describe, expect, it } from 'vitest';
import { compareDebtVsSave, type DebtComparatorDebtInput, type DebtComparatorInput } from './debtComparator';
import type { PersonWaterfallInput } from './waterfall';

const TODAY = '2026-08-03';

function person(overrides: Partial<PersonWaterfallInput> = {}): PersonWaterfallInput {
  return {
    personId: 1,
    name: 'Alex',
    // 41 on TODAY: past the 18–39 open window, but the "already has one, can keep
    // contributing to 50" tier applies since hasExistingLisa is true below.
    dateOfBirth: '1985-04-12',
    grossIncomePence: 60_000_00n,
    pensionContributions: [],
    hasFlexiblyAccessedPension: false,
    hasExistingLisa: true,
    isaUsedPence: 0n,
    lisaUsedPence: 0n,
    ...overrides,
  };
}

function debt(overrides: Partial<DebtComparatorDebtInput> = {}): DebtComparatorDebtInput {
  return {
    accountId: 1,
    name: 'Mortgage',
    personId: 1,
    balancePence: 300_000_00n,
    interestRatePct: '4.250',
    overpaymentAllowancePct: '10.000',
    overpaymentAllowanceBalanceBasis: 'current_balance',
    ercRatePct: '2.000',
    ercPeriodEnd: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<DebtComparatorInput> = {}): DebtComparatorInput {
  return {
    todayIso: TODAY,
    extraAmountPence: 1_000_00n,
    debtBenchmarkRatePct: '5.500',
    householdOwnsProperty: false,
    debts: [],
    people: [],
    ...overrides,
  };
}

describe('compareDebtVsSave', () => {
  it('excludes a debt whose rate beats the benchmark — that is the waterfall’s territory', () => {
    const result = compareDebtVsSave(
      baseInput({ debts: [debt({ interestRatePct: '24.900' })], people: [person()] }),
    );
    expect(result.comparable).toHaveLength(0);
    expect(result.uncomparable).toHaveLength(0);
  });

  it('hand-computed regression: £300,000 at 4.25%, 10% allowance on current balance, £1,000 considered', () => {
    const result = compareDebtVsSave(baseInput({ debts: [debt()], people: [person()] }));
    expect(result.comparable).toHaveLength(1);
    const [row] = result.comparable;
    expect(row).toMatchObject({
      penaltyFreeAllowancePence: 30_000_00n,
      penaltyFreeAllowanceApproximated: false,
      withinAllowancePence: 1_000_00n,
      aboveAllowancePence: 0n,
      ercCostPence: 0n,
      ercStillApplies: true,
    });
    const lisa = row!.investingOptions.find((o) => o.id === 'lisa');
    const pension = row!.investingOptions.find((o) => o.id === 'pension_ras');
    // (1,000 * 5/4) - 1,000 = 250 — the flat 25% top-up, hand-verified.
    expect(lisa?.oneOffBonusPence).toBe(25_000n);
    expect(pension?.oneOffBonusPence).toBe(25_000n);
  });

  it('hand-computed regression: £40,000 considered exceeds the £30,000 allowance, costing ERC on the excess', () => {
    const result = compareDebtVsSave(
      baseInput({ extraAmountPence: 40_000_00n, debts: [debt()], people: [person()] }),
    );
    const [row] = result.comparable;
    expect(row).toMatchObject({
      penaltyFreeAllowancePence: 30_000_00n,
      withinAllowancePence: 30_000_00n,
      aboveAllowancePence: 10_000_00n,
      // 10,000 * 2.000% = 200 — hand-verified.
      ercCostPence: 20_000n,
      ercStillApplies: true,
    });
  });

  it('treats the amount above the allowance as penalty-free once the ERC period has lapsed', () => {
    const result = compareDebtVsSave(
      baseInput({
        extraAmountPence: 40_000_00n,
        debts: [debt({ ercPeriodEnd: '2020-01-01' })],
        people: [person()],
      }),
    );
    const [row] = result.comparable;
    expect(row?.ercStillApplies).toBe(false);
    expect(row?.ercCostPence).toBe(0n);
    expect(row?.warnings.some((w) => w.includes('ended on 2020-01-01'))).toBe(true);
  });

  it('reports the allowance and ERC as unknown, not zero, when no allowance percentage is on file', () => {
    const result = compareDebtVsSave(
      baseInput({ debts: [debt({ overpaymentAllowancePct: null })], people: [person()] }),
    );
    const [row] = result.comparable;
    expect(row?.penaltyFreeAllowancePence).toBeNull();
    expect(row?.withinAllowancePence).toBeNull();
    expect(row?.aboveAllowancePence).toBeNull();
    expect(row?.ercCostPence).toBeNull();
    expect(row?.warnings.some((w) => w.includes('no penalty-free overpayment allowance'))).toBe(true);
  });

  it('flags an approximated allowance when the basis is not the current balance', () => {
    const result = compareDebtVsSave(
      baseInput({
        debts: [debt({ overpaymentAllowanceBalanceBasis: 'original_balance' })],
        people: [person()],
      }),
    );
    const [row] = result.comparable;
    expect(row?.penaltyFreeAllowanceApproximated).toBe(true);
    expect(row?.warnings.some((w) => w.includes('original_balance'))).toBe(true);
  });

  it('reports an unknown ERC cost, not zero, when the excess has no rate on file', () => {
    const result = compareDebtVsSave(
      baseInput({
        extraAmountPence: 40_000_00n,
        debts: [debt({ ercRatePct: null })],
        people: [person()],
      }),
    );
    const [row] = result.comparable;
    expect(row?.aboveAllowancePence).toBe(10_000_00n);
    expect(row?.ercCostPence).toBeNull();
    expect(row?.warnings.some((w) => w.includes('no early-repayment-charge rate'))).toBe(true);
  });

  it('treats a missing interest rate as uncomparable, not a rate of zero', () => {
    const result = compareDebtVsSave(baseInput({ debts: [debt({ interestRatePct: null })], people: [person()] }));
    expect(result.comparable).toHaveLength(0);
    expect(result.uncomparable).toEqual([{ accountId: 1, name: 'Mortgage', reason: expect.stringContaining('No interest rate') }]);
  });

  it('treats a zero balance as uncomparable', () => {
    const result = compareDebtVsSave(baseInput({ debts: [debt({ balancePence: 0n })], people: [person()] }));
    expect(result.comparable).toHaveLength(0);
    expect(result.uncomparable).toEqual([{ accountId: 1, name: 'Mortgage', reason: expect.stringContaining('No balance') }]);
  });

  it('flags the LISA lock-in only when the household already owns a home', () => {
    const ownsHome = compareDebtVsSave(
      baseInput({ householdOwnsProperty: true, debts: [debt()], people: [person()] }),
    );
    const noHome = compareDebtVsSave(
      baseInput({ householdOwnsProperty: false, debts: [debt()], people: [person()] }),
    );
    const lisaOwns = ownsHome.comparable[0]?.investingOptions.find((o) => o.id === 'lisa');
    const lisaNoHome = noHome.comparable[0]?.investingOptions.find((o) => o.id === 'lisa');
    expect(lisaOwns?.lisaLockInWarning).toContain('net loss');
    expect(lisaNoHome?.lisaLockInWarning).toBeNull();
  });

  it('omits LISA entirely for a LISA-ineligible person', () => {
    const result = compareDebtVsSave(
      baseInput({
        debts: [debt()],
        // 55-year-old with no existing LISA: can't open (max open age 39) or contribute (max 50).
        people: [person({ dateOfBirth: '1971-04-12' })],
      }),
    );
    expect(result.comparable[0]?.investingOptions.find((o) => o.id === 'lisa')).toBeUndefined();
  });

  it('offers only the GIA/ISA option for a jointly-owned debt, with no person to attribute LISA/pension to', () => {
    const result = compareDebtVsSave(baseInput({ debts: [debt({ personId: null })], people: [person()] }));
    const ids = result.comparable[0]?.investingOptions.map((o) => o.id);
    expect(ids).toEqual(['gia_isa']);
  });

  it('returns no comparisons and a top-level warning for a non-finite benchmark', () => {
    const result = compareDebtVsSave(
      baseInput({ debtBenchmarkRatePct: 'not-a-number', debts: [debt()], people: [person()] }),
    );
    expect(result.comparable).toHaveLength(0);
    expect(result.uncomparable).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});
