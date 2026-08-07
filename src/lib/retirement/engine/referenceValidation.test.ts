import { describe, expect, it } from 'vitest';
import { parseScaledDecimal, roundDiv } from '@/lib/portfolio/valuation';
import { RATE_SCALE, type DrawdownAccountType, type ResolvedScenario } from '../engineTypes';
import { simulatePath } from './deterministicCore';

/**
 * Phase 3's own definition of done (`docs/PROPOSAL.md`, Phased delivery table) requires
 * "naming a specific published reference tool/scenario ... and reproducing its output
 * within a documented tolerance on matching inputs" — not a general "seems plausible"
 * check. This file is that validation, and the reference tool it names is the **Trinity
 * study** (Cooley, Hubbard & Walz, 1998) — the canonical, most-reproduced "safe
 * withdrawal rate" success-rate methodology, still cited today as the origin of the "4%
 * rule".
 *
 * **A real methodological difference, disclosed rather than papered over**: the original
 * Trinity study computes a success rate over *deterministic rolling historical windows*
 * (every actual N-year stretch in its dataset), not a randomized bootstrap Monte Carlo —
 * this codebase's own M5 sampler (`bootstrapEngine.ts`) is the latter. Comparing our
 * bootstrap's aggregate success rate against Trinity's rolling-window number would
 * conflate two different sampling methodologies, so this file does not do that. Instead
 * it validates the piece that actually needs external checking — `simulatePath`'s
 * decumulation mechanics (compounding, withdrawal, depletion) — using the *same*
 * deterministic rolling-window method Trinity itself uses, over a real historical return
 * dataset. This isolates "is the core math right" from "does a random sampler's long-run
 * average match a fixed historical resample" — the latter is Monte Carlo theory holding,
 * not something a single reference figure could validate anyway.
 *
 * **Data source, precisely** (not hand-transcribed from a summary — downloaded and
 * parsed directly, 2026-07-31): Aswath Damodaran's (NYU Stern) historical returns
 * dataset, `https://www.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls`, sheet
 * "Nominal vs Real Data", columns "S&P 500 (Real)" and "T.Bond (Real)" (10-year US
 * Treasury) — both already inflation-adjusted total returns, 1928–2025 (98 years). This
 * is a standard, citable academic/practitioner source (updated annually), not a blog's
 * re-derivation of someone else's numbers.
 *
 * **Why this dataset, not the original 1926–1995 Ibbotson data Trinity itself used**:
 * that data is commercial (Ibbotson/Morningstar), not freely reproducible — a real,
 * documented reason several independent "updated Trinity study" analyses (Bogleheads,
 * thepoorswiss.com, bestinterest.blog — found while researching this) substitute a
 * different public dataset and extend the window range, exactly as this file does.
 * That's also why the tolerance bands below are ranges drawn from multiple independent
 * secondary sources, not one blog's single decimal — those sources don't agree with each
 * other to the percentage point either, for the same reason.
 *
 * **Money/rate conventions**: pence as `bigint`, rates as `RATE_SCALE`-scaled fractions —
 * same discipline as the rest of the engine (`engineTypes.ts`). Withdrawals are a flat
 * real amount each year (no separate inflation adjustment) against already-real returns —
 * confirmed by reading `deterministicCore.ts` itself: `inflationRate` is never read
 * there, so there is no double-counting risk in feeding it real returns directly.
 */

const SCALE_DIVISOR = 10n ** BigInt(RATE_SCALE);

/** Real (inflation-adjusted) total annual returns, S&P 500 and 10-year US Treasury —
 * see this file's own doc comment for exact source/sheet/columns. Six decimal places,
 * matching `RATE_SCALE`. */
