/**
 * Money handling.
 *
 * PROPOSAL.md is unambiguous that money is `NUMERIC(14,2)` and never a float: "a Monte
 * Carlo engine quietly built on IEEE 754 for GBP amounts is exactly the kind of error the
 * reference-calculator tolerance test won't catch". Getting the column type right is only
 * half of that promise — if the app reads a NUMERIC into a JS `number`, adds a few of
 * them and writes the result back, the column type has bought nothing.
 *
 * So this module is the whole of the app's money arithmetic, and it never produces a
 * float:
 *  - node-postgres already returns NUMERIC as a **string**, which is what makes this
 *    possible without a custom type parser.
 *  - Amounts are parsed into **integer pence as `bigint`**, summed and compared there,
 *    and rendered back to a NUMERIC-shaped string for the database.
 *  - `number` shows up in a few places where it is never money and never persisted —
 *    chart geometry (src/lib/networth/series.ts), where the output is an SVG coordinate
 *    and a sub-penny rounding error is invisible and harmless; and summary statistics
 *    like a Monte Carlo success rate (src/lib/retirement/engineTypes.ts), computed once
 *    at the end of a run rather than compounded. Nothing that is ever displayed as a
 *    money figure or written to the database as an amount goes through a float.
 *
 * The reason for `bigint` rather than `number` for pence, given that Number.MAX_SAFE_INTEGER
 * is ~9e15 pence (£90 trillion) and no household will reach it: NUMERIC(14,2) permits
 * amounts up to 10^12, and summing a few of those in a `number` would still be exact —
 * but the moment a later phase multiplies (compound growth, ERC on an overpayment) a
 * float would start producing 0.30000000000000004-shaped answers in code that looks
 * identical to this. Making pence a `bigint` means that mistake doesn't typecheck.
 */

/** Largest magnitude NUMERIC(14,2) can hold: 12 integer digits, so < 10^12 pounds. */
const MAX_POUNDS = 10n ** 12n;
const MAX_PENCE = MAX_POUNDS * 100n;

export type MoneyParseFailure =
  | 'empty'
  | 'not-a-number'
  | 'too-many-decimals'
  | 'out-of-range';

export type MoneyParseResult =
  | { ok: true; pence: bigint }
  | { ok: false; reason: MoneyParseFailure };

/**
 * Parse what a human typed into integer pence.
 *
 * Tolerant of the things people actually type into a balance field — a leading `£`,
 * thousands separators, surrounding whitespace, a leading `+`, one or two decimal places,
 * no decimal places at all. Deliberately intolerant of three or more decimal places
 * (`10.999` is either a typo or a unit misunderstanding, and silently rounding it to
 * £11.00 would hide both) and of anything non-numeric.
 *
 * Returns a discriminated result rather than throwing or returning NaN, so callers have
 * to handle the failure — `Number('12abc')` being NaN is exactly the kind of quiet
 * failure this app can't afford in a balance field.
 */
