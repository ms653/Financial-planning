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
 * **Accumulation phase — Phase 4.4, extended to every non-pension wrapper by its own
 * follow-up.** Milestone 3 originally scoped this engine to pure decumulation, with
 * `retirementAge` carried but never read (the historical decision is preserved in
 * `docs/STATUS.md`'s Phase 3 Milestone 3 section — "Genuine, plan-contradicting scope
 * narrowing" — since it was a real, deliberate deferral, not a case of the data not
 * existing). Phase 4.4 built the deferred wiring: a person is "still working" for any
 * simulated year where `age < retirementAge`, during which their
 * `annualContributionsPence` (resolved from `pension_contribution` and, since the
 * follow-up, `regular_contribution` too — `resolveScenario.ts`) land in their own
 * wrappers instead of that year's spending being drawn from wrapper balances. From
 * `age === retirementAge` onward they're "retired". A jointly-owned account's
 * `regular_contribution` has no single owner's `retirementAge` to gate on, so it
 * instead lands every year the household hasn't yet started drawing down —
 * `scenario.jointAnnualContributionsPence`, gated on the same `householdFullyRetired`
 * flag that gates withdrawal below, just inverted.
 *
 * **Two disclosed simplifications**, not oversights:
 * 1. **No partial-household drawdown.** Household spending/withdrawal (step 5 below)
 *    only happens once *every alive* person has reached their own `retirementAge` — a
 *    two-person household with one still working and one already past their
 *    `retirementAge` draws down nothing until both have retired, on the assumption the
 *    working person's income covers costs in the meantime. A real household might want
 *    the retired person's share drawn down while the other still works; that's a genuine
 *    refinement this milestone doesn't attempt, not a bug.
 * 2. **No relief-at-source grossing-up.** `pension_contribution.amount` lands in
 *    `sipp_pension` exactly as entered, regardless of `method` — a `relief_at_source`
 *    contribution's real-world basic-rate top-up isn't modelled. PROPOSAL.md names
 *    method-aware tax treatment (ANI/threshold income) as Phase 4.5's job specifically;
 *    Phase 4.4 only needs contributions to exist and compound, not to be tax-exact yet.
 *
 * **Tax treatment** — `flatEffectiveTaxRate` applies only to `gia` and the non-PCLS
 * portion of `sipp_pension`. `cash`/`cash_isa`/`ss_isa`/`lisa` withdrawals are net of tax
 * by construction: ISA wrappers are genuinely tax-free, and `cash` is already-taxed
 * money whose *withdrawal* triggers no further tax — taxing it under the "taxable
 * drawdown" umbrella would be a real error, not a simplification, so `cash` is grouped
 * with the tax-free wrappers below despite the Phase 3 milestone plan's own shorthand
 * ("ISA/PCLS excluded") not naming it explicitly.
 *
 * **Year-step ordering** — for each simulated year: (1) who's alive, whether the
 * household is fully retired yet, and State Pension income for whoever's claimed —
 * computed first since step 3's joint contributions need it and it depends on no
 * balance; (2) investment growth applied to every wrapper's start-of-year balance;
 * (3) each still-working person's `annualContributionsPence` lands in their own
 * wrappers, and any joint contributions land while the household isn't fully retired
 * yet (Phase 4.4 and its follow-up); (4) any PCLS event(s) due this year move 25% of
 * the (post-growth, post-contribution) `sipp_pension` balance into `cash`, tax-free —
 * a one-off transfer between wrappers, not a direct offset against spending, so
 * unspent PCLS proceeds correctly remain on the balance sheet (as cash) rather than
 * silently vanishing from `totalBalancePence`; (5) the remaining shortfall (spending,
 * itself zero unless every alive person has reached their `retirementAge`, minus State
 * Pension income) is drawn from wrappers in `wrapperWithdrawalOrder`, literally,
 * stopping once met. All amounts are bigint pence throughout; rates are
 * `RATE_SCALE`-scaled fractions (`percentStringToScaledFraction`).
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

    // 1. Who's alive this year, household spending, and guaranteed income (State
    // Pension) for whoever's claimed. A person is "alive" through the year their age
    // equals `planEndAge`, gone the year after. `householdFullyRetired` is Phase 4.4's
    // "no partial-household drawdown" gate (module doc comment, above): false whenever
    // any alive person hasn't yet reached their own `retirementAge`. Computed first,
    // not alongside withdrawal further down, because step 3's joint contributions need
    // it too and it never depends on this year's balances.
    let anyoneAlive = false;
    let allOriginalPeopleAlive = true;
    let householdFullyRetired = true;
    let statePensionIncomePence = 0n;
    for (const person of scenario.people) {
      const age = person.currentAge + yearIndex;
      const alive = age <= person.planEndAge;
      if (alive) {
        anyoneAlive = true;
        if (age < person.retirementAge) householdFullyRetired = false;
        if (age >= person.statePensionClaimAge) {
          statePensionIncomePence += person.statePensionAnnualPence;
        }
      } else {
        allOriginalPeopleAlive = false;
      }
    }

    // 2. Investment growth on every wrapper's start-of-year balance.
    for (const type of DRAWDOWN_ACCOUNT_TYPES) {
      balances.set(type, applyAnnualReturn(balances.get(type) ?? 0n, rateScaled));
    }

    // 3. Accumulation (Phase 4.4, extended to non-pension wrappers by its own
    // follow-up): each still-working, alive person's annual contributions land in
    // their own wrappers. "Still working" = age < retirementAge; the year
    // age === retirementAge, they're retired, not contributing (a clean boundary,
    // matching the >= convention `statePensionClaimAge` above already uses for
    // "started"). Joint accounts have no single owner's retirementAge to gate on, so
    // they instead land while the household as a whole hasn't started drawing down —
    // `!householdFullyRetired`, the same flag step 5 uses to gate withdrawal.
    for (const person of scenario.people) {
      const age = person.currentAge + yearIndex;
      const alive = age <= person.planEndAge;
      if (alive && age < person.retirementAge) {
        for (const [type, amountPence] of Object.entries(person.annualContributionsPence) as Array<
          [DrawdownAccountType, bigint]
        >) {
          balances.set(type, (balances.get(type) ?? 0n) + amountPence);
        }
      }
    }
    if (!householdFullyRetired) {
      for (const [type, amountPence] of Object.entries(scenario.jointAnnualContributionsPence) as Array<
        [DrawdownAccountType, bigint]
      >) {
        balances.set(type, (balances.get(type) ?? 0n) + amountPence);
      }
    }

    // 4. PCLS events due this year: 25% of the (post-growth, post-contribution) pension
    // balance moves to cash, tax-free. Not validated against the £268,275 Lump Sum
    // Allowance — an explicit Milestone 3 simplification, not an oversight (see the
    // plan's own note).
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

    const spendingPence = !anyoneAlive || !householdFullyRetired
      ? 0n
      : allOriginalPeopleAlive || scenario.people.length === 1
        ? scenario.annualSpendingPence
        : // Non-null whenever `people.length > 1` — enforced by
          // `parseScenarioAssumptions`; the household is never actually reachable with
          // this null in practice, but kept explicit rather than a silent `!`.
          (scenario.survivorAnnualSpendingPence ?? scenario.annualSpendingPence);

    let shortfallPence = spendingPence - statePensionIncomePence;
    if (shortfallPence < 0n) shortfallPence = 0n; // surplus guaranteed income isn't invested in M3.

    // 5. Draw the remaining shortfall from wrappers in the scenario's literal order.
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
