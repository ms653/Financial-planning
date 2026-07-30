/**
 * Pure date-of-birth arithmetic, extracted out of `resolveScenario.ts` so it can be
 * imported client-side (Milestone 9's Scenario Editor needs both functions for "When"
 * section defaults and live retirement-age validation) without dragging `resolveScenario.ts`'s
 * `getDb()`/drizzle imports into a client bundle. `resolveScenario.ts` re-exports both names
 * unchanged so its own existing imports and tests keep working.
 */

/** Whole years elapsed from `dob` to `asOf` (both `YYYY-MM-DD`), floored — you're not a
 * year older until the anniversary has passed. Nothing existing in this codebase
 * computes an age from a date of birth (checked); `taxYearConfig.ts` deliberately
 * works in dates, not ages, by M1's own design. */
export function ageAsOf(dob: string, asOf: string): number {
  const [dobY, dobM, dobD] = dob.split('-').map(Number) as [number, number, number];
  const [asOfY, asOfM, asOfD] = asOf.split('-').map(Number) as [number, number, number];
  let age = asOfY - dobY;
  if (asOfM < dobM || (asOfM === dobM && asOfD < dobD)) age -= 1;
  return age;
}

/**
 * The default `statePensionClaimAge` when a scenario doesn't override it: the whole
 * number of years from `dob` to `statePensionDate(dob)`, rounded *up* when the two
 * don't land on the same day (conservative — assumes the State Pension arrives no
 * earlier than reality, never optimistic). For anyone in a flat age band (66/67/68 —
 * which includes both of this household's own people, born 1985 and 1987, per
 * Milestone 1's own finding), `statePensionDate` always lands exactly on a birthday, so
 * this reduces to an exact integer with no rounding at all. Only the two narrow
 * transitional birth-date bands (66→67, 67→68) ever actually round.
 */
export function statePensionClaimAgeFromDate(dob: string, statePensionDateIso: string): number {
  const flooredAge = ageAsOf(dob, statePensionDateIso);
  const sameDayOfYear = statePensionDateIso.slice(5) === dob.slice(5);
  return sameDayOfYear ? flooredAge : flooredAge + 1;
}
