import { describe, expect, it } from 'vitest';
import { statePensionAnnualPence, statePensionDate, STATE_PENSION_WEEKLY_PENCE_2026_27 } from './taxYearConfig';

describe('statePensionAnnualPence', () => {
  it('is the weekly figure times 52, not an independently rounded constant', () => {
    expect(statePensionAnnualPence()).toBe(STATE_PENSION_WEEKLY_PENCE_2026_27 * 52n);
    // £241.30 * 52 = £12,547.60 — the precise figure, not the commonly quoted ~£12,548.
    expect(statePensionAnnualPence()).toBe(1_254_760n);
  });
});

describe('statePensionDate', () => {
  it('throws on a malformed date of birth rather than guessing a band', () => {
    expect(() => statePensionDate('')).toThrow();
    expect(() => statePensionDate('12-04-1985')).toThrow();
    expect(() => statePensionDate('not-a-date')).toThrow();
  });

  it('is flat 66 for anyone born before 6 April 1960', () => {
    expect(statePensionDate('1960-04-05')).toBe('2026-04-05');
    expect(statePensionDate('1900-01-01')).toBe('1966-01-01');
  });

  it('rises month by month for the 1960-04-06 to 1961-03-05 transitional band', () => {
    // First person to be affected: 66 years + 1 month, matching gov.uk's own framing
    // that the rise "starts" 6 May 2026.
    expect(statePensionDate('1960-04-06')).toBe('2026-05-06');
    // Same band (still +1 month), but the offset is from each person's own birthdate,
    // not a shared date for the whole band.
    expect(statePensionDate('1960-05-05')).toBe('2026-06-05');
    expect(statePensionDate('1960-05-06')).toBe('2026-07-06'); // +2 months
    // Last person in the band: 66 years + 11 months.
    expect(statePensionDate('1961-03-05')).toBe('2028-02-05');
  });

  it('is flat 67 for anyone born 6 March 1961 to 5 April 1977', () => {
    expect(statePensionDate('1961-03-06')).toBe('2028-03-06');
    expect(statePensionDate('1977-04-05')).toBe('2044-04-05');
  });

  it('maps the 1977-04-06 to 1978-04-05 band to the literal gov.uk dates, not a derived offset', () => {
    expect(statePensionDate('1977-04-06')).toBe('2044-05-06');
    expect(statePensionDate('1977-05-05')).toBe('2044-05-06');
    expect(statePensionDate('1978-04-05')).toBe('2046-03-06');
  });

  it('is flat 68 for anyone born on or after 6 April 1978, under current legislation', () => {
    expect(statePensionDate('1978-04-06')).toBe('2046-04-06');
    expect(statePensionDate('2000-01-01')).toBe('2068-01-01');
  });

  it('matches this household’s own two people (regression pin)', () => {
    expect(statePensionDate('1985-04-12')).toBe('2053-04-12');
    expect(statePensionDate('1987-09-30')).toBe('2055-09-30');
  });

  it('clamps a 29 February birth date to 28 February in a non-leap target year', () => {
    // 1960 was a leap year; +66 years lands on 2026, not a leap year.
    expect(statePensionDate('1960-02-29')).toBe('2026-02-28');
  });

  it('clamps an end-of-month birth date when the +months step lands in a shorter month', () => {
    // In the 6 Jan – 5 Feb 1961 band (+10 months): 1961-01-31 + 66 years = 2027-01-31,
    // then + 10 months lands in November 2027, which has only 30 days.
    expect(statePensionDate('1961-01-31')).toBe('2027-11-30');
  });

  it('does not clamp when the target month has enough days', () => {
    // Flat-68 territory (born after 5 April 1978); January always has 31 days.
    expect(statePensionDate('1990-01-31')).toBe('2058-01-31');
  });
});
