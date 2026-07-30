/**
 * The Comparison screen's assumptions-diff table: "only the fields that *differ*
 * between scenarios, not a full duplicate list, so the comparison is legible" per
 * `docs/DESIGN_SPEC.md`. Pure and DB-free — operates on two already-parsed
 * `ScenarioAssumptionsV1` values.
 */

import type { ScenarioAssumptionsV1 } from './scenarioAssumptions';

export interface AssumptionDiffRow {
  label: string;
  a: string;
  b: string;
}

const SCALAR_FIELDS: Array<{ key: keyof ScenarioAssumptionsV1; label: string; suffix?: string }> = [
  { key: 'annualSpending', label: 'Annual spending', suffix: '' },
  { key: 'survivorAnnualSpending', label: 'Survivor annual spending' },
  { key: 'inflationPct', label: 'Inflation', suffix: '%' },
  { key: 'equityAllocationPct', label: 'Equity allocation', suffix: '%' },
  { key: 'targetSuccessRatePct', label: 'Target success rate', suffix: '%' },
  { key: 'flatEffectiveTaxRatePct', label: 'Flat effective tax rate', suffix: '%' },
];

function scalarValue(value: string | undefined, suffix: string | undefined): string {
  if (value === undefined) return '—';
  return suffix ? `${value}${suffix}` : value;
}

/** `personNames` keys by `personId` — diff rows for per-person fields use the name, not
 * the raw id, matching the Editor's own "scope each field to a named person" rule. */
export function diffAssumptions(
  a: ScenarioAssumptionsV1,
  b: ScenarioAssumptionsV1,
  personNames: ReadonlyMap<number, string>,
): AssumptionDiffRow[] {
  const rows: AssumptionDiffRow[] = [];

  for (const field of SCALAR_FIELDS) {
    const aValue = a[field.key] as string | undefined;
    const bValue = b[field.key] as string | undefined;
    if (aValue !== bValue) {
      rows.push({ label: field.label, a: scalarValue(aValue, field.suffix), b: scalarValue(bValue, field.suffix) });
    }
  }

  if (a.wrapperWithdrawalOrder.join(',') !== b.wrapperWithdrawalOrder.join(',')) {
    rows.push({
      label: 'Withdrawal order',
      a: a.wrapperWithdrawalOrder.join(' → '),
      b: b.wrapperWithdrawalOrder.join(' → '),
    });
  }

  const personIds = new Set([...a.people.map((p) => p.personId), ...b.people.map((p) => p.personId)]);
  for (const personId of personIds) {
    const name = personNames.get(personId) ?? `Person ${personId}`;
    const aPerson = a.people.find((p) => p.personId === personId);
    const bPerson = b.people.find((p) => p.personId === personId);

    if (aPerson?.retirementAge !== bPerson?.retirementAge) {
      rows.push({
        label: `${name}'s retirement age`,
        a: aPerson ? String(aPerson.retirementAge) : '—',
        b: bPerson ? String(bPerson.retirementAge) : '—',
      });
    }
    if (aPerson?.planEndAge !== bPerson?.planEndAge) {
      rows.push({
        label: `${name}'s plan end age`,
        a: aPerson ? String(aPerson.planEndAge) : '—',
        b: bPerson ? String(bPerson.planEndAge) : '—',
      });
    }
    if (aPerson?.statePensionClaimAge !== bPerson?.statePensionClaimAge) {
      rows.push({
        label: `${name}'s State Pension claim age`,
        a: aPerson?.statePensionClaimAge !== undefined ? String(aPerson.statePensionClaimAge) : 'Default',
        b: bPerson?.statePensionClaimAge !== undefined ? String(bPerson.statePensionClaimAge) : 'Default',
      });
    }
    if (aPerson?.pclsAge !== bPerson?.pclsAge) {
      rows.push({
        label: `${name}'s PCLS age`,
        a: aPerson?.pclsAge !== undefined ? String(aPerson.pclsAge) : 'Never',
        b: bPerson?.pclsAge !== undefined ? String(bPerson.pclsAge) : 'Never',
      });
    }
    if (aPerson?.statePensionAnnualOverride !== bPerson?.statePensionAnnualOverride) {
      rows.push({
        label: `${name}'s State Pension override`,
        a: aPerson?.statePensionAnnualOverride ?? 'Default',
        b: bPerson?.statePensionAnnualOverride ?? 'Default',
      });
    }
  }

  return rows;
}
