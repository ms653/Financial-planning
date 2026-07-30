'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ageAsOf } from '@/lib/retirement/personAge';
import { deserializeSimulationResult } from '@/lib/retirement/simulationResultCodec';
import { buildFanChartSeries, toFanChartData } from '@/lib/retirement/fanChartData';
import { successBandFor } from '@/lib/retirement/successBand';
import { useSimulationPolling } from '@/lib/retirement/useSimulationPolling';
import { startSimulationRun, type SimulationRunView } from '@/lib/retirement/simulationRunClient';
import { FanChart } from './FanChart';
import { SuccessBandIndicator } from './SuccessBandIndicator';
import { StaleResultsBanner } from './StaleResultsBanner';

/**
 * One side of the Comparison screen (`/retirement/compare`) — "skeleton per side,
 * independently (one might load faster than the other)" and "if either scenario's
 * results are stale... that side shows the same stale banner pattern" per
 * `docs/DESIGN_SPEC.md`: each side polls and re-runs entirely on its own, one
 * `useSimulationPolling` instance per side, not one shared for the pair.
 */

export function ComparisonSide({
  scenarioId,
  scenarioName,
  targetSuccessRatePct,
  initialRun,
  referencePersonDob,
  referencePersonName,
  scenarioUpdatedAtIso,
}: {
  scenarioId: number;
  scenarioName: string;
  targetSuccessRatePct: string;
  initialRun: SimulationRunView | null;
  referencePersonDob: string;
  referencePersonName: string;
  scenarioUpdatedAtIso: string;
}) {
  const [runId, setRunId] = useState<number | null>(initialRun?.id ?? null);
  const [starting, setStarting] = useState(false);
  const { run } = useSimulationPolling(runId, initialRun);

  async function handleStart() {
    setStarting(true);
    try {
      const started = await startSimulationRun(scenarioId);
      setRunId(started.id);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card">
      <Link href={`/retirement/${scenarioId}`} className="font-serif text-lg text-content hover:underline">
        {scenarioName}
      </Link>

      {run === null ? (
        <div className="mt-4">
          <p className="text-sm text-content-faint">Not yet run</p>
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={starting}
            className="mt-2 inline-flex min-h-[36px] items-center rounded-lg border border-line-strong px-3 text-sm font-medium text-content transition hover:border-brass disabled:opacity-50"
          >
            {starting ? 'Starting…' : 'Run simulation'}
          </button>
        </div>
      ) : run.status === 'running' ? (
        <p role="status" className="mt-4 text-sm text-content-muted">
          Running {run.iterationCount.toLocaleString('en-GB')} simulations…
        </p>
      ) : run.status === 'failed' || run.status === 'cancelled' ? (
        <p className="mt-4 text-sm text-clay">
          {run.status === 'failed' ? 'This simulation didn’t complete.' : 'This simulation was cancelled.'}
        </p>
      ) : (
        <ComparisonSideResult
          run={run}
          targetSuccessRatePct={targetSuccessRatePct}
          referencePersonDob={referencePersonDob}
          referencePersonName={referencePersonName}
          stale={scenarioUpdatedAtIso > run.createdAt}
          onRerun={handleStart}
          rerunning={starting}
        />
      )}
    </div>
  );
}

function ComparisonSideResult({
  run,
  targetSuccessRatePct,
  referencePersonDob,
  referencePersonName,
  stale,
  onRerun,
  rerunning,
}: {
  run: SimulationRunView;
  targetSuccessRatePct: string;
  referencePersonDob: string;
  referencePersonName: string;
  stale: boolean;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const result = deserializeSimulationResult(run.result);
  const percentileBandsPenceStrings: Record<string, string[]> = Object.fromEntries(
    Object.entries(result.percentileBandsPence).map(([bandKey, pence]) => [bandKey, pence.map(String)]),
  );
  const referenceAgeAtYearZero = ageAsOf(referencePersonDob, run.createdAt.slice(0, 10));
  const points = buildFanChartSeries(percentileBandsPenceStrings, referenceAgeAtYearZero);
  const chartData = toFanChartData(points);
  const band = successBandFor(result.successRate, targetSuccessRatePct);
  const pct = Math.round(result.successRate * 100);

  return (
    <div className="mt-4">
      {stale ? <StaleResultsBanner onRerun={onRerun} rerunning={rerunning} /> : null}
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-serif text-2xl text-content">{pct}%</p>
        <SuccessBandIndicator band={band} />
      </div>
      <div className="mt-3">
        <FanChart data={chartData} band={band} size="compact" ageAxisLabel={`${referencePersonName}'s age`} />
      </div>
    </div>
  );
}
