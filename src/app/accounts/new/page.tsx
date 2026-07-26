import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { AccountForm } from '@/components/accounts/AccountForm';
import { createAccount } from '@/lib/household/actions';
import { getPeople, getSetupState } from '@/lib/household/queries';
import { todayIso } from '@/lib/accounts/validation';

/**
 * Add Account — DESIGN_SPEC.md's Add/Edit Account screen, create mode.
 *
 * A full screen rather than a modal. The spec allows either ("modal or full screen depending
 * on device"), and a full route is the better default here: the type-picker grid plus the
 * revealed form is a lot of vertical content on a phone, and a route means a browser back
 * button behaves the way the spec's "one back-navigable step" wording expects.
 */

export const dynamic = 'force-dynamic';

/**
 * Create, then leave for the accounts list.
 *
 * `createAccount` itself doesn't redirect, because Guided Setup calls the same action and
 * needs to stay put to offer "+ Add another". Wrapping it here keeps that difference in the
 * screen that wants it rather than in a flag on the action. On failure the result falls
 * through so the form can render the error and keep everything typed.
 */
async function createAccountThenReturn(formData: FormData) {
  'use server';
  const result = await createAccount(formData);
  if (result.ok) redirect('/accounts');
  return result;
}

export default async function NewAccountPage() {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const people = await getPeople(setup.householdId);

  return (
    <AppShell pathname="/accounts">
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-content-muted">
        <Link href="/accounts" className="underline underline-offset-2 hover:text-content">
          Accounts
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span>New</span>
      </nav>

      <h1 className="mb-6 font-serif text-3xl leading-tight text-content">Add an account</h1>

      <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <AccountForm
          people={people}
          action={createAccountThenReturn}
          today={todayIso()}
          submitLabel="Add account"
          cancelHref="/accounts"
        />
      </div>
    </AppShell>
  );
}
