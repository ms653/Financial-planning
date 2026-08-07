/**
 * The typed shape of `retirement_scenario.assumptions`, and the only code path that
 * should read or write that JSONB column's contents as anything other than `unknown`.
 *
 * JSONB's real failure mode is silent shape drift, not a loud error — a scenario saved
 * under one version of this app read by a later (or earlier) one. The guard against that
 * is a `schemaVersion` field checked before anything else, and a parser that throws on
 * anything it doesn't recognise rather than guessing. There is only one version today;
 * the `switch` is written as a switch anyway so "add v2" is "add a case", not "rewrite
 * the function and hope nothing upstream assumed v1's shape".
 *
 * Values that are money are decimal strings in pounds (matching `src/lib/money.ts`'s
 * "NUMERIC stays as a string" discipline throughout this codebase) — parsed to pence via
 * `numericToPence` at the point the engine actually needs to compute with them, never
 * stored or passed around as a JS `number`.
 */

import { numericToPence } from '@/lib/money';
import { DRAWDOWN_ACCOUNT_TYPES, type DrawdownAccountType } from '@/lib/retirement/engineTypes';

export class ScenarioAssumptionsParseError extends Error {}

export interface ScenarioAssumptionsPersonV1 {
  personId: number;
  /** Planning assumption, not necessarily today's age — the age this person intends to
   * stop earned income and start drawing down. */
  retirementAge: number;
  /** Overrides the default derived from `taxYearConfig.statePensionDate` via this
   * person's date of birth — a household may want to model claiming later than the
   * earliest eligible date. Undefined = use the derived default. */
  statePensionClaimAge?: number;
  /** Overrides the default `taxYearConfig.statePensionAnnualPence()` figure — e.g. a
   * reduced entitlement from an incomplete National Insurance record. Decimal pounds
   * string. Undefined = use the current tax year's default. */
  statePensionAnnualOverride?: string;
  /** Age at which this person's 25% Pension Commencement Lump Sum is taken.
   * Undefined = never taken within the modelled horizon (deferred indefinitely) — a
   * documented simplification, not validated against the £268,275 Lump Sum Allowance;
   * see `src/lib/retirement/engine/deterministicCore.ts` (Milestone 3). */
  pclsAge?: number;
  /** The age this person's plan ends — a mortality assumption, required (not optional)
   * so "one person outlives the other" is representable at all. Not a prediction of
   * actual life expectancy; a planning horizon the household chooses. */
  planEndAge: number;
}

/**
 * A one-off cash event at a specific age — "house purchase" and "major expense" from
 * `docs/PROPOSAL.md`'s Phase 4.6 spec are both just this, signed: a positive `amount`
 * is an injection (windfall/gift), a negative one an expense. No "which wrapper"
 * field — an expense is folded into that year's ordinary shortfall and drawn through
 * `wrapperWithdrawalOrder` exactly like normal spending; an injection lands directly
 * in `cash` (see `deterministicCore.ts`'s own doc comment for why that's hardcoded
 * rather than reusing `wrapperWithdrawalOrder[0]`).
 */
export interface OneOffEventV1 {
  /** Client-generated (`crypto.randomUUID()`) — a list-editing key only, never read
   * by the engine and not meaningful across scenarios (see `scenarioDiff.ts`). */
  id: string;
  label: string;
  /** Must be a member of this same scenario's own `people[]`. */
  personId: number;
  age: number;
  /** Signed decimal pounds string; must be non-zero. */
  amount: string;
}

