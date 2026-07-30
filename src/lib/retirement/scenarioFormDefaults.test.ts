import { describe, expect, it } from 'vitest';
import { defaultAssumptionsFor, DEFAULT_WRAPPER_WITHDRAWAL_ORDER } from './scenarioFormDefaults';

describe('defaultAssumptionsFor', () => {
  it('defaults a single person\'s retirement age to 65 when they are younger than that', () => {
    const assumptions = defaultAssumptionsFor([{ personId: 1, dateOfBirth: '1990-01-01' }], '2026-07-30');
    expect(assumptions.people[0]!.retirementAge).toBe(65);
    expect(assumptions.survivorAnnualSpending).toBeUndefined();
  });

  it('defaults retirement age to the current age when already past 65', () => {
    const assumptions = defaultAssumptionsFor([{ personId: 1, dateOfBirth: '1950-01-01' }], '2026-07-30');
    expect(assumptions.people[0]!.retirementAge).toBe(76);
  });

  it('sets survivorAnnualSpending to 75% of annualSpending for a two-person household', () => {
    const assumptions = defaultAssumptionsFor(
      [
        { personId: 1, dateOfBirth: '1985-06-15' },
        { personId: 2, dateOfBirth: '1987-03-01' },
      ],
      '2026-07-30',
    );
    expect(assumptions.annualSpending).toBe('30000.00');
    expect(assumptions.survivorAnnualSpending).toBe('22500.00');
  });

  it('derives each person\'s default State Pension claim age from their date of birth', () => {
    const assumptions = defaultAssumptionsFor([{ personId: 1, dateOfBirth: '1985-06-15' }], '2026-07-30');
    // Flat 68 band for anyone born on/after 1978-04-06 (per taxYearConfig.ts).
    expect(assumptions.people[0]!.statePensionClaimAge).toBe(68);
  });

  it('produces assumptions parseScenarioAssumptions itself accepts unmodified', async () => {
    const { parseScenarioAssumptions } = await import('./scenarioAssumptions');
    const assumptions = defaultAssumptionsFor(
      [
        { personId: 1, dateOfBirth: '1985-06-15' },
        { personId: 2, dateOfBirth: '1987-03-01' },
      ],
      '2026-07-30',
    );
    expect(() => parseScenarioAssumptions(assumptions)).not.toThrow();
  });

  it('uses the documented UK decumulation withdrawal order by default', () => {
    const assumptions = defaultAssumptionsFor([{ personId: 1, dateOfBirth: '1990-01-01' }], '2026-07-30');
    expect(assumptions.wrapperWithdrawalOrder).toEqual(DEFAULT_WRAPPER_WITHDRAWAL_ORDER);
    expect(assumptions.wrapperWithdrawalOrder).toEqual(['cash', 'gia', 'cash_isa', 'ss_isa', 'lisa', 'sipp_pension']);
  });
});
