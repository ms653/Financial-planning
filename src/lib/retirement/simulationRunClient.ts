/**
 * Typed client-side `fetch` wrappers for the compute-persist-poll API
 * (`/api/retirement/simulation-runs*`, Milestone 7). `POST` calls are same-origin
 * `fetch('/api/...')` requests, which the browser sets `Origin`/`Host` on automatically —
 * `sameOriginGuard` (`src/lib/auth/csrf.ts`) needs no explicit token or header from here,
 * and the session cookie rides along automatically for a same-origin request with no
 * `credentials` option needed.
 */

/** Mirrors `serializeSimulationRun`'s return shape (`simulationRunView.ts`) — kept as a
 * hand-written client-side type rather than importing that function's return type
 * directly, since this file is client code and that one lives behind `getDb`-touching
 * imports elsewhere in the same module graph up the chain. `result`/`errorDetail` are
 * `unknown`/`string | null` here and narrowed by the caller (`deserializeSimulationResult`
 * for `result`) rather than typed strictly in this thin transport layer. */
export interface SimulationRunView {
  id: number;
  scenarioId: number;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  seed: number;
  iterationCount: number;
  result: unknown;
  errorDetail: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class SimulationRunClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function parseOrThrow(response: Response): Promise<SimulationRunView> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Body wasn't JSON — keep the generic status-coded message.
    }
    throw new SimulationRunClientError(message, response.status);
  }
  return (await response.json()) as SimulationRunView;
}

export async function startSimulationRun(scenarioId: number, iterations?: number): Promise<SimulationRunView> {
  const response = await fetch('/api/retirement/simulation-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(iterations === undefined ? { scenarioId } : { scenarioId, iterations }),
  });
  return parseOrThrow(response);
}

export async function fetchSimulationRun(runId: number): Promise<SimulationRunView> {
  const response = await fetch(`/api/retirement/simulation-runs/${runId}`);
  return parseOrThrow(response);
}

export async function cancelSimulationRun(runId: number): Promise<SimulationRunView> {
  const response = await fetch(`/api/retirement/simulation-runs/${runId}/cancel`, { method: 'POST' });
  return parseOrThrow(response);
}
