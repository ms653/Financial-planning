import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { ResultsBody } from '@/components/retirement/ResultsBody';
import { getPeople, getSetupState } from '@/lib/household/queries';
import { getScenarios, getScenarioWithLatestRun } from '@/lib/retirement/queries';
import { parseScenarioAssumptions } from '@/lib/retirement/scenarioAssumptions';
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
  const people = await getPeople(setup.householdId);
  const personNames = people.map((p) => ({ id: p.id, name: p.name }));

  const referencePersonId = assumptions.people[0]!.personId;
  const referencePerson = people.find((p) => p.id === referencePersonId);
  const referencePersonName = referencePerson?.name ?? 'This person';
  const referencePersonDob = referencePerson?.dateOfBirth ?? '2000-01-01';

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
      />
    </AppShell>
  );
}
