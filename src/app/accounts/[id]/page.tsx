import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { UpdateBalanceDrawer } from '@/components/accounts/UpdateBalanceDrawer';
import { HoldingsPanel } from '@/components/accounts/HoldingsPanel';
import { RegularContributionsPanel } from '@/components/accounts/RegularContributionsPanel';
import { BalanceHistoryPanel } from '@/components/accounts/BalanceHistoryPanel';
import { AccountTypeBadge, ArchivedBadge, TaxWrapperBadge } from '@/components/ui/Badges';
import { FreshnessLine } from '@/components/ui/States';
import { formatMoney, formatMoneyParts, numericToPence, penceToNumeric, sumPence } from '@/lib/money';
import { accountTypeMeta } from '@/lib/accounts/types';
import { OVERPAYMENT_BASIS_LABELS, todayIso } from '@/lib/accounts/validation';
import {
  addHolding,
  addRegularContribution,
  deleteBalanceSnapshot,
  deleteHolding,
  deleteRegularContribution,
  setAccountArchived,
  updateBalance,
  updateBalanceSnapshot,
  updateHolding,
  updateRegularContribution,
} from '@/lib/household/actions';
import { getAccountDetail, getSetupState } from '@/lib/household/queries';
import { pointPixelCoordinates, seriesToPath, seriesToSegments } from '@/lib/networth/series';
import { InteractiveTrendChart } from '@/components/ui/InteractiveTrendChart';
import { formatDateLabel } from '@/lib/ui/formatDateLabel';
import { alphaVantageApiKey, quoteStaleAfterHours } from '@/lib/env';
import { createAlphaVantageQuoteSource, valueHoldings } from '@/lib/portfolio/quotes';
import { gainLoss } from '@/lib/portfolio/valuation';
import { formatGainLossAmount, relativeTimeFrom } from '@/lib/portfolio/formatting';

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

/** Same reasoning as `removeHolding`. */
async function removeRegularContribution(formData: FormData) {
  'use server';
  await deleteRegularContribution(formData);
}

/** Same reasoning as `removeHolding` — a bare single-button form has nothing to render an
 * error into, so this returns void rather than the underlying action's `ActionResult`. */
