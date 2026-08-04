/**
 * The UK tax year runs 6 April–5 April, not the calendar year — needed by Phase 4.5's
 * waterfall to know "how much ISA/LISA allowance has this household used so far this
 * tax year." Dates are plain `YYYY-MM-DD` strings compared lexicographically
 * throughout, the same convention `taxYearConfig.ts` already established for exactly
 * this reason (no timezone conversion is ever needed for a date-only fact).
 */

export interface UkTaxYearWindow {
  /** Inclusive, `YYYY-MM-DD`. */
  startIso: string;
  /** Inclusive, `YYYY-MM-DD`. */
  endIso: string;
}

/**
 * The UK tax year window containing `todayIso`. If today is on or after 6 April, the
 * window is this calendar year's 6 April to next calendar year's 5 April; otherwise
 * it's last calendar year's 6 April to this calendar year's 5 April.
 */
export function currentUkTaxYearWindow(todayIso: string): UkTaxYearWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(todayIso)}`);
  }
  const year = Number(todayIso.slice(0, 4));
  const aprilSixthThisYear = `${year}-04-06`;

  if (todayIso >= aprilSixthThisYear) {
    return { startIso: aprilSixthThisYear, endIso: `${year + 1}-04-05` };
  }
  return { startIso: `${year - 1}-04-06`, endIso: `${year}-04-05` };
}
