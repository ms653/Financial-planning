import { describe, expect, it } from 'vitest';
import { diffAssumptions } from './scenarioDiff';
import type { ScenarioAssumptionsV1 } from './scenarioAssumptions';

function assumptions(overrides: Partial<ScenarioAssumptionsV1> = {}): ScenarioAssumptionsV1 {
  return {
    schemaVersion: 1,
    annualSpending: '30000.00',
    inflationPct: '2.500',
    equityAllocationPct: '60.000',
    targetSuccessRatePct: '90.000',
    flatEffectiveTaxRatePct: '20.000',
    wrapperWithdrawalOrder: ['gia'],
    people: [{ personId: 1, retirementAge: 65, planEndAge: 90 }],
    ...overrides,
  };
}

describe('diffAssumptions', () => {
  it('returns no rows for identical scenarios', () => {
    const rows = diffAssumptions(assumptions(), assumptions(), new Map());
    expect(rows).toEqual([]);
  });

  it('includes only the fields that differ', () => {
    const a = assumptions({ annualSpending: '30000.00' });
    const b = assumptions({ annualSpending: '35000.00' });
    const rows = diffAssumptions(a, b, new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('Annual spending');
    expect(rows[0]!.a).toBe('30000.00');
    expect(rows[0]!.b).toBe('35000.00');
  });

  it('names a differing per-person field using the provided person name, not the raw id', () => {
    const a = assumptions({ people: [{ personId: 1, retirementAge: 60, planEndAge: 90 }] });
    const b = assumptions({ people: [{ personId: 1, retirementAge: 65, planEndAge: 90 }] });
    const rows = diffAssumptions(a, b, new Map([[1, 'Alex']]));
    expect(rows).toEqual([{ label: "Alex's retirement age", a: '60', b: '65' }]);
  });

  it('diffs the withdrawal order as a single joined row', () => {
    const a = assumptions({ wrapperWithdrawalOrder: ['cash', 'gia'] });
    const b = assumptions({ wrapperWithdrawalOrder: ['gia', 'cash'] });
    const rows = diffAssumptions(a, b, new Map());
    expect(rows).toEqual([{ label: 'Withdrawal order', a: 'cash → gia', b: 'gia → cash' }]);
  });

  it('percent fields carry a % suffix', () => {
    const a = assumptions({ inflationPct: '2.500' });
    const b = assumptions({ inflationPct: '3.000' });
    const rows = diffAssumptions(a, b, new Map());
    expect(rows).toEqual([{ label: 'Inflation', a: '2.500%', b: '3.000%' }]);
  });

  // Regression for a real gap Fable review found: PCLS age and the State Pension
  // override were the only two per-person fields never compared, so two scenarios
  // differing *only* in one of these showed no diff row at all despite the spec's
  // "only the fields that differ" promising exactly that — implying every differing
  // field, not a subset of them.
  it('diffs PCLS age, defaulting the label to "Never" when unset', () => {
    const a = assumptions({ people: [{ personId: 1, retirementAge: 65, planEndAge: 90, pclsAge: 60 }] });
    const b = assumptions({ people: [{ personId: 1, retirementAge: 65, planEndAge: 90 }] });
    const rows = diffAssumptions(a, b, new Map([[1, 'Alex']]));
    expect(rows).toEqual([{ label: "Alex's PCLS age", a: '60', b: 'Never' }]);
  });

  it('diffs the State Pension annual override, defaulting the label to "Default" when unset', () => {
    const a = assumptions({
      people: [{ personId: 1, retirementAge: 65, planEndAge: 90, statePensionAnnualOverride: '10000.00' }],
    });
    const b = assumptions({ people: [{ personId: 1, retirementAge: 65, planEndAge: 90 }] });
    const rows = diffAssumptions(a, b, new Map([[1, 'Alex']]));
    expect(rows).toEqual([{ label: "Alex's State Pension override", a: '10000.00', b: 'Default' }]);
  });
});
