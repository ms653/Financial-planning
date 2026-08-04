import { describe, expect, it } from 'vitest';
import { currentUkTaxYearWindow } from './taxYear';

describe('currentUkTaxYearWindow', () => {
  it('is 6 April of this year to 5 April next year, on 6 April itself', () => {
    expect(currentUkTaxYearWindow('2026-04-06')).toEqual({
      startIso: '2026-04-06',
      endIso: '2027-04-05',
    });
  });

  it('is 6 April of last year to 5 April this year, on 5 April itself', () => {
    expect(currentUkTaxYearWindow('2026-04-05')).toEqual({
      startIso: '2025-04-06',
      endIso: '2026-04-05',
    });
  });

  it('mid-year dates fall in the tax year that started the previous 6 April', () => {
    expect(currentUkTaxYearWindow('2026-08-03')).toEqual({
      startIso: '2026-04-06',
      endIso: '2027-04-05',
    });
  });

  it('early-calendar-year dates fall in the tax year that started the prior 6 April', () => {
    expect(currentUkTaxYearWindow('2027-01-15')).toEqual({
      startIso: '2026-04-06',
      endIso: '2027-04-05',
    });
  });

  it('throws on a malformed date rather than guessing', () => {
    expect(() => currentUkTaxYearWindow('06/04/2026')).toThrow(/YYYY-MM-DD/);
  });
});
