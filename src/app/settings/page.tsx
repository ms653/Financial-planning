import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { BackupStatusIndicator } from '@/components/BackupStatusIndicator';
import { PersonForm } from '@/components/setup/SetupSteps';
import { PersonPanel } from '@/components/settings/PersonPanel';
import { EmergencyFundForm } from '@/components/settings/EmergencyFundForm';
import { getBackupStatus } from '@/lib/backup/status';
import {
  addPensionContribution,
  addPerson,
  deletePensionContribution,
  updateEmergencyFundTarget,
  updatePerson,
} from '@/lib/household/actions';
import { getPeopleWithPensions, getSetupState } from '@/lib/household/queries';
import { formatMoney, numericToPence } from '@/lib/money';

/**
 * Settings — household member management, backup status.
 *
 * DESIGN_SPEC.md's screen inventory gives this route that purpose, which is why the full
 * `BackupStatusIndicator` moved here from Phase 0's placeholder home page (a compact warning
 * strip still appears on every screen when the backup is unhealthy — see BackupWarningStrip).
 *
 * This screen is also where pension contributions are entered, and it is deliberately plain.
 * PROPOSAL.md needs the contribution method and employer amount recorded per person so that
 * Phase 4.5's Cash Allocation Advisor can derive a tax band and taper position; nothing in
 * Phase 1 reads them. Building a workflow around data with no consumer yet would be guessing at
 * what that workflow should be — the schema is the part that's expensive to get wrong later, so
 * the schema is precise and the form is basic.
 *
 * Deleting a person isn't offered. `ON DELETE RESTRICT` means the database would refuse while
 * they own accounts, and the correct operation — reassigning those accounts first — is an
 * explicit ownership migration the proposal asks for rather than a button. Reassignment is
 * available today by editing each account's owner.
 */

export const dynamic = 'force-dynamic';

/** Bare `<form action>`, so it returns void. Failures are logged, not rendered. */
async function removeContribution(formData: FormData) {
  'use server';
  await deletePensionContribution(formData);
}

export default async function SettingsPage() {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const [people, backupStatus] = await Promise.all([
    getPeopleWithPensions(setup.householdId),
    getBackupStatus(),
  ]);

  return (
    <AppShell pathname="/settings">
      <div className="mb-6">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-content-faint">
          Household
        </span>
        <h1 className="font-serif text-3xl leading-tight text-content">
          {setup.householdName ?? 'Settings'}
        </h1>
      </div>

      <div className="space-y-5">
        <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
          <h2 className="font-serif text-lg text-content">People</h2>
          <p className="mt-1 text-xs text-content-faint">
            Income and pension contributions are planning assumptions — edit them whenever they
            change. They’re used by the retirement and allocation tools in later phases.
          </p>

          <div className="mt-5 space-y-4">
            {people.map((person) => (
              <PersonPanel
                key={person.id}
                person={{
                  id: person.id,
                  name: person.name,
                  dateOfBirth: person.dateOfBirth,
                  annualGrossIncome: person.annualGrossIncome,
                  incomeLabel:
                    person.annualGrossIncome === null
                      ? null
                      : formatMoney(numericToPence(person.annualGrossIncome)),
                  hasFlexiblyAccessedPension: person.hasFlexiblyAccessedPension,
                  contributions: person.pensionContributions.map((contribution) => ({
                    id: contribution.id,
                    method: contribution.method,
                    amount: formatMoney(numericToPence(contribution.amount)),
                    employerAmount: formatMoney(numericToPence(contribution.employerAmount)),
                  })),
                }}
                updateAction={updatePerson}
                addContributionAction={addPensionContribution}
                deleteContributionAction={removeContribution}
              />
            ))}
          </div>
        </section>

        <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
          <h2 className="font-serif text-lg text-content">Add a person</h2>
          <p className="mt-1 text-xs text-content-faint">
            Date of birth is required — it sets State Pension age and the ISA age limits.
          </p>
          <div className="mt-5">
            <PersonForm action={addPerson} />
          </div>
        </section>

        <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
          <h2 className="font-serif text-lg text-content">Emergency fund</h2>
          <p className="mt-1 text-xs text-content-faint">
            A target balance for the household’s buffer. Tag which cash account(s) count towards
            it on each account’s own page.
          </p>
          <div className="mt-4">
            <EmergencyFundForm
              currentTarget={setup.emergencyFundTarget}
              updateAction={updateEmergencyFundTarget}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-lg text-content">Backups</h2>
          <BackupStatusIndicator status={backupStatus} />
          <p className="mt-3 max-w-prose text-xs leading-relaxed text-content-faint">
            All of your financial data lives in one Postgres database on this machine. The backup
            job and its off-machine copy are set up in docs/DEPLOYMENT.md; a restore test is worth
            running quarterly (docs/RESTORE_TEST.md).
          </p>
        </section>
      </div>
    </AppShell>
  );
}
