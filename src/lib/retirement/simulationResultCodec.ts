/**
 * `simulation_run.result` is a `jsonb` column, and `SimulationResult` carries `bigint`
 * pence values (`percentileBandsPence`) — `JSON.stringify` throws on a raw `bigint`, so
 * something has to convert to/from a JSON-safe shape before a result ever reaches the
 * database. Nothing needed this before M6 (M1's `assumptions` JSONB has no bigints —
 * `ScenarioAssumptionsV1` stores money as canonical decimal strings, not pence). Kept
 * narrow and hand-rolled, matching `scenarioAssumptions.ts`'s house style, rather than a
 * generic bigint-aware JSON replacer — the only bigint-shaped field here is
 * `percentileBandsPence`.
 */

import type { SimulationResult } from './engineTypes';

export interface SerializedSimulationResult {
  scenarioId: number;
  seed: number;
  iterationCount: number;
  successRate: number;
  percentileBandsPence: Record<string, string[]>;
}

export function serializeSimulationResult(result: SimulationResult): SerializedSimulationResult {
  return {
    scenarioId: result.scenarioId,
    seed: result.seed,
    iterationCount: result.iterationCount,
    successRate: result.successRate,
    percentileBandsPence: Object.fromEntries(
      Object.entries(result.percentileBandsPence).map(([band, values]) => [
        band,
        values.map((pence) => pence.toString()),
      ]),
    ),
  };
}

export class SimulationResultCodecError extends Error {}

function expectNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SimulationResultCodecError(`${field} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** The inverse of `serializeSimulationResult` — validated, not just cast, since this is
 * reading back a column whose shape nothing at the database level enforces. */
export function deserializeSimulationResult(raw: unknown): SimulationResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new SimulationResultCodecError('simulation_run.result is not an object');
  }
  const value = raw as Record<string, unknown>;

  const scenarioId = expectNumber(value.scenarioId, 'scenarioId');
  const seed = expectNumber(value.seed, 'seed');
  const iterationCount = expectNumber(value.iterationCount, 'iterationCount');
  const successRate = expectNumber(value.successRate, 'successRate');

  if (typeof value.percentileBandsPence !== 'object' || value.percentileBandsPence === null) {
    throw new SimulationResultCodecError('percentileBandsPence must be an object');
  }

  const percentileBandsPence: Record<string, bigint[]> = {};
  for (const [band, values] of Object.entries(
    value.percentileBandsPence as Record<string, unknown>,
  )) {
    if (!Array.isArray(values)) {
      throw new SimulationResultCodecError(`percentileBandsPence.${band} must be an array`);
    }
    percentileBandsPence[band] = values.map((entry, index) => {
      if (typeof entry !== 'string') {
        throw new SimulationResultCodecError(
          `percentileBandsPence.${band}[${index}] must be a string, got ${JSON.stringify(entry)}`,
        );
      }
      try {
        return BigInt(entry);
      } catch {
        throw new SimulationResultCodecError(
          `percentileBandsPence.${band}[${index}] is not a valid bigint literal, got ${JSON.stringify(entry)}`,
        );
      }
    });
  }

  return { scenarioId, seed, iterationCount, successRate, percentileBandsPence };
}
