import { redirect } from 'next/navigation';
import { compareDebtVsSave } from '@/lib/advisor/debtComparator';
import { orderDebts, type DebtOrderingMode, type OrderableDebt } from '@/lib/advisor/debtOrdering';
import { resolveWaterfallInput } from '@/lib/advisor/resolveWaterfallInput';
import { computeContributionWaterfall } from '@/lib/advisor/waterfall';
import { AppShell } from '@/components/AppShell';
import { DebtOrderToggle, type DebtOrderRowView } from '@/components/advisor/DebtOrderToggle';
import { ExtraAmountForm } from '@/components/advisor/ExtraAmountForm';
import { getSetupState } from '@/lib/household/queries';
import { formatMoney, parseMoneyInput } from '@/lib/money';
import { formatDateLabel } from '@/lib/ui/formatDateLabel';

/**
 * Phase 4.5, Milestone 4 — the Advisor page.
 *
 * Surfaces the contribution waterfall (`waterfall.ts`) and the debt-vs-save comparator
 * (`debtComparator.ts`) together, given how much extra the household has to allocate.
 * Recomputed live on every load from `searchParams.extra` — no persisted result row,
 * the same "read-only view parameterized by query string" shape
 * `retirement/compare/page.tsx` already uses, chosen over a Server Action because this
 * number is a one-off with nowhere worth persisting it (see `ExtraAmountForm.tsx`'s
 * own doc comment).
 */

export const dynamic = 'force-dynamic';

function orderableFromComparatorDebts(
  debts: Awaited<ReturnType<typeof resolveWaterfallInput>>['comparator']['debts'],
): OrderableDebt[] {
  return debts.map((debt) => ({
    accountId: debt.accountId,
    name: debt.name,
    personId: debt.personId,
    balancePence: debt.balancePence,
    interestRatePct: debt.interestRatePct,
    minimumPaymentPence: null,
  }));
}

function toOrderRowView(debts: OrderableDebt[]): DebtOrderRowView[] {
  return debts.map((debt) => ({
    accountId: debt.accountId,
    name: debt.name,
    balance: formatMoney(debt.balancePence),
    minimumPayment: debt.minimumPaymentPence !== null ? formatMoney(debt.minimumPaymentPence) : null,
    interestRate: debt.interestRatePct,
  }));
}

