import type { ScenarioAssumptionsV1 } from '@/lib/retirement/scenarioAssumptions';

/**
 * The Results screen's "compact assumptions summary (collapsed, expandable) so the user
 * can see *what* produced this result without leaving the screen" — a native
 * `<details>` disclosure, needing no client JS, matching this codebase's existing bias
 * (`ErrorState`'s retry link, the Compare picker) toward plain HTML over a client
 * component wherever the interaction is this simple.
 */

export function AssumptionsSummary({
  assumptions,
  personNames,
  defaultOpen = false,
}: {
  assumptions: ScenarioAssumptionsV1;
  personNames: ReadonlyMap<number, string>;
  /** The Results screen wants this collapsed by default; the Scenario Wizard's
   * Review step wants it open immediately, since the whole point of that step is
   * to show what's about to run without an extra click. */
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="rounded-card border border-line bg-paper-raised">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-content">
        Assumptions used
      </summary>
      <dl className="grid gap-x-6 gap-y-3 border-t border-line px-4 py-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-content-faint">Annual spending</dt>
          <dd className="tabular text-content">£{assumptions.annualSpending}</dd>
        </div>
        {assumptions.survivorAnnualSpending ? (
          <div>
            <dt className="text-content-faint">Survivor annual spending</dt>
            <dd className="tabular text-content">£{assumptions.survivorAnnualSpending}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-content-faint">Inflation</dt>
          <dd className="tabular text-content">{assumptions.inflationPct}%</dd>
        </div>
        <div>
          <dt className="text-content-faint">Equity allocation</dt>
          <dd className="tabular text-content">{assumptions.equityAllocationPct}%</dd>
        </div>
        <div>
          <dt className="text-content-faint">Target success rate</dt>
          <dd className="tabular text-content">{assumptions.targetSuccessRatePct}%</dd>
        </div>
        <div>
          <dt className="text-content-faint">Flat effective tax rate</dt>
          <dd className="tabular text-content">{assumptions.flatEffectiveTaxRatePct}%</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-content-faint">Withdrawal order</dt>
          <dd className="text-content">{assumptions.wrapperWithdrawalOrder.join(' → ')}</dd>
        </div>
        {assumptions.people.map((person) => (
          <div key={person.personId} className="sm:col-span-2">
            <dt className="text-content-faint">{personNames.get(person.personId) ?? `Person ${person.personId}`}</dt>
            <dd className="tabular text-content">
              Retires at {person.retirementAge}, plan ends at {person.planEndAge}
              {person.statePensionClaimAge !== undefined
                ? `, State Pension from ${person.statePensionClaimAge}`
                : ''}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
