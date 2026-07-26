import Link from 'next/link';
import { formatMoney, formatMoneyParts } from '@/lib/money';
import { FreshnessLine } from '@/components/ui/States';
import { RANGE_DESCRIPTIONS, TREND_RANGES, seriesToPath, type NetWorthSeries, type TrendDelta, type TrendRange } from '@/lib/networth/series';

/**
 * The dashboard hero: total net worth, the change across the window, a range selector, and
 * the trend chart.
 *
 * DESIGN_SPEC.md: "total household net worth as the single largest number on the page … and
 * a trend sparkline/chart spanning a selectable window (1M/6M/1Y/All)". Also, explicitly:
 * "Tapping the total net worth figure has no action (it's not a button) — avoid the common
 * mistake of making the hero number secretly clickable with no visual affordance." So it is
 * a plain `<p>`, and nothing wraps it.
 *
 * Negative net worth is rendered in parentheses with a neutral tone rather than in alarm-red,
 * per the spec's edge case: "negative net worth early in adulthood (e.g. a mortgage-heavy
 * household) isn't a failure state". The parentheses also mean the sign survives for anyone
 * who can't distinguish the colour, which the accessibility requirements ask for directly.
 */

function DeltaLine({ delta, range }: { delta: TrendDelta; range: TrendRange }) {
  const { direction, pence, ratio } = delta;

  const tone =
    direction === 'up' ? 'text-sage' : direction === 'down' ? 'text-clay' : 'text-content-faint';
  // Paired with a glyph and a word, never colour alone.
  const glyph = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  const magnitude = formatMoney(pence < 0n ? -pence : pence);
  const percent = ratio === null ? null : `${(Math.abs(ratio) * 100).toFixed(1)}%`;

  return (
    <p className={`mt-2 flex flex-wrap items-center gap-1.5 text-sm ${tone}`}>
      <span aria-hidden="true">{glyph}</span>
      <span>
        {direction === 'flat'
          ? 'No change'
          : `${direction === 'up' ? 'Up' : 'Down'} ${magnitude}${percent ? ` (${percent})` : ''}`}{' '}
        {RANGE_DESCRIPTIONS[range]}
      </span>
    </p>
  );
}

/**
 * The trend chart, as inline SVG.
 *
 * Hand-rolled rather than pulling in a charting library: this is one area path with a
 * gradient fill, the geometry is already computed and tested in `seriesToPath`, and the full
 * visual pass is Phase 7 anyway. A library would add a dependency and a client bundle to
 * render what is fundamentally two `<path>` elements.
 *
 * `role="img"` with a real `aria-label` giving the start and end figures, because a
 * screen-reader user gets nothing from a path. `preserveAspectRatio="none"` lets it stretch
 * to the card width the way the mockup's does.
 */
function TrendChart({ series, range }: { series: NetWorthSeries; range: TrendRange }) {
  const path = seriesToPath(series.points, { width: 760, height: 132, padding: 6 });

  if (!path || series.points.length < 2) {
    // DESIGN_SPEC.md, Account Detail edge case, applied here too: "chart area shows a single
    // point plus a light 'history will build up as you update this account' note rather than
    // an empty/broken-looking chart."
    return (
      <div className="mt-6 flex h-[132px] items-center justify-center rounded-lg border border-dashed border-line px-4 text-center text-xs text-content-faint">
        Your trend line will build up here as you update balances over time.
      </div>
    );
  }

  const first = series.first!;
  const last = series.last!;

  return (
    <div className="mt-6">
      <svg
        viewBox="0 0 760 132"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Net worth trend ${RANGE_DESCRIPTIONS[range]}, from ${formatMoney(
          first.pence,
        )} on ${first.date} to ${formatMoney(last.pence)} on ${last.date}.`}
        className="h-[132px] w-full"
      >
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brass)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brass)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="var(--line)" strokeWidth="1">
          <line x1="0" y1="22" x2="760" y2="22" />
          <line x1="0" y1="66" x2="760" y2="66" />
          <line x1="0" y1="110" x2="760" y2="110" />
        </g>
        <path d={path.area} fill="url(#trendFill)" />
        <path
          d={path.line}
          fill="none"
          stroke="var(--brass)"
          strokeWidth="2.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      {series.downsampled ? (
        <p className="mt-1.5 text-[11px] text-content-faint">
          Showing a sample of your history to keep the chart readable.
        </p>
      ) : null}
    </div>
  );
}

export function NetWorthHero({
  totalPence,
  series,
  delta,
  range,
  breakdownMode,
  latestCapturedAt,
  now,
}: {
  totalPence: bigint;
  series: NetWorthSeries;
  delta: TrendDelta | null;
  range: TrendRange;
  /** Preserved across range changes so the toggle state survives navigation. */
  breakdownMode: string;
  latestCapturedAt: Date | null;
  now: Date;
}) {
  const negative = totalPence < 0n;
  const { main, fraction } = formatMoneyParts(totalPence, { parentheses: true });

  return (
    <section
      aria-labelledby="net-worth-heading"
      className="rounded-card border border-line bg-paper-raised p-6 shadow-card sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="net-worth-heading" className="text-[12.5px] text-content-muted">
            Household total
          </h2>
          {/* Not a link and not a button: the spec is explicit that the hero figure has no action. */}
          <p
            className={`tabular mt-1.5 font-serif text-[clamp(2.25rem,7vw,3.25rem)] leading-none ${
              negative ? 'text-content-muted' : 'text-content'
            }`}
          >
            {main}
            <span className="text-[0.55em] text-content-faint">{fraction}</span>
          </p>
          {negative ? (
            <p className="mt-1.5 text-xs text-content-muted">
              Shown in brackets because your debts currently exceed your assets.
            </p>
          ) : null}
          {delta ? <DeltaLine delta={delta} range={range} /> : null}
          <FreshnessLine capturedAt={latestCapturedAt} now={now} />
        </div>

        <div role="group" aria-label="Chart time range" className="flex gap-0.5 rounded-full bg-paper-sunken p-0.5">
          {TREND_RANGES.map((option) => (
            <Link
              key={option}
              // Range is a URL parameter, so the chart is server-rendered and the choice
              // survives a refresh or a shared link. The breakdown mode rides along so
              // changing the range doesn't silently reset the other control.
              href={`/?range=${option}&breakdown=${breakdownMode}`}
              scroll={false}
              aria-current={option === range ? 'true' : undefined}
              className={`min-h-[36px] rounded-full px-3 text-xs font-medium leading-9 transition ${
                option === range
                  ? 'bg-paper-raised text-content shadow-card'
                  : 'text-content-muted hover:text-content'
              }`}
            >
              {option}
            </Link>
          ))}
        </div>
      </div>

      <TrendChart series={series} range={range} />
    </section>
  );
}
