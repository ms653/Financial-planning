'use client';

import { useEffect, useState } from 'react';
import { fetchSimulationRun, type SimulationRunView } from './simulationRunClient';

/**
 * Polls `GET /api/retirement/simulation-runs/[id]` while a run is `running`, stopping on
 * any terminal status (`complete`/`failed`/`cancelled`). Built once, shared by the
 * Scenario Editor's Running state and the Results screen's Computing state — the only
 * piece of infrastructure genuinely common to both, per this milestone's plan.
 *
 * Polls with `setTimeout` chained after each response resolves, not `setInterval` — a
 * slow response can't cause overlapping in-flight requests to pile up.
 */

export interface SimulationPollingState {
  run: SimulationRunView | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 2000;

/** @param runId `null` = nothing to poll (e.g. no run has been started in this tab yet).
 * @param initialRun Seeds the state immediately (e.g. a Results page's already-fetched
 *   latest run) so the UI doesn't flash empty before the first poll response — only used
 *   when it matches `runId`; ignored otherwise. */
export function useSimulationPolling(runId: number | null, initialRun?: SimulationRunView | null): SimulationPollingState {
  const [run, setRun] = useState<SimulationRunView | null>(
    initialRun && initialRun.id === runId ? initialRun : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);

    if (runId === null) {
      setRun(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const result = await fetchSimulationRun(runId as number);
        if (cancelled) return;
        setRun(result);
        if (result.status === 'running') {
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not check simulation status.');
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // initialRun deliberately excluded — it only seeds the very first render for a given
    // runId, not something a later render should re-trigger polling for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { run, error };
}
