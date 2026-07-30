import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { ScenarioEditorForm } from '@/components/retirement/ScenarioEditorForm';
import { getPeople, getSetupState } from '@/lib/household/queries';
import { todayIso } from '@/lib/accounts/validation';
import { ageAsOf } from '@/lib/retirement/personAge';
import { defaultAssumptionsFor } from '@/lib/retirement/scenarioFormDefaults';

/**
 * New retirement scenario — Scenario Editor, create mode. Per `docs/DESIGN_SPEC.md`'s
 * route inventory (`/retirement/new`). No "Save" separate from "Run simulation" — see
 * `useScenarioRunner.ts`'s own doc comment.
 */

export const dynamic = 'force-dynamic';

export default async function NewScenarioPage() {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const people = await getPeople(setup.householdId);
  const today = todayIso();
  const formPeople = people.map((person) => ({
    personId: person.id,
    name: person.name,
    currentAge: ageAsOf(person.dateOfBirth, today),
  }));
  const initialAssumptions = defaultAssumptionsFor(
    people.map((p) => ({ personId: p.id, dateOfBirth: p.dateOfBirth })),
    today,
  );

  return (
    <AppShell pathname="/retirement">
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-content-muted">
        <Link href="/retirement" className="underline underline-offset-2 hover:text-content">
          Retirement
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span>New scenario</span>
      </nav>

      <h1 className="mb-6 font-serif text-3xl leading-tight text-content">New scenario</h1>

      <ScenarioEditorForm
        people={formPeople}
        scenarioId={null}
        initialName=""
        initialIsBaseline={false}
        initialAssumptions={initialAssumptions}
      />
    </AppShell>
  );
}
