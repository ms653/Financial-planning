/**
 * Milestone 3 — the deterministic, zero-volatility decumulation core.
 *
 * Per PROPOSAL.md's own Testing strategy: "with volatility = 0, the simulation must
 * equal deterministic compounding exactly... the single highest-value test for a Monte
 * Carlo engine, since the expected answer is independently computable." This module is
 * that computation. Milestone 5's bootstrap engine is meant to be built as "this core
 * plus sampled returns" — `simulatePath` below already takes one return rate per
 * simulated year rather than a single flat rate, specifically so M5 can hand it a
 * sampled sequence instead of a repeated constant without duplicating the year-by-year
 * mechanics; `runDeterministicPath` is the thin M3-specific wrapper that repeats one
 * fixed rate.
 *
 * **Explicit scope decision — no accumulation/contribution phase, and this narrows one
 * of M3's own named tests, not just a general one.** A simulated path always begins
 * already retired: `ResolvedPerson.currentAge` is this person's age at year 0 of *this*
 * path, not necessarily today's real age, and a "retire at 60 vs. 65" comparison
 * (Milestone 9) is built by resolving two separate `ResolvedScenario`s that each start at
 * a different `currentAge`, not by simulating one continuous timeline through a working
 * phase into decumulation. `retirementAge` itself is therefore never read below — see its
 * doc comment in `engineTypes.ts`. `ScenarioAssumptionsV1` (the JSONB scenario blob) has
 * no contribution-amount field — but that alone understates the real gap, caught by an
 * independent Fable review of this milestone: Phase 1 *does* already carry live
 * contribution data (`person.annual_gross_income`, the `pension_contribution` table,
 * `src/lib/db/schema.ts`) that a resolution layer could have surfaced into
 * `ResolvedPerson`; this session chose not to build that wiring. The Phase 3 milestone
 * plan itself (not just PROPOSAL.md's general Testing strategy) names "contributions past
 * assumed retirement" as one of **M3's own required tests** — so this is a real,
 * plan-contradicting scope narrowing made unilaterally in-code, not a case of the data
 * simply not existing anywhere. It is judged a defensible engineering call (a full
 * accumulation-phase model is substantial separate scope, and PROPOSAL §5's own "P1 ships
 * a pre-tax/pre-wrapper Monte Carlo" framing supports pure decumulation for Phase 3), and
 * is recorded here and in the plan file rather than silently dropped or left for a future
 * session to rediscover — but it is a deferral, not a resolution: whichever milestone
 * next touches accumulation (or Phase 4.5's contribution-aware planning) has to actually
 * build this, and the stand-in regression test in `deterministicCore.test.ts` (asserting
 * `retirementAge` has zero effect) only locks in that this deferral hasn't silently been
 * half-undone — it does not exercise the real edge case the plan named.
 *
 * **Tax treatment** — `flatEffectiveTaxRate` applies only to `gia` and the non-PCLS
 * portion of `sipp_pension`. `cash`/`cash_isa`/`ss_isa`/`lisa` withdrawals are net of tax
 * by construction: ISA wrappers are genuinely tax-free, and `cash` is already-taxed
 * money whose *withdrawal* triggers no further tax — taxing it under the "taxable
 * drawdown" umbrella would be a real error, not a simplification, so `cash` is grouped
 * with the tax-free wrappers below despite the Phase 3 milestone plan's own shorthand
 * ("ISA/PCLS excluded") not naming it explicitly.
 *
 * **Year-step ordering** — for each simulated year: (1) investment growth applied to
 * every wrapper's start-of-year balance; (2) any PCLS event(s) due this year move 25% of
 * the (post-growth) `sipp_pension` balance into `cash`, tax-free — a one-off transfer
 * between wrappers, not a direct offset against spending, so unspent PCLS proceeds
 * correctly remain on the balance sheet (as cash) rather than silently vanishing from
 * `totalBalancePence`; (3) State Pension income for anyone who has reached their claim
 * age directly offsets the year's spending need; (4) the remaining shortfall is drawn
 * from wrappers in `wrapperWithdrawalOrder`, literally, stopping once met. All amounts
 * are bigint pence throughout; rates are `RATE_SCALE`-scaled fractions
 * (`percentStringToScaledFraction`).
 */

