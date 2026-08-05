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
import type { FmpStatementPeriod, FmpStatements } from './fmp';

/** A fraction, not a percent: "8.5%" is represented as the fraction 0.085, scaled by
 * `10^RATE_SCALE`. Matches `retirement/engineTypes.ts`'s own `RATE_SCALE` value (six
 * digits of fractional precision), coincidentally, not by import. */
const RATE_SCALE = 6;
const RATE_SCALE_DIVISOR = 10n ** BigInt(RATE_SCALE);

export class DcfInputsParseError extends Error {}

/** The generic house defaults for a ticker with no saved assumptions and no
 * data-driven suggestion available (see `suggestGrowthRatePct`/`suggestDiscountRatePct`
 * below). Shared by `/stocks/[ticker]` (which prefers a suggestion over this where one
 * exists) and the watchlist list page (Milestone 5, which shows saved-or-default
 * assumptions without computing per-ticker suggestions for every row) — one constant,
 * not two copies that could drift. */
export const DEFAULT_DCF_INPUTS: DcfInputsV1 = {
  schemaVersion: 1,
  growthRatePct: '8.000',
  discountRatePct: '10.000',
  terminalGrowthRatePct: '2.500',
  projectionYears: 5,
};

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
  /** The currency the statement figures above are reported in, e.g. `"USD"` —
   * `null` when the field is absent (an older cached row, or the field genuinely
   * missing). See this function's own doc comment on `reportedCurrency` for what this
   * guards against and the caveat on how confidently the field name itself is known. */
  reportedCurrency: string | null;
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
 *
 * **Disclosed methodology simplification, flagged by independent review, not fixed**:
 * FMP's `freeCashFlow` (operating cash flow minus capex) is *levered* (equity) free
 * cash flow, since operating cash flow already sits after interest paid — not the
 * unlevered FCFF a textbook enterprise-value DCF is built to discount. `computeDcf`
 * discounts this levered figure at a cost-of-equity-style rate (`suggestDiscountRatePct`
 * is CAPM, itself a cost-of-equity estimate, not a WACC) and *then* subtracts net debt
 * to reach `equityValuePence` — for a company with meaningful net debt, that
 * effectively costs it twice, once implicitly (levered FCF is already net of interest)
 * and once explicitly (the net-debt subtraction), understating intrinsic value by
 * roughly the net-debt amount. A correct fix needs unlevered FCF
 * (`freeCashFlow + afterTaxInterestExpense`, which needs an interest-expense figure
 * and a tax rate this module doesn't currently fetch) and a genuine WACC — real
 * scope beyond a bug fix, so this is named here rather than silently left for the
 * next person to rediscover. Net-cash companies (negative net debt) aren't
 * meaningfully affected either way.
 *
 * **`reportedCurrency` — read defensively, not live-verified this session.** FMP's
 * income/balance-sheet/cash-flow statement endpoints are commonly documented to carry
 * a `reportedCurrency` field (e.g. `"USD"`), but unlike every other field name this
 * function's own doc comment above cites, this one hasn't been confirmed against a
 * real key in this codebase's own verification passes — flagged honestly, not
 * presented as equally certain. It exists to guard a real gap independent review
 * found: nothing in this module checks whether a ticker's statements are reported in
 * the same currency as its market quote (hardcoded USD elsewhere in this codebase),
 * so a US-listed ADR filing in its home currency (e.g. a JPY filer) would previously
 * have its intrinsic value computed in the wrong currency entirely and compared
 * directly against a USD price with no warning. `null` here (field absent or this
 * name turns out to be wrong) means "unknown," and the caller's own comparison logic
 * treats unknown the same as USD — this narrows the gap for tickers where the field
 * is present, it doesn't close it for tickers where it isn't.
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

  const reportedCurrency = typeof latestIncome.reportedCurrency === 'string' ? latestIncome.reportedCurrency : null;

  return {
    baseFcfPence: BigInt(Math.round(freeCashFlow * 100)),
    netDebtPence: BigInt(Math.round(netDebt * 100)),
    dilutedShares: BigInt(Math.round(dilutedSharesRaw)),
    reportedCurrency,
  };
}

