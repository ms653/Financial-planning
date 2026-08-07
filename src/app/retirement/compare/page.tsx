import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { ComparisonSide } from '@/components/retirement/ComparisonSide';
import { getPeople, getSetupState } from '@/lib/household/queries';
import { getScenarioWithLatestRun } from '@/lib/retirement/queries';
import { parseScenarioAssumptions } from '@/lib/retirement/scenarioAssumptions';
import { diffAssumptions, oneOffEventsDiffCount } from '@/lib/retirement/scenarioDiff';
import { buildDeltaCallout } from '@/lib/retirement/scenarioDeltaCallout';
import { deserializeSimulationResult } from '@/lib/retirement/simulationResultCodec';
import type { SimulationRunView } from '@/lib/retirement/simulationRunClient';
import type { SimulationRun } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Converts a DB row's `Date` fields to plain strings before it crosses into a client
 * component's props — see the identical comment on `[scenarioId]/page.tsx`; React
 * Flight revives a `Date` prop as a `Date`, not a string. */
function toRunView(run: SimulationRun | null): SimulationRunView | null {
  if (!run) return null;
  return {
    id: run.id,
    scenarioId: run.retirementScenarioId,
    status: run.status,
    seed: run.seed,
    iterationCount: run.iterationCount,
    result: run.result,
    errorDetail: run.errorDetail,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  };
}

export default async function CompareScenariosPage({
  searchParams,
}: {
  searchParams: { a?: string; b?: string };
}) {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const idA = Number.parseInt(searchParams.a ?? '', 10);
  const idB = Number.parseInt(searchParams.b ?? '', 10);
  if (!Number.isInteger(idA) || !Number.isInteger(idB)) notFound();

  if (idA === idB) {
    return (
      <AppShell pathname="/retirement">
        <p className="rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay">
          Choose two different scenarios to compare.{' '}
          <Link href={`/retirement/${idA}`} className="underline underline-offset-2">
            Back to results
          </Link>
        </p>
      </AppShell>
    );
  }

  const [scenarioA, scenarioB] = await Promise.all([
    getScenarioWithLatestRun(idA, setup.householdId),
    getScenarioWithLatestRun(idB, setup.householdId),
  ]);
  if (!scenarioA || !scenarioB) notFound();

  const assumptionsA = parseScenarioAssumptions(scenarioA.assumptions);
  const assumptionsB = parseScenarioAssumptions(scenarioB.assumptions);

  const people = await getPeople(setup.householdId);
  const personNamesMap = new Map(people.map((p) => [p.id, p.name]));
  const referencePersonA = people.find((p) => p.id === assumptionsA.people[0]!.personId);
  const referencePersonB = people.find((p) => p.id === assumptionsB.people[0]!.personId);

  const diffRows = diffAssumptions(assumptionsA, assumptionsB, personNamesMap);

  // Delta callout uses each side's *initial* (page-load) result — a snapshot, not
  // reactive to a re-run started from this screen without a reload. Scoped this way
  // deliberately: keeping it live would mean lifting both sides' polling state up into
  // this component, which the spec's "each side independently" framing doesn't ask for.
  let deltaCallout: string | null = null;
  if (scenarioA.latestRun?.status === 'complete' && scenarioB.latestRun?.status === 'complete') {
    const resultA = deserializeSimulationResult(scenarioA.latestRun.result);
    const resultB = deserializeSimulationResult(scenarioB.latestRun.result);
    deltaCallout = buildDeltaCallout({
      label: scenarioB.name,
      successRateFraction: resultB.successRate,
      otherSuccessRateFraction: resultA.successRate,
      retirementAge: assumptionsB.people[0]!.retirementAge,
      otherRetirementAge: assumptionsA.people[0]!.retirementAge,
      oneOffEventsDiffCount: oneOffEventsDiffCount(assumptionsA.oneOffEvents, assumptionsB.oneOffEvents),
    });
  }

  return (
    <AppShell pathname="/retirement">
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-content-muted">
        <Link href="/retirement" className="underline underline-offset-2 hover:text-content">
          Retirement
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span>Compare</span>
      </nav>

      <h1 className="mb-6 font-serif text-3xl leading-tight text-content">
        {scenarioA.name} vs. {scenarioB.name}
      </h1>

      {deltaCallout ? (
        <p className="mb-5 rounded-card border border-brass/40 bg-brass/10 px-4 py-3 text-sm text-content">
          {deltaCallout}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <ComparisonSide
          scenarioId={idA}
          scenarioName={scenarioA.name}
          targetSuccessRatePct={assumptionsA.targetSuccessRatePct}
          initialRun={toRunView(scenarioA.latestRun)}
          referencePersonDob={referencePersonA?.dateOfBirth ?? '2000-01-01'}
          referencePersonName={referencePersonA?.name ?? 'This person'}
          scenarioUpdatedAtIso={scenarioA.updatedAt.toISOString()}
        />
        <ComparisonSide
          scenarioId={idB}
          scenarioName={scenarioB.name}
          targetSuccessRatePct={assumptionsB.targetSuccessRatePct}
          initialRun={toRunView(scenarioB.latestRun)}
          referencePersonDob={referencePersonB?.dateOfBirth ?? '2000-01-01'}
          referencePersonName={referencePersonB?.name ?? 'This person'}
          scenarioUpdatedAtIso={scenarioB.updatedAt.toISOString()}
        />
      </div>

      {diffRows.length > 0 ? (
        <div className="mt-6 overflow-x-auto rounded-card border border-line bg-paper-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-content-faint">
                <th className="px-4 py-3 font-medium">Assumption</th>
                <th className="px-4 py-3 font-medium">{scenarioA.name}</th>
                <th className="px-4 py-3 font-medium">{scenarioB.name}</th>
              </tr>
            </thead>
            <tbody>
              {diffRows.map((row) => (
                <tr key={row.label} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 text-content-muted">{row.label}</td>
                  <td className="tabular px-4 py-2.5 text-content">{row.a}</td>
                  <td className="tabular px-4 py-2.5 text-content">{row.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppShell>
  );
}
