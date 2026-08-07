import { describe, expect, it } from 'vitest';
import { parseScenarioAssumptions, ScenarioAssumptionsParseError } from './scenarioAssumptions';

function validSinglePersonPayload() {
  return {
    schemaVersion: 1,
    annualSpending: '30000',
    inflationPct: '2.500',
    equityAllocationPct: '70.000',
    targetSuccessRatePct: '90.000',
    flatEffectiveTaxRatePct: '20.000',
    wrapperWithdrawalOrder: ['ss_isa', 'gia', 'sipp_pension'],
    people: [{ personId: 1, retirementAge: 65, planEndAge: 95 }],
  };
}

function validTwoPersonPayload() {
  return {
    ...validSinglePersonPayload(),
    survivorAnnualSpending: '22000',
    people: [
      { personId: 1, retirementAge: 65, planEndAge: 95 },
      { personId: 2, retirementAge: 63, planEndAge: 92, statePensionClaimAge: 68, pclsAge: 57 },
    ],
  };
}

describe('parseScenarioAssumptions', () => {
  it('parses a valid v1 single-person payload', () => {
    const result = parseScenarioAssumptions(validSinglePersonPayload());
    expect(result.schemaVersion).toBe(1);
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({ personId: 1, retirementAge: 65, planEndAge: 95 });
    expect(result.survivorAnnualSpending).toBeUndefined();
  });

  it('parses a valid v1 two-person payload, including optional per-person overrides', () => {
    const result = parseScenarioAssumptions(validTwoPersonPayload());
    expect(result.people).toHaveLength(2);
    expect(result.people[1]).toMatchObject({ statePensionClaimAge: 68, pclsAge: 57 });
    expect(result.survivorAnnualSpending).toBe('22000');
  });

  it('rejects a non-object payload', () => {
    expect(() => parseScenarioAssumptions('not an object')).toThrow(ScenarioAssumptionsParseError);
    expect(() => parseScenarioAssumptions(null)).toThrow(ScenarioAssumptionsParseError);
    expect(() => parseScenarioAssumptions([1, 2, 3])).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects an unrecognised schemaVersion rather than guessing at the shape', () => {
    expect(() => parseScenarioAssumptions({ ...validSinglePersonPayload(), schemaVersion: 2 })).toThrow(
      ScenarioAssumptionsParseError,
    );
    expect(() => parseScenarioAssumptions({ ...validSinglePersonPayload(), schemaVersion: undefined })).toThrow(
      ScenarioAssumptionsParseError,
    );
  });

  it('rejects an empty or missing people array', () => {
    expect(() => parseScenarioAssumptions({ ...validSinglePersonPayload(), people: [] })).toThrow(
      ScenarioAssumptionsParseError,
    );
    const { people, ...withoutPeople } = validSinglePersonPayload();
    expect(() => parseScenarioAssumptions(withoutPeople)).toThrow(ScenarioAssumptionsParseError);
  });

  it('requires survivorAnnualSpending once more than one person is modelled', () => {
    const { survivorAnnualSpending, ...twoPersonWithoutSurvivorSpend } = validTwoPersonPayload();
    expect(() => parseScenarioAssumptions(twoPersonWithoutSurvivorSpend)).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects a non-decimal money field', () => {
    expect(() =>
      parseScenarioAssumptions({ ...validSinglePersonPayload(), annualSpending: 'thirty thousand' }),
    ).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects a non-numeric age field', () => {
    const payload = validSinglePersonPayload();
    payload.people = [{ personId: 1, retirementAge: '65' as unknown as number, planEndAge: 95 }];
    expect(() => parseScenarioAssumptions(payload)).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects a missing or empty wrapperWithdrawalOrder', () => {
    expect(() =>
      parseScenarioAssumptions({ ...validSinglePersonPayload(), wrapperWithdrawalOrder: [] }),
    ).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects a person missing a required field', () => {
    const payload = validSinglePersonPayload();
    payload.people = [{ personId: 1, retirementAge: 65 } as unknown as (typeof payload)['people'][number]];
    expect(() => parseScenarioAssumptions(payload)).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects a wrapperWithdrawalOrder entry that is not a real account type', () => {
    expect(() =>
      parseScenarioAssumptions({
        ...validSinglePersonPayload(),
        wrapperWithdrawalOrder: ['ss_isa', 'not_a_real_type'],
      }),
    ).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects debt and property in wrapperWithdrawalOrder — neither is a drawdown wrapper', () => {
    // Regression test for the gap Milestone 2's Fable review flagged and Milestone 3
    // closed: wrapperWithdrawalOrder used to accept any real AccountTypeValue, which
    // meant a mortgage or a house valuation could be walked into a simulated drawdown.
    expect(() =>
      parseScenarioAssumptions({ ...validSinglePersonPayload(), wrapperWithdrawalOrder: ['ss_isa', 'debt'] }),
    ).toThrow(ScenarioAssumptionsParseError);
    expect(() =>
      parseScenarioAssumptions({ ...validSinglePersonPayload(), wrapperWithdrawalOrder: ['ss_isa', 'property'] }),
    ).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects an out-of-range percent field, not just a badly-formatted one', () => {
    expect(() =>
      parseScenarioAssumptions({ ...validSinglePersonPayload(), equityAllocationPct: '150.000' }),
    ).toThrow(ScenarioAssumptionsParseError);
    expect(() =>
      parseScenarioAssumptions({ ...validSinglePersonPayload(), targetSuccessRatePct: '-40.000' }),
    ).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects an out-of-range or non-integer age', () => {
    const negative = validSinglePersonPayload();
    negative.people = [{ personId: 1, retirementAge: -5, planEndAge: 95 }];
    expect(() => parseScenarioAssumptions(negative)).toThrow(ScenarioAssumptionsParseError);

    const tooOld = validSinglePersonPayload();
    tooOld.people = [{ personId: 1, retirementAge: 65, planEndAge: 200 }];
    expect(() => parseScenarioAssumptions(tooOld)).toThrow(ScenarioAssumptionsParseError);

    const fractional = validSinglePersonPayload();
    fractional.people = [{ personId: 1, retirementAge: 65.5, planEndAge: 95 }];
    expect(() => parseScenarioAssumptions(fractional)).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects a money field with UI-input formatting (currency symbol, comma) rather than silently accepting it', () => {
    // A stored assumption is canonical data, not raw keystrokes — unlike money.ts's own
    // parseMoneyInput, which deliberately tolerates this shape for real form input.
    expect(() =>
      parseScenarioAssumptions({ ...validSinglePersonPayload(), annualSpending: '£30,000' }),
    ).toThrow(ScenarioAssumptionsParseError);
  });

  it('rejects a non-positive-integer personId', () => {
    const payload = validSinglePersonPayload();
    payload.people = [{ personId: 0, retirementAge: 65, planEndAge: 95 }];
    expect(() => parseScenarioAssumptions(payload)).toThrow(ScenarioAssumptionsParseError);
  });

  describe('oneOffEvents', () => {
    it('is undefined when absent — a pre-Phase-4.6 scenario, not an empty list', () => {
      const result = parseScenarioAssumptions(validSinglePersonPayload());
      expect(result.oneOffEvents).toBeUndefined();
    });

    it('parses a valid expense (negative amount) and injection (positive amount)', () => {
      const payload = {
        ...validSinglePersonPayload(),
        oneOffEvents: [
          { id: 'a', label: 'House deposit', personId: 1, age: 45, amount: '-50000' },
          { id: 'b', label: 'Inheritance', personId: 1, age: 50, amount: '20000' },
        ],
      };
      const result = parseScenarioAssumptions(payload);
      expect(result.oneOffEvents).toEqual([
        { id: 'a', label: 'House deposit', personId: 1, age: 45, amount: '-50000' },
        { id: 'b', label: 'Inheritance', personId: 1, age: 50, amount: '20000' },
      ]);
    });

    it('rejects a zero amount', () => {
      const payload = {
        ...validSinglePersonPayload(),
        oneOffEvents: [{ id: 'a', label: 'Nothing', personId: 1, age: 45, amount: '0' }],
      };
      expect(() => parseScenarioAssumptions(payload)).toThrow(ScenarioAssumptionsParseError);
    });

    it('rejects a personId that is not one of this scenario’s own people', () => {
      const payload = {
        ...validSinglePersonPayload(),
        oneOffEvents: [{ id: 'a', label: 'House deposit', personId: 999, age: 45, amount: '-50000' }],
      };
      expect(() => parseScenarioAssumptions(payload)).toThrow(ScenarioAssumptionsParseError);
    });

    it('rejects a non-array oneOffEvents', () => {
      const payload = { ...validSinglePersonPayload(), oneOffEvents: 'not an array' };
      expect(() => parseScenarioAssumptions(payload)).toThrow(ScenarioAssumptionsParseError);
    });

    it('rejects an event missing a required field', () => {
      const payload = {
        ...validSinglePersonPayload(),
        oneOffEvents: [{ id: 'a', label: 'House deposit', personId: 1, amount: '-50000' }],
      };
      expect(() => parseScenarioAssumptions(payload)).toThrow(ScenarioAssumptionsParseError);
    });

    it('accepts an empty oneOffEvents array', () => {
      const result = parseScenarioAssumptions({ ...validSinglePersonPayload(), oneOffEvents: [] });
      expect(result.oneOffEvents).toEqual([]);
    });
  });
});
