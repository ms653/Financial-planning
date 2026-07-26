import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { UpdateBalanceDrawer } from '@/components/accounts/UpdateBalanceDrawer';
import { HoldingsPanel } from '@/components/accounts/HoldingsPanel';
import { AccountTypeBadge, ArchivedBadge, TaxWrapperBadge } from '@/components/ui/Badges';
import { FreshnessLine } from '@/components/ui/States';
import { formatMoney, formatMoneyParts, numericToPence } from '@/lib/money';
import { accountTypeMeta } from '@/lib/accounts/types';
import { OVERPAYMENT_BASIS_LABELS, todayIso } from '@/lib/accounts/validation';
import { addHolding, deleteHolding, setAccountArchived, updateBalance } from '@/lib/household/actions';
import { getAccountDetail, getSetupState } from '@/lib/household/queries';
import { seriesToPath } from '@/lib/networth/series';

/**
 * Account Detail — DESIGN_SPEC.md.
 *
 * "Header: account name, type/wrapper badges, owner(s), current balance (large). A
 * balance-history chart (same visual language as the Dashboard's trend chart, scoped to this
 * account) … A prominent 'Update balance' action."
 *
 * Two type-dependent behaviours from the spec:
 *  - Investment accounts (GIA/ISA/SIPP) get a holdings table, display-only in Phase 1.
 *  - Debt accounts invert the chart's framing: "paying down is 'progress', shown as a
 *    downward-trending 'good' line, not styled as decline."
 */

export const dynamic = 'force-dynamic';

/** Archive/restore, then stay on this screen so the state change is visible. */
async function toggleArchived(formData: FormData) {
  'use server';
  await setAccountArchived(formData);
}

/**
 * Remove a holding. Wrapped to return void because it's a bare `<form action>` — a
 * single-button form has no field to attach an error to. A failure is logged server-side and
 * the row simply stays, which is the safe direction for a delete.
 */
async function removeHolding(formData: FormData) {
  'use server';
  await deleteHolding(formData);
}

