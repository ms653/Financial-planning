/**
 * Versioned UK tax-year constants.
 *
 * `docs/PROPOSAL.md`'s Testing strategy section calls for exactly this shape: "a
 * versioned `tax_year_config` module (a typed constants file per tax year, no database
 * table needed) that both the advisor and the engine consume turns the annual update
 * into 'one file plus its test vectors', not a grep across the codebase." Phase 3 only
 * consumes the State Pension figures below; Phase 4.5's personal-allowance/annual-allowance
 * taper constants belong in this same file when that phase starts, not a second one.
 *
 * Every fact here is sourced, not estimated — the same discipline Phase 2 applied to the
 * GBX-vs-GBP provider check before building on it. Where gov.uk states something is
 * still under review, that is recorded rather than smoothed over.
 */

/**
 * State Pension weekly/annual amount, 2026/27 tax year.
 *
 * £241.30/week, per `docs/PROPOSAL.md` §2 (itself sourced from
 * RetirementExpert.co.uk and PoundSense, cited there). Stored as the weekly figure in
 * pence — the one DWP actually quotes and uprates annually via the "triple lock" — with
 * the annual figure *derived* by multiplying, not stored as a second independent
 * constant that could silently disagree with the weekly one. Note this lands on
 * £12,547.60/year exactly, not the commonly quoted "~£12,548" rounding.
 */
export const STATE_PENSION_WEEKLY_PENCE_2026_27 = 24_130n;

export function statePensionAnnualPence(): bigint {
  return STATE_PENSION_WEEKLY_PENCE_2026_27 * 52n;
}

/**
 * Personal allowance taper (Phase 4.5's Cash Allocation Advisor). Adjusted net income
 * (ANI) above `PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27` withdraws the standard
 * personal allowance at £1 per £2, until it reaches zero at
 * `personalAllowanceTaperCeilingPence()` — derived from the two constants below rather
 * than stored as a third independent figure, so it can't silently disagree with them
 * (the same reasoning `statePensionAnnualPence` above already applies to its own
 * weekly→annual derivation). £12,570 has been frozen since 2021/22; Autumn Budget 2025
 * extended that freeze to April 2031, so it holds for 2026/27 unchanged
 * (`docs/PROPOSAL.md` §2).
 */
export const PERSONAL_ALLOWANCE_PENCE_2026_27 = 12_570_00n;
export const PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27 = 100_000_00n;

export function personalAllowanceTaperCeilingPence(): bigint {
  return PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27 + 2n * PERSONAL_ALLOWANCE_PENCE_2026_27;
}

/**
 * Pension annual allowance (Phase 4.5). £60,000/year standard allowance, restricted to
 * £10,000/year (the Money Purchase Annual Allowance, MPAA) for anyone who has already
 * flexibly accessed a pension — `docs/PROPOSAL.md` §4's waterfall step 7 caps further
 * pension contributions at whichever of these applies, before carry-forward.
 *
 * The taper that further restricts this allowance for high earners (threshold income
 * over £200,000 AND adjusted income over £260,000, tapering £1 per £2 of adjusted
 * income above £260,000 down to the same £10,000 floor) is deliberately **not**
 * encoded here yet — confirmed against gov.uk's own "Tapered Annual Allowance"
 * guidance (gov.uk/guidance/pension-schemes-work-out-your-tapered-annual-allowance,
 * fetched 2026-08-03) but `docs/PROPOSAL.md` explicitly defers the exact
 * threshold-income/adjusted-income *worksheet mechanics* (how salary sacrifice is
 * added back, etc.) to Phase 4.5 implementation, and that worksheet is what actually
 * consumes these two constants — landing them without the worksheet that uses them
 * would be a half-finished feature. They belong with the threshold/adjusted-income
 * calculation itself, in `src/lib/advisor/taxStatus.ts`, once that's built (Milestone
 * 2, not this one).
 */
export const PENSION_ANNUAL_ALLOWANCE_PENCE_2026_27 = 60_000_00n;
export const MPAA_PENCE_2026_27 = 10_000_00n;