export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: { extra?: string };
}) {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const parsedExtra = searchParams.extra !== undefined ? parseMoneyInput(searchParams.extra) : null;
  const extraAmountPence = parsedExtra?.ok ? parsedExtra.pence : 0n;

  const resolved = await resolveWaterfallInput(setup.householdId, extraAmountPence);
  const waterfallResult = computeContributionWaterfall(resolved.input);
  const comparatorResult = compareDebtVsSave({
    todayIso: resolved.input.todayIso,
    extraAmountPence,
    debtBenchmarkRatePct: resolved.input.debtBenchmarkRatePct,
    householdOwnsProperty: resolved.comparator.householdOwnsProperty,
    debts: resolved.comparator.debts,
    people: resolved.input.people,
  });

  const orderable = orderableFromComparatorDebts(resolved.comparator.debts);
  const orderings: Record<DebtOrderingMode, DebtOrderRowView[]> = {
    avalanche: toOrderRowView(orderDebts(orderable, 'avalanche')),
    snowball: toOrderRowView(orderDebts(orderable, 'snowball')),
  };

  const allWarnings = [...resolved.warnings, ...waterfallResult.dataQualityWarnings];

  return (
    <AppShell pathname="/advisor">
      <div className="space-y-6">
        <div>
          <h1 className="font-serif text-2xl text-content">Cash allocation advisor</h1>
          <p className="mt-1 text-sm text-content-muted">
            Where extra money should go, in order — for the tax year{' '}
            {formatDateLabel(waterfallResult.taxYearWindow.startIso)}–
            {formatDateLabel(waterfallResult.taxYearWindow.endIso)}.
          </p>
        </div>

        <ExtraAmountForm initialValue={searchParams.extra ?? ''} />

        {allWarnings.length > 0 ? (
          <div className="space-y-2">
            {allWarnings.map((warning, index) => (
              <p
                key={index}
                role="alert"
                className="rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay"
              >
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
          <h2 className="font-serif text-lg text-content">Recommended order</h2>
          {waterfallResult.steps.length === 0 ? (
            <p className="mt-3 text-sm text-content-muted">Enter an amount above to see where it should go.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm text-content">
              {waterfallResult.steps.map((step, index) => (
                <li key={index} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{step.label}</span>
                    <span className="tabular font-medium">{formatMoney(step.amountPence)}</span>
                  </div>
                  <p className="mt-0.5 text-content-muted">{step.rationale}</p>
                </li>
              ))}
            </ul>
          )}
          {waterfallResult.unallocatedPence > 0n ? (
            <p className="mt-3 text-sm text-content-muted">
              {formatMoney(waterfallResult.unallocatedPence)} left over with nowhere left to recommend.
            </p>
          ) : null}

          <details open className="mt-4 rounded-card border border-line bg-paper">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-content">
              How to read this
            </summary>
            <div className="space-y-2 border-t border-line px-4 pb-4 pt-3 text-sm leading-relaxed text-content-muted">
              <p>
                Each step fills from what&rsquo;s left after the one before it: emergency fund, then any debt
                whose rate beats a realistic long-run investment return, then LISA, then the rest of the ISA
                allowance, then further pension contributions (capped by the annual allowance and your
                earnings), then a general investment account for whatever&rsquo;s left. This is a priority
                order, not a plan you have to follow exactly.
              </p>
            </div>
          </details>
        </div>

        {comparatorResult.comparable.length > 0 ? (
          <div className="space-y-4">
            <h2 className="font-serif text-lg text-content">Debt vs. save</h2>
            <p className="text-sm text-content-muted">
              For debt whose rate doesn&rsquo;t clearly beat investing, here are the numbers side by side —
              not a verdict.
            </p>
            {comparatorResult.comparable.map((debt) => (
              <div
                key={debt.accountId}
                className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-serif text-base text-content">{debt.name}</h3>
                  <span className="tabular text-sm text-content-muted">{debt.debtRatePct}% APR</span>
                </div>

                <p className="mt-2 text-sm text-content-muted">
                  Considering {formatMoney(debt.amountConsideredPence)}
                  {debt.penaltyFreeAllowancePence !== null ? (
                    <>
                      {' '}
                      — {formatMoney(debt.withinAllowancePence ?? 0n)} within the penalty-free overpayment
                      allowance
                      {debt.penaltyFreeAllowanceApproximated ? ' (estimated)' : ''}
                      {debt.aboveAllowancePence && debt.aboveAllowancePence > 0n ? (
                        <>
                          , {formatMoney(debt.aboveAllowancePence)} above it
                          {debt.ercCostPence !== null
                            ? ` costing ${formatMoney(debt.ercCostPence)} in early-repayment charges`
                            : ' (early-repayment-charge cost unknown)'}
                        </>
                      ) : null}
                      .
                    </>
                  ) : (
                    '.'
                  )}
                </p>

                {debt.warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-content-faint">
                    {debt.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                ) : null}

                <ul className="mt-4 space-y-2 border-t border-line pt-3">
                  {debt.investingOptions.map((option) => (
                    <li key={option.id} className="text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-content">{option.label}</span>
                        <span className="tabular text-content-muted">
                          {option.returnRatePct}%{option.beatsDebtRate ? ' — beats this debt’s rate' : ''}
                        </span>
                      </div>
                      {option.oneOffBonusPence !== null ? (
                        <p className="text-xs text-content-faint">
                          Plus a {formatMoney(option.oneOffBonusPence)} top-up on this amount.
                        </p>
                      ) : null}
                      {option.lisaLockInWarning ? (
                        <p className="mt-1 text-xs text-clay">{option.lisaLockInWarning}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        <DebtOrderToggle orderings={orderings} />
      </div>
    </AppShell>
  );
}
