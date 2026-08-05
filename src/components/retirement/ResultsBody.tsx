'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ageAsOf } from '@/lib/retirement/personAge';
import { deserializeSimulationResult } from '@/lib/retirement/simulationResultCodec';
import { buildFanChartSeries, fanChartAccessibleSummary, toFanChartData } from '@/lib/retirement/fanChartData';
import { successBandFor } from '@/lib/retirement/successBand';
import { useSimulationPolling } from '@/lib/retirement/useSimulationPolling';
import { useOnlineStatus } from '@/lib/retirement/useOnlineStatus';
import { startSimulationRun, cancelSimulationRun, type SimulationRunView } from '@/lib/retirement/simulationRunClient';
import type { ScenarioAssumptionsV1 } from '@/lib/retirement/scenarioAssumptions';
import { FanChart } from './FanChart';
import { SuccessBandIndicator } from './SuccessBandIndicator';
import { ComputingState } from './ComputingState';
import { StaleResultsBanner } from './StaleResultsBanner';
import { AssumptionsSummary } from './AssumptionsSummary';

/**
 * The interactive body of the Results screen (`/retirement/[scenarioId]`) — everything
 * that can change after first paint (a running simulation completing, a re-run being
 * started) has to live in a client component; the page itself stays a server component
 * for the initial data fetch and the redirect/notFound guards.
 */

export interface PreRetirementContribution {
  personId: number;
  name: string;
  retirementAge: number;
  /** Pre-formatted on the server via `formatMoney` — pension plus this person's own
   * regular_contribution rows, combined (Phase 4.4 and its follow-up). Never a raw
   * bigint across the server/client boundary, this codebase's usual discipline. */
  annualContribution: string;
}

