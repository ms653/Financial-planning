import { describe, expect, it } from 'vitest';
import { classifyBackupAge, formatRelativeAge, hoursSince } from './status';

const NOW = new Date('2026-07-26T12:00:00Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

describe('hoursSince', () => {
  it('rounds down to whole hours', () => {
    expect(hoursSince(new Date('2026-07-26T10:30:00Z'), NOW)).toBe(1);
    expect(hoursSince(new Date('2026-07-26T11:59:59Z'), NOW)).toBe(0);
  });
});

describe('classifyBackupAge', () => {
  it('is ok for a recent backup', () => {
    expect(classifyBackupAge(hoursAgo(2), NOW, 48)).toEqual({ severity: 'ok', ageHours: 2 });
  });

  it('is still ok one hour inside the threshold', () => {
    expect(classifyBackupAge(hoursAgo(47), NOW, 48)).toEqual({ severity: 'ok', ageHours: 47 });
  });

  it('goes stale exactly at the threshold', () => {
    expect(classifyBackupAge(hoursAgo(48), NOW, 48)).toEqual({ severity: 'stale', ageHours: 48 });
  });

  it('is stale for a long-dead backup — the failure mode this indicator exists for', () => {
    // "A pg_dump that's been silently failing for six months is the single most likely
    // catastrophic failure mode for this system." (PROPOSAL.md)
    expect(classifyBackupAge(hoursAgo(24 * 180), NOW, 48)).toMatchObject({ severity: 'stale' });
  });

  it("distinguishes 'never backed up' from 'stale'", () => {
    expect(classifyBackupAge(null, NOW, 48)).toEqual({ severity: 'never', ageHours: null });
  });

  it('honours a custom threshold', () => {
    expect(classifyBackupAge(hoursAgo(10), NOW, 6)).toMatchObject({ severity: 'stale' });
    expect(classifyBackupAge(hoursAgo(10), NOW, 24)).toMatchObject({ severity: 'ok' });
  });

  it('treats a future timestamp as fresh rather than erroring', () => {
    // Laptop clock skew after sleep is common; alarming over it would train the
    // household to ignore this indicator.
    expect(classifyBackupAge(new Date(NOW.getTime() + 3_600_000), NOW, 48)).toEqual({
      severity: 'ok',
      ageHours: 0,
    });
  });
});

describe('formatRelativeAge', () => {
  it.each([
    [0, 'less than an hour ago'],
    [1, '1 hour ago'],
    [5, '5 hours ago'],
    [47, '47 hours ago'],
    [48, '2 days ago'],
    [24 * 9, '9 days ago'],
  ])('formats %i hours as "%s"', (hours, expected) => {
    expect(formatRelativeAge(hours)).toBe(expected);
  });
});
