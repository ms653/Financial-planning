import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useScenarioRunner } from './useScenarioRunner';
import type { ScenarioAssumptionsV1 } from './scenarioAssumptions';

const createScenarioReturningId = vi.fn();
const updateScenario = vi.fn();
vi.mock('./actions', () => ({
  createScenarioReturningId: (formData: FormData) => createScenarioReturningId(formData),
  updateScenario: (formData: FormData) => updateScenario(formData),
}));

const startSimulationRun = vi.fn();
const fetchSimulationRun = vi.fn();
vi.mock('./simulationRunClient', () => ({
  startSimulationRun: (scenarioId: number) => startSimulationRun(scenarioId),
  fetchSimulationRun: (runId: number) => fetchSimulationRun(runId),
  cancelSimulationRun: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const ASSUMPTIONS: ScenarioAssumptionsV1 = {
  schemaVersion: 1,
  annualSpending: '30000.00',
  inflationPct: '2.500',
  equityAllocationPct: '60.000',
  targetSuccessRatePct: '90.000',
  flatEffectiveTaxRatePct: '20.000',
  wrapperWithdrawalOrder: ['cash'],
  people: [{ personId: 1, retirementAge: 65, planEndAge: 95 }],
};

describe('useScenarioRunner', () => {
  it('stays locked in the window between a run starting and the first poll response — regression for a real race found by Fable review', async () => {
    createScenarioReturningId.mockResolvedValue({ ok: true, scenarioId: 42 });
    startSimulationRun.mockResolvedValue({
      id: 7,
      scenarioId: 42,
      status: 'running',
      seed: 1,
      iterationCount: 2000,
      result: null,
      errorDetail: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    // Held open deliberately — this is the exact window the bug lived in: activeRunId
    // is set (startSimulationRun already resolved) but the polling hook's own first GET
    // hasn't resolved yet, so poll.run is still null.
    let resolveFetch: (() => void) | undefined;
    fetchSimulationRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({
              id: 7,
              scenarioId: 42,
              status: 'running',
              seed: 1,
              iterationCount: 2000,
              result: null,
              errorDetail: null,
              createdAt: new Date().toISOString(),
              completedAt: null,
            });
        }),
    );

    const { result } = renderHook(() => useScenarioRunner());

    await act(async () => {
      await result.current.run({ scenarioId: null, name: 'Baseline', isBaseline: false, assumptions: ASSUMPTIONS });
    });

    // The bug: at exactly this point, saving is already false (run() has returned) and
    // poll.run is still null (its GET hasn't resolved) — the old `poll.run?.status ===
    // 'running'` check read false here, briefly unlocking a genuinely in-flight run.
    expect(result.current.saving).toBe(false);
    expect(result.current.locked).toBe(true);

    await act(async () => {
      resolveFetch?.();
    });
    await waitFor(() => expect(result.current.poll.run?.status).toBe('running'));
    expect(result.current.locked).toBe(true);
  });

  it('unlocks once the run is confirmed terminal', async () => {
    createScenarioReturningId.mockResolvedValue({ ok: true, scenarioId: 42 });
    const completeRun = {
      id: 7,
      scenarioId: 42,
      status: 'complete',
      seed: 1,
      iterationCount: 2000,
      result: { scenarioId: 42, seed: 1, iterationCount: 2000, successRate: 0.9, percentileBandsPence: {} },
      errorDetail: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    startSimulationRun.mockResolvedValue(completeRun);
    fetchSimulationRun.mockResolvedValue(completeRun);

    const { result } = renderHook(() => useScenarioRunner());
    await act(async () => {
      await result.current.run({ scenarioId: null, name: 'Baseline', isBaseline: false, assumptions: ASSUMPTIONS });
    });

    await waitFor(() => expect(result.current.poll.run?.status).toBe('complete'));
    expect(result.current.locked).toBe(false);
  });
});
