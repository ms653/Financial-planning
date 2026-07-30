import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { ScenarioEditorForm } from '@/components/retirement/ScenarioEditorForm';
import { getPeople, getSetupState } from '@/lib/household/queries';
import { getScenario } from '@/lib/retirement/queries';
import { parseScenarioAssumptions } from '@/lib/retirement/scenarioAssumptions';
import { todayIso } from '@/lib/accounts/validation';
import { ageAsOf } from '@/lib/retirement/personAge';

export const dynamic = 'force-dynamic';

export default async function EditScenarioPage({ params }: { params: { scenarioId: string } }) {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const scenarioId = Number.parseInt(params.scenarioId, 10);
  if (!Number.isInteger(scenarioId)) notFound();

  const scenario = await getScenario(scenarioId, setup.householdId);
  if (!scenario) notFound();

  // A scenario referencing a person no longer in the household, or an unparseable
  // assumptions blob, is a data-integrity problem the Editor can't meaningfully recover
  // from — same "throw, don't guess" posture `resolveScenario.ts` already takes.
  const assumptions = parseScenarioAssumptions(scenario.assumptions);

  const people = await getPeople(setup.householdId);
  const today = todayIso();
  const formPeople = people.map((person) => ({
    personId: person.id,
    name: person.name,
    currentAge: ageAsOf(person.dateOfBirth, today),
  }));

  return (
    <AppShell pathname="/retirement">
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-content-muted">
        <Link href="/retirement" className="underline underline-offset-2 hover:text-content">
          Retirement
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <Link href={`/retirement/${scenarioId}`} className="underline underline-offset-2 hover:text-content">
          {scenario.name}
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span>Edit</span>
      </nav>

      <h1 className="mb-6 font-serif text-3xl leading-tight text-content">Edit scenario</h1>

      <ScenarioEditorForm
        people={formPeople}
        scenarioId={scenario.id}
        initialName={scenario.name}
        initialIsBaseline={scenario.isBaseline}
        initialAssumptions={assumptions}
      />
    </AppShell>
  );
}
