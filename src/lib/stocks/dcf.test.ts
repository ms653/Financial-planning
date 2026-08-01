import { describe, expect, it } from 'vitest';
import { computeDcf, deriveDcfBaseInputs, parseDcfInputs, DcfInputsParseError, type DcfInputsV1 } from './dcf';
import type { FmpStatements } from './fmp';

describe('parseDcfInputs', () => {
  function validRaw(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      schemaVersion: 1,
      growthRatePct: '8.000',
      discountRatePct: '10.000',
      terminalGrowthRatePct: '2.500',
      projectionYears: 5,
      ...overrides,
    };
  }

  it('parses a valid v1 payload', () => {
    const result = parseDcfInputs(validRaw());
    expect(result).toEqual({
      schemaVersion: 1,
      growthRatePct: '8.000',
      discountRatePct: '10.000',
      terminalGrowthRatePct: '2.500',
      projectionYears: 5,
    });
  });

  it('rejects terminalGrowthRatePct equal to discountRatePct', () => {
    expect(() => parseDcfInputs(validRaw({ terminalGrowthRatePct: '10.000' }))).toThrow(
      /terminalGrowthRatePct must be less than discountRatePct/,
    );
  });

  it('rejects terminalGrowthRatePct greater than discountRatePct', () => {
    expect(() => parseDcfInputs(validRaw({ terminalGrowthRatePct: '15.000' }))).toThrow(
      /terminalGrowthRatePct must be less than discountRatePct/,
    );
  });

  it('rejects a discount rate of exactly zero', () => {
    expect(() => parseDcfInputs(validRaw({ discountRatePct: '0.000' }))).toThrow(DcfInputsParseError);
  });

  it('rejects projectionYears outside 1-20', () => {
    expect(() => parseDcfInputs(validRaw({ projectionYears: 0 }))).toThrow(/projectionYears must be a whole number/);
    expect(() => parseDcfInputs(validRaw({ projectionYears: 21 }))).toThrow(/projectionYears must be a whole number/);
    expect(() => parseDcfInputs(validRaw({ projectionYears: 5.5 }))).toThrow(/projectionYears must be a whole number/);
  });

  it('rejects a malformed percent string', () => {
    expect(() => parseDcfInputs(validRaw({ growthRatePct: 'not a number' }))).toThrow(
      /growthRatePct must be a plain percent/,
    );
  });

  it('rejects an unrecognised schemaVersion', () => {
    expect(() => parseDcfInputs(validRaw({ schemaVersion: 2 }))).toThrow(/Unknown DCF inputs schemaVersion/);
  });

  it('rejects a non-object payload', () => {
    expect(() => parseDcfInputs(null)).toThrow(/must be a JSON object/);
    expect(() => parseDcfInputs('nope')).toThrow(/must be a JSON object/);
  });
});

