import { describe, expect, it } from 'vitest';
import { ageAsOf, statePensionClaimAgeFromDate } from './resolveScenario';

describe('ageAsOf', () => {
  it('is exact on the birthday itself', () => {
    expect(ageAsOf('1985-06-15', '2026-06-15')).toBe(41);
  });

  it('floors when the birthday has not yet happened this year', () => {
    expect(ageAsOf('1985-06-15', '2026-06-14')).toBe(40);
  });

  it('increments the day after the birthday', () => {
    expect(ageAsOf('1985-06-15', '2026-06-16')).toBe(41);
  });

  it('handles a birth month later in the year than the as-of month', () => {
    expect(ageAsOf('1985-12-01', '2026-03-01')).toBe(40);
  });

  it('is zero on the day of birth itself', () => {
    expect(ageAsOf('2026-07-29', '2026-07-29')).toBe(0);
  });
});

describe('statePensionClaimAgeFromDate', () => {
  it('returns the exact floored age with no rounding when the state pension date falls on a birthday (the flat-age-band case)', () => {
    // Mirrors what taxYearConfig.ts's statePensionDate actually returns for anyone in a
    // flat band (66/67/68) — always a literal birthday, e.g. addCalendarYears(dob, 68).
    expect(statePensionClaimAgeFromDate('1985-06-15', '2053-06-15')).toBe(68);
  });

  it('rounds up when the state pension date does not land on the same day of year (the transitional-band case)', () => {
    // Mirrors the monthly/dated transition bands, where the qualifying date is offset
    // by extra months or is a literal gov.uk-published date unrelated to the birthday.
    expect(statePensionClaimAgeFromDate('1960-04-10', '2026-04-10')).toBe(66); // exact, no rounding
    expect(statePensionClaimAgeFromDate('1960-04-10', '2026-04-11')).toBe(67); // one day past -> rounds up
    expect(statePensionClaimAgeFromDate('1960-04-10', '2026-05-10')).toBe(67); // a month past -> rounds up
  });
});
