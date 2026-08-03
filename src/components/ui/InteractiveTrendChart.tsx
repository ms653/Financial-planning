'use client';

import { useId, useRef, useState, type PointerEvent } from 'react';

/**
 * The interactive part of a money trend chart — hover for the date/figure at a point,
 * a dashed/faded stroke for a long stale gap. Split out as a client component purely
 * because hover state needs one; the surrounding page (a Server Component in both of
 * today's callers, `NetWorthHero.tsx` and the account-detail page) computes all the
 * geometry and formatting and hands this component only plain, pre-formatted,
 * already-serializable data (numbers and strings) — never a `bigint` `pence` value —
 * so money never has to cross the server/client boundary in its raw form.
 *
 * Shared between the net worth chart and the per-account balance chart — `color` is
 * the one thing that varies between callers (brass for a normal account, sage for a
 * debt, per `accounts/[id]/page.tsx`'s own existing convention).
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

export function InteractiveTrendChart({
  width,
  height,
  areaPath,
  segments,
  hoverPoints,
  ariaLabel,
  color = 'var(--brass)',
}: {
  width: number;
  height: number;
  areaPath: string;
  segments: TrendSegment[];
  hoverPoints: TrendHoverPoint[];
  ariaLabel: string;
  color?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Unique per instance — two of these charts could in principle render on the same
  // page, and a shared hardcoded gradient id would make the second silently reuse (or
  // corrupt) the first's fill.
  const gradientId = useId();

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || hoverPoints.length === 0) return;
    const rect = svg.getBoundingClientRect();
    // The viewBox is a fixed width×height regardless of the SVG's actual rendered
    // size (`preserveAspectRatio="none"` stretches it) — convert the pointer's screen
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
        style={{ height: `${height}px` }}
        className="w-full cursor-crosshair"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="var(--line)" strokeWidth="1">
          <line x1="0" y1={height * 0.167} x2={width} y2={height * 0.167} />
          <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} />
          <line x1="0" y1={height * 0.833} x2={width} y2={height * 0.833} />
        </g>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        {segments.map((segment, index) => (
          <path
            key={index}
            d={segment.path}
            fill="none"
            stroke={color}
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
            <circle cx={hovered.x} cy={hovered.y} r="4" fill={color} stroke="var(--paper)" strokeWidth="1.5" />
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
