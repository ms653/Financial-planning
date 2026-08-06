import { redirect } from 'next/navigation';
import { compareDebtVsSave } from '@/lib/advisor/debtComparator';
import { orderDebts, type DebtOrderingMode, type OrderableDebt } from '@/lib/advisor/debtOrdering';
import { resolveWaterfallInput } from '@/lib/advisor/resolveWaterfallInput';
import { computeTaperRescueRecommendations } from '@/lib/advisor/taperRescue';
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
    minimumPaymentPence: debt.minimumPaymentPence,
  }));
}

function formatMonths(months: number): string {
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  const yearsPart = `${years} year${years === 1 ? '' : 's'}`;
  return remainder === 0 ? yearsPart : `${yearsPart} ${remainder} month${remainder === 1 ? '' : 's'}`;
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

  const taperRescueResult = computeTaperRescueRecommendations({
    extraAmountPence,
    debtBenchmarkRatePct: resolved.input.debtBenchmarkRatePct,
    emergencyFundTargetPence: resolved.input.emergencyFundTargetPence,
    emergencyFundCurrentPence: resolved.input.emergencyFundCurrentPence,
    people: resolved.input.people,
    debts: resolved.comparator.debts,
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

        {taperRescueResult.people.length > 0 ? (
          <div className="space-y-4">
            <h2 className="font-serif text-lg text-content">Worth weighing separately</h2>
            {taperRescueResult.people.map((person) => {
              const alreadyRecommendedPence =
                waterfallResult.steps.find((s) => s.id === 'further_pension' && s.personId === person.personId)
                  ?.amountPence ?? 0n;
              const remainingGrossPence = person.recommendedGrossContributionPence - alreadyRecommendedPence;

              return (
                <div
                  key={person.personId}
                  className="rounded-card border border-brass/40 bg-brass/10 p-5 shadow-card sm:p-6"
                >
                  <h3 className="font-serif text-base text-content">
                    {person.personName}: pulling income back under £100,000
                  </h3>
                  <p className="mt-2 text-sm text-content">
                    {person.personName}&rsquo;s income for tax purposes is {formatMoney(person.adjustedNetIncomePence)}
                    , inside the £100,000–£125,140 band where the personal allowance withdraws at £1 per £2 —
                    an effective ~60% marginal rate on that slice. A pension contribution here is a one-off
                    uplift, not a recurring return like a debt&rsquo;s interest rate, so it&rsquo;s worth
                    weighing against the steps above rather than assumed to win automatically.
                  </p>
                  <p className="mt-2 text-sm text-content">
                    Contributing {formatMoney(person.excessPence)} more (gross) would clear the taper
                    entirely
                    {person.recommendedGrossContributionPence < person.excessPence ? (
                      <>
                        , but headroom and the amount you have to allocate cap what&rsquo;s realistic right
                        now at {formatMoney(person.recommendedGrossContributionPence)}
                      </>
                    ) : null}
                    . Paid via relief-at-source, that&rsquo;s about {formatMoney(person.recommendedNetPaymentPence)}{' '}
                    from take-home pay — the scheme tops up the rest.
                    {alreadyRecommendedPence > 0n ? (
                      <>
                        {' '}
                        The order above already puts {formatMoney(alreadyRecommendedPence)} toward{' '}
                        {person.personName}&rsquo;s pension;
                        {remainingGrossPence > 0n
                          ? ` up to ${formatMoney(remainingGrossPence)} more (of your total extra amount) would fully clear the threshold.`
                          : ' that already covers the recommended amount above.'}
                      </>
                    ) : null}
                  </p>

                  {person.debtComparisons.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm text-content-muted">
                      {person.debtComparisons.map((cmp) => (
                        <li key={cmp.accountId}>
                          Versus {cmp.name} at {cmp.aprPct}% APR: paying that off instead would cost about{' '}
                          {formatMoney(cmp.totalInterestPence)} in interest over {formatMonths(cmp.months)}.
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {!taperRescueResult.emergencyFundOnTrack ? (
                    <p className="mt-3 text-xs text-content-faint">
                      Your emergency fund isn&rsquo;t at target yet — the order above already prioritises
                      that first.
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-content-faint">
                    Assumes you can keep servicing any debt minimum payments from your regular income — this
                    tool doesn&rsquo;t track a monthly budget to verify that. Doesn&rsquo;t account for the
                    Tax-Free Childcare / 30-funded-hours cliff at £100k ANI, which can make this move even
                    more valuable for parents relying on either — not modeled here.
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}

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
