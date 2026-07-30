import { describe, expect, it } from 'vitest';
import { successBandFor } from './successBand';

describe('successBandFor', () => {
  it('is "on-track" exactly at target', () => {
    expect(successBandFor(0.9, '90.000')).toBe('on-track');
  });

  it('is "strong" at target + 10pp', () => {
    expect(successBandFor(1.0, '90.000')).toBe('strong');
  });

  it('is "on-track" just below the strong margin', () => {
    expect(successBandFor(0.99, '90.000')).toBe('on-track');
  });

  it('is "at-risk" below target', () => {
    expect(successBandFor(0.89, '90.000')).toBe('at-risk');
  });

  it('treats 0% as a valid, non-error "at-risk" result', () => {
    expect(successBandFor(0, '90.000')).toBe('at-risk');
  });

  it('treats 100% as "strong" whenever target + 10pp <= 100', () => {
    expect(successBandFor(1, '85.000')).toBe('strong');
  });

  it('makes "strong" unreachable for a target of 90% or higher, by design', () => {
    // 100% achieved against a 95% target is only 5pp above target, short of the 10pp
    // margin needed for "strong" — an already-ambitious target isn't easy to exceed.
    expect(successBandFor(1, '95.000')).toBe('on-track');
  });

  it('is "on-track" for a 100% target achieving exactly 100%', () => {
    expect(successBandFor(1, '100.000')).toBe('on-track');
  });
});
