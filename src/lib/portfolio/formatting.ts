import { formatMoney, type FormatMoneyOptions } from '@/lib/money';

/**
 * Relative-time phrasing shared between the quote "prices as of" line and (in a later
 * phase) similar freshness indicators. Deliberately the same bucketing as
 * `src/components/ui/States.tsx`'s `FreshnessLine` (under an hour / hours / days) so the
 * two read consistently on the same page — that component bakes in its own "Balances
 * last updated" wrapper copy, which doesn't fit a per-holding price line, so the relative
 * phrase is factored out here rather than duplicated by eye.
 */
export function relativeTimeFrom(from: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - from.getTime()) / 3_600_000);
  if (hours < 1) return 'less than an hour ago';
  if (hours === 1) return '1 hour ago';
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/**
 * A gain/loss amount, signed with a leading `+` on a genuine gain. `formatMoney` already
 * renders a negative with U+2212, and a flat £0.00 gets no sign either way — this only
 * adds the `+` `formatMoney` deliberately omits (it's a generic money formatter used for
 * plain balances too, where a leading `+` would be wrong).
 */
export function formatGainLossAmount(pence: bigint, options: FormatMoneyOptions = {}): string {
  const formatted = formatMoney(pence, { showPence: true, ...options });
  return pence > 0n ? `+${formatted}` : formatted;
}
