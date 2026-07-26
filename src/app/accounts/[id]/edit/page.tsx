import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { AccountForm } from '@/components/accounts/AccountForm';
import { updateAccount } from '@/lib/household/actions';
import { getAccountDetail, getPeople, getSetupState } from '@/lib/household/queries';
import { todayIso } from '@/lib/accounts/validation';

/**
 * Edit Account — DESIGN_SPEC.md's Add/Edit Account screen, edit mode.
 *
 * Pre-filled with the account's current details. Scoped to the account's *static* details, as
 * the spec's screen purpose says: type, owner, and wrapper-specific fields. Balance changes go
 * through "Update balance" on the detail screen, which appends a dated snapshot rather than
 * rewriting one.
 *
 * Owner chips are pre-selected to reflect current ownership. A joint account (null `person_id`)
 * pre-selects everyone, since "joint" is what more-than-one-selected means — and the schema
 * doesn't record *which* people share a joint account, only that no single person owns it. That
 * round-trips correctly: re-saving a joint account leaves it joint.
 */

export const dynamic = 'force-dynamic';

async function updateAccountThenReturn(formData: FormData) {
  'use server';
  const result = await updateAccount(formData);
  if (result.ok) {
    const accountId = String(formData.get('accountId') ?? '');
    redirect(`/accounts/${accountId}`);
  }
  return result;
}

export default async function EditAccountPage({ params }: { params: { id: string } }) {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const accountId = Number.parseInt(params.id, 10);
  if (!Number.isInteger(accountId)) notFound();

  const [account, people] = await Promise.all([
    getAccountDetail(setup.householdId, accountId),
    getPeople(setup.householdId),
  ]);
  if (!account) notFound();

  return (
    <AppShell pathname="/accounts">
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-content-muted">
        <Link href="/accounts" className="underline underline-offset-2 hover:text-content">
          Accounts
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <Link href={`/accounts/${account.id}`} className="underline underline-offset-2 hover:text-content">
          {account.name}
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span>Edit</span>
      </nav>

      <h1 className="mb-6 font-serif text-3xl leading-tight text-content">Edit account</h1>

      <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <AccountForm
          people={people}
          action={updateAccountThenReturn}
          today={todayIso()}
          initial={{
            accountId: account.id,
            name: account.name,
            type: account.type,
            ownerIds:
              account.personId === null
                ? // Joint: everyone selected, which is what >1 selected means.
                  people.map((person) => person.id)
                : [account.personId],
            debtTerms: account.debtTerms
              ? {
                  interestRate: account.debtTerms.interestRate,
                  minimumPayment: account.debtTerms.minimumPayment,
                  overpaymentAllowancePct: account.debtTerms.overpaymentAllowancePct,
                  overpaymentAllowanceBalanceBasis: account.debtTerms.overpaymentAllowanceBalanceBasis,
                  ercRatePct: account.debtTerms.ercRatePct,
                  ercPeriodEnd: account.debtTerms.ercPeriodEnd,
                }
              : null,
          }}
          submitLabel="Save changes"
          cancelHref={`/accounts/${account.id}`}
        />
      </div>

      <p className="mt-4 max-w-prose text-xs leading-relaxed text-content-faint">
        Balances aren’t edited here — use “Update balance” on the account so the change is
        recorded with a date and your history stays intact.
      </p>
    </AppShell>
  );
}
