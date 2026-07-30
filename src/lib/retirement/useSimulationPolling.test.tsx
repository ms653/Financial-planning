import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSimulationPolling } from './useSimulationPolling';
import type { SimulationRunView } from './simulationRunClient';

function runView(overrides: Partial<SimulationRunView> = {}): SimulationRunView {
  return {
    id: 1,
    scenarioId: 10,
    status: 'running',
    seed: 1,
    iterationCount: 2000,
    result: null,
    errorDetail: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

describe('useSimulationPolling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not poll when runId is null', async () => {
    const fetchMock = vi.mocked(fetch);
    renderHook(() => useSimulationPolling(null));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls immediately and again while status is running, stopping once complete', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(runView({ status: 'running' })), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(runView({ status: 'complete', completedAt: '2026-07-30T00:01:00.000Z' })), {
          status: 200,
        }),
      );

    const { result } = renderHook(() => useSimulationPolling(1));

    await waitFor(() => expect(result.current.run?.status).toBe('running'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/retirement/simulation-runs/1');

    await waitFor(() => expect(result.current.run?.status).toBe('complete'), { timeout: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // No further polling once terminal — give it a moment and confirm no third call.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10000);

  it('stops polling and does not update state after unmount', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(runView({ status: 'running' })), { status: 200 }));

    const { result, unmount } = renderHook(() => useSimulationPolling(1));
    await waitFor(() => expect(result.current.run).not.toBeNull());

    const callsBeforeUnmount = fetchMock.mock.calls.length;
    unmount();

    await new Promise((resolve) => setTimeout(resolve, 2500));
    // The in-flight poll loop's timer was cleared, so no further calls happen after unmount.
    expect(fetchMock.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it('surfaces a fetch failure as an error rather than throwing', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useSimulationPolling(1));
    await waitFor(() => expect(result.current.error).toBe('network down'));
  });
});
