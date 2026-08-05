import { describe, expect, it } from 'vitest';
import {
  computeAdjustedNetIncomePence,
  computeAnnualAllowanceStatus,
  computePersonalAllowanceTaperStatus,
  memberGrossContributionPence,
  pensionAllowanceConsumedPence,
  personalAllowanceTaperCeilingPence,
  type PensionContributionInput,
} from './taxStatus';

function contribution(overrides: Partial<PensionContributionInput> = {}): PensionContributionInput {
  return {
    amountPence: 0n,
    method: 'relief_at_source',
    employerAmountPence: 0n,
    ...overrides,
  };
}

describe('computeAdjustedNetIncomePence', () => {
  it('subtracts relief-at-source contributions grossed up by ÷0.8', () => {
    // £150,000 gross, £10,000 relief-at-source -> grossed up to £12,500 deducted.
    const ani = computeAdjustedNetIncomePence(150_000_00n, [
      contribution({ amountPence: 10_000_00n, method: 'relief_at_source' }),
    ]);
    expect(ani).toBe(137_500_00n);
  });

  it('subtracts salary-sacrifice contributions at face value', () => {
    const ani = computeAdjustedNetIncomePence(150_000_00n, [
      contribution({ amountPence: 10_000_00n, method: 'salary_sacrifice' }),
    ]);
    expect(ani).toBe(140_000_00n);
  });

  it('subtracts net-pay contributions at face value, same as salary sacrifice', () => {
    const ani = computeAdjustedNetIncomePence(150_000_00n, [
      contribution({ amountPence: 10_000_00n, method: 'net_pay' }),
    ]);
    expect(ani).toBe(140_000_00n);
  });

  it('never subtracts employer contributions', () => {
    const withoutEmployer = computeAdjustedNetIncomePence(150_000_00n, [
      contribution({ amountPence: 10_000_00n, method: 'salary_sacrifice', employerAmountPence: 0n }),
    ]);
    const withEmployer = computeAdjustedNetIncomePence(150_000_00n, [
      contribution({ amountPence: 10_000_00n, method: 'salary_sacrifice', employerAmountPence: 50_000_00n }),
    ]);
    expect(withEmployer).toBe(withoutEmployer);
  });

  it('sums multiple contributions across different methods', () => {
    const ani = computeAdjustedNetIncomePence(150_000_00n, [
      contribution({ amountPence: 10_000_00n, method: 'relief_at_source' }), // -12,500
      contribution({ amountPence: 5_000_00n, method: 'salary_sacrifice' }), // -5,000
    ]);
    expect(ani).toBe(150_000_00n - 12_500_00n - 5_000_00n);
  });

  it('floors at zero rather than going negative', () => {
    const ani = computeAdjustedNetIncomePence(5_000_00n, [
      contribution({ amountPence: 10_000_00n, method: 'salary_sacrifice' }),
    ]);
    expect(ani).toBe(0n);
  });

  it('with no contributions, ANI equals gross income', () => {
    expect(computeAdjustedNetIncomePence(150_000_00n, [])).toBe(150_000_00n);
  });
});

describe('personalAllowanceTaperCeilingPence', () => {
  it('derives £125,140 from the start point plus twice the full allowance', () => {
    expect(personalAllowanceTaperCeilingPence()).toBe(125_140_00n);
  });
});