export interface ScenarioAssumptionsV1 {
  schemaVersion: 1;
  /** Real (inflation-adjusted) annual household spending while both people are alive,
   * before any survivor adjustment. Decimal pounds string. */
  annualSpending: string;
  /** Household spending once only one person in `people` remains under their
   * `planEndAge` — the "single-survivor spending" case named explicitly in
   * `docs/PROPOSAL.md`'s Testing strategy. Decimal pounds string. Required whenever
   * `people` has more than one entry; meaningless (and should be omitted) for a
   * single-person household. */
  survivorAnnualSpending?: string;
  /** Annual inflation assumption, percent (e.g. "2.500" for 2.5%). */
  inflationPct: string;
  /** Percent of the modelled portfolio treated as growth assets vs. cash/bonds for the
   * return-sampling engine (Milestone 5) — not a real per-account allocation. */
  equityAllocationPct: string;
  /** The simulation's target success rate, percent — shown against the actual computed
   * rate, not itself an input to the maths. */
  targetSuccessRatePct: string;
  /** A single flat rate applied to taxable drawdown only (ISA withdrawals and the PCLS
   * tranche are excluded) — `docs/PROPOSAL.md`'s deliberate P1-of-Phase-3 simplification;
   * real personal-allowance/taper logic is Phase 4.5. No sensible default is specified
   * anywhere in the source proposal (unlike the 3.0–3.5% withdrawal rate); the UI layer
   * (Milestone 9) is responsible for choosing and documenting one. */
  flatEffectiveTaxRatePct: string;
  /** Applied literally, in order, with no optimisation — the exact boundary
   * `docs/PROPOSAL.md`'s Phase 8 note draws: an honestly-documented simplification, not
   * an undocumented early arrival of wrapper-sequencing optimisation. */
  wrapperWithdrawalOrder: DrawdownAccountType[];
  people: ScenarioAssumptionsPersonV1[];
  /** Optional — a new `schemaVersion: 1` field, not a version bump. The parser
   * already ignores unknown keys and this one defaults to absent, so both directions
   * (old code reading a new scenario; new code reading an old one) are safe with no
   * migration — the same category of addition `pclsAge`/`survivorAnnualSpending`
   * already are. */
  oneOffEvents?: OneOffEventV1[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new ScenarioAssumptionsParseError(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Strict canonical form only — `^-?\d+(\.\d{1,2})?$` — deliberately narrower than
 * `numericToPence`'s own `parseMoneyInput`, which also tolerates a leading `£`,
 * thousands separators and whitespace for the UI-input case it was written for. A
 * stored assumption is not raw user keystrokes; two scenarios worth "£30,000" and
 * "30000" would otherwise persist as different bytes for the same value. The format
 * check runs first, then `numericToPence` for the same magnitude bound
 * (`MAX_PENCE`) every other money value in this codebase is held to.
 */
function requireDecimalString(value: unknown, field: string): string {
  const str = requireString(value, field);
  if (!/^-?\d+(\.\d{1,2})?$/.test(str)) {
    throw new ScenarioAssumptionsParseError(
      `${field} must be a plain decimal amount like "30000" or "30000.50", got ${JSON.stringify(str)}`,
    );
  }
  try {
    numericToPence(str);
  } catch {
    throw new ScenarioAssumptionsParseError(`${field} is out of range: ${JSON.stringify(str)}`);
  }
  return str;
}

function optionalDecimalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireDecimalString(value, field);
}

/** Matches the `percent()` schema helper's NUMERIC(6,3) — up to 3 decimal places, not
 * `requireDecimalString`'s 2dp money scale. A percent field parsed with the money
 * validator would reject a perfectly valid "2.500" for being "too many decimal places".
 * `bounds` also mirrors NUMERIC(6,3)'s own 3-integer-digit ceiling (max magnitude
 * 999.999) in addition to whatever domain-specific range the field actually needs —
 * without it, "150.000" for an allocation percent or "-40.000" for a target success
 * rate would both pass as a merely-well-formatted number. */
function requirePercentString(
  value: unknown,
  field: string,
  bounds: { min: number; max: number },
): string {
  const str = requireString(value, field);
  if (!/^-?\d{1,3}(\.\d{1,3})?$/.test(str)) {
    throw new ScenarioAssumptionsParseError(`${field} must be a plain percent like "2.500", got ${JSON.stringify(str)}`);
  }
  const numeric = Number(str);
  if (numeric < bounds.min || numeric > bounds.max) {
    throw new ScenarioAssumptionsParseError(
      `${field} must be between ${bounds.min} and ${bounds.max}, got ${JSON.stringify(str)}`,
    );
  }
  return str;
}

/** Ages are whole years within a plainly sane human range — the same ~120-year sanity
 * bound `validateAccountEdit`'s date-of-birth check already applies elsewhere in this
 * codebase (`src/lib/accounts/validation.ts`), not a stricter or looser one invented
 * here. Not a cross-field check (e.g. `retirementAge` vs. `planEndAge` ordering) —
 * that belongs with the scenario-editor form validation once Milestone 9 builds it,
 * where a field-level error can be shown against the specific input, not a blob-level
 * throw. */
function requireAge(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 130) {
    throw new ScenarioAssumptionsParseError(`${field} must be a whole number of years between 0 and 130`);
  }
  return value;
}

function optionalAge(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return requireAge(value, field);
}

function requirePersonId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ScenarioAssumptionsParseError(`${field} must be a positive integer`);
  }
  return value;
}

function parsePersonV1(raw: unknown, index: number): ScenarioAssumptionsPersonV1 {
  if (!isPlainObject(raw)) {
    throw new ScenarioAssumptionsParseError(`people[${index}] must be an object`);
  }
  return {
    personId: requirePersonId(raw.personId, `people[${index}].personId`),
    retirementAge: requireAge(raw.retirementAge, `people[${index}].retirementAge`),
    statePensionClaimAge: optionalAge(raw.statePensionClaimAge, `people[${index}].statePensionClaimAge`),
    statePensionAnnualOverride: optionalDecimalString(
      raw.statePensionAnnualOverride,
      `people[${index}].statePensionAnnualOverride`,
    ),
    pclsAge: optionalAge(raw.pclsAge, `people[${index}].pclsAge`),
    planEndAge: requireAge(raw.planEndAge, `people[${index}].planEndAge`),
  };
}

/** Membership against `validPersonIds` is a structural/referential check — the same
 * category `wrapperWithdrawalOrder`'s own enum check already is — so it belongs here,
 * not deferred to `scenarioFormValidation.ts` (which owns business-judgment cross-field
 * checks like age ordering, not "does this id exist at all"). */