describe('computeDcf', () => {
  // Fully exact, hand-verifiable case — deliberately picked rates/values that divide
  // evenly at every step, so this checks the algorithm's own defined bigint operations
  // exactly, not a tolerance band against continuous-math rounding (see dcf.ts's own
  // doc comment on why the iterative approach can differ from a naive real-number
  // formula by a rounding penny in the general case — this case is chosen to have none).
  //
  // growth 0%, discount 100%, terminal growth 0%, 1 year:
  //   year 1 FCF = base FCF (unchanged, 0% growth)
  //   discount factor after 1 year = 1 / (1 + 1.00) = 0.5 exactly
  //   year 1 PV = baseFCF * 0.5
  //   terminal FCF (year 2, at the terminal rate) = base FCF (0% terminal growth too)
  //   TV = terminalFCF / (discountRate - terminalGrowthRate) = FCF / 1.00 = FCF exactly
  //   PV of TV = FCF * 0.5
  //   enterprise value = FCF*0.5 + FCF*0.5 = FCF exactly
  it('computes an exact result for a hand-verifiable input', () => {
    const inputs: DcfInputsV1 = {
      schemaVersion: 1,
      growthRatePct: '0.000',
      discountRatePct: '100.000',
      terminalGrowthRatePct: '0.000',
      projectionYears: 1,
    };
    const baseFcfPence = 10_000_000n; // £100,000.00
    const dilutedShares = 1_000_000n; // 1,000,000 shares

    const result = computeDcf(inputs, baseFcfPence, 0n, dilutedShares);

    expect(result.years).toEqual([{ year: 1, projectedFcfPence: 10_000_000n, presentValuePence: 5_000_000n }]);
    expect(result.terminalValuePence).toBe(10_000_000n);
    expect(result.presentValueOfTerminalValuePence).toBe(5_000_000n);
    expect(result.enterpriseValuePence).toBe(10_000_000n);
    expect(result.equityValuePence).toBe(10_000_000n);
    expect(result.intrinsicValuePerSharePence).toBe(10n); // £100,000 / 1,000,000 shares = 10p/share
  });

  it('subtracts net debt from enterprise value to reach equity value', () => {
    const inputs: DcfInputsV1 = {
      schemaVersion: 1,
      growthRatePct: '0.000',
      discountRatePct: '100.000',
      terminalGrowthRatePct: '0.000',
      projectionYears: 1,
    };
    const result = computeDcf(inputs, 10_000_000n, 3_000_000n, 1_000_000n);
    expect(result.enterpriseValuePence).toBe(10_000_000n);
    expect(result.equityValuePence).toBe(7_000_000n);
  });

  it('a net cash position (negative net debt) increases equity value', () => {
    const inputs: DcfInputsV1 = {
      schemaVersion: 1,
      growthRatePct: '0.000',
      discountRatePct: '100.000',
      terminalGrowthRatePct: '0.000',
      projectionYears: 1,
    };
    const result = computeDcf(inputs, 10_000_000n, -2_000_000n, 1_000_000n);
    expect(result.equityValuePence).toBe(12_000_000n);
  });

  it('leaves FCF unchanged across every projected year at 0% growth', () => {
    const inputs: DcfInputsV1 = {
      schemaVersion: 1,
      growthRatePct: '0.000',
      discountRatePct: '10.000',
      terminalGrowthRatePct: '2.000',
      projectionYears: 5,
    };
    const result = computeDcf(inputs, 10_000_000n, 0n, 1_000_000n);
    expect(result.years.map((y) => y.projectedFcfPence)).toEqual(Array(5).fill(10_000_000n));
  });

  it('grows FCF year over year at a positive growth rate', () => {
    const inputs: DcfInputsV1 = {
      schemaVersion: 1,
      growthRatePct: '10.000',
      discountRatePct: '15.000',
      terminalGrowthRatePct: '2.000',
      projectionYears: 3,
    };
    const result = computeDcf(inputs, 10_000_000n, 0n, 1_000_000n);
    const fcfs = result.years.map((y) => y.projectedFcfPence);
    // Strictly increasing at a positive growth rate.
    expect(fcfs[0]!).toBeGreaterThan(10_000_000n);
    expect(fcfs[1]!).toBeGreaterThan(fcfs[0]!);
    expect(fcfs[2]!).toBeGreaterThan(fcfs[1]!);
  });

  it('returns null intrinsic value per share when there are no shares to divide by', () => {
    const inputs: DcfInputsV1 = {
      schemaVersion: 1,
      growthRatePct: '5.000',
      discountRatePct: '10.000',
      terminalGrowthRatePct: '2.000',
      projectionYears: 1,
    };
    const result = computeDcf(inputs, 10_000_000n, 0n, 0n);
    expect(result.intrinsicValuePerSharePence).toBeNull();
  });

  it('handles a negative base FCF without throwing', () => {
    const inputs: DcfInputsV1 = {
      schemaVersion: 1,
      growthRatePct: '5.000',
      discountRatePct: '10.000',
      terminalGrowthRatePct: '2.000',
      projectionYears: 3,
    };
    expect(() => computeDcf(inputs, -5_000_000n, 0n, 1_000_000n)).not.toThrow();
  });
});

describe('deriveDcfBaseInputs', () => {
  function statements(overrides: Partial<FmpStatements> = {}): FmpStatements {
    return {
      incomeStatements: [{ date: '2025-12-31', weightedAverageShsOutDil: 1_000_000 }],
      balanceSheets: [{ date: '2025-12-31', totalDebt: 5_000_000, cashAndCashEquivalents: 2_000_000 }],
      cashFlowStatements: [{ date: '2025-12-31', freeCashFlow: 1_234_567 }],
      ...overrides,
    };
  }

  it('converts the latest period to bigint pence, including net debt', () => {
    const result = deriveDcfBaseInputs(statements());
    expect(result).toEqual({
      baseFcfPence: 123_456_700n, // £1,234,567.00 -> pence
      netDebtPence: 300_000_000n, // (5,000,000 - 2,000,000) -> pence
      dilutedShares: 1_000_000n,
    });
  });

  it('returns null when any statement array is empty', () => {
    expect(deriveDcfBaseInputs(statements({ cashFlowStatements: [] }))).toBeNull();
    expect(deriveDcfBaseInputs(statements({ balanceSheets: [] }))).toBeNull();
    expect(deriveDcfBaseInputs(statements({ incomeStatements: [] }))).toBeNull();
  });

  it('returns null when a required field is missing or not a finite number', () => {
    expect(
      deriveDcfBaseInputs(statements({ cashFlowStatements: [{ date: '2025-12-31' }] })),
    ).toBeNull();
    expect(
      deriveDcfBaseInputs(
        statements({ cashFlowStatements: [{ date: '2025-12-31', freeCashFlow: 'N/A' }] }),
      ),
    ).toBeNull();
  });

  it('returns null for a negative diluted share count', () => {
    expect(
      deriveDcfBaseInputs(
        statements({ incomeStatements: [{ date: '2025-12-31', weightedAverageShsOutDil: -1 }] }),
      ),
    ).toBeNull();
  });
});