describe('computePersonalAllowanceTaperStatus', () => {
  it('is not in the taper zone at exactly £100,000 ANI, full allowance intact', () => {
    const status = computePersonalAllowanceTaperStatus(100_000_00n, []);
    expect(status.inTaperZone).toBe(false);
    expect(status.personalAllowanceWithdrawnPence).toBe(0n);
    expect(status.remainingPersonalAllowancePence).toBe(12_570_00n);
  });

  it('withdraws £0.50 of allowance per £1 above the start point', () => {
    // £100,000.01 ANI -> 1 penny excess -> £0 withdrawn (integer pence division floors).
    const justOver = computePersonalAllowanceTaperStatus(100_000_01n, []);
    expect(justOver.inTaperZone).toBe(true);
    expect(justOver.personalAllowanceWithdrawnPence).toBe(0n);

    // £110,000 ANI -> £10,000 excess -> £5,000 withdrawn.
    const midway = computePersonalAllowanceTaperStatus(110_000_00n, []);
    expect(midway.personalAllowanceWithdrawnPence).toBe(5_000_00n);
    expect(midway.remainingPersonalAllowancePence).toBe(12_570_00n - 5_000_00n);
  });

  it('fully withdraws the allowance at exactly £125,140 ANI, and stays fully withdrawn above it', () => {
    const atCeiling = computePersonalAllowanceTaperStatus(125_140_00n, []);
    expect(atCeiling.personalAllowanceWithdrawnPence).toBe(12_570_00n);
    expect(atCeiling.remainingPersonalAllowancePence).toBe(0n);
    expect(atCeiling.inTaperZone).toBe(true);

    const aboveCeiling = computePersonalAllowanceTaperStatus(200_000_00n, []);
    expect(aboveCeiling.personalAllowanceWithdrawnPence).toBe(12_570_00n);
    expect(aboveCeiling.remainingPersonalAllowancePence).toBe(0n);
    expect(aboveCeiling.inTaperZone).toBe(true);
  });

  it('a pension contribution that pulls ANI back under £100,000 clears the taper zone entirely', () => {
    const status = computePersonalAllowanceTaperStatus(110_000_00n, [
      contribution({ amountPence: 12_000_00n, method: 'salary_sacrifice' }),
    ]);
    expect(status.adjustedNetIncomePence).toBe(98_000_00n);
    expect(status.inTaperZone).toBe(false);
    expect(status.remainingPersonalAllowancePence).toBe(12_570_00n);
  });
});

describe('computeAnnualAllowanceStatus', () => {
  it('gives the full £60,000 standard allowance when not MPAA-restricted', () => {
    const status = computeAnnualAllowanceStatus(false);
    expect(status.mpaaRestricted).toBe(false);
    expect(status.standardAllowancePence).toBe(60_000_00n);
    expect(status.effectiveAllowancePence).toBe(60_000_00n);
  });

  it('restricts the effective allowance to £10,000 once flexibly accessed, standard figure unchanged', () => {
    const status = computeAnnualAllowanceStatus(true);
    expect(status.mpaaRestricted).toBe(true);
    expect(status.standardAllowancePence).toBe(60_000_00n);
    expect(status.effectiveAllowancePence).toBe(10_000_00n);
  });
});

describe('memberGrossContributionPence', () => {
  it('grosses up a relief-at-source amount by ÷0.8', () => {
    expect(
      memberGrossContributionPence(contribution({ amountPence: 40_000_00n, method: 'relief_at_source' })),
    ).toBe(50_000_00n);
  });

  it('takes salary-sacrifice and net-pay amounts at face value', () => {
    expect(
      memberGrossContributionPence(contribution({ amountPence: 40_000_00n, method: 'salary_sacrifice' })),
    ).toBe(40_000_00n);
    expect(memberGrossContributionPence(contribution({ amountPence: 40_000_00n, method: 'net_pay' }))).toBe(
      40_000_00n,
    );
  });
});

describe('pensionAllowanceConsumedPence', () => {
  it('sums the grossed member contribution and the employer contribution', () => {
    const consumed = pensionAllowanceConsumedPence(
      contribution({ amountPence: 40_000_00n, method: 'relief_at_source', employerAmountPence: 5_000_00n }),
    );
    // £40,000 RAS -> £50,000 gross, plus £5,000 employer -> £55,000.
    expect(consumed).toBe(55_000_00n);
  });

  it('never grosses up the employer amount itself', () => {
    const consumed = pensionAllowanceConsumedPence(
      contribution({ amountPence: 0n, method: 'relief_at_source', employerAmountPence: 10_000_00n }),
    );
    expect(consumed).toBe(10_000_00n);
  });
});
