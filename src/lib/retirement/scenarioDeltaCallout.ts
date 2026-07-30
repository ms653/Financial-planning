/**
 * The Comparison screen's "compact delta callout" — `docs/DESIGN_SPEC.md`'s own example:
 * "Scenario B: 12 percentage points higher success rate, retires 2 years later". Pure,
 * builds one sentence (not a list of bullets) from whatever actually differs, so a pair
 * of scenarios that differ in only one respect doesn't read a trailing ", " for nothing.
 */

export interface DeltaCalloutInput {
  /** The side being described relative to the other, e.g. "Scenario B". */
  label: string;
  successRateFraction: number;
  otherSuccessRateFraction: number;
  /** Reference person's retirement age (people[0] — same reference-person convention
   * `fanChartData.ts` uses, so the two screens never disagree about "whose age"). */
  retirementAge: number;
  otherRetirementAge: number;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Returns `null` when the two sides are identical in every dimension this callout
 * covers — nothing to say, rather than an empty or misleading sentence. */
export function buildDeltaCallout(input: DeltaCalloutInput): string | null {
  const clauses: string[] = [];

  const ppDiff = Math.round((input.successRateFraction - input.otherSuccessRateFraction) * 100);
  if (ppDiff !== 0) {
    const direction = ppDiff > 0 ? 'higher' : 'lower';
    clauses.push(`${pluralize(Math.abs(ppDiff), 'percentage point')} ${direction} success rate`);
  }

  const ageDiff = input.retirementAge - input.otherRetirementAge;
  if (ageDiff !== 0) {
    const direction = ageDiff > 0 ? 'later' : 'earlier';
    clauses.push(`retires ${pluralize(Math.abs(ageDiff), 'year')} ${direction}`);
  }

  if (clauses.length === 0) return null;
  return `${input.label}: ${clauses.join(', ')}`;
}