/**
 * Data-driven suggestions for the two assumptions that are actually derivable —
 * `growthRatePct` from the ticker's own FCF history, `discountRatePct` via CAPM
 * from its beta. Terminal growth rate and projection years have no per-company
 * suggestion (see `dcf.ts`'s module-level reasoning: terminal growth is a fixed
 * market convention, projection years is a genuine preference), so there are no
 * equivalent functions for those.
 *
 * **A second, lower-stakes disclosed exception to "money/rates never touch a
 * float"** (the first is `deriveDcfBaseInputs`'s own, above): these two functions
 * return a *suggested display value* the household can edit or ignore before it
 * ever becomes a real `DcfInputsV1` field — never a value that flows through
 * `computeDcf`'s own bigint math directly. Plain `Number` arithmetic is fine here.
 */

/** Fixed market-convention constants, not fetched — same "not company-specific"
 * reasoning already applied to the terminal growth rate default elsewhere in this
 * module. Worth reviewing periodically (both drift slowly over years), not on every
 * request. */
const RISK_FREE_RATE_PCT = 4.5; // approximates the 10yr US Treasury yield
const EQUITY_RISK_PREMIUM_PCT = 5.5; // conventional long-run US equity risk premium

/** Clamp a suggested percent to the same bounds `parseDcfInputs` itself enforces for
 * the field it's suggesting a value for, and format to the same 3dp every percent
 * string in this module uses. */
function formatSuggestedPercent(value: number, bounds: { min: number; max: number }): string {
  return Math.min(Math.max(value, bounds.min), bounds.max).toFixed(3);
}

/**
 * CAPM: discount rate = risk-free rate + beta × equity risk premium. `null` for a
 * missing, non-finite, or non-positive beta — a zero or negative beta is either
 * data noise or too unusual a case (inverse-correlated to the market) to hand a
 * household a confident suggestion for without more context than this workbench
 * has.
 */
export function suggestDiscountRatePct(beta: number | null): string | null {
  if (beta === null || !Number.isFinite(beta) || beta <= 0) return null;
  return formatSuggestedPercent(RISK_FREE_RATE_PCT + beta * EQUITY_RISK_PREMIUM_PCT, { min: 0.001, max: 100 });
}

/**
 * Historical FCF CAGR between the oldest and newest usable period among the (up to
 * 5) cached annual cash flow statements — newest-first, matching `deriveDcfBaseInputs`'s
 * own confirmed array-ordering assumption. `null` when fewer than two usable periods
 * exist, or either endpoint's FCF is zero or negative: a CAGR computed from or to a
 * non-positive base is undefined or misleading, not a number worth suggesting.
 */
export function suggestGrowthRatePct(cashFlowStatements: readonly FmpStatementPeriod[]): string | null {
  const usable = cashFlowStatements.filter(
    (period): period is FmpStatementPeriod & { freeCashFlow: number; date: string } =>
      typeof period.freeCashFlow === 'number' &&
      Number.isFinite(period.freeCashFlow) &&
      typeof period.date === 'string',
  );
  if (usable.length < 2) return null;

  const newest = usable[0]!;
  const oldest = usable[usable.length - 1]!;
  if (newest.freeCashFlow <= 0 || oldest.freeCashFlow <= 0) return null;

  const newestDate = new Date(newest.date);
  const oldestDate = new Date(oldest.date);
  if (Number.isNaN(newestDate.getTime()) || Number.isNaN(oldestDate.getTime())) return null;

  // The actual calendar span between the newest and oldest *usable* period's own
  // dates — not `usable.length - 1` — since a period skipped by the filter above (a
  // missing/non-numeric freeCashFlow) shortens the surviving array without shortening
  // the real time span it covers. Dividing by the too-small period count inflated the
  // implied growth rate: a real bug found by independent review — a 2-year span with
  // one missing period in between computed as a 1-year CAGR (double the true rate,
  // sometimes clamped all the way to the 100% ceiling below).
  const years = (newestDate.getTime() - oldestDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 0) return null;

  const cagr = Math.pow(newest.freeCashFlow / oldest.freeCashFlow, 1 / years) - 1;
  return formatSuggestedPercent(cagr * 100, { min: -100, max: 100 });
}