import { roundDiv } from '@/lib/portfolio/valuation';
import { sumPence } from '@/lib/money';
import {
  RATE_SCALE,
  DRAWDOWN_ACCOUNT_TYPES,
  type DrawdownAccountType,
  type ResolvedScenario,
  type SimulationOutcome,
  type YearState,
} from '../engineTypes';

const RATE_SCALE_DIVISOR = 10n ** BigInt(RATE_SCALE);

/** Wrapper types whose withdrawal is genuinely tax-free — the ISA family (permanently,
 * by law) plus `cash` (already-taxed money; a capital withdrawal, not taxable income) —
 * see this file's own doc comment for why `cash` isn't grouped with the taxable set
 * despite the Milestone 3 plan's shorthand. Everything else in `DRAWDOWN_ACCOUNT_TYPES`
 * (`gia`, `sipp_pension`) is taxable. */
const TAX_FREE_DRAWDOWN_TYPES = new Set<DrawdownAccountType>(['cash', 'cash_isa', 'ss_isa', 'lisa']);

/** `balance * (1 + rateScaled)`, rounded half up. `rateScaled` may be negative (a loss
 * year) or below -100% is not guarded against — not a reachable input from M4's real
 * return dataset or M5's sampling from it, and out of scope for M3's fixed-rate case. */
function applyAnnualReturn(balancePence: bigint, rateScaled: bigint): bigint {
  if (balancePence === 0n) return 0n;
  return balancePence + roundDiv(balancePence * rateScaled, RATE_SCALE_DIVISOR);
}

/**
 * The number of years a path must cover: the longest of any person's own horizon
 * (`planEndAge - currentAge`), floored at zero. A person already past their own
 * `planEndAge` at year 0 contributes nothing (and is simply never "alive" in the loop
 * below) without pulling the whole simulation's length negative.
 *
 * Exported for Milestone 5's bootstrap engine, which needs to know how many years of
 * sampled returns a scenario actually requires.
 */
export function totalSimulationYears(scenario: ResolvedScenario): number {
  let maxYears = 0;
  for (const person of scenario.people) {
    const years = person.planEndAge - person.currentAge;
    if (years > maxYears) maxYears = years;
  }
  return maxYears;
}

/**
 * Run one simulated path, given one real annual return rate per year (length must be at
 * least `totalSimulationYears(scenario)`). Shared by `runDeterministicPath` (M3, a
 * single rate repeated) and Milestone 5's bootstrap engine (a sampled sequence).
 */