const DAMODARAN_REAL_RETURNS: readonly { year: number; spReal: string; bondReal: string }[] = [
  { year: 1928, spReal: '0.454932', bondReal: '0.020148' },
  { year: 1929, spReal: '-0.088311', bondReal: '0.035980' },
  { year: 1930, spReal: '-0.200079', bondReal: '0.116835' },
  { year: 1931, spReal: '-0.380674', bondReal: '0.074522' },
  { year: 1932, spReal: '0.018184', bondReal: '0.212472' },
  { year: 1933, spReal: '0.488460', bondReal: '0.010836' },
  { year: 1934, spReal: '-0.026634', bondReal: '0.063520' },
  { year: 1935, spReal: '0.424871', bondReal: '0.014439' },
  { year: 1936, spReal: '0.300585', bondReal: '0.035176' },
  { year: 1937, spReal: '-0.371329', bondReal: '-0.014369' },
  { year: 1938, spReal: '0.329764', bondReal: '0.071908' },
  { year: 1939, spReal: '-0.010976', bondReal: '0.044123' },
  { year: 1940, spReal: '-0.113064', bondReal: '0.046549' },
  { year: 1941, spReal: '-0.206502', bondReal: '-0.108718' },
  { year: 1942, spReal: '0.093014', bondReal: '-0.061793' },
  { year: 1943, spReal: '0.214676', bondReal: '-0.004551' },
  { year: 1944, spReal: '0.163558', bondReal: '0.002725' },
  { year: 1945, spReal: '0.328360', bondReal: '0.015230' },
  { year: 1946, spReal: '-0.224842', bondReal: '-0.127006' },
  { year: 1947, spReal: '-0.033419', bondReal: '-0.072746' },
  { year: 1948, spReal: '0.028917', bondReal: '-0.007620' },
  { year: 1949, spReal: '0.205079', bondReal: '0.066140' },
  { year: 1950, spReal: '0.236317', bondReal: '-0.050784' },
  { year: 1951, spReal: '0.167166', bondReal: '-0.059077' },
  { year: 1952, spReal: '0.170894', bondReal: '0.013491' },
  { year: 1953, spReal: '-0.017965', bondReal: '0.035237' },
  { year: 1954, spReal: '0.531332', bondReal: '0.036756' },
  { year: 1955, spReal: '0.321039', bondReal: '-0.017036' },
  { year: 1956, spReal: '0.044842', bondReal: '-0.049444' },
  { year: 1957, spReal: '-0.130993', bondReal: '0.036460' },
  { year: 1958, spReal: '0.412395', bondReal: '-0.037887' },
  { year: 1959, spReal: '0.103800', bondReal: '-0.041031' },
  { year: 1960, spReal: '-0.010098', bondReal: '0.101415' },
  { year: 1961, spReal: '0.257937', bondReal: '0.013807' },
  { year: 1962, spReal: '-0.099220', bondReal: '0.044063' },
  { year: 1963, spReal: '0.206266', bondReal: '0.000377' },
  { year: 1964, spReal: '0.150371', bondReal: '0.024999' },
  { year: 1965, spReal: '0.102818', bondReal: '-0.011785' },
  { year: 1966, spReal: '-0.128972', bondReal: '-0.004369' },
  { year: 1967, spReal: '0.198704', bondReal: '-0.047069' },
  { year: 1968, spReal: '0.058344', bondReal: '-0.013669' },
  { year: 1969, spReal: '-0.133526', bondReal: '-0.103050' },
  { year: 1970, spReal: '-0.019031', bondReal: '0.105943' },
  { year: 1971, spReal: '0.106083', bondReal: '0.063143' },
  { year: 1972, spReal: '0.148434', bondReal: '-0.005685' },
  { year: 1973, spReal: '-0.213411', bondReal: '-0.048490' },
  { year: 1974, spReal: '-0.338970', bondReal: '-0.090159' },
  { year: 1975, spReal: '0.278786', bondReal: '-0.032893' },
  { year: 1976, spReal: '0.178939', bondReal: '0.104237' },
  { year: 1977, spReal: '-0.128028', bondReal: '-0.050508' },
  { year: 1978, spReal: '-0.022750', bondReal: '-0.089609' },
  { year: 1979, spReal: '0.046485', bondReal: '-0.111113' },
  { year: 1980, spReal: '0.172505', bondReal: '-0.136564' },
  { year: 1981, spReal: '-0.125004', bondReal: '-0.006545' },
  { year: 1982, spReal: '0.159819', bondReal: '0.279207' },
  { year: 1983, spReal: '0.178732', bondReal: '-0.005655' },
  { year: 1984, spReal: '0.020210', bondReal: '0.093134' },
  { year: 1985, spReal: '0.264412', bondReal: '0.211203' },
  { year: 1986, spReal: '0.171043', bondReal: '0.228260' },
  { year: 1987, spReal: '0.014191', bondReal: '-0.089068' },
  { year: 1988, spReal: '0.116131', bondReal: '0.036508' },
  { year: 1989, spReal: '0.256457', bondReal: '0.124752' },
  { year: 1990, spReal: '-0.087708', bondReal: '-0.000184' },
  { year: 1991, spReal: '0.264654', bondReal: '0.116759' },
  { year: 1992, spReal: '0.043966', bondReal: '0.062107' },
  { year: 1993, spReal: '0.069604', bondReal: '0.110883' },
  { year: 1994, spReal: '-0.012393', bondReal: '-0.103648' },
  { year: 1995, spReal: '0.338077', bondReal: '0.204319' },
  { year: 1996, spReal: '0.186713', bondReal: '-0.018865' },
  { year: 1997, spReal: '0.308825', bondReal: '0.081045' },
  { year: 1998, spReal: '0.263083', bondReal: '0.131039' },
  { year: 1999, spReal: '0.177343', bondReal: '-0.106457' },
  { year: 2000, spReal: '-0.120537', bondReal: '0.127801' },
  { year: 2001, spReal: '-0.132411', bondReal: '0.039059' },
  { year: 2002, spReal: '-0.238547', bondReal: '0.123303' },
  { year: 2003, spReal: '0.257956', bondReal: '-0.016268' },
  { year: 2004, spReal: '0.071611', bondReal: '0.011112' },
  { year: 2005, spReal: '0.014476', bondReal: '-0.004558' },
  { year: 2006, spReal: '0.127664', bondReal: '-0.005491' },
  { year: 2007, spReal: '0.013216', bondReal: '0.058603' },
  { year: 2008, spReal: '-0.365382', bondReal: '0.201280' },
  { year: 2009, spReal: '0.224883', bondReal: '-0.135495' },
  { year: 2010, spReal: '0.131936', bondReal: '0.069256' },
  { year: 2011, spReal: '-0.009351', bondReal: '0.125878' },
  { year: 2012, spReal: '0.138867', bondReal: '0.011911' },
  { year: 2013, spReal: '0.301757', bondReal: '-0.104592' },
  { year: 2014, spReal: '0.127878', bondReal: '0.100276' },
  { year: 2015, spReal: '0.007355', bondReal: '0.006415' },
  { year: 2016, spReal: '0.095269', bondReal: '-0.013329' },
  { year: 2017, spReal: '0.190694', bondReal: '0.006578' },
  { year: 2018, spReal: '-0.061070', bondReal: '-0.019794' },
  { year: 2019, spReal: '0.282441', bondReal: '0.071561' },
  { year: 2020, spReal: '0.164832', bondReal: '0.098793' },
  { year: 2021, spReal: '0.198465', bondReal: '-0.108312' },
  { year: 2022, spReal: '-0.230001', bondReal: '-0.228034' },
  { year: 2023, spReal: '0.222466', bondReal: '0.007370' },
  { year: 2024, spReal: '0.213733', bondReal: '-0.043982' },
  { year: 2025, spReal: '0.145895', bondReal: '0.049257' },
];

