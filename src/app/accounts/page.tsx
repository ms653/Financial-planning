import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { AccountLedger } from '@/components/accounts/AccountLedger';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { formatMoney } from '@/lib/money';
import { groupAccountsByOwner, netWorthPence } from '@/lib/networth/breakdown';
import { getAccountsWithBalances, getPeople, getSetupState } from '@/lib/household/queries';

/**
 * Accounts List — DESIGN_SPEC.md.
 *
 * "Grouped list by owner (Person A, Person B, Joint) … Each row: account type icon, name,
 * wrapper badge, balance, last-updated relative time. A persistent '+ Add account' action,
 * always visible (not buried in a menu), since this is a core recurring action."
 *
 * Archived accounts are excluded from the default view and from the total, and are
 * "filterable back in" via `?archived=1` — the spec's wording. They're a separate section
 * rather than mixed into the owner groups, so an old transferred ISA can't be mistaken for a
 * live one at a glance.
 *
 * The loading state is a `<Suspense>` boundary rather than a `loading.tsx`, for the reason
 * documented on the dashboard: a route-level loading file forces streaming, which turns the
 * setup redirect below from a 307 into an instruction only a browser with JavaScript can act on.
 */

export const dynamic = 'force-dynamic';

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: { archived?: string };
}) {
  const setup = await getSetupState();
  // Awaited before any JSX, so this stays a real redirect.
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  return (
    <AppShell pathname="/accounts">
      <Heading />
      <Suspense fallback={<SkeletonRows rows={5} label="Loading your accounts" />}>
        <AccountsBody householdId={setup.householdId} showArchived={searchParams.archived === '1'} />
      </Suspense>
    </AppShell>
  );
}

async function AccountsBody({
  householdId,
  showArchived,
}: {
  householdId: number;
  showArchived: boolean;
}) {
  const now = new Date();

  let all: Awaited<ReturnType<typeof getAccountsWithBalances>>;
  let people: Awaited<ReturnType<typeof getPeople>>;
  try {
    [all, people] = await Promise.all([
      getAccountsWithBalances(householdId, { includeArchived: true }),
      getPeople(householdId),
    ]);
  } catch (error) {
    console.error('[accounts] failed to load accounts', error);
    return <ErrorState retryHref="/accounts" detail="Your data is safe — this was a problem reading it." />;
  }

  const live = all.filter((account) => !account.archived);
  const archived = all.filter((account) => account.archived);

  if (all.length === 0) {
    return (
      <EmptyState
        title="No accounts yet — add your first one to get started"
        ctaLabel="+ Add account"
        ctaHref="/accounts/new"
      />
    );
  }

  const groups = groupAccountsByOwner(live, people);
  const archivedGroups = groupAccountsByOwner(archived, people);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-content-muted">
          {live.length} {live.length === 1 ? 'account' : 'accounts'} ·{' '}
          <span className="tabular font-medium text-content">{formatMoney(netWorthPence(live))}</span>{' '}
          total
        </p>
        <Link
          href="/accounts/new"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-ink-950 px-4 text-sm font-medium text-content-ink transition hover:bg-ink-800 dark:bg-brass dark:text-ink-950"
        >
          <span aria-hidden="true">+</span> Add account
        </Link>
      </div>

      <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        {groups.length === 0 ? (
          <p className="text-sm text-content-muted">
            Every account is archived. Show them below to bring one back.
          </p>
        ) : (
          <AccountLedger groups={groups} now={now} />
        )}
      </div>

      {archived.length > 0 ? (
        <div className="mt-6">
          {showArchived ? (
            <div className="rounded-card border border-line bg-paper-sunken/40 p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-serif text-base text-content-muted">Archived</h2>
                <Link href="/accounts" className="text-xs text-content-muted underline underline-offset-2">
                  Hide archived
                </Link>
              </div>
              <p className="mb-4 text-xs text-content-faint">
                Excluded from your totals and from your net worth trend. Their balance history
                is kept here if you need to look back at it.
              </p>
              <AccountLedger groups={archivedGroups} now={now} showGroupTotals={false} />
            </div>
          ) : (
            <Link
              href="/accounts?archived=1"
              className="text-sm text-content-muted underline underline-offset-2 hover:text-content"
            >
              Show {archived.length} archived{' '}
              {archived.length === 1 ? 'account' : 'accounts'}
            </Link>
          )}
        </div>
      ) : null}
    </>
  );
}

function Heading() {
  return (
    <div className="mb-6">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-content-faint">
        Manage
      </span>
      <h1 className="font-serif text-3xl leading-tight text-content">Accounts</h1>
    </div>
  );
}