export function simulatePath(
  scenario: ResolvedScenario,
  annualReturnRates: readonly bigint[],
): SimulationOutcome {
  const totalYears = totalSimulationYears(scenario);
  if (annualReturnRates.length < totalYears) {
    throw new Error(
      `simulatePath needs at least ${totalYears} yearly return rate(s) for this scenario, got ${annualReturnRates.length}`,
    );
  }

  const balances = new Map<DrawdownAccountType, bigint>();
  for (const type of DRAWDOWN_ACCOUNT_TYPES) {
    balances.set(type, scenario.startingBalancesPence[type] ?? 0n);
  }

  // Guards a person's PCLS firing more than once. Can't happen in practice — age
  // advances monotonically with `yearIndex` and each person's `pclsAge` is a single
  // value — but keeps the loop honest rather than relying on that invariant silently.
  const pclsTaken = new Set<number>();

  const path: YearState[] = [];
  let permanentlyDepleted = false;

  for (let yearIndex = 0; yearIndex < totalYears; yearIndex++) {
    const rateScaled = annualReturnRates[yearIndex]!;

    // 1. Investment growth on every wrapper's start-of-year balance.
    for (const type of DRAWDOWN_ACCOUNT_TYPES) {
      balances.set(type, applyAnnualReturn(balances.get(type) ?? 0n, rateScaled));
    }

    // 2. PCLS events due this year: 25% of the (post-growth) pension balance moves to
    // cash, tax-free. Not validated against the £268,275 Lump Sum Allowance — an
    // explicit Milestone 3 simplification, not an oversight (see the plan's own note).
    for (const person of scenario.people) {
      const age = person.currentAge + yearIndex;
      if (person.pclsAge !== null && age === person.pclsAge && !pclsTaken.has(person.personId)) {
        pclsTaken.add(person.personId);
        const pensionBalance = balances.get('sipp_pension') ?? 0n;
        const pclsAmount = roundDiv(pensionBalance * 25n, 100n);
        balances.set('sipp_pension', pensionBalance - pclsAmount);
        balances.set('cash', (balances.get('cash') ?? 0n) + pclsAmount);
      }
    }

    // 3. Who's alive this year, household spending, and guaranteed income (State
    // Pension) for whoever's claimed. A person is "alive" through the year their age
    // equals `planEndAge`, gone the year after.
    let anyoneAlive = false;
    let allOriginalPeopleAlive = true;
    let statePensionIncomePence = 0n;
    for (const person of scenario.people) {
      const age = person.currentAge + yearIndex;
      const alive = age <= person.planEndAge;
      if (alive) {
        anyoneAlive = true;
        if (age >= person.statePensionClaimAge) {
          statePensionIncomePence += person.statePensionAnnualPence;
        }
      } else {
        allOriginalPeopleAlive = false;
      }
    }

    const spendingPence = !anyoneAlive
      ? 0n
      : allOriginalPeopleAlive || scenario.people.length === 1
        ? scenario.annualSpendingPence
        : // Non-null whenever `people.length > 1` — enforced by
          // `parseScenarioAssumptions`; the household is never actually reachable with
          // this null in practice, but kept explicit rather than a silent `!`.
          (scenario.survivorAnnualSpendingPence ?? scenario.annualSpendingPence);

    let shortfallPence = spendingPence - statePensionIncomePence;
    if (shortfallPence < 0n) shortfallPence = 0n; // surplus guaranteed income isn't invested in M3.

    // 4. Draw the remaining shortfall from wrappers in the scenario's literal order.
    // Money in a wrapper the order omits is simply never touched — the documented
    // "applied literally, no optimisation" simplification, not a bug.
    for (const type of scenario.wrapperWithdrawalOrder) {
      if (shortfallPence <= 0n) break;
      const available = balances.get(type) ?? 0n;
      if (available <= 0n) continue;

      const taxFree = TAX_FREE_DRAWDOWN_TYPES.has(type);
      const afterTaxScaled = RATE_SCALE_DIVISOR - scenario.flatEffectiveTaxRate;
      if (!taxFree && afterTaxScaled <= 0n) {
        // 100%-or-more effective tax rate: no gross withdrawal from a taxable wrapper
        // can ever net a positive amount, so this wrapper can never help — skip it
        // rather than divide by zero.
        continue;
      }

      const grossNeeded = taxFree
        ? shortfallPence
        : roundDiv(shortfallPence * RATE_SCALE_DIVISOR, afterTaxScaled);
      const grossWithdrawn = grossNeeded > available ? available : grossNeeded;
      balances.set(type, available - grossWithdrawn);

      const netDelivered = taxFree
        ? grossWithdrawn
        : roundDiv(grossWithdrawn * afterTaxScaled, RATE_SCALE_DIVISOR);
      shortfallPence -= netDelivered;
    }
    if (shortfallPence < 0n) shortfallPence = 0n; // a fixed-point rounding overshoot, not still-owed money.

    if (shortfallPence > 0n) permanentlyDepleted = true;

    path.push({
      yearIndex,
      totalBalancePence: sumPence(balances.values()),
      balancesByWrapperPence: Object.fromEntries(balances) as Partial<Record<DrawdownAccountType, bigint>>,
      depleted: permanentlyDepleted,
    });
  }

  return { success: !path.some((year) => year.depleted), path };
}

/** M3's own entry point: one fixed real annual return rate, repeated for every
 * simulated year — the zero-volatility case Milestone 5 will replace with sampled
 * per-year rates via `simulatePath` directly. */
export function runDeterministicPath(
  scenario: ResolvedScenario,
  annualRealReturnRateScaled: bigint,
): SimulationOutcome {
  const totalYears = totalSimulationYears(scenario);
  const rates = Array.from({ length: totalYears }, () => annualRealReturnRateScaled);
  return simulatePath(scenario, rates);
}
