import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountForm } from '@/components/accounts/AccountForm';
import { HouseholdForm, PersonForm } from '@/components/setup/SetupSteps';
import { AccountTypeIcon } from '@/components/ui/Badges';
import { addPerson, createAccount, createHousehold, finishSetup } from '@/lib/household/actions';
import { getAccountsWithBalances, getPeople, getSetupState } from '@/lib/household/queries';
import { accountTypeMeta } from '@/lib/accounts/types';
import { formatNumeric } from '@/lib/money';
import { todayIso } from '@/lib/accounts/validation';

/**
 * Guided Setup — DESIGN_SPEC.md's first-time setup flow.
 *
 * The flow, verbatim from the spec:
 *  1. login → no household detected → redirected here, not to an empty dashboard
 *  2. "Let's set up your household"
 *  3. add household members (name + date of birth per person, at least one required)
 *  4. "Add your first account" → account-type picker
 *  5. type-specific fields → created → "shown in a running list with a '+ Add another'
 *     affordance"
 *  6. "Finish setup" → Net Worth Dashboard
 *
 * **The step is derived from the database, not held in a cookie or a wizard state machine.**
 * A household either exists or doesn't; there either are people or aren't. That makes every
 * step idempotent and refresh-safe: reloading mid-setup, or coming back tomorrow, resumes
 * exactly where the data says you are rather than restarting or resuming into a half-built
 * state. `?step=` only ever moves *backwards* to a step the data has already satisfied, so it
 * can't be used to skip ahead.
 */

export const dynamic = 'force-dynamic';

type Step = 'household' | 'people' | 'accounts';

const STEPS: readonly { value: Step; label: string }[] = [
  { value: 'household', label: 'Household' },
  { value: 'people', label: 'People' },
  { value: 'accounts', label: 'Accounts' },
];

export default async function SetupPage({
  searchParams,
}: {
  searchParams: { step?: string };
}) {
  const setup = await getSetupState();

  // Setup is done: the spec scopes this screen to "a household exists with zero
  // people/accounts", so once there's both, this route stops being reachable.
  if (setup.complete) redirect('/');

  const furthest: Step =
    setup.householdId === null ? 'household' : setup.personCount === 0 ? 'people' : 'accounts';

  // Requested step is honoured only if the data already supports it — so "back to people" works
  // while jumping to "accounts" before adding anyone does not.
  const requested = searchParams.step;
  const stepOrder: Step[] = ['household', 'people', 'accounts'];
  const step: Step =
    requested && stepOrder.includes(requested as Step) &&
    stepOrder.indexOf(requested as Step) <= stepOrder.indexOf(furthest)
      ? (requested as Step)
      : furthest;

  const people = setup.householdId === null ? [] : await getPeople(setup.householdId);
  const accounts = setup.householdId === null ? [] : await getAccountsWithBalances(setup.householdId);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brass to-brass-strong font-serif text-base font-bold text-ink-950"
        >
          £
        </span>
        <span className="text-sm font-medium uppercase tracking-[0.14em] text-content-muted">
          Household Finance
        </span>
      </div>

      {/* Progress. An ordered list rather than a decorative bar, so the current position is
          available to a screen reader as structure rather than as colour. */}
      <ol className="mb-8 flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((entry, index) => {
          const state =
            entry.value === step
              ? 'current'
              : stepOrder.indexOf(entry.value) < stepOrder.indexOf(step)
                ? 'done'
                : 'upcoming';
          return (
            <li key={entry.value} className="flex items-center gap-2">
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                  state === 'current'
                    ? 'bg-ink-950 font-medium text-content-ink dark:bg-brass dark:text-ink-950'
                    : state === 'done'
                      ? 'bg-sage-bg text-sage'
                      : 'bg-paper-sunken text-content-faint'
                }`}
              >
                <span aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
                {entry.label}
              </span>
              {index < STEPS.length - 1 ? (
                <span aria-hidden="true" className="text-content-faint">
                  ·
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {step === 'household' ? (
        <section>
          <h1 className="font-serif text-3xl leading-tight text-content">
            Let’s set up your household
          </h1>
          <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-content-muted">
            Three short steps: name your household, add the people in it, then add your first
            account. You can change any of it later.
          </p>
          <div className="mt-7">
            <HouseholdForm action={createHousehold} />
          </div>
        </section>
      ) : null}

      {step === 'people' ? (
        <section>
          <h1 className="font-serif text-3xl leading-tight text-content">Who’s in the household?</h1>
          <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-content-muted">
            Add at least one person. Date of birth is required because it drives State Pension
            age and the ISA age limits in later phases — it isn’t just record-keeping.
          </p>

          {people.length > 0 ? (
            <ul className="mt-6 space-y-1.5">
              {people.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-paper-raised px-4 py-3 text-sm"
                >
                  <span className="font-medium text-content">{person.name}</span>
                  <span className="tabular text-xs text-content-faint">{person.dateOfBirth}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 rounded-card border border-line bg-paper-raised p-5">
            <h2 className="mb-4 text-sm font-medium text-content">
              {people.length === 0 ? 'Add a person' : 'Add another person'}
            </h2>
            <PersonForm action={addPerson} />
          </div>

          {people.length > 0 ? (
            <div className="mt-6">
              <Link
                href="/setup?step=accounts"
                className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition hover:bg-ink-800 dark:bg-brass dark:text-ink-950"
              >
                Next: add an account
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 'accounts' ? (
        <section>
          <h1 className="font-serif text-3xl leading-tight text-content">
            {accounts.length === 0 ? 'Add your first account' : 'Add another account'}
          </h1>
          <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-content-muted">
            Start with whatever you know off the top of your head — a current account, a
            pension, your home and its mortgage. You can add the rest whenever.
          </p>

          {/* The running list the spec asks for, so progress is visible while adding several. */}
          {accounts.length > 0 ? (
            <ul className="mt-6 space-y-1.5">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex items-center gap-3 rounded-card border border-line bg-paper-raised px-4 py-3"
                >
                  <AccountTypeIcon type={account.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-content">
                      {account.name}
                    </span>
                    <span className="block text-[11.5px] text-content-faint">
                      {accountTypeMeta(account.type).label}
                      {account.personId === null ? ' · Joint' : ` · ${account.ownerName ?? ''}`}
                    </span>
                  </span>
                  <span
                    className={`tabular text-sm font-medium ${
                      account.latestAmount?.startsWith('-') ? 'text-clay' : 'text-content'
                    }`}
                  >
                    {account.latestAmount ? formatNumeric(account.latestAmount) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 rounded-card border border-line bg-paper-raised p-5">
            <AccountForm
              people={people}
              action={createAccount}
              today={todayIso()}
              submitLabel={accounts.length === 0 ? 'Add account' : 'Add another account'}
              cancelHref="/setup?step=people"
            />
          </div>

          {accounts.length > 0 ? (
            <form action={finishSetup} className="mt-6">
              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition hover:bg-ink-800 dark:bg-brass dark:text-ink-950"
              >
                Finish setup
              </button>
            </form>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