export function ResultsBody({
  scenarioId,
  targetSuccessRatePct,
  initialRun,
  assumptions,
  personNames,
  referencePersonDob,
  referencePersonName,
  scenarioUpdatedAtIso,
  editHref,
  preRetirementContributions,
  jointAnnualContribution,
  anyoneStillWorking,
}: {
  scenarioId: number;
  targetSuccessRatePct: string;
  initialRun: SimulationRunView | null;
  assumptions: ScenarioAssumptionsV1;
  personNames: Array<{ id: number; name: string }>;
  referencePersonDob: string;
  referencePersonName: string;
  scenarioUpdatedAtIso: string;
  editHref: string;
  /** People still short of their own `retirementAge` with a nonzero personal
   * contribution — Phase 4.4. Can be empty even while `anyoneStillWorking` is true
   * (e.g. only a joint contribution, or none at all): the card's own visibility is
   * gated on `anyoneStillWorking`, not on this array having entries. */
  preRetirementContributions: PreRetirementContribution[];
  /** Pre-formatted, e.g. "£2,400/year" — total regular_contribution amount across
   * every jointly-owned account, shown only when there's at least one still-working
   * person (the same condition that keeps it actually landing in the simulation). */
  jointAnnualContribution: string | null;
  /** Whether the "Before retirement" card should render at all. Independent of
   * `preRetirementContributions.length` on purpose — a household can have someone
   * still working with zero *personal* contributions recorded (only a joint one, or
   * none), and the engine is still simulating that (withholding all drawdown, plus
   * any joint contribution) regardless, so the disclosure still belongs on screen. */
  anyoneStillWorking: boolean;
}) {
  const [runId, setRunId] = useState<number | null>(initialRun?.id ?? null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const online = useOnlineStatus();

  const { run, error: pollError } = useSimulationPolling(runId, initialRun);

  async function handleStart() {
    setStarting(true);
    setActionError(null);
    try {
      const started = await startSimulationRun(scenarioId);
      setRunId(started.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Couldn’t start this simulation right now');
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    if (runId === null) return;
    setCancelling(true);
    try {
      await cancelSimulationRun(runId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Couldn’t cancel this simulation right now');
    } finally {
      setCancelling(false);
    }
  }

  const personNamesMap = new Map(personNames.map((p) => [p.id, p.name]));

  // Never run.
  if (run === null) {
    return (
      <div className="space-y-4">
        {actionError ? (
          <p role="alert" className="rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay">
            {actionError}
          </p>
        ) : null}
        <div className="rounded-card border border-line bg-paper-raised px-6 py-10 text-center shadow-card">
          <h2 className="font-serif text-xl text-content">Run your first simulation to see your results</h2>
          {!online ? (
            <div className="mt-4">
              <p className="text-sm text-clay">Reconnect to run this</p>
              <p className="mt-1 text-xs text-content-faint">This needs a live connection to your home network</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={starting}
              className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition enabled:hover:bg-ink-800 disabled:opacity-50 dark:bg-brass dark:text-ink-950"
            >
              {starting ? 'Starting…' : 'Run simulation'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (run.status === 'running') {
    return <ComputingState iterationCount={run.iterationCount} onCancel={() => void handleCancel()} canceling={cancelling} />;
  }

  if (run.status === 'failed' || run.status === 'cancelled') {
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-clay/50 bg-clay-bg px-6 py-8 text-center text-clay">
          <p className="font-medium">
            {run.status === 'failed' ? 'This simulation didn’t complete.' : 'This simulation was cancelled.'}
          </p>
          {run.errorDetail ? <p className="mt-1 text-sm opacity-90">{run.errorDetail}</p> : null}
          {!online ? (
            <p className="mt-4 text-sm">Reconnect to run this</p>
          ) : (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={starting}
              className="mt-4 inline-flex min-h-[44px] items-center rounded-lg border border-clay/60 px-4 text-sm font-medium transition hover:bg-clay/10 disabled:opacity-50"
            >
              {starting ? 'Starting…' : 'Try again'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Complete. `deserializeSimulationResult` validates the whole shape (throws on
  // anything malformed) but returns `percentileBandsPence` as `bigint[]`, while
  // `buildFanChartSeries` wants the raw wire-format decimal-pence strings per its own
  // contract — converted back rather than widening that function to accept both, so it
  // stays a single, simple "here's what the wire format looks like" entry point.
  const result = deserializeSimulationResult(run.result);
  const percentileBandsPenceStrings: Record<string, string[]> = Object.fromEntries(
    Object.entries(result.percentileBandsPence).map(([bandKey, pence]) => [bandKey, pence.map(String)]),
  );
  const referenceAgeAtYearZero = ageAsOf(referencePersonDob, run.createdAt.slice(0, 10));
  const points = buildFanChartSeries(percentileBandsPenceStrings, referenceAgeAtYearZero);
  const chartData = toFanChartData(points);
  const summary = fanChartAccessibleSummary(points);
  const band = successBandFor(result.successRate, targetSuccessRatePct);
  const stale = scenarioUpdatedAtIso > run.createdAt;
  const pct = Math.round(result.successRate * 100);

  return (
    <div className="space-y-5">
      {pollError ? (
        <p role="alert" className="text-sm text-clay">
          {pollError}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay">
          {actionError}
        </p>
      ) : null}

      {stale ? <StaleResultsBanner onRerun={() => void handleStart()} rerunning={starting} /> : null}

      <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          {/* Visually split (large hero figure + caption, matching the dashboard's own
              hero-figure convention) but one accessible sentence via aria-label — the
              spec's own headline example ("87% of simulated outcomes succeeded") reads
              as a single sentence, which two separately-announced text nodes would lose. */}
          <div aria-label={`${pct}% of simulated outcomes succeeded`}>
            <p aria-hidden="true" className="font-serif text-4xl text-content">
              {pct}%
            </p>
            <p aria-hidden="true" className="text-sm text-content-muted">
              of simulated outcomes succeeded
            </p>
          </div>
          <SuccessBandIndicator band={band} />
        </div>

        <div className="mt-6">
          <FanChart data={chartData} band={band} size="full" ageAxisLabel={`${referencePersonName}'s age`} />
        </div>
        {summary ? <p className="mt-3 text-xs text-content-muted">{summary}</p> : null}
      </div>

      <AssumptionsSummary assumptions={assumptions} personNames={personNamesMap} />

      {anyoneStillWorking ? (
        <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
          <h2 className="font-serif text-lg text-content">Before retirement</h2>
          <p className="mt-1 text-sm text-content-muted">
            Until each person’s own retirement age above, this simulation assumes they
            keep contributing (pension via{' '}
            <Link href="/settings" className="underline underline-offset-2 hover:text-content">
              Settings
            </Link>
            , everything else via each account’s own page) and draws down nothing.
          </p>
          {preRetirementContributions.length > 0 || jointAnnualContribution ? (
            <ul className="mt-3 space-y-1 text-sm text-content">
              {preRetirementContributions.map((p) => (
                <li key={p.personId}>
                  {p.name}: {p.annualContribution}/year until age {p.retirementAge}
                </li>
              ))}
              {jointAnnualContribution ? <li>Joint accounts: {jointAnnualContribution}/year</li> : null}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-content-faint">No contributions currently recorded.</p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={editHref}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content transition hover:border-brass"
        >
          Adjust assumptions
        </Link>
      </div>
    </div>
  );
}