/**
 * A UK State Pension age band, as gov.uk's own "State Pension age timetable" states it
 * (published under the Pensions Act 2007 and Pensions Act 2014). Fetched and
 * transcribed 2026-07-27 from
 * https://www.gov.uk/government/publications/state-pension-age-timetable/state-pension-age-timetable
 *
 * Four regions, in birth-date order:
 *  1. Born before 6 April 1960: age 66.
 *  2. Born 6 April 1960 – 5 March 1961: a *monthly* transitional band — 66 years plus 1
 *     to 11 months, depending on which one-month birth window you fall into (Pensions
 *     Act 2014, Table 4). Encoded below as `MONTHLY_TRANSITION_66_TO_67`.
 *  3. Born 6 March 1961 – 5 April 1977: age 67.
 *  4. Born 6 April 1977 – 5 April 1978: a transitional band to 68, but gov.uk expresses
 *     this one as literal target *dates* per one-month birth window (Pensions Act 2007,
 *     Table 5), not a clean age-plus-months offset — encoded below as
 *     `DATED_TRANSITION_67_TO_68` using the literal dates, not derived arithmetic.
 *  5. Born on or after 6 April 1978: age 68 — **under current legislation only**.
 *     gov.uk's own publication states explicitly: "the timetable for the increase in the
 *     State Pension age from 67 to 68 could change as a result of the review." Two
 *     government reviews (Government Actuary's Department, and an independent expert)
 *     were ongoing as of mid-2026 into whether to bring this forward to 2037–39; nothing
 *     has been legislated to change it yet. This is exactly the kind of fact this module
 *     exists to hold in one place — if it changes, it changes here, dated, not silently.
 */
const FLAT_66_CUTOFF = '1960-04-06'; // born before this date: flat 66
const TRANSITION_66_TO_67_END = '1961-03-05'; // last day of the monthly-transition band
const FLAT_67_START = '1961-03-06';
const TRANSITION_67_TO_68_START = '1977-04-06';
const TRANSITION_67_TO_68_END = '1978-04-05';
const FLAT_68_START = '1978-04-06';

/** Birth-month window (inclusive `from`, inclusive `to`) → months added to 66 years. */
const MONTHLY_TRANSITION_66_TO_67: Array<{ from: string; to: string; extraMonths: number }> = [
  { from: '1960-04-06', to: '1960-05-05', extraMonths: 1 },
  { from: '1960-05-06', to: '1960-06-05', extraMonths: 2 },
  { from: '1960-06-06', to: '1960-07-05', extraMonths: 3 },
  { from: '1960-07-06', to: '1960-08-05', extraMonths: 4 },
  { from: '1960-08-06', to: '1960-09-05', extraMonths: 5 },
  { from: '1960-09-06', to: '1960-10-05', extraMonths: 6 },
  { from: '1960-10-06', to: '1960-11-05', extraMonths: 7 },
  { from: '1960-11-06', to: '1960-12-05', extraMonths: 8 },
  { from: '1960-12-06', to: '1961-01-05', extraMonths: 9 },
  { from: '1961-01-06', to: '1961-02-05', extraMonths: 10 },
  { from: '1961-02-06', to: '1961-03-05', extraMonths: 11 },
];

/** Birth-month window → the literal State Pension date gov.uk publishes for it. */
const DATED_TRANSITION_67_TO_68: Array<{ from: string; to: string; statePensionDate: string }> = [
  { from: '1977-04-06', to: '1977-05-05', statePensionDate: '2044-05-06' },
  { from: '1977-05-06', to: '1977-06-05', statePensionDate: '2044-07-06' },
  { from: '1977-06-06', to: '1977-07-05', statePensionDate: '2044-09-06' },
  { from: '1977-07-06', to: '1977-08-05', statePensionDate: '2044-11-06' },
  { from: '1977-08-06', to: '1977-09-05', statePensionDate: '2045-01-06' },
  { from: '1977-09-06', to: '1977-10-05', statePensionDate: '2045-03-06' },
  { from: '1977-10-06', to: '1977-11-05', statePensionDate: '2045-05-06' },
  { from: '1977-11-06', to: '1977-12-05', statePensionDate: '2045-07-06' },
  { from: '1977-12-06', to: '1978-01-05', statePensionDate: '2045-09-06' },
  { from: '1978-01-06', to: '1978-02-05', statePensionDate: '2045-11-06' },
  { from: '1978-02-06', to: '1978-03-05', statePensionDate: '2046-01-06' },
  { from: '1978-03-06', to: '1978-04-05', statePensionDate: '2046-03-06' },
];

