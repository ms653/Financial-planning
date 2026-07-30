'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { formatCompactPounds } from '@/lib/retirement/chartFormatting';
import type { FanChartDatum } from '@/lib/retirement/fanChartData';
import type { SuccessBand } from '@/lib/retirement/successBand';

/**
 * The median-plus-percentile-band chart `docs/DESIGN_SPEC.md` calls "the single
 * highest-design-value component in P1" — median line + a shaded 10th–90th percentile
 * band, with a real tap/hover tooltip, rather than a bare success-rate number.
 *
 * Only plain, already-serializable props cross in (`FanChartDatum[]`, pre-formatted
 * label strings) — no `bigint`, per this milestone's money-discipline rule: React
 * Flight can't serialize a `bigint` prop from server to client, so the conversion
 * (`toFanChartData`) happens server-side before this component ever renders.
 *
 * Band = area fill at low opacity, median = a plain 2px line — not a saturated block —
 * and the whole chart is `aria-hidden`: the always-visible one-sentence summary
 * rendered alongside it (`fanChartAccessibleSummary`) is the actual accessible
 * equivalent, per the spec's own accessibility requirement.
 */

export interface FanChartProps {
  data: FanChartDatum[];
  /** Strong/On-track share one tone (things are going well); At-risk gets a distinct
   * one — reusing this codebase's existing sage=positive/clay=negative convention
   * (already used this way for the debt-paydown line on Account Detail) rather than
   * defaulting every chart to brass. */
  band: SuccessBand;
  size: 'full' | 'compact';
  /** e.g. "Alex's age" — the x-axis needs to say whose age it is, since a two-person
   * household's simulated years don't have one unambiguous "age" (the fan chart always
   * plots the scenario's first-listed person). */
  ageAxisLabel: string;
}

const TONE_VAR: Record<SuccessBand, string> = {
  strong: 'var(--sage)',
  'on-track': 'var(--sage)',
  'at-risk': 'var(--clay)',
};

function ChartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]!.payload as FanChartDatum;
  return (
    <div className="rounded-card border border-line bg-paper-raised px-3 py-2 text-xs shadow-card">
      <p className="font-medium text-content">Age {point.age}</p>
      <p className="mt-1 tabular text-content">
        <span className="font-semibold">{point.p50Label}</span> median
      </p>
      <p className="tabular text-content-muted">10th percentile: {point.p10Label}</p>
      <p className="tabular text-content-muted">90th percentile: {point.p90Label}</p>
    </div>
  );
}

export function FanChart({ data, band, size, ageAxisLabel }: FanChartProps) {
  const color = TONE_VAR[band];
  const compact = size === 'compact';

  return (
    <div aria-hidden="true" className={compact ? 'h-40' : 'h-72'}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: compact ? 4 : 16, bottom: 0, left: compact ? 0 : 4 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 11, fill: 'var(--content-faint)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            interval={compact ? 'preserveStartEnd' : 'preserveEnd'}
            label={compact ? undefined : { value: ageAxisLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: 'var(--content-faint)' }}
          />
          {compact ? null : (
            <YAxis
              tickFormatter={(value: number) => formatCompactPounds(BigInt(Math.round(value * 100)))}
              tick={{ fontSize: 11, fill: 'var(--content-faint)' }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
          )}
          <Tooltip content={(props) => <ChartTooltip {...props} />} />
          {/* Invisible baseline the band stacks on, so the band renders from p10 up to
              p90 rather than from zero. */}
          <Area dataKey="p10" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
          <Area dataKey="bandWidth" stackId="band" stroke="none" fill={color} fillOpacity={0.1} isAnimationActive={false} />
          <Line dataKey="p50" stroke={color} strokeWidth={2} dot={false} type="monotone" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
