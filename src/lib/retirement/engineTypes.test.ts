import { describe, expect, it } from 'vitest';
import { DRAWDOWN_ACCOUNT_TYPES, percentStringToScaledFraction, RATE_SCALE } from './engineTypes';

describe('percentStringToScaledFraction', () => {
  it('converts a percent string to a RATE_SCALE-scaled fraction', () => {
    // 2.500% -> fraction 0.025, scaled by 10^6.
    expect(percentStringToScaledFraction('2.500')).toBe(25_000n);
  });

  it('converts 100% to a scaled fraction of exactly 1', () => {
    expect(percentStringToScaledFraction('100.000')).toBe(10n ** BigInt(RATE_SCALE));
  });

  it('converts 0% to a scaled fraction of 0', () => {
    expect(percentStringToScaledFraction('0.000')).toBe(0n);
  });

  it('preserves sign for a negative percent (e.g. deflation)', () => {
    expect(percentStringToScaledFraction('-2.500')).toBe(-25_000n);
  });

  it('rounds half up rather than truncating', () => {
    // Any percent string with at most 3 decimal places (the shape scenarioAssumptions.ts
    // actually produces, matching the `percent` schema column's NUMERIC(6,3)) always
    // divides evenly by 100 once scaled to RATE_SCALE=6 — there's no remainder to round.
    // Rounding only becomes reachable with more precision than that, which this
    // function's own signature (any string, not just 3dp) still has to handle
    // correctly: "2.505050" scales to 2,505,050 (RATE_SCALE=6), and dividing by 100
    // lands exactly on a .5 boundary (25050.5) — round-half-up takes it to 25051, not
    // truncated down to 25050.
    expect(percentStringToScaledFraction('2.505050')).toBe(25_051n);
  });
});

describe('DRAWDOWN_ACCOUNT_TYPES', () => {
  it('excludes debt and property — neither is a liquid decumulation wrapper', () => {
    expect(DRAWDOWN_ACCOUNT_TYPES).not.toContain('debt');
    expect(DRAWDOWN_ACCOUNT_TYPES).not.toContain('property');
  });

  it('includes every other account type', () => {
    expect([...DRAWDOWN_ACCOUNT_TYPES].sort()).toEqual(
      ['cash', 'cash_isa', 'gia', 'lisa', 'sipp_pension', 'ss_isa'].sort(),
    );
  });
});