/** Add whole calendar years to an ISO date, clamping 29 Feb to 28 Feb in a non-leap
 * target year — never rolling into March, which `Date.UTC`'s own overflow behaviour
 * would otherwise do silently. */
function addCalendarYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const targetYear = y + years;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTargetMonth);
  return `${String(targetYear).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * Add whole years then whole months to an ISO date, same end-of-month clamping applied
 * at each step in sequence — the years step can clamp (29 Feb → 28 Feb), and the months
 * step then clamps again against whatever day the years step produced, rather than
 * clamping once against the final target month. The only caller today
 * (`MONTHLY_TRANSITION_66_TO_67`) never combines a 29 February birth date with a
 * month-shortening step, so this two-step clamping and a single "clamp once at the end"
 * implementation can't currently disagree — but they are not the same function in
 * general, and a future caller with different offsets could hit a case where they do.
 */
function addCalendarYearsAndMonths(iso: string, years: number, months: number): string {
  const withYears = addCalendarYears(iso, years);
  const [y, m, d] = withYears.split('-').map(Number) as [number, number, number];
  const totalMonths = m - 1 + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = (((totalMonths % 12) + 12) % 12) + 1;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTargetMonth);
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * The ISO date a person born on `dateOfBirth` (a `YYYY-MM-DD` string) first reaches
 * State Pension age, under the currently legislated timetable.
 *
 * Comparisons are plain ISO string comparisons throughout (valid for `YYYY-MM-DD`,
 * the same trick `todayIso`/future-date checks already use elsewhere in this codebase)
 * rather than parsing to `Date` and comparing epoch values, since no timezone
 * conversion is ever needed for a date-only fact like this.
 *
 * Throws on a malformed `dateOfBirth` rather than letting a lexicographic comparison
 * land it in an arbitrary branch — today's only real caller (`person.date_of_birth`) is
 * a `NOT NULL date` column Postgres itself constrains, but this function is exported,
 * and "throw, don't guess" is this codebase's standing posture for exactly this shape
 * of input.
 */
export function statePensionDate(dateOfBirth: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    throw new Error(`Not a YYYY-MM-DD date of birth: ${JSON.stringify(dateOfBirth)}`);
  }

  if (dateOfBirth < FLAT_66_CUTOFF) {
    return addCalendarYears(dateOfBirth, 66);
  }

  if (dateOfBirth <= TRANSITION_66_TO_67_END) {
    const band = MONTHLY_TRANSITION_66_TO_67.find(
      (b) => dateOfBirth >= b.from && dateOfBirth <= b.to,
    );
    if (!band) throw new Error(`No 66→67 transition band matched date of birth ${dateOfBirth}`);
    return addCalendarYearsAndMonths(dateOfBirth, 66, band.extraMonths);
  }

  if (dateOfBirth < TRANSITION_67_TO_68_START) {
    // Covers FLAT_67_START through the day before the next transition starts.
    return addCalendarYears(dateOfBirth, 67);
  }

  if (dateOfBirth <= TRANSITION_67_TO_68_END) {
    const band = DATED_TRANSITION_67_TO_68.find(
      (b) => dateOfBirth >= b.from && dateOfBirth <= b.to,
    );
    if (!band) throw new Error(`No 67→68 transition band matched date of birth ${dateOfBirth}`);
    return band.statePensionDate;
  }

  if (dateOfBirth >= FLAT_68_START) {
    return addCalendarYears(dateOfBirth, 68);
  }

  // Unreachable given the bands above are contiguous and exhaustive from FLAT_66_CUTOFF
  // onward, but keeps the function total rather than implicitly returning undefined.
  throw new Error(`No State Pension age band matched date of birth ${dateOfBirth}`);
}
