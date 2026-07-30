'use client';

import { useCallback, useState } from 'react';
import { createScenarioReturningId, updateScenario } from './actions';
import { startSimulationRun } from './simulationRunClient';
import { useSimulationPolling, type SimulationPollingState } from './useSimulationPolling';
import type { ScenarioAssumptionsV1 } from './scenarioAssumptions';

/**
 * Orchestrates the Scenario Editor's single "Run simulation" action: save the
 * scenario's assumptions (`createScenarioReturningId`/`updateScenario`, Milestone 8),
 * then start a run against the now-current row (`POST /simulation-runs`, Milestone 7),
 * then hand off to `useSimulationPolling` for the result — one client-side sequence, no
 * separate Save button and no autosave-on-blur (confirmed with the household: the
 * design spec shows no Save button anywhere, and its "Discard unsaved changes?" copy
 * only makes sense under this reading).
 *
 * `useActionForm` doesn't fit here — its `onSubmit` calls exactly one
 * `Promise<ActionResult>` action per submit and has nowhere to hand back the new
 * scenario id inline, which this sequence needs (to start a run against it immediately).
 */

export interface RunScenarioInput {
  /** `null` when creating a brand-new scenario. */
  scenarioId: number | null;
  name: string;
  isBaseline: boolean;
  assumptions: ScenarioAssumptionsV1;
}

/** Statuses `useSimulationPolling` will never poll again after — anything else (a
 * genuinely `'running'` row, or `poll.run` still `null` because the first `GET` hasn't
 * resolved yet) counts as "not confirmed done" for `locked`'s purposes below. */
const TERMINAL_STATUSES = new Set(['complete', 'failed', 'cancelled']);

export interface ScenarioRunnerState {
  /** True from the moment a run *this hook itself started* is underway until it's
   * confirmed terminal — locks the Editor's fieldset. Per the confirmed judgment call:
   * a different run in progress elsewhere (started from another tab/visit) never sets
   * this — only the tab that clicked "Run simulation" locks its own form.
   *
   * Deliberately keyed to "not yet confirmed terminal", not `poll.run?.status ===
   * 'running'` — Fable review (2026-07-31) found a real race in the latter: right after
   * `startSimulationRun` resolves and `activeRunId` is set, `poll.run` is still `null`
   * (its own first `GET` hasn't resolved), so `poll.run?.status === 'running'` reads
   * `false` for one network round trip and the form was briefly editable/submittable
   * again while a run was genuinely in flight — reproduced directly with a held-open
   * poll response. */
  locked: boolean;
  saving: boolean;
  formError: string | null;
  poll: SimulationPollingState;
  /** Set once a save succeeds — lets the Editor page swap from "new" to "editing this
   * id" without a full navigation. */
  savedScenarioId: number | null;
  /** Resolves `true` only once a run has actually been started — `false` on any save or
   * start-run failure. Returned rather than left for the caller to infer from
   * `formError` afterward: a `setState` call inside `run()` doesn't update the `runner`
   * object a caller already holds a reference to until the *next* render, so checking
   * `formError` immediately after `await run(...)` resolves would read a stale value. */
  run: (input: RunScenarioInput) => Promise<boolean>;
}

function scenarioFormData(input: RunScenarioInput): FormData {
  const formData = new FormData();
  if (input.scenarioId !== null) formData.set('scenarioId', String(input.scenarioId));
  formData.set('name', input.name);
  formData.set('isBaseline', String(input.isBaseline));
  formData.set('assumptions', JSON.stringify(input.assumptions));
  return formData;
}

const GENERIC_ERROR = 'Couldn’t save this right now';

export function useScenarioRunner(): ScenarioRunnerState {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [savedScenarioId, setSavedScenarioId] = useState<number | null>(null);

  const poll = useSimulationPolling(activeRunId);

  const run = useCallback(async (input: RunScenarioInput): Promise<boolean> => {
    setSaving(true);
    setFormError(null);
    try {
      let scenarioId = input.scenarioId;
      if (scenarioId === null) {
        const created = await createScenarioReturningId(scenarioFormData(input));
        if (!created.ok) {
          setFormError(created.formError);
          return false;
        }
        scenarioId = created.scenarioId;
      } else {
        const updated = await updateScenario(scenarioFormData(input));
        if (!updated.ok) {
          setFormError(updated.formError ?? GENERIC_ERROR);
          return false;
        }
      }
      setSavedScenarioId(scenarioId);

      const startedRun = await startSimulationRun(scenarioId);
      setActiveRunId(startedRun.id);
      return true;
    } catch (error) {
      console.error('[retirement] useScenarioRunner run() failed:', error);
      setFormError(error instanceof Error ? error.message : GENERIC_ERROR);
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    locked: activeRunId !== null && !(poll.run !== null && TERMINAL_STATUSES.has(poll.run.status)),
    saving,
    formError,
    poll,
    savedScenarioId,
    run,
  };
}