async function removeBalanceSnapshot(formData: FormData) {
  'use server';
  await deleteBalanceSnapshot(formData);
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

  // For a debt, the line falls as the household pays down — which is progress. It's drawn in
  // the sage (positive) tone rather than clay so it doesn't read as decline, per the spec.
  const isDebt = meta.isLiability;
  const strokeColour = isDebt ? 'var(--sage)' : 'var(--brass)';

  // A debt's own `amount` is stored negative (Phase 1's convention — see schema.ts),
  // moving *up* towards zero as it's paid down. Plotted as-is, `seriesToPath`'s
  // largest-value-at-top scaling would draw that as a *rising* line — the opposite of
  // the "falling line is progress" caption above and of the "Outstanding" figure this
  // same page shows everywhere else (the balance history table below already flips
  // the sign for exactly this reason). Flipped here too, so the chart shows the
  // outstanding amount falling as it's paid off, matching both the caption and the
  // rest of the page.
  const points = account.history.map((entry) => ({
    date: entry.snapshotDate,
    pence: isDebt ? -numericToPence(entry.amount) : numericToPence(entry.amount),
  }));
  // A debt account's y-axis floor is pinned at 0 (genuinely paid off), not the
  // series' own smallest recorded balance — otherwise the chart's bottom edge reads
  // as "nearly paid off" even when a substantial amount is still owed, since the
  // chart has no way to show how far the smallest-so-far figure still is from zero.
  const chartDimensions = { width: 760, height: 120, padding: 6, minBaseline: isDebt ? 0 : undefined };
  const path = points.length >= 2 ? seriesToPath(points, chartDimensions) : null;
  const segments = points.length >= 2 ? seriesToSegments(points, chartDimensions) : [];
  // Same posture as `NetWorthHero.tsx`: only plain numbers and pre-formatted strings
  // cross to `InteractiveTrendChart`, never the raw `bigint` pence.
  const coordinates = points.length >= 2 ? pointPixelCoordinates(points, chartDimensions) : [];
  const hoverPoints = points.map((point, index) => ({
    x: coordinates[index]?.x ?? 0,
    y: coordinates[index]?.y ?? 0,
    dateLabel: formatDateLabel(point.date),
    amountLabel: formatMoney(point.pence, { showPence: true }),
  }));

  // Live pricing is genuinely optional (docs/PROPOSAL.md's Open Banking posture, applied
  // here to market data too): with no key configured, holdings just render without a
  // current value, rather than the page failing.
  const apiKey = alphaVantageApiKey();
  const holdingValuations =
    meta.holdsSecurities && account.holdings.length > 0 && apiKey
      ? await valueHoldings(
          account.holdings.map((holding) => ({
            id: holding.id,
            ticker: holding.ticker,
            quantity: holding.quantity,
            costBasis: holding.costBasis,
            accountCurrency: account.currency,
          })),
          { source: createAlphaVantageQuoteSource(apiKey), staleAfterHours: quoteStaleAfterHours() },
        )
      : new Map();

  // "Prices as of" reflects the freshest quote actually found — null when nothing in this
  // account priced at all (no key configured, or every holding came back unpriceable).
  const latestQuoteFetch = Array.from(holdingValuations.values())
    .map((v) => v.quoteFetchedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const pricesStale = Array.from(holdingValuations.values()).some((v) => v.quoteStale);

  // Totals across every holding in this account. Cost basis is always known, so its total
  // covers every row regardless of pricing. Current value and gain/loss can only be summed
  // from the rows that actually priced — silently treating an unpriced holding as £0 would
  // understate the total without saying so, the same fabrication Phase 2's "Price
  // unavailable" convention exists to avoid at the row level.
  const totalCostBasisPence = sumPence(account.holdings.map((h) => numericToPence(h.costBasis)));
  const pricedHoldings = account.holdings.filter(
    (h) => holdingValuations.get(h.id)?.currentValuePence != null,
  );
  const unpricedCount = account.holdings.length - pricedHoldings.length;
  const totalCurrentValuePence =
    pricedHoldings.length > 0
      ? sumPence(pricedHoldings.map((h) => holdingValuations.get(h.id)!.currentValuePence!))
      : null;
  const totalGainLoss =
    totalCurrentValuePence !== null
      ? gainLoss(sumPence(pricedHoldings.map((h) => numericToPence(h.costBasis))), totalCurrentValuePence)
      : null;

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
              <InteractiveTrendChart
                width={chartDimensions.width}
                height={chartDimensions.height}
                areaPath={path.area}
                segments={segments}
                hoverPoints={hoverPoints}
                color={strokeColour}
                ariaLabel={`Balance history for ${account.name}, from ${formatMoney(
                  points[0]!.pence,
                )} on ${points[0]!.date} to ${formatMoney(points.at(-1)!.pence)} on ${points.at(-1)!.date}.`}
              />
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

      <div className="mt-5">
        <BalanceHistoryPanel
          accountId={account.id}
          accountType={account.type}
          today={todayIso(now)}
          entries={[...account.history]
            .reverse()
            .map((entry) => ({
              id: entry.id,
              snapshotDate: entry.snapshotDate,
              amount: isDebt
                ? formatMoney(-numericToPence(entry.amount), { showPence: true })
                : formatMoney(numericToPence(entry.amount), { showPence: true }),
              amountRaw: isDebt ? penceToNumeric(-numericToPence(entry.amount)) : entry.amount,
            }))}
          editAction={updateBalanceSnapshot}
          deleteAction={removeBalanceSnapshot}
        />
      </div>

      {meta.holdsSecurities ? (
        <div className="mt-5">
          <HoldingsPanel
            accountId={account.id}
            holdings={account.holdings.map((holding) => {
              const valuation = holdingValuations.get(holding.id);
              const currency = valuation?.quoteCurrency ?? account.currency;
              return {
                id: holding.id,
                ticker: holding.ticker,
                quantity: holding.quantity,
                costBasis: formatMoney(numericToPence(holding.costBasis), { showPence: true }),
                costBasisRaw: holding.costBasis,
                currentValue:
                  valuation?.currentValuePence != null
                    ? formatMoney(valuation.currentValuePence, { showPence: true, currency })
                    : null,
                gainLoss: valuation?.gainLoss
                  ? {
                      amount: formatGainLossAmount(valuation.gainLoss.amountPence, { currency }),
                      percent: valuation.gainLoss.percent,
                      direction: valuation.gainLoss.direction,
                    }
                  : null,
              };
            })}
            addAction={addHolding}
            editAction={updateHolding}
            deleteAction={removeHolding}
            pricesAsOf={latestQuoteFetch ? relativeTimeFrom(latestQuoteFetch, now) : null}
            pricesStale={pricesStale}
            totals={{
              costBasis: formatMoney(totalCostBasisPence, { showPence: true }),
              currentValue:
                totalCurrentValuePence !== null
                  ? formatMoney(totalCurrentValuePence, { showPence: true, currency: account.currency })
                  : null,
              gainLoss: totalGainLoss
                ? {
                    amount: formatGainLossAmount(totalGainLoss.amountPence, { currency: account.currency }),
                    percent: totalGainLoss.percent,
                    direction: totalGainLoss.direction,
                  }
                : null,
              unpricedCount,
            }}
          />
        </div>
      ) : null}

      {!isDebt && account.type !== 'property' && account.type !== 'sipp_pension' ? (
        <div className="mt-5">
          <RegularContributionsPanel
            accountId={account.id}
            allowTicker={meta.holdsSecurities}
            contributions={account.regularContributions.map((contribution) => ({
              id: contribution.id,
              ticker: contribution.ticker,
              amount: `${formatMoney(numericToPence(contribution.amount), { showPence: true })}/year`,
              amountRaw: contribution.amount,
            }))}
            addAction={addRegularContribution}
            editAction={updateRegularContribution}
            deleteAction={removeRegularContribution}
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
