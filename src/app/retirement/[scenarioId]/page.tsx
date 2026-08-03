import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { ResultsBody, type PreRetirementContribution } from '@/components/retirement/ResultsBody';
import { getPeopleWithPensions, getRegularContributionAmounts, getSetupState } from '@/lib/household/queries';
import { getScenarios, getScenarioWithLatestRun } from '@/lib/retirement/queries';
import { parseScenarioAssumptions } from '@/lib/retirement/scenarioAssumptions';
import { ageAsOf } from '@/lib/retirement/personAge';
import { todayIso } from '@/lib/accounts/validation';
import { formatMoney, numericToPence } from '@/lib/money';
import type { SimulationRunView } from '@/lib/retirement/simulationRunClient';

/**
 * Retirement Planner — Results (`docs/DESIGN_SPEC.md`'s `/retirement/:scenarioId`).
 * The initial data fetch and guards are server-side; everything that can change after
 * first paint (a running simulation completing, a re-run) lives in `ResultsBody`, a
 * client component.
 */

export const dynamic = 'force-dynamic';

export default async function ScenarioResultsPage({ params }: { params: { scenarioId: string } }) {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const scenarioId = Number.parseInt(params.scenarioId, 10);
  if (!Number.isInteger(scenarioId)) notFound();

  const scenario = await getScenarioWithLatestRun(scenarioId, setup.householdId);
  if (!scenario) notFound();

  const assumptions = parseScenarioAssumptions(scenario.assumptions);
  const people = await getPeopleWithPensions(setup.householdId);
  const personNames = people.map((p) => ({ id: p.id, name: p.name }));

  const referencePersonId = assumptions.people[0]!.personId;
  const referencePerson = people.find((p) => p.id === referencePersonId);
  const referencePersonName = referencePerson?.name ?? 'This person';
  const referencePersonDob = referencePerson?.dateOfBirth ?? '2000-01-01';

  // Phase 4.4 (and its follow-up): who's still short of their own retirementAge, and
  // what they're assumed to be contributing until then — pension plus every personal
  // regular_contribution — surfaced here (not just silently baked into the simulation)
  // so the household can see and correct it via Settings/the account page if it's
  // stale. Regular_contribution rows on a jointly-owned account have no single
  // person's retirementAge to attribute to, so they're totalled separately below.
  const today = todayIso();
  const regularContributionAmounts = await getRegularContributionAmounts(setup.householdId);
  const personalRegularContributionPenceById = new Map<number, bigint>();
  let jointRegularContributionPence = 0n;
  for (const row of regularContributionAmounts) {
    const pence = numericToPence(row.amount);
    if (row.personId === null) {
      jointRegularContributionPence += pence;
    } else {
      personalRegularContributionPenceById.set(
        row.personId,
        (personalRegularContributionPenceById.get(row.personId) ?? 0n) + pence,
      );
    }
  }

  const preRetirementContributions: PreRetirementContribution[] = assumptions.people.flatMap((assumptionPerson) => {
    const person = people.find((p) => p.id === assumptionPerson.personId);
    if (!person) return [];
    const currentAge = ageAsOf(person.dateOfBirth, today);
    if (currentAge >= assumptionPerson.retirementAge) return [];
    const pensionPence = person.pensionContributions.reduce(
      (sum, c) => sum + numericToPence(c.amount) + numericToPence(c.employerAmount),
      0n,
    );
    const totalPence = pensionPence + (personalRegularContributionPenceById.get(person.id) ?? 0n);
    if (totalPence === 0n) return [];
    return [
      {
        personId: person.id,
        name: person.name,
        retirementAge: assumptionPerson.retirementAge,
        annualContribution: formatMoney(totalPence),
      },
    ];
  });

  // Joint contributions apply household-wide until every included person has retired
  // (deterministicCore.ts's householdFullyRetired gate) — shown only alongside at
  // least one still-working person, the same condition that keeps them landing.
  const jointAnnualContribution =
    jointRegularContributionPence > 0n && preRetirementContributions.length > 0
      ? formatMoney(jointRegularContributionPence)
      : null;

  const otherScenarios = (await getScenarios(setup.householdId)).filter((s) => s.id !== scenarioId);

  // Converted explicitly to plain JSON-safe values, not passed through as-is: a `Date`
  // crossing the server-to-client component boundary is revived as a `Date` by React
  // Flight, not stringified the way `Response.json` (the API route's own path) would —
  // `ResultsBody`'s `SimulationRunView` prop type expects `createdAt`/`completedAt` as
  // strings, matching what a later poll response actually returns, so this has to match.
  const initialRun: SimulationRunView | null = scenario.latestRun
    ? {
        id: scenario.latestRun.id,
        scenarioId: scenario.latestRun.retirementScenarioId,
        status: scenario.latestRun.status,
        seed: scenario.latestRun.seed,
        iterationCount: scenario.latestRun.iterationCount,
        result: scenario.latestRun.result,
        errorDetail: scenario.latestRun.errorDetail,
        createdAt: scenario.latestRun.createdAt.toISOString(),
        completedAt: scenario.latestRun.completedAt ? scenario.latestRun.completedAt.toISOString() : null,
      }
    : null;

  return (
    <AppShell pathname="/retirement">
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-content-muted">
        <Link href="/retirement" className="underline underline-offset-2 hover:text-content">
          Retirement
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span>{scenario.name}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl leading-tight text-content">
          {scenario.name}
          {scenario.isBaseline ? (
            <span className="ml-2 align-middle text-xs font-medium uppercase tracking-wider text-brass-strong dark:text-brass">
              Baseline
            </span>
          ) : null}
        </h1>

        {otherScenarios.length > 0 ? (
          <details className="relative">
            <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content transition hover:border-brass">
              Compare
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-64 rounded-card border border-line bg-paper-raised p-2 shadow-card">
              {otherScenarios.map((other) => (
                <Link
                  key={other.id}
                  href={`/retirement/compare?a=${scenarioId}&b=${other.id}`}
                  className="block rounded-lg px-3 py-2 text-sm text-content transition hover:bg-paper-sunken"
                >
                  Compare with {other.name}
                </Link>
              ))}
              <Link
                href="/retirement/new"
                className="block rounded-lg px-3 py-2 text-sm text-content-muted transition hover:bg-paper-sunken"
              >
                Create a new one to compare
              </Link>
            </div>
          </details>
        ) : (
          <Link
            href="/retirement/new"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition hover:border-brass"
          >
            Create a scenario to compare
          </Link>
        )}
      </div>

      <ResultsBody
        scenarioId={scenarioId}
        targetSuccessRatePct={assumptions.targetSuccessRatePct}
        initialRun={initialRun}
        assumptions={assumptions}
        personNames={personNames}
        referencePersonDob={referencePersonDob}
        referencePersonName={referencePersonName}
        scenarioUpdatedAtIso={scenario.updatedAt.toISOString()}
        editHref={`/retirement/${scenarioId}/edit`}
        preRetirementContributions={preRetirementContributions}
        jointAnnualContribution={jointAnnualContribution}
      />
    </AppShell>
  );
}
