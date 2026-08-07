/**
 * Scenario Editor form validation. Pure, client-safe, mirrors `AccountForm.tsx`'s own
 * pattern of re-running the same validator client-side (via `useMemo`, on every
 * keystroke) that a Server Action would otherwise be the only thing checking.
 *
 * `parseScenarioAssumptions` (`scenarioAssumptions.ts`) already owns every field-level
 * format/range rule (decimal-string shape, percent bounds, 0–130 age sanity) and its own
 * doc comment explicitly declines to own cross-field ordering — "that belongs with the
 * scenario-editor form validation once Milestone 9 builds it, where a field-level error
 * can be shown against the specific input." This file adds exactly those cross-field
 * checks, then defers to `parseScenarioAssumptions` as the final, authoritative parse —
 * not a second, possibly-drifting copy of its rules.
 */

import { type FieldErrors, type Validated } from '@/lib/accounts/validation';
import {
  parseScenarioAssumptions,
  ScenarioAssumptionsParseError,
  type ScenarioAssumptionsV1,
} from './scenarioAssumptions';
import type { DrawdownAccountType } from './engineTypes';

/** One person's raw form input — every age-shaped field is a string (an HTML number
 * input's `.value`), converted to a number only once it's confirmed to parse. */
export interface ScenarioFormPersonValues {
  personId: number;
  /** Not itself saved — carried through so `retirementAge` can be validated against it,
   * per the spec's exact rule ("must be between your current age and 100"). */
  currentAge: number;
  retirementAge: string;
  /** Empty string = use the derived default (not an override). */
  statePensionClaimAge: string;
  statePensionAnnualOverride: string;
  pclsAge: string;
  planEndAge: string;
}

/** One one-off event's raw form input (Phase 4.6). `amount` is the unsigned
 * magnitude the household typed; `direction` is a same-row Expense/Windfall toggle
 * that supplies the sign, rather than asking the household to type a minus sign. */
export interface ScenarioFormOneOffEventValues {
  id: string;
  label: string;
  personId: number;
  age: string;
  amount: string;
  direction: 'expense' | 'injection';
}

export interface ScenarioFormValues {
  annualSpending: string;
  /** Empty string = omit (single-person household, or not yet entered). */
  survivorAnnualSpending: string;
  inflationPct: string;
  equityAllocationPct: string;
  targetSuccessRatePct: string;
  flatEffectiveTaxRatePct: string;
  wrapperWithdrawalOrder: DrawdownAccountType[];
  people: ScenarioFormPersonValues[];
  oneOffEvents: ScenarioFormOneOffEventValues[];
}

const MIN_RETIREMENT_AGE_CONTEXT = 100;

function parseWholeNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** Exact copy from `docs/DESIGN_SPEC.md`'s copy table. */
export const RETIREMENT_AGE_RANGE_ERROR = 'Retirement age must be between your current age and 100';

function personFieldKey(index: number, field: string): string {
  return `people.${index}.${field}`;
}

export function validateScenarioForm(values: ScenarioFormValues): Validated<ScenarioAssumptionsV1> {
  const errors: FieldErrors = {};

  const parsedPeople = values.people.map((person, index) => {
    const retirementAge = parseWholeNumber(person.retirementAge);
    if (retirementAge === null || retirementAge < person.currentAge || retirementAge > MIN_RETIREMENT_AGE_CONTEXT) {
      errors[personFieldKey(index, 'retirementAge')] = RETIREMENT_AGE_RANGE_ERROR;
    }

    const planEndAge = parseWholeNumber(person.planEndAge);
    if (planEndAge === null) {
      errors[personFieldKey(index, 'planEndAge')] = 'Enter a whole number of years.';
    } else if (retirementAge !== null && planEndAge <= retirementAge) {
      errors[personFieldKey(index, 'planEndAge')] = 'Plan end age must be after retirement age.';
    }

    // `undefined` = not provided (use the derived default); `null` = provided but
    // unparseable, a genuine field error.
    function optionalWholeNumber(raw: string, field: string): number | undefined {
      if (raw.trim() === '') return undefined;
      const parsed = parseWholeNumber(raw);
      if (parsed === null) {
        errors[personFieldKey(index, field)] = 'Enter a whole number of years.';
        return undefined;
      }
      return parsed;
    }

    const statePensionClaimAgeValue = optionalWholeNumber(person.statePensionClaimAge, 'statePensionClaimAge');
    const pclsAgeValue = optionalWholeNumber(person.pclsAge, 'pclsAge');

    return {
      personId: person.personId,
      retirementAge: retirementAge ?? 0,
      statePensionClaimAge: statePensionClaimAgeValue,
      statePensionAnnualOverride:
        person.statePensionAnnualOverride.trim() === '' ? undefined : person.statePensionAnnualOverride.trim(),
      pclsAge: pclsAgeValue,
      planEndAge: planEndAge ?? 0,
    };
  });

  // Age needs client-side parsing (a number, not a string) before the final parse can
  // run at all — the same reason retirementAge/planEndAge are parsed above, not left
  // to parseScenarioAssumptions. The signed amount string, by contrast, is left for
  // parseScenarioAssumptions's own requireDecimalString to validate — same posture as
  // every other decimal field here (annualSpending, inflationPct, ...), which get no
  // pre-validation of their own and surface a format error as a generic form message.
  const parsedOneOffEvents = values.oneOffEvents.map((event, index) => {
    const age = parseWholeNumber(event.age);
    if (age === null) {
      errors[`oneOffEvents.${index}.age`] = 'Enter a whole number of years.';
    }
    return {
      id: event.id,
      label: event.label.trim(),
      personId: event.personId,
      age: age ?? 0,
      amount: event.direction === 'expense' ? `-${event.amount.trim()}` : event.amount.trim(),
    };
  });

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const candidate = {
    schemaVersion: 1,
    annualSpending: values.annualSpending.trim(),
    survivorAnnualSpending: values.survivorAnnualSpending.trim() === '' ? undefined : values.survivorAnnualSpending.trim(),
    inflationPct: values.inflationPct.trim(),
    equityAllocationPct: values.equityAllocationPct.trim(),
    targetSuccessRatePct: values.targetSuccessRatePct.trim(),
    flatEffectiveTaxRatePct: values.flatEffectiveTaxRatePct.trim(),
    wrapperWithdrawalOrder: values.wrapperWithdrawalOrder,
    people: parsedPeople,
    oneOffEvents: parsedOneOffEvents.length > 0 ? parsedOneOffEvents : undefined,
  };

  try {
    return { ok: true, value: parseScenarioAssumptions(candidate) };
  } catch (error) {
    const message =
      error instanceof ScenarioAssumptionsParseError ? error.message : 'Something in these assumptions isn’t valid.';
    return { ok: false, errors: { form: message } };
  }
}