function parseOneOffEventV1(raw: unknown, index: number, validPersonIds: ReadonlySet<number>): OneOffEventV1 {
  if (!isPlainObject(raw)) {
    throw new ScenarioAssumptionsParseError(`oneOffEvents[${index}] must be an object`);
  }
  const personId = requirePersonId(raw.personId, `oneOffEvents[${index}].personId`);
  if (!validPersonIds.has(personId)) {
    throw new ScenarioAssumptionsParseError(
      `oneOffEvents[${index}].personId (${personId}) is not one of this scenario's own people`,
    );
  }
  const amount = requireDecimalString(raw.amount, `oneOffEvents[${index}].amount`);
  if (numericToPence(amount) === 0n) {
    throw new ScenarioAssumptionsParseError(`oneOffEvents[${index}].amount must not be zero`);
  }
  return {
    id: requireString(raw.id, `oneOffEvents[${index}].id`),
    label: requireString(raw.label, `oneOffEvents[${index}].label`),
    personId,
    age: requireAge(raw.age, `oneOffEvents[${index}].age`),
    amount,
  };
}

/**
 * Parse and validate a `retirement_scenario.assumptions` JSONB value. Throws
 * `ScenarioAssumptionsParseError` on anything malformed or on an unrecognised
 * `schemaVersion`, rather than guessing at a shape or silently dropping fields — the
 * same "never fabricate, always say so" posture the rest of this codebase applies to
 * money and market data.
 */
export function parseScenarioAssumptions(raw: unknown): ScenarioAssumptionsV1 {
  if (!isPlainObject(raw)) {
    throw new ScenarioAssumptionsParseError('assumptions must be a JSON object');
  }

  switch (raw.schemaVersion) {
    case 1: {
      const peopleRaw = raw.people;
      if (!Array.isArray(peopleRaw) || peopleRaw.length === 0) {
        throw new ScenarioAssumptionsParseError('people must be a non-empty array');
      }
      const people = peopleRaw.map((p, i) => parsePersonV1(p, i));

      if (people.length > 1 && raw.survivorAnnualSpending === undefined) {
        throw new ScenarioAssumptionsParseError(
          'survivorAnnualSpending is required when more than one person is modelled',
        );
      }

      // Validated against the real drawdown-wrapper enum, not just "is a string" — an
      // unchecked cast to AccountTypeValue[] would let a payload like ["not_a_type"]
      // through as if it were trusted, typed data, contradicting this module's whole
      // reason to exist. Narrowed to `DrawdownAccountType` (excludes `debt`/`property`),
      // not the full 8-value `AccountTypeValue` enum: Milestone 2's Fable review flagged
      // that a wider type here would let a mortgage or a house valuation be walked into
      // a simulated drawdown total, and Milestone 3 is the milestone that had to close
      // it — see `engineTypes.ts`'s `DRAWDOWN_ACCOUNT_TYPES` doc comment.
      const validAccountTypes = new Set<string>(DRAWDOWN_ACCOUNT_TYPES);
      const wrapperWithdrawalOrderRaw = raw.wrapperWithdrawalOrder;
      if (
        !Array.isArray(wrapperWithdrawalOrderRaw) ||
        wrapperWithdrawalOrderRaw.length === 0 ||
        !wrapperWithdrawalOrderRaw.every((w) => typeof w === 'string' && validAccountTypes.has(w))
      ) {
        throw new ScenarioAssumptionsParseError(
          `wrapperWithdrawalOrder must be a non-empty array of drawdown account types (one of ${[...validAccountTypes].join(', ')})`,
        );
      }

      const personIds = new Set(people.map((p) => p.personId));
      const oneOffEventsRaw = raw.oneOffEvents;
      let oneOffEvents: OneOffEventV1[] | undefined;
      if (oneOffEventsRaw !== undefined) {
        if (!Array.isArray(oneOffEventsRaw)) {
          throw new ScenarioAssumptionsParseError('oneOffEvents must be an array');
        }
        oneOffEvents = oneOffEventsRaw.map((e, i) => parseOneOffEventV1(e, i, personIds));
      }

      return {
        schemaVersion: 1,
        annualSpending: requireDecimalString(raw.annualSpending, 'annualSpending'),
        survivorAnnualSpending: optionalDecimalString(raw.survivorAnnualSpending, 'survivorAnnualSpending'),
        inflationPct: requirePercentString(raw.inflationPct, 'inflationPct', { min: -20, max: 50 }),
        equityAllocationPct: requirePercentString(raw.equityAllocationPct, 'equityAllocationPct', { min: 0, max: 100 }),
        targetSuccessRatePct: requirePercentString(raw.targetSuccessRatePct, 'targetSuccessRatePct', { min: 0, max: 100 }),
        flatEffectiveTaxRatePct: requirePercentString(raw.flatEffectiveTaxRatePct, 'flatEffectiveTaxRatePct', {
          min: 0,
          max: 100,
        }),
        wrapperWithdrawalOrder: wrapperWithdrawalOrderRaw as DrawdownAccountType[],
        people,
        oneOffEvents,
      };
    }
    default:
      throw new ScenarioAssumptionsParseError(
        `Unsupported scenario schemaVersion: ${JSON.stringify(raw.schemaVersion)}`,
      );
  }
}