/** Deliberately independent of `bootstrapEngine.ts`'s own (unexported) blending helper —
 * this file validates `simulatePath` against an external reference and shouldn't share a
 * bug with the code it's checking. Same formula, same `RATE_SCALE` fixed-point
 * convention, reimplemented from scratch. */
function blendedReturn(spReal: string, bondReal: string, equityAllocationRate: bigint): bigint {
  const sp = parseScaledDecimal(spReal, RATE_SCALE);
  const bond = parseScaledDecimal(bondReal, RATE_SCALE);
  const equityPart = roundDiv(sp * equityAllocationRate, SCALE_DIVISOR);
  const bondPart = roundDiv(bond * (SCALE_DIVISOR - equityAllocationRate), SCALE_DIVISOR);
  return equityPart + bondPart;
}

const STARTING_BALANCE_PENCE = 100_000_000n; // £1,000,000 — a round number; only the ratios matter.
const WRAPPER_ORDER: DrawdownAccountType[] = ['gia'];

/** One person, no State Pension, no PCLS, no tax — matching Trinity's own pre-tax,
 * portfolio-only, no-other-income methodology. `retirementAge`/`inflationRate` are
 * carried for shape-completeness only; neither is read by `simulatePath` (see this
 * file's doc comment). */
function buildScenario(withdrawalRatePercent: bigint, equityAllocationRate: bigint, horizonYears: number): ResolvedScenario {
  return {
    scenarioId: 0,
    annualSpendingPence: (STARTING_BALANCE_PENCE * withdrawalRatePercent) / 100n,
    survivorAnnualSpendingPence: null,
    inflationRate: 0n,
    equityAllocationRate,
    targetSuccessRate: 900_000n,
    flatEffectiveTaxRate: 0n,
    wrapperWithdrawalOrder: WRAPPER_ORDER,
    people: [
      {
        personId: 1,
        currentAge: 65,
        retirementAge: 65,
        statePensionClaimAge: 68,
        statePensionAnnualPence: 0n,
        pclsAge: null,
        planEndAge: 65 + horizonYears,
        annualContributionsPence: {},
      },
    ],
    startingBalancesPence: { gia: STARTING_BALANCE_PENCE },
    jointAnnualContributionsPence: {},
    oneOffEvents: [],
  };
}

