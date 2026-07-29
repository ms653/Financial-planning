import { describe, expect, it } from 'vitest';
import {
  deserializeSimulationResult,
  serializeSimulationResult,
  SimulationResultCodecError,
} from './simulationResultCodec';
import type { SimulationResult } from './engineTypes';

const sample: SimulationResult = {
  scenarioId: 7,
  seed: 42,
  iterationCount: 200,
  successRate: 0.87,
  percentileBandsPence: {
    p10: [-1_000_000n, 0n, 5_000_000n],
    p50: [50_000_000n],
  },
};

describe('serializeSimulationResult / deserializeSimulationResult', () => {
  it('round-trips a real SimulationResult exactly, including negative and large bigints', () => {
    const round = deserializeSimulationResult(serializeSimulationResult(sample));
    expect(round).toEqual(sample);
  });

  it('serializes bigints as strings, not raw bigints, so JSON.stringify does not throw', () => {
    const serialized = serializeSimulationResult(sample);
    expect(() => JSON.stringify(serialized)).not.toThrow();
    expect(serialized.percentileBandsPence.p10).toEqual(['-1000000', '0', '5000000']);
  });

  it('rejects a non-object payload', () => {
    expect(() => deserializeSimulationResult(null)).toThrow(SimulationResultCodecError);
    expect(() => deserializeSimulationResult('nope')).toThrow(SimulationResultCodecError);
  });

  it('rejects a non-string array entry in percentileBandsPence', () => {
    expect(() =>
      deserializeSimulationResult({
        ...serializeSimulationResult(sample),
        percentileBandsPence: { p50: [123] },
      }),
    ).toThrow(SimulationResultCodecError);
  });

  // Regression test: an earlier version left `BigInt(entry)` unguarded, so a
  // string that isn't a valid bigint literal threw a raw SyntaxError instead of
  // this module's own typed error — found by independent Fable review of M6.
  it('rejects a string that is not a valid bigint literal, with this module\'s own error type', () => {
    expect(() =>
      deserializeSimulationResult({
        ...serializeSimulationResult(sample),
        percentileBandsPence: { p50: ['not-a-bigint'] },
      }),
    ).toThrow(SimulationResultCodecError);
  });
});
