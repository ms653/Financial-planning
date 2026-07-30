import { describe, expect, it } from 'vitest';
import { formatCompactPounds } from './chartFormatting';

describe('formatCompactPounds', () => {
  it('formats sub-thousand amounts plainly', () => {
    expect(formatCompactPounds(50000n)).toBe('£500');
  });

  it('formats thousands with a k suffix', () => {
    expect(formatCompactPounds(10_000_000n)).toBe('£100k');
  });

  it('formats millions with an m suffix', () => {
    expect(formatCompactPounds(1_200_000_00n)).toBe('£1.2m');
  });

  it('formats an exact million with no decimal', () => {
    expect(formatCompactPounds(1_000_000_00n)).toBe('£1m');
  });

  it('formats negative amounts with a real minus sign', () => {
    expect(formatCompactPounds(-50_000_00n)).toBe('−£50k');
  });

  it('formats zero', () => {
    expect(formatCompactPounds(0n)).toBe('£0');
  });
});