/** Every rolling `horizonYears`-long window the dataset supports (69 for a 30-year
 * horizon over 98 years, 1928–2025) — Trinity's own rolling-window method, not a
 * bootstrap sample. Runs the *real* `simulatePath`, not a reimplementation of it. */
function rollingWindowSuccessRate(
  withdrawalRatePercent: bigint,
  equityAllocationRate: bigint,
  horizonYears: number,
): { successes: number; windows: number; rate: number } {
  const scenario = buildScenario(withdrawalRatePercent, equityAllocationRate, horizonYears);
  let successes = 0;
  let windows = 0;
  for (let start = 0; start + horizonYears <= DAMODARAN_REAL_RETURNS.length; start++) {
    const returns = DAMODARAN_REAL_RETURNS.slice(start, start + horizonYears).map((row) =>
      blendedReturn(row.spReal, row.bondReal, equityAllocationRate),
    );
    const outcome = simulatePath(scenario, returns);
    windows += 1;
    if (outcome.success) successes += 1;
  }
  return { successes, windows, rate: successes / windows };
}

describe('Phase 3 reference-tool validation — Trinity study rolling-window success rates', () => {
  it('4% withdrawal, 50/50 stock/bond, 30-year horizon — the canonical "4% rule" case', () => {
    // Widely cited across multiple independent secondary sources for this exact input
    // combination: the original 1998 paper (no fees) ≈95%; a 1% AUM fee ≈84%; Wade
    // Pfau's own re-derivation ≈100% — a real spread, not one fixed number, because
    // different sources use different (and differently-dated) substitute datasets, per
    // this file's own doc comment. 90% is a floor comfortably below every cited figure.
    const { successes, windows, rate } = rollingWindowSuccessRate(4n, 500_000n, 30);
    expect(windows).toBe(69);
    expect(rate).toBeGreaterThanOrEqual(0.9);
    expect(successes).toBe(66); // pinned exactly too, so a real regression still fails loudly
  });

  it('5% withdrawal, 50/50 stock/bond, 30-year horizon — cross-checked against a second, independently-sourced figure', () => {
    // retirementresearcher.com's own description of the original Trinity methodology:
    // 41 of 60 rolling 30-year periods (1926–1985 windows) succeeded at this exact
    // combination ≈68%. A different, shorter, older dataset than this file's — the
    // remarkably close match (68.1% here) is corroborating evidence, not a coincidence
    // this test depends on to pass; the tolerance band is wide precisely because it's a
    // secondary citation of a different vintage, not this file's own primary claim.
    const { successes, windows, rate } = rollingWindowSuccessRate(5n, 500_000n, 30);
    expect(windows).toBe(69);
    expect(rate).toBeGreaterThanOrEqual(0.55);
    expect(rate).toBeLessThanOrEqual(0.85);
    expect(successes).toBe(47);
  });

  it('3% withdrawal, 50/50 stock/bond, 30-year horizon — Pfau\'s own re-derivation reports 100% ("every 30-year retiree still had money")', () => {
    const { successes, windows, rate } = rollingWindowSuccessRate(3n, 500_000n, 30);
    expect(windows).toBe(69);
    expect(rate).toBe(1);
    expect(successes).toBe(69);
  });
});
