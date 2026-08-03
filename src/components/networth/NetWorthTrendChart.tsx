'use client';

import { useRef, useState, type PointerEvent } from 'react';

/**
 * The interactive part of the net worth trend chart — split out from
 * `NetWorthHero.tsx` (a Server Component) purely because hover state needs a client
 * component. Receives only plain, pre-formatted, already-serializable data (numbers
 * and strings) — never a `bigint` `pence` value — computed server-side from
 * `series.ts`'s pixel-coordinate and formatting helpers, so money never has to cross
 * the server/client boundary in its raw form.
 *
 * Segment styling (solid vs. dashed/faded for a long, stale gap) is pre-computed
 * server-side too (`seriesToSegments`) — this component only renders what it's given.
 */

export interface TrendHoverPoint {
  x: number;
  y: number;
  dateLabel: string;
  amountLabel: string;
}

export interface TrendSegment {
  path: string;
  stale: boolean;
}

export function NetWorthTrendChart({
  width,
  height,
  areaPath,
  segments,
  hoverPoints,
  ariaLabel,
}: {
  width: number;
  height: number;
  areaPath: string;
  segments: TrendSegment[];
  hoverPoints: TrendHoverPoint[];
  ariaLabel: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || hoverPoints.length === 0) return;
    const rect = svg.getBoundingClientRect();
    // The viewBox is a fixed 760×132 regardless of the SVG's actual rendered width
    // (`preserveAspectRatio="none"` stretches it) — convert the pointer's screen
    // position back into viewBox units before comparing against `hoverPoints`, which
    // are themselves in viewBox units.
    const viewBoxX = ((event.clientX - rect.left) / rect.width) * width;

    // A linear scan for the nearest point by x — `hoverPoints.length` is at most a
    // couple hundred (the same `maxPoints` cap `buildNetWorthSeries` already applies),
    // nowhere near enough points to need anything cleverer.
    let nearest = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < hoverPoints.length; i += 1) {
      const distance = Math.abs(hoverPoints[i]!.x - viewBoxX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    setHoverIndex(nearest);
  }

  const hovered = hoverIndex !== null ? hoverPoints[hoverIndex] : null;
  // Percentage, not pixels — the tooltip sits in a same-sized wrapping `<div>` outside
  // the SVG's own coordinate system, and the SVG's rendered width is responsive, so a
  // raw pixel offset from the (fixed) viewBox would drift from the visible point as
  // soon as the card isn't exactly `width`px wide.
  const hoveredLeftPct = hovered ? (hovered.x / width) * 100 : 0;
  const hoveredTopPct = hovered ? (hovered.y / height) * 100 : 0;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className="h-[132px] w-full cursor-crosshair"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brass)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brass)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="var(--line)" strokeWidth="1">
          <line x1="0" y1="22" x2={width} y2="22" />
          <line x1="0" y1="66" x2={width} y2="66" />
          <line x1="0" y1="110" x2={width} y2="110" />
        </g>
        <path d={areaPath} fill="url(#trendFill)" />
        {segments.map((segment, index) => (
          <path
            key={index}
            d={segment.path}
            fill="none"
            stroke="var(--brass)"
            strokeWidth="2.25"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={segment.stale ? '6 5' : undefined}
            opacity={segment.stale ? 0.55 : 1}
          />
        ))}
        {hovered ? (
          <>
            <line
              x1={hovered.x}
              y1="0"
              x2={hovered.x}
              y2={height}
              stroke="var(--line-strong)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill="var(--brass)" stroke="var(--paper)" strokeWidth="1.5" />
          </>
        ) : null}
      </svg>

      {hovered ? (
        <div
          // Clamped so the tooltip stays visible near the chart's left/right edges
          // rather than running off the card.
          style={{
            left: `${Math.min(Math.max(hoveredLeftPct, 8), 92)}%`,
            top: `${hoveredTopPct}%`,
          }}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border border-line bg-paper-raised px-2.5 py-1.5 text-xs shadow-card"
        >
          <p className="font-medium text-content">{hovered.amountLabel}</p>
          <p className="text-content-faint">{hovered.dateLabel}</p>
        </div>
      ) : null}
    </div>
  );
}
