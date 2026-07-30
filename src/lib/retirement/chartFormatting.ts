/**
 * Compact axis-tick money formatting for the Fan Chart's Y axis — `£100k`, `£1.2m`, not
 * `formatMoney`'s full `£100,000` (correct for a headline figure, too wide for a
 * repeated tick label). Single-purpose and colocated here rather than added to
 * `src/lib/money.ts`, matching `portfolio/formatting.ts`'s existing precedent of keeping
 * a formatter with exactly one caller next to that caller rather than in the shared
 * module.
 */

/** `pence` in, a compact pounds string out. Never shows pence — a chart axis tick has
 * no use for sub-pound precision. */
export function formatCompactPounds(pence: bigint): string {
  const negative = pence < 0n;
  const pounds = Number((negative ? -pence : pence) / 100n);
  const sign = negative ? '−' : '';

  if (pounds >= 1_000_000) return `${sign}£${(pounds / 1_000_000).toFixed(pounds % 1_000_000 === 0 ? 0 : 1)}m`;
  if (pounds >= 1_000) return `${sign}£${(pounds / 1_000).toFixed(pounds % 1_000 === 0 ? 0 : 0)}k`;
  return `${sign}£${pounds}`;
}