export function parseMoneyInput(raw: string): MoneyParseResult {
  const cleaned = raw.trim().replace(/^\+/, '').replace(/[£,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return { ok: false, reason: 'empty' };

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return { ok: false, reason: 'not-a-number' };

  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > 2) return { ok: false, reason: 'too-many-decimals' };

  // Pad rather than parse-and-multiply: '1.5' must become 150 pence, not 15.
  const pencePart = fraction.padEnd(2, '0');
  const magnitude = BigInt(whole ?? '0') * 100n + BigInt(pencePart);
  if (magnitude >= MAX_PENCE) return { ok: false, reason: 'out-of-range' };

  return { ok: true, pence: sign === '-' ? -magnitude : magnitude };
}

/**
 * Convert a NUMERIC string from Postgres into integer pence.
 *
 * Postgres renders `numeric(14,2)` with both decimal places, so the input is normally
 * well-formed — but this also accepts the looser shapes (`'1234'`, `'1234.5'`) so it can
 * be used on values that haven't been through the database yet, and throws on genuine
 * garbage rather than returning a plausible-looking wrong number.
 */
export function numericToPence(value: string): bigint {
  const parsed = parseMoneyInput(value);
  if (!parsed.ok) {
    throw new Error(`Not a NUMERIC money value: ${JSON.stringify(value)} (${parsed.reason})`);
  }
  return parsed.pence;
}

/**
 * Render integer pence as a NUMERIC(14,2)-shaped string for the database.
 *
 * Always two decimal places, so what is written matches the column's own rendering and a
 * `git diff` of a dump doesn't churn on '10' vs '10.00'.
 */
export function penceToNumeric(pence: bigint): string {
  const negative = pence < 0n;
  const magnitude = negative ? -pence : pence;
  const pounds = magnitude / 100n;
  const remainder = magnitude % 100n;
  return `${negative ? '-' : ''}${pounds}.${remainder.toString().padStart(2, '0')}`;
}

/** Sum in pence. Exact by construction — no float ever holds an intermediate total. */
export function sumPence(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

/** Sum NUMERIC strings straight from a query, returning pence. */
export function sumNumeric(values: Iterable<string>): bigint {
  let total = 0n;
  for (const value of values) total += numericToPence(value);
  return total;
}

export interface FormatMoneyOptions {
  /**
   * Show pence. Default false: the dashboard's figures are in the tens or hundreds of
   * thousands, where trailing pence is noise, and the mockup's hero figure shows pence
   * in a de-emphasised style rather than inline. Account-level figures where the pence
   * genuinely matter (a balance the user just typed) pass `true`.
   */
  showPence?: boolean;
  /** Render a negative amount as `(£1,234)` rather than `−£1,234`. */
  parentheses?: boolean;
  /** ISO 4217 code. Only GBP occurs in Phase 1; carried so Phase 2's USD holdings work. */
  currency?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };

/**
 * Format pence for display.
 *
 * Hand-rolled rather than `Intl.NumberFormat`, because the input is a `bigint` of pence
 * and handing it to Intl would mean converting to a float first — the exact thing this
 * module exists to avoid. Grouping and the symbol are all that is needed, and both are
 * trivial on the string.
 *
 * Negative amounts use a real minus sign (U+2212), not a hyphen, so a debt figure lines
 * up in a tabular-numerals column instead of shifting by a pixel.
 */
export function formatMoney(pence: bigint, options: FormatMoneyOptions = {}): string {
  const { showPence = false, parentheses = false, currency = 'GBP' } = options;
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;

  const negative = pence < 0n;
  const magnitude = negative ? -pence : pence;
  const pounds = magnitude / 100n;
  const remainder = magnitude % 100n;

  const grouped = pounds.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = showPence
    ? `${symbol}${grouped}.${remainder.toString().padStart(2, '0')}`
    : // Round to the nearest pound for display so a column of figures adds up visually.
      `${symbol}${(remainder >= 50n ? pounds + 1n : pounds).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

  if (!negative) return body;
  return parentheses ? `(${body})` : `−${body}`;
}

/** Convenience: format a NUMERIC string straight from a query. */
export function formatNumeric(value: string, options: FormatMoneyOptions = {}): string {
  return formatMoney(numericToPence(value), options);
}

/**
 * Split a formatted figure into pounds and pence parts, for the dashboard hero.
 *
 * The mockup renders the hero total as `£412,308` with `.40` in a smaller, fainter style
 * — precise without letting the pence compete with the number that matters. Returning
 * the parts rather than pre-baked markup keeps that a styling decision.
 */
export function formatMoneyParts(
  pence: bigint,
  options: Omit<FormatMoneyOptions, 'showPence'> = {},
): { main: string; fraction: string } {
  const withPence = formatMoney(pence, { ...options, showPence: true });
  const lastDot = withPence.lastIndexOf('.');
  if (lastDot === -1) return { main: withPence, fraction: '' };
  return { main: withPence.slice(0, lastDot), fraction: withPence.slice(lastDot) };
}
