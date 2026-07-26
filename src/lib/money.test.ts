import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatMoneyParts,
  formatNumeric,
  numericToPence,
  parseMoneyInput,
  penceToNumeric,
  sumNumeric,
  sumPence,
} from '@/lib/money';

/**
 * These tests are the guard on the proposal's "never float" requirement. The cases that
 * matter most are the ones where a float implementation would pass a casual eyeball and
 * still be wrong — 0.1 + 0.2, a long column of pence, and a value with more precision
 * than the column can hold.
 */

describe('parseMoneyInput', () => {
  it('parses plain pounds and pence', () => {
    expect(parseMoneyInput('1234.56')).toEqual({ ok: true, pence: 123456n });
    expect(parseMoneyInput('0.01')).toEqual({ ok: true, pence: 1n });
    expect(parseMoneyInput('0')).toEqual({ ok: true, pence: 0n });
  });

  it('pads a single decimal place to pence rather than misreading it', () => {
    // The bug this guards: '1.5' -> 15 pence instead of 150.
    expect(parseMoneyInput('1.5')).toEqual({ ok: true, pence: 150n });
  });

  it('tolerates what people actually type into a balance field', () => {
    expect(parseMoneyInput(' £12,500.00 ')).toEqual({ ok: true, pence: 1250000n });
    expect(parseMoneyInput('+42')).toEqual({ ok: true, pence: 4200n });
    expect(parseMoneyInput('376500')).toEqual({ ok: true, pence: 37650000n });
  });

  it('parses negatives, which debt snapshots need', () => {
    expect(parseMoneyInput('-376500.00')).toEqual({ ok: true, pence: -37650000n });
    expect(parseMoneyInput('-0.01')).toEqual({ ok: true, pence: -1n });
  });

  it('rejects empty and non-numeric input instead of yielding NaN', () => {
    expect(parseMoneyInput('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMoneyInput('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMoneyInput('-')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMoneyInput('abc')).toEqual({ ok: false, reason: 'not-a-number' });
    expect(parseMoneyInput('12abc')).toEqual({ ok: false, reason: 'not-a-number' });
    expect(parseMoneyInput('1.2.3')).toEqual({ ok: false, reason: 'not-a-number' });
    expect(parseMoneyInput('1e5')).toEqual({ ok: false, reason: 'not-a-number' });
  });

  it('rejects more precision than the column can hold rather than rounding it away', () => {
    expect(parseMoneyInput('10.999')).toEqual({ ok: false, reason: 'too-many-decimals' });
  });

  it('rejects amounts NUMERIC(14,2) cannot store', () => {
    expect(parseMoneyInput('999999999999.99')).toEqual({ ok: true, pence: 99999999999999n });
    expect(parseMoneyInput('1000000000000.00')).toEqual({ ok: false, reason: 'out-of-range' });
  });
});

describe('penceToNumeric / numericToPence', () => {
  it('round-trips exactly', () => {
    for (const pence of [0n, 1n, 99n, 100n, 123456n, -37650000n, 99999999999999n]) {
      expect(numericToPence(penceToNumeric(pence))).toBe(pence);
    }
  });

  it('always renders two decimal places for the column', () => {
    expect(penceToNumeric(0n)).toBe('0.00');
    expect(penceToNumeric(5n)).toBe('0.05');
    expect(penceToNumeric(150n)).toBe('1.50');
    expect(penceToNumeric(-1n)).toBe('-0.01');
    expect(penceToNumeric(-37650000n)).toBe('-376500.00');
  });

  it('reads the shapes Postgres returns', () => {
    expect(numericToPence('12500.00')).toBe(1250000n);
    expect(numericToPence('-376500.00')).toBe(-37650000n);
  });

  it('throws on garbage rather than returning a plausible wrong number', () => {
    expect(() => numericToPence('not money')).toThrow(/Not a NUMERIC money value/);
  });
});

describe('summation is exact', () => {
  it('adds the classic float-error case exactly', () => {
    // 0.1 + 0.2 in IEEE 754 is 0.30000000000000004.
    expect(penceToNumeric(sumNumeric(['0.10', '0.20']))).toBe('0.30');
  });

  it('adds a long column of pence without drift', () => {
    // 10,000 x 1p is exactly £100. A float accumulation of 0.01 drifts here.
    const pennies = Array.from({ length: 10_000 }, () => 1n);
    expect(penceToNumeric(sumPence(pennies))).toBe('100.00');
  });

  it('nets assets against debts, which is the whole net worth calculation', () => {
    const total = sumNumeric(['410000.00', '6180.00', '-376500.00', '186420.00']);
    expect(penceToNumeric(total)).toBe('226100.00');
  });

  it('sums to a negative total when a household is mortgage-heavy', () => {
    // Negative net worth is a legitimate state, not an error (DESIGN_SPEC.md edge case).
    expect(penceToNumeric(sumNumeric(['12000.00', '-250000.00']))).toBe('-238000.00');
  });

  it('sums nothing to zero', () => {
    expect(sumPence([])).toBe(0n);
  });
});

describe('formatMoney', () => {
  it('groups thousands and defaults to whole pounds', () => {
    expect(formatMoney(41230840n)).toBe('£412,308');
    expect(formatMoney(618000n)).toBe('£6,180');
    expect(formatMoney(100n)).toBe('£1');
  });

  it('shows pence when asked', () => {
    expect(formatMoney(41230840n, { showPence: true })).toBe('£412,308.40');
    expect(formatMoney(5n, { showPence: true })).toBe('£0.05');
  });

  it('rounds to the nearest pound so a displayed column adds up', () => {
    expect(formatMoney(150n)).toBe('£2');
    expect(formatMoney(149n)).toBe('£1');
    // Rounding up must carry into the grouping, not produce '£1,000' as '£999'.
    expect(formatMoney(99999n + 51n)).toBe('£1,001');
  });

  it('uses a true minus sign for negatives', () => {
    expect(formatMoney(-37650000n)).toBe('−£376,500');
  });

  it('can render negatives in parentheses for the negative-net-worth case', () => {
    // DESIGN_SPEC.md: negative net worth should be "visually distinct" but not alarming.
    expect(formatMoney(-23800000n, { parentheses: true })).toBe('(£238,000)');
  });

  it('carries a currency other than GBP for Phase 2', () => {
    expect(formatMoney(123456n, { currency: 'USD', showPence: true })).toBe('$1,234.56');
    expect(formatMoney(100n, { currency: 'CHF' })).toBe('CHF 1');
  });

  it('formats a NUMERIC string straight from a query', () => {
    expect(formatNumeric('412308.40')).toBe('£412,308');
  });
});

describe('formatMoneyParts', () => {
  it('splits pounds from pence for the dashboard hero', () => {
    expect(formatMoneyParts(41230840n)).toEqual({ main: '£412,308', fraction: '.40' });
  });

  it('keeps the minus sign with the pounds', () => {
    expect(formatMoneyParts(-23800000n)).toEqual({ main: '−£238,000', fraction: '.00' });
  });
});
