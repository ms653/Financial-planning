import { redirect } from 'next/navigation';
import { getSetupState } from '@/lib/household/queries';
import { getScenarios } from '@/lib/retirement/queries';

/**
 * Bare `/retirement` — the nav link's target. Per `docs/DESIGN_SPEC.md`'s user flow
 * ("User opens Retirement Planner → System shows the most recent scenario's
 * assumptions and its last-computed results"), this redirects into a real scenario's
 * Results screen rather than rendering a list.
 *
 * **Judgment call**: the spec never states what happens with zero scenarios ever
 * created. Redirects to `/retirement/new` — the only sensible destination, matching the
 * Results screen's own "Run your first simulation" empty state's own CTA target.
 *
 * **Judgment call**: "most recent" reuses `getScenarios`' existing ordering (baseline
 * first, then newest-created) rather than a second "most recently updated" notion — a
 * household that has designated a baseline almost certainly wants to land on *that*
 * plan by default regardless of when it was last touched.
 */

export const dynamic = 'force-dynamic';

export default async function RetirementIndexPage() {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const scenarios = await getScenarios(setup.householdId);
  if (scenarios.length === 0) redirect('/retirement/new');

  redirect(`/retirement/${scenarios[0]!.id}`);
}
