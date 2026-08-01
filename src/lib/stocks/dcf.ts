/**
 * The DCF (discounted cash flow) calculator — Phase 4 Milestone 2.
 *
 * Standard, deliberately simple textbook DCF: base free cash flow grown at one uniform
 * annual rate over a user-set projection horizon, a terminal value via the Gordon
 * Growth Model (no exit-multiple option yet — that needs peer data M3's relative
 * valuation hasn't built), discounted to present value, minus net debt, divided by
 * diluted shares outstanding.
 *
 * **Money/rate math reuses this codebase's existing fixed-point techniques rather than
 * inventing new ones.** `roundDiv` (`src/lib/portfolio/valuation.ts`) is already
 * documented as reusable "for other fixed-point domains." Growing/discounting a value
 * year over year mirrors `src/lib/retirement/engine/deterministicCore.ts`'s
 * `applyAnnualReturn`: each step is `value + roundDiv(value * rateScaled,
 * RATE_SCALE_DIVISOR)`, looped N times — never a closed-form `(1+r)^N` power, which
 * would need a float or a bigint-power helper this codebase has neither of. `RATE_SCALE`
 * below is a new, local constant — not imported from `retirement/engineTypes.ts`, the
 * same "don't reach into an unrelated domain for a coincidentally-similar concept"
 * reasoning Milestone 1 already applied to the ticker-validation regex.
 */

import { parseScaledDecimal, roundDiv } from '@/lib/portfolio/valuation';
import type { FmpStatements } from './fmp';

/** A fraction, not a percent: "8.5%" is represented as the fraction 0.085, scaled by
 * `10^RATE_SCALE`. Matches `retirement/engineTypes.ts`'s own `RATE_SCALE` value (six
 * digits of fractional precision), coincidentally, not by import. */
const RATE_SCALE = 6;
const RATE_SCALE_DIVISOR = 10n ** BigInt(RATE_SCALE);

export class DcfInputsParseError extends Error {}

export interface DcfInputsV1 {
  schemaVersion: 1;
  /** Annual growth rate applied to free cash flow during the projection horizon. */
  growthRatePct: string;
  /** The required rate of return (or WACC) cash flows are discounted at. */
  discountRatePct: string;
  /** Perpetuity growth rate used in the Gordon Growth terminal value — must be strictly
   * less than `discountRatePct`, or the model's denominator is zero or negative. */
  terminalGrowthRatePct: string;
  /** How many years to project explicitly before the terminal value picks up. */
  projectionYears: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new DcfInputsParseError(`${field} must be a non-empty string`);
  }
  return value;
}

/** Mirrors `scenarioAssumptions.ts`'s `requirePercentString` exactly (same NUMERIC(6,3)
 * shape reasoning) — reimplemented locally rather than imported, since importing a
 * private helper across an unrelated domain module isn't a real dependency, just a
 * coincidence of both needing "a percent string". */
function requirePercentString(value: unknown, field: string, bounds: { min: number; max: number }): string {
  const str = requireString(value, field);
  if (!/^-?\d{1,3}(\.\d{1,3})?$/.test(str)) {
    throw new DcfInputsParseError(`${field} must be a plain percent like "8.500", got ${JSON.stringify(str)}`);
  }
  const numeric = Number(str);
  if (numeric < bounds.min || numeric > bounds.max) {
    throw new DcfInputsParseError(`${field} must be between ${bounds.min} and ${bounds.max}, got ${JSON.stringify(str)}`);
  }
  return str;
}

/** 1–20 years: long enough for a real projection horizon, short enough that the model
 * isn't pretending to forecast a company's cash flows decades out with any real
 * confidence — the terminal value exists precisely so the model doesn't need to. */
function requireProjectionYears(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 20) {
    throw new DcfInputsParseError('projectionYears must be a whole number between 1 and 20');
  }
  return value;
}

export function parseDcfInputs(raw: unknown): DcfInputsV1 {
  if (!isPlainObject(raw)) {
    throw new DcfInputsParseError('DCF inputs must be a JSON object');
  }

  switch (raw.schemaVersion) {
    case 1: {
      const growthRatePct = requirePercentString(raw.growthRatePct, 'growthRatePct', { min: -100, max: 100 });
      const discountRatePct = requirePercentString(raw.discountRatePct, 'discountRatePct', { min: 0.001, max: 100 });
      const terminalGrowthRatePct = requirePercentString(raw.terminalGrowthRatePct, 'terminalGrowthRatePct', {
        min: -100,
        max: 100,
      });
      if (Number(terminalGrowthRatePct) >= Number(discountRatePct)) {
        throw new DcfInputsParseError(
          'terminalGrowthRatePct must be less than discountRatePct, or the terminal value is undefined',
        );
      }
      const projectionYears = requireProjectionYears(raw.projectionYears);

      return { schemaVersion: 1, growthRatePct, discountRatePct, terminalGrowthRatePct, projectionYears };
    }
    default:
      throw new DcfInputsParseError(`Unknown DCF inputs schemaVersion: ${JSON.stringify(raw.schemaVersion)}`);
  }
}

