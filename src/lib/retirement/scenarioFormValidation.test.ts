import { describe, expect, it } from 'vitest';
import { RETIREMENT_AGE_RANGE_ERROR, validateScenarioForm, type ScenarioFormValues } from './scenarioFormValidation';

function baseValues(overrides: Partial<ScenarioFormValues> = {}): ScenarioFormValues {
  return {
    annualSpending: '30000.00',
    survivorAnnualSpending: '',
    inflationPct: '2.500',
    equityAllocationPct: '60.000',
    targetSuccessRatePct: '90.000',
    flatEffectiveTaxRatePct: '20.000',
    wrapperWithdrawalOrder: ['gia'],
    people: [
      {
        personId: 1,
        currentAge: 41,
        retirementAge: '65',
        statePensionClaimAge: '',
        statePensionAnnualOverride: '',
        pclsAge: '',
        planEndAge: '90',
      },
    ],
    ...overrides,
  };
}

describe('validateScenarioForm', () => {
  it('accepts valid values and returns a parsed ScenarioAssumptionsV1', () => {
    const result = validateScenarioForm(baseValues());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.people[0]!.retirementAge).toBe(65);
  });

  it('rejects a retirement age below current age, with the exact spec copy', () => {
    const result = validateScenarioForm(
      baseValues({ people: [{ ...baseValues().people[0]!, retirementAge: '40' }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors['people.0.retirementAge']).toBe(RETIREMENT_AGE_RANGE_ERROR);
  });

  it('rejects a retirement age above 100, with the exact spec copy', () => {
    const result = validateScenarioForm(
      baseValues({ people: [{ ...baseValues().people[0]!, retirementAge: '101' }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors['people.0.retirementAge']).toBe(RETIREMENT_AGE_RANGE_ERROR);
  });

  it('accepts a retirement age exactly at current age or exactly 100', () => {
    const atCurrentAge = validateScenarioForm(
      baseValues({ people: [{ ...baseValues().people[0]!, retirementAge: '41' }] }),
    );
    expect(atCurrentAge.ok).toBe(true);

    const at100 = validateScenarioForm(
      baseValues({
        people: [{ ...baseValues().people[0]!, retirementAge: '100', planEndAge: '105' }],
      }),
    );
    expect(at100.ok).toBe(true);
  });

  it('rejects a plan end age that is not after retirement age', () => {
    const result = validateScenarioForm(
      baseValues({ people: [{ ...baseValues().people[0]!, retirementAge: '65', planEndAge: '65' }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors['people.0.planEndAge']).toMatch(/after retirement age/);
  });

  it('rejects a non-numeric age field', () => {
    const result = validateScenarioForm(
      baseValues({ people: [{ ...baseValues().people[0]!, planEndAge: 'ninety' }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors['people.0.planEndAge']).toBeDefined();
  });

  it('treats an empty optional field as "use the default", not an error', () => {
    const result = validateScenarioForm(baseValues());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.people[0]!.statePensionClaimAge).toBeUndefined();
    expect(result.value.people[0]!.pclsAge).toBeUndefined();
  });

  it('rejects a malformed optional age field rather than silently dropping it', () => {
    const result = validateScenarioForm(
      baseValues({ people: [{ ...baseValues().people[0]!, pclsAge: 'not-a-number' }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors['people.0.pclsAge']).toBeDefined();
  });

  it('defers format/range checks (e.g. an out-of-range percent) to parseScenarioAssumptions', () => {
    const result = validateScenarioForm(baseValues({ inflationPct: 'not-a-percent' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.form).toBeDefined();
  });

  it('requires survivorAnnualSpending for a two-person household (delegated to parseScenarioAssumptions)', () => {
    const values = baseValues({
      people: [
        { personId: 1, currentAge: 41, retirementAge: '65', statePensionClaimAge: '', statePensionAnnualOverride: '', pclsAge: '', planEndAge: '90' },
        { personId: 2, currentAge: 39, retirementAge: '65', statePensionClaimAge: '', statePensionAnnualOverride: '', pclsAge: '', planEndAge: '90' },
      ],
    });
    const result = validateScenarioForm(values);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.form).toMatch(/survivorAnnualSpending/);
  });
});
