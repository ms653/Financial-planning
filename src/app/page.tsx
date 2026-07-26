import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { AccountLedger } from '@/components/accounts/AccountLedger';
import { BreakdownPanel, type BreakdownSliceView } from '@/components/networth/BreakdownPanel';
import { NetWorthHero } from '@/components/networth/NetWorthHero';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { formatMoney } from '@/lib/money';
import {
  breakdown,
  groupAccountsByOwner,
  isBreakdownMode,
  netWorthPence,
  type BreakdownMode,
} from '@/lib/networth/breakdown';
import {
  buildNetWorthSeries,
  isTrendRange,
  rangeStartDate,
  trendDelta,
  type TrendRange,
} from '@/lib/networth/series';
import {
  getAccountsWithBalances,
  getPeople,
  getSetupState,
  getSnapshotsForTrend,
} from '@/lib/household/queries';

/**
 * Net Worth Dashboard — DESIGN_SPEC.md's home screen, replacing Phase 0's placeholder page.
 *
 * Structure follows the spec top to bottom: hero total with trend chart and range selector,
 * then the breakdown segmented control, then the account list grouped by owner including a
 * Joint group.
 *
 * All four states are here:
 *  - *Default*: below.
 *  - *Loading*: `loading.tsx` alongside this file, which Next renders while this server
 *    component awaits — skeletons for the figure, chart and rows, not a full-page spinner.
 *  - *Empty*: the genuinely-zero-accounts case. Reaching it should be impossible because a
 *    household with no accounts is redirected to Guided Setup, but the spec asks for it
 *    anyway, and "shouldn't happen" states are exactly the ones that look broken when they do.
 *  - *Error*: query failed with the backend up. Distinct from empty on purpose — showing "no
 *    accounts yet" for a failed query would tell a household its financial data is gone.
 */

// Never cached: this is the household's live financial position.
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { range?: string; breakdown?: string };
}) {
  const setup = await getSetupState();

  // First login with no household, or a household with nobody in it, goes to Guided Setup
  // rather than to an empty dashboard. This is the redirect the design spec's first-time
  // setup flow requires, and it lives here rather than in middleware because middleware runs
  // in the edge runtime, where node-postgres can't reach the database at all.
  if (setup.householdId === null || setup.personCount === 0) {
    redirect('/setup');
  }
  const householdId = setup.householdId;

  const range: TrendRange = isTrendRange(searchParams.range ?? '') ? (searchParams.range as TrendRange) : '6M';
  const breakdownMode: BreakdownMode = isBreakdownMode(searchParams.breakdown ?? '')
    ? (searchParams.breakdown as BreakdownMode)
    : 'person';

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  let accounts: Awaited<ReturnType<typeof getAccountsWithBalances>>;
  let people: Awaited<ReturnType<typeof getPeople>>;
  let snapshots: Awaited<ReturnType<typeof getSnapshotsForTrend>>;
  try {
    [accounts, people, snapshots] = await Promise.all([
      getAccountsWithBalances(householdId),
      getPeople(householdId),
      getSnapshotsForTrend(householdId, rangeStartDate(range, now)),
    ]);
  } catch (error) {
    console.error('[dashboard] failed to load net worth', error);
    return (
      <AppShell pathname="/">
        <PageHeading />
        <ErrorState
          title="Couldn’t load your net worth right now"
          detail="Your data is safe — this was a problem reading it."
          retryHref={`/?range=${range}&breakdown=${breakdownMode}`}
        />
      </AppShell>
    );
  }

  if (accounts.length === 0) {
    return (
      <AppShell pathname="/">
        <PageHeading />
        <EmptyState
          title="No accounts yet"
          body="Add your first account to see your net worth."
          ctaLabel="Add account"
          ctaHref="/accounts/new"
        />
      </AppShell>
    );
  }

  const total = netWorthPence(accounts);
  const series = buildNetWorthSeries(snapshots, { start: rangeStartDate(range, now), today });
  const groups = groupAccountsByOwner(accounts, people);

  // All three groupings are computed here and handed to the client component together, so the
  // segmented control switches in place with no request. Pence are formatted to strings first:
  // bigint doesn't cross the server/client boundary, and converting to a number to send it
  // would put money through a float for no reason.
  const slices = Object.fromEntries(
    (['person', 'asset', 'wrapper'] as const).map((mode) => [
      mode,
      breakdown(mode, accounts, people).map(
        (slice): BreakdownSliceView => ({
          key: slice.key,
          label: slice.label,
          amount: formatMoney(slice.pence),
          share: slice.share,
          negative: slice.pence < 0n,
        }),
      ),
    ]),
  ) as Record<BreakdownMode, BreakdownSliceView[]>;

  const latestCapturedAt = accounts.reduce<Date | null>((newest, account) => {
    if (!account.latestCapturedAt) return newest;
    if (!newest || account.latestCapturedAt > newest) return account.latestCapturedAt;
    return newest;
  }, null);

  return (
    <AppShell pathname="/">
      <PageHeading />

      <div className="space-y-5">
        <NetWorthHero
          totalPence={total}
          series={series}
          delta={trendDelta(series)}
          range={range}
          breakdownMode={breakdownMode}
          latestCapturedAt={latestCapturedAt}
          now={now}
        />

        <BreakdownPanel slices={slices} initialMode={breakdownMode} />

        <section
          aria-labelledby="accounts-heading"
          className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="accounts-heading" className="font-serif text-lg text-content">
              Accounts
            </h2>
            <Link
              href="/accounts/new"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-medium text-content-muted transition hover:border-brass hover:text-content"
            >
              <span aria-hidden="true">+</span> Add account
            </Link>
          </div>

          <AccountLedger groups={groups} now={now} />
        </section>
      </div>
    </AppShell>
  );
}

function PageHeading() {
  return (
    <div className="mb-6">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-content-faint">
        Overview
      </span>
      <h1 className="font-serif text-3xl leading-tight text-content">Net worth</h1>
    </div>
  );
}