function percentToScaledFraction(percent: string): bigint {
  return roundDiv(parseScaledDecimal(percent, RATE_SCALE), 100n);
}

/** One year's growth: `value + roundDiv(value * rateScaled, RATE_SCALE_DIVISOR)`,
 * matching `applyAnnualReturn`'s exact shape. Deliberately no zero-balance
 * short-circuit — unlike a portfolio balance, `value` here can legitimately be zero or
 * negative (a company currently burning cash), and `roundDiv(0n * rate, divisor)` is
 * already `0n` without one. */
function growOneYear(valuePence: bigint, rateScaled: bigint): bigint {
  return valuePence + roundDiv(valuePence * rateScaled, RATE_SCALE_DIVISOR);
}

/** One year's discounting of a *cumulative discount factor* (not of a money value
 * directly) — `factor / (1 + rate)`, i.e. `roundDiv(factor * RATE_SCALE_DIVISOR,
 * RATE_SCALE_DIVISOR + rateScaled)`. Starting `factor` at `RATE_SCALE_DIVISOR`
 * (representing exactly 1.0) and calling this once per year builds up `1/(1+r)^t`
 * iteratively — the same "loop, don't exponentiate" choice `growOneYear` makes, applied
 * to division instead of multiplication. */
function discountFactorOneYear(factorScaled: bigint, rateScaled: bigint): bigint {
  return roundDiv(factorScaled * RATE_SCALE_DIVISOR, RATE_SCALE_DIVISOR + rateScaled);
}

export interface DcfYearProjection {
  /** 1-based — year 1 is the first projected year after the base (most recent actual). */
  year: number;
  projectedFcfPence: bigint;
  presentValuePence: bigint;
}

export interface DcfResult {
  years: DcfYearProjection[];
  /** Undiscounted Gordon Growth terminal value, as of the end of the projection horizon. */
  terminalValuePence: bigint;
  presentValueOfTerminalValuePence: bigint;
  /** Sum of every projected year's present value, plus the terminal value's. */
  enterpriseValuePence: bigint;
  /** Enterprise value minus net debt (`totalDebt - cash`) — net debt itself may be
   * negative (more cash than debt), which correctly *adds* to equity value here. */
  equityValuePence: bigint;
  /** `null` when `dilutedShares` is zero or unknown — there is nothing to divide by. */
  intrinsicValuePerSharePence: bigint | null;
}

/**
 * Pure DCF calculation. Takes the household's assumptions plus the base figures
 * derived from fetched fundamentals (`deriveDcfBaseInputs` below) — never fetches or
 * reads anything itself, so it's exactly as testable as
 * `retirement/engine/deterministicCore.ts`'s `simulatePath` is for the same reason.
 */
export function computeDcf(
  inputs: DcfInputsV1,
  baseFcfPence: bigint,
  netDebtPence: bigint,
  dilutedShares: bigint,
): DcfResult {
  const growthRate = percentToScaledFraction(inputs.growthRatePct);
  const discountRate = percentToScaledFraction(inputs.discountRatePct);
  const terminalGrowthRate = percentToScaledFraction(inputs.terminalGrowthRatePct);

  const years: DcfYearProjection[] = [];
  let projectedFcfPence = baseFcfPence;
  let discountFactorScaled = RATE_SCALE_DIVISOR; // 1.0, scaled
  let enterpriseValuePence = 0n;

  for (let year = 1; year <= inputs.projectionYears; year++) {
    projectedFcfPence = growOneYear(projectedFcfPence, growthRate);
    discountFactorScaled = discountFactorOneYear(discountFactorScaled, discountRate);
    const presentValuePence = roundDiv(projectedFcfPence * discountFactorScaled, RATE_SCALE_DIVISOR);
    years.push({ year, projectedFcfPence, presentValuePence });
    enterpriseValuePence += presentValuePence;
  }

  // Gordon Growth Model: TV = FCF_(N+1) / (discountRate - terminalGrowthRate).
  // FCF_(N+1) = the final projected year's FCF grown one more year at the *terminal*
  // rate (not the explicit-projection growth rate — by year N+1 the explicit forecast
  // has ended and the perpetuity growth rate is what's actually being modelled).
  const fcfAfterHorizon = growOneYear(projectedFcfPence, terminalGrowthRate);
  const rateDiffScaled = discountRate - terminalGrowthRate; // > 0n, enforced by parseDcfInputs
  const terminalValuePence = roundDiv(fcfAfterHorizon * RATE_SCALE_DIVISOR, rateDiffScaled);
  const presentValueOfTerminalValuePence = roundDiv(terminalValuePence * discountFactorScaled, RATE_SCALE_DIVISOR);

  enterpriseValuePence += presentValueOfTerminalValuePence;
  const equityValuePence = enterpriseValuePence - netDebtPence;
  const intrinsicValuePerSharePence = dilutedShares > 0n ? roundDiv(equityValuePence, dilutedShares) : null;

  return {
    years,
    terminalValuePence,
    presentValueOfTerminalValuePence,
    enterpriseValuePence,
    equityValuePence,
    intrinsicValuePerSharePence,
  };
}