export default async function AccountDetailPage({ params }: { params: { id: string } }) {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const accountId = Number.parseInt(params.id, 10);
  if (!Number.isInteger(accountId)) notFound();

  const account = await getAccountDetail(setup.householdId, accountId);
  // A stale bookmark to an account that no longer exists is a 404, not a 500.
  if (!account) notFound();

  const meta = accountTypeMeta(account.type);
  const now = new Date();
  const balance = account.latestAmount === null ? null : numericToPence(account.latestAmount);
  const { main, fraction } = balance === null ? { main: '—', fraction: '' } : formatMoneyParts(balance);

  const points = account.history.map((entry) => ({
    date: entry.snapshotDate,
    pence: numericToPence(entry.amount),
  }));
  const path = points.length >= 2 ? seriesToPath(points, { width: 760, height: 120, padding: 6 }) : null;

  // For a debt, the line falls as the household pays down — which is progress. It's drawn in
  // the sage (positive) tone rather than clay so it doesn't read as decline, per the spec.
  const isDebt = meta.isLiability;
  const strokeColour = isDebt ? 'var(--sage)' : 'var(--brass)';

  return (
    <AppShell pathname="/accounts">
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-content-muted">
        <Link href="/accounts" className="underline underline-offset-2 hover:text-content">
          Accounts
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span className="text-content">{account.name}</span>
      </nav>

      <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl leading-tight text-content">{account.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <AccountTypeBadge type={account.type} />
              <TaxWrapperBadge wrapper={account.taxWrapper} />
              {account.archived ? <ArchivedBadge /> : null}
              <span className="text-xs text-content-faint">
                {account.personId === null ? 'Joint — owned by the household' : account.ownerName}
              </span>
            </div>

            <p
              className={`tabular mt-4 font-serif text-[clamp(1.75rem,5vw,2.5rem)] leading-none ${
                balance !== null && balance < 0n ? 'text-clay' : 'text-content'
              }`}
            >
              {main}
              <span className="text-[0.55em] text-content-faint">{fraction}</span>
            </p>
            {isDebt && balance !== null ? (
              <p className="mt-1.5 text-xs text-content-muted">
                Outstanding: {formatMoney(-balance, { showPence: true })}
              </p>
            ) : null}
            <FreshnessLine capturedAt={account.latestCapturedAt} now={now} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <UpdateBalanceDrawer
              accountId={account.id}
              accountName={account.name}
              accountType={account.type}
              action={updateBalance}
              today={todayIso(now)}
            />
            <Link
              href={`/accounts/${account.id}/edit`}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition hover:border-brass hover:text-content"
            >
              Edit
            </Link>
          </div>
        </div>

        {/* Balance history. A single-point account gets a note rather than a broken-looking
            chart — the spec's edge case for a brand new account. */}
        <div className="mt-6">
          {path ? (
            <>
              <svg
                viewBox="0 0 760 120"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Balance history for ${account.name}, from ${formatMoney(
                  points[0]!.pence,
                )} on ${points[0]!.date} to ${formatMoney(points.at(-1)!.pence)} on ${points.at(-1)!.date}.`}
                className="h-[120px] w-full"
              >
                <defs>
                  <linearGradient id="detailFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={strokeColour} stopOpacity="0.24" />
                    <stop offset="100%" stopColor={strokeColour} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <g stroke="var(--line)" strokeWidth="1">
                  <line x1="0" y1="30" x2="760" y2="30" />
                  <line x1="0" y1="60" x2="760" y2="60" />
                  <line x1="0" y1="90" x2="760" y2="90" />
                </g>
                <path d={path.area} fill="url(#detailFill)" />
                <path
                  d={path.line}
                  fill="none"
                  stroke={strokeColour}
                  strokeWidth="2.25"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              {isDebt ? (
                <p className="mt-1.5 text-[11px] text-sage">
                  A falling line here is progress — it means the balance is coming down.
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-line px-4 text-center text-xs text-content-faint">
              History will build up as you update this account.
            </div>
          )}
        </div>
      </section>

      {meta.holdsSecurities ? (
        <div className="mt-5">
          <HoldingsPanel
            accountId={account.id}
            holdings={account.holdings.map((holding) => ({
              id: holding.id,
              ticker: holding.ticker,
              quantity: holding.quantity,
              costBasis: formatMoney(numericToPence(holding.costBasis), { showPence: true }),
            }))}
            addAction={addHolding}
            deleteAction={removeHolding}
          />
        </div>
      ) : null}

      {account.debtTerms ? (
        <section className="mt-5 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
          <h2 className="font-serif text-lg text-content">Debt details</h2>
          <p className="mt-1 text-xs text-content-faint">
            Used by the cash allocation advisor in a later phase.
          </p>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Term label="Interest rate" value={account.debtTerms.interestRate ? `${account.debtTerms.interestRate}%` : null} />
            <Term
              label="Minimum payment"
              value={
                account.debtTerms.minimumPayment
                  ? formatMoney(numericToPence(account.debtTerms.minimumPayment), { showPence: true })
                  : null
              }
            />
            <Term
              label="Overpayment allowance"
              value={
                account.debtTerms.overpaymentAllowancePct
                  ? `${account.debtTerms.overpaymentAllowancePct}% of ${
                      account.debtTerms.overpaymentAllowanceBalanceBasis
                        ? OVERPAYMENT_BASIS_LABELS[account.debtTerms.overpaymentAllowanceBalanceBasis]
                        : '—'
                    }`
                  : null
              }
            />
            {/* Shown separately from the allowance above: two different numbers. */}
            <Term
              label="Early repayment charge"
              value={account.debtTerms.ercRatePct ? `${account.debtTerms.ercRatePct}%` : null}
            />
            <Term label="Charge period ends" value={account.debtTerms.ercPeriodEnd} />
          </dl>
        </section>
      ) : null}

      {/* Archive, never delete. Reversible, so the copy and styling are not destructive. */}
      <section className="mt-5 rounded-card border border-line bg-paper-sunken/40 p-5">
        <h2 className="text-sm font-medium text-content">
          {account.archived ? 'Restore this account?' : 'Archive this account?'}
        </h2>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-content-muted">
          {account.archived
            ? 'It’ll count towards your current totals again.'
            : 'It’ll be hidden from your current totals but its history is kept.'}
        </p>
        <form action={toggleArchived} className="mt-3">
          <input type="hidden" name="accountId" value={account.id} />
          <input type="hidden" name="archived" value={account.archived ? 'false' : 'true'} />
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition hover:border-brass hover:text-content"
          >
            {account.archived ? 'Restore' : 'Archive'}
          </button>
        </form>
      </section>
    </AppShell>
  );
}

function Term({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-content-faint">{label}</dt>
      <dd className={`tabular mt-0.5 text-sm ${value ? 'text-content' : 'text-content-faint'}`}>
        {value ?? 'Not set'}
      </dd>
    </div>
  );
}
