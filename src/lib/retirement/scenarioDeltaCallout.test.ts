import { describe, expect, it } from 'vitest';
import { buildDeltaCallout } from './scenarioDeltaCallout';

describe('buildDeltaCallout', () => {
  it('matches docs/DESIGN_SPEC.md\'s own example exactly', () => {
    const result = buildDeltaCallout({
      label: 'Scenario B',
      successRateFraction: 0.92,
      otherSuccessRateFraction: 0.8,
      retirementAge: 67,
      otherRetirementAge: 65,
    });
    expect(result).toBe('Scenario B: 12 percentage points higher success rate, retires 2 years later');
  });

  it('pluralizes a single percentage point / single year correctly', () => {
    const result = buildDeltaCallout({
      label: 'Scenario B',
      successRateFraction: 0.81,
      otherSuccessRateFraction: 0.8,
      retirementAge: 66,
      otherRetirementAge: 65,
    });
    expect(result).toBe('Scenario B: 1 percentage point higher success rate, retires 1 year later');
  });

  it('describes a lower success rate and an earlier retirement', () => {
    const result = buildDeltaCallout({
      label: 'Scenario B',
      successRateFraction: 0.7,
      otherSuccessRateFraction: 0.8,
      retirementAge: 60,
      otherRetirementAge: 65,
    });
    expect(result).toBe('Scenario B: 10 percentage points lower success rate, retires 5 years earlier');
  });

  it('omits a clause that has no difference', () => {
    const result = buildDeltaCallout({
      label: 'Scenario B',
      successRateFraction: 0.8,
      otherSuccessRateFraction: 0.8,
      retirementAge: 60,
      otherRetirementAge: 65,
    });
    expect(result).toBe('Scenario B: retires 5 years earlier');
  });

  it('returns null when there is nothing to say', () => {
    const result = buildDeltaCallout({
      label: 'Scenario B',
      successRateFraction: 0.8,
      otherSuccessRateFraction: 0.8,
      retirementAge: 65,
      otherRetirementAge: 65,
    });
    expect(result).toBeNull();
  });

  it('adds a one-off-events clause, pluralized, when the two sides differ', () => {
    const result = buildDeltaCallout({
      label: 'Scenario B',
      successRateFraction: 0.8,
      otherSuccessRateFraction: 0.8,
      retirementAge: 65,
      otherRetirementAge: 65,
      oneOffEventsDiffCount: 2,
    });
    expect(result).toBe('Scenario B: also models 2 one-off events differently');
  });

  it('singularizes the one-off-events clause for a single differing event', () => {
    const result = buildDeltaCallout({
      label: 'Scenario B',
      successRateFraction: 0.8,
      otherSuccessRateFraction: 0.8,
      retirementAge: 65,
      otherRetirementAge: 65,
      oneOffEventsDiffCount: 1,
    });
    expect(result).toBe('Scenario B: also models 1 one-off event differently');
  });

  it('omits the one-off-events clause when the count is zero or undefined', () => {
    expect(
      buildDeltaCallout({
        label: 'Scenario B',
        successRateFraction: 0.8,
        otherSuccessRateFraction: 0.8,
        retirementAge: 65,
        otherRetirementAge: 65,
        oneOffEventsDiffCount: 0,
      }),
    ).toBeNull();
  });
});