export interface DcfBaseInputs {
  baseFcfPence: bigint;
  netDebtPence: bigint;
  dilutedShares: bigint;
}

/**
 * Maps the most recent fiscal year in a ticker's cached FMP statements to the base
 * figures `computeDcf` needs. `null` when any required figure is missing or
 * unparseable — the caller shows "can't compute a DCF for this ticker yet" rather than
 * a crash or a silently-wrong zero.
 *
 * **The one disclosed, narrow exception to "money never touches a float" in this
 * codebase**: FMP returns statement figures as JSON numbers (e.g. `69391000000`), not
 * the NUMERIC-as-string shape this codebase's own database returns everywhere else.
 * Converted to bigint pence *immediately here, once* — never carried as a float
 * through `computeDcf`'s own maths. Company-scale financials (up to ~14 digits) are
 * safely within `Number`'s exact-integer range even at cent precision (`Number
 * .isSafeInteger` covers up to ~9 * 10^15), so `Math.round(value * 100)` doesn't lose
 * precision here — but this is still a deliberate, called-out exception, not a silent
 * gap in the rule, because the source is third-party JSON this codebase doesn't control,
 * not a value it computed itself.
 *
 * **Index `[0]` = most recent fiscal year — confirmed live, 2026-08-01**, not just the
 * widely-documented convention this originally assumed. A real call against `AAPL`
 * returned `date: "2025-09-27"` (FY2025) first, `"2024-09-28"` (FY2024) second —
 * genuinely newest-first, cross-checked at the same time `fmp.ts`'s own error-response
 * shape was confirmed (see that file's doc comment for the full verification, including
 * a real endpoint-URL bug that verification pass also caught and fixed).
 *
 * **Reads `netDebt` directly rather than computing `totalDebt - cashAndCashEquivalents`
 * itself** — also decided during the same live-verification pass. FMP exposes `netDebt`
 * as its own field, and a real `AAPL` response confirmed it's exactly consistent with
 * the subtraction (both gave 76,443,000,000) — reading the provider's own authoritative
 * figure directly is simpler and more robust to edge cases (e.g. a company where "net
 * debt" isn't just `totalDebt - cash` by some other convention) than re-deriving it.
 */
export function deriveDcfBaseInputs(statements: FmpStatements): DcfBaseInputs | null {
  const latestCashFlow = statements.cashFlowStatements[0];
  const latestBalanceSheet = statements.balanceSheets[0];
  const latestIncome = statements.incomeStatements[0];
  if (!latestCashFlow || !latestBalanceSheet || !latestIncome) return null;

  const freeCashFlow = latestCashFlow.freeCashFlow;
  const netDebt = latestBalanceSheet.netDebt;
  const dilutedSharesRaw = latestIncome.weightedAverageShsOutDil;

  if (
    typeof freeCashFlow !== 'number' ||
    !Number.isFinite(freeCashFlow) ||
    typeof netDebt !== 'number' ||
    !Number.isFinite(netDebt) ||
    typeof dilutedSharesRaw !== 'number' ||
    !Number.isFinite(dilutedSharesRaw) ||
    dilutedSharesRaw < 0
  ) {
    return null;
  }

  return {
    baseFcfPence: BigInt(Math.round(freeCashFlow * 100)),
    netDebtPence: BigInt(Math.round(netDebt * 100)),
    dilutedShares: BigInt(Math.round(dilutedSharesRaw)),
  };
}
