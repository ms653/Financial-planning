'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DEFAULT_WRAPPER_WITHDRAWAL_ORDER } from '@/lib/retirement/scenarioFormDefaults';
import {
  validateScenarioForm,
  type ScenarioFormPersonValues,
  type ScenarioFormValues,
} from '@/lib/retirement/scenarioFormValidation';
import type { FieldErrors } from '@/lib/accounts/validation';
import type { ScenarioAssumptionsV1 } from '@/lib/retirement/scenarioAssumptions';
import type { DrawdownAccountType } from '@/lib/retirement/engineTypes';
import { useScenarioRunner } from '@/lib/retirement/useScenarioRunner';
import { ComputingState } from './ComputingState';
import { ScenarioWizard } from './ScenarioWizard';

/**
 * The Scenario Editor: a person-picker plus three sections (When/Spending/Strategy)
 * per `docs/DESIGN_SPEC.md`, one primary action ("Run simulation" — saves the
 * scenario and starts a run in one sequence, see `useScenarioRunner.ts`'s own doc
 * comment for why there's no separate Save button), and a persistent
 * results-preview strip. An opt-in guided wizard (`ScenarioWizard.tsx`) walks
 * through the same fields with explanations, using the exact same state and
 * validation as the direct form below — never the default, per a household's own
 * request after a confusing first result (see the person-picker note below).
 *
 * **The person-picker exists because of a real incident, not speculative scope.**
 * A household ran their first scenario with every household member included —
 * including two young children — because there was previously no way to leave
 * anyone out. Each selected person gets their own drawdown horizon, and the
 * simulation runs for as long as the *longest* one, so an unrelated child's default
 * `planEndAge` silently stretched the whole simulation out to ~90 years. New
 * scenarios now default to nobody selected (mirroring `AccountForm.tsx`'s own
 * owner-picker precedent: "defaults to unselected... to avoid silent
 * misattribution") rather than defaulting to the full household.
 *
 * Client-side validation calls the real `validateScenarioForm` (which itself defers
 * to `parseScenarioAssumptions` for every format/range rule) on every render, the
 * same `AccountForm.tsx` pattern this codebase already uses — one set of rules, not
 * two — but against `filteredValues` (only the *selected* people), not the raw form
 * state, so an unselected person's blank fields never block submission.
 */

export interface ScenarioEditorPerson {
  personId: number;
  name: string;
  currentAge: number;
}

const WRAPPER_LABELS: Record<DrawdownAccountType, string> = {
  cash: 'Cash',
  gia: 'General investment account',
  cash_isa: 'Cash ISA',
  ss_isa: 'Stocks & shares ISA',
  lisa: 'LISA',
  sipp_pension: 'Pension (SIPP)',
};

function toFormValues(people: ScenarioEditorPerson[], assumptions: ScenarioAssumptionsV1): ScenarioFormValues {
  const byId = new Map(assumptions.people.map((p) => [p.personId, p]));
  return {
    annualSpending: assumptions.annualSpending,
    survivorAnnualSpending: assumptions.survivorAnnualSpending ?? '',
    inflationPct: assumptions.inflationPct,
    equityAllocationPct: assumptions.equityAllocationPct,
    targetSuccessRatePct: assumptions.targetSuccessRatePct,
    flatEffectiveTaxRatePct: assumptions.flatEffectiveTaxRatePct,
    wrapperWithdrawalOrder: assumptions.wrapperWithdrawalOrder,
    people: people.map((person) => {
      const saved = byId.get(person.personId);
      return {
        personId: person.personId,
        currentAge: person.currentAge,
        retirementAge: saved ? String(saved.retirementAge) : '',
        statePensionClaimAge: saved?.statePensionClaimAge !== undefined ? String(saved.statePensionClaimAge) : '',
        statePensionAnnualOverride: saved?.statePensionAnnualOverride ?? '',
        pclsAge: saved?.pclsAge !== undefined ? String(saved.pclsAge) : '',
        planEndAge: saved ? String(saved.planEndAge) : '',
      };
    }),
  };
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  // `flex h-full flex-col` + `mt-auto` on the input wrapper: label/hint text wraps to
  // a different number of lines per column (e.g. "State Pension claim age" vs.
  // "retirement age"), which otherwise leaves each column's input box starting at a
  // different height within the same grid row. Grid's own row-stretch already makes
  // this div as tall as the row's tallest cell; anchoring the input to the bottom of
  // that (rather than letting it sit directly under however much text happens to be
  // above it) is what actually lines every input up across a row.
  return (
    <div className="flex h-full flex-col">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-content">
        {label}
      </label>
      {hint ? <p className="mt-0.5 text-xs text-content-faint">{hint}</p> : null}
      <div className="mt-auto pt-1.5">{children}</div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-clay">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass tabular';

export function ScenarioEditorForm({
  people,
  scenarioId,
  initialName,
  initialIsBaseline,
  initialAssumptions,
}: {
  people: ScenarioEditorPerson[];
  scenarioId: number | null;
  initialName: string;
  initialIsBaseline: boolean;
  initialAssumptions: ScenarioAssumptionsV1;
}) {
  const router = useRouter();
  const runner = useScenarioRunner();

  // Tracks which row "Run simulation" actually saves to — starts at the `scenarioId`
  // prop (null on /retirement/new) and switches to the newly-created id the first time
  // a save succeeds. Fable review (2026-07-31) found that using the `scenarioId` prop
  // directly here was a real bug: the prop never changes after mount (deliberately, per
  // the comment below on why there's no router.replace), so every subsequent click of
  // "Run simulation" on the New Scenario page — after editing an assumption and running
  // again, without navigating away — took the create branch again instead of updating
  // the scenario just created, silently multiplying "Baseline" rows (and, if "Set as
  // baseline" was checked, repeatedly stealing the baseline flag from the previous
  // duplicate). This local state is what actually prevents that, independent of the URL.
  const [effectiveScenarioId, setEffectiveScenarioId] = useState<number | null>(scenarioId);
  useEffect(() => {
    if (runner.savedScenarioId !== null) setEffectiveScenarioId(runner.savedScenarioId);
  }, [runner.savedScenarioId]);

  const [name, setName] = useState(initialName);
  const [isBaseline, setIsBaseline] = useState(initialIsBaseline);
  const [values, setValues] = useState<ScenarioFormValues>(toFormValues(people, initialAssumptions));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mode, setMode] = useState<'direct' | 'guided'>('direct');

  // Who this scenario actually models. An existing scenario keeps whoever was
  // already saved; a brand-new one starts with nobody selected — an explicit
  // choice is required rather than silently including the whole household (see
  // this file's own top-of-file doc comment for the incident that prompted this).
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<number>>(() =>
    scenarioId !== null ? new Set(initialAssumptions.people.map((p) => p.personId)) : new Set(),
  );

  function togglePerson(personId: number) {
    setSelectedPersonIds((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  const personNames = useMemo(() => new Map(people.map((p) => [p.personId, p.name])), [people]);

  // Snapshots {name, isBaseline, values, selection} as they were at the *last
  // successful run* — not the original `initial*` props, which never change again
  // after mount. Comparing against the fixed props would mean any scenario whose
  // name was typed in (i.e. every new scenario) reads as permanently dirty even the
  // instant after a successful run, since the current `name` would never again
  // equal the empty `initialName` it started from. Found by a real browser E2E run,
  // not reasoned out in advance. Selection is included too: toggling who's included
  // changes what a re-run would actually simulate, so it counts as a real edit.
  function snapshotOf(n: string, baseline: boolean, v: ScenarioFormValues, selected: Set<number>): string {
    return JSON.stringify({ name: n, isBaseline: baseline, values: v, selected: [...selected].sort((a, b) => a - b) });
  }
  const [lastRunSnapshot, setLastRunSnapshot] = useState(() =>
    snapshotOf(initialName, initialIsBaseline, toFormValues(people, initialAssumptions), selectedPersonIds),
  );

  // Only the selected people are ever validated or saved — an unselected person's
  // blank/default fields (e.g. a child nobody has touched) must never block
  // submission or leak into the error list.
  const filteredValues: ScenarioFormValues = useMemo(
    () => ({ ...values, people: values.people.filter((p) => selectedPersonIds.has(p.personId)) }),
    [values, selectedPersonIds],
  );

  const validation = useMemo(() => validateScenarioForm(filteredValues), [filteredValues]);
  const liveErrors: FieldErrors = validation.ok ? {} : validation.errors;
  const dirty = snapshotOf(name, isBaseline, values, selectedPersonIds) !== lastRunSnapshot;

  function errorFor(field: string): string | undefined {
    return touched[field] ? liveErrors[field] : undefined;
  }

  function blur(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function setPersonField(index: number, field: keyof ScenarioFormPersonValues, value: string) {
    setValues((current) => ({
      ...current,
      people: current.people.map((person, i) => (i === index ? { ...person, [field]: value } : person)),
    }));
  }

  function moveWrapper(index: number, direction: -1 | 1) {
    setValues((current) => {
      const order = [...current.wrapperWithdrawalOrder];
      const target = index + direction;
      if (target < 0 || target >= order.length) return current;
      [order[index], order[target]] = [order[target]!, order[index]!];
      return { ...current, wrapperWithdrawalOrder: order };
    });
  }

  async function handleRunSimulation() {
    if (!validation.ok) {
      // Touch exactly the fields `validateScenarioForm` actually flagged, not a
      // hand-maintained list of field names. Fable review (2026-07-31) found a real bug
      // in the previous hand-maintained list: it omitted `statePensionClaimAge` and
      // `pclsAge`, so typing something unparseable into either and clicking "Run
      // simulation" without first blurring the field produced a field-keyed error that
      // `errorFor()` never shows (it's gated on `touched`) — the click appeared to
      // silently do nothing. Deriving the touched set from `liveErrors`' own keys can't
      // drift out of sync with the validator the way an enumerated list already did once.
      setTouched((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(liveErrors).map((key) => [key, true])),
      }));
      return;
    }

    const started = await runner.run({
      scenarioId: effectiveScenarioId,
      name,
      isBaseline,
      assumptions: validation.value,
    });
    if (started) setLastRunSnapshot(snapshotOf(name, isBaseline, values, selectedPersonIds));
  }

  const locked = runner.locked;
  const resultsHref = runner.savedScenarioId ? `/retirement/${runner.savedScenarioId}` : null;

  // Deliberately no router.replace to the new edit URL after a create-mode save: doing
  // that immediately would remount this component (a new dynamic route segment) right as
  // useScenarioRunner is mid-sequence starting the run, dropping the in-flight
  // activeRunId/Computing state exactly when the user most wants to see it. The "View
  // results"/"View full results" links are the way to reach the saved scenario's own URL.

  function renderNameFields() {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Scenario name" htmlFor="scenario-name">
          <input
            id="scenario-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Baseline"
            className={inputClass}
          />
        </Field>
        <label className="mt-7 inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-content-muted">
          <input
            type="checkbox"
            checked={isBaseline}
            onChange={(event) => setIsBaseline(event.target.checked)}
            className="h-4 w-4 accent-brass"
          />
          Set as the baseline scenario
        </label>
      </div>
    );
  }

  function renderPersonPicker() {
    return (
      <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Who’s this scenario for?</h2>
        <p className="mt-0.5 text-xs text-content-faint">
          Only the people who’ll actually share this pot and draw down together — typically the
          adults, not children or other dependents. Everyone selected gets their own drawdown
          horizon, and the simulation runs for as long as the longest one.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {people.map((person) => {
            const selected = selectedPersonIds.has(person.personId);
            return (
              <label
                key={person.personId}
                className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition ${
                  selected
                    ? 'border-brass bg-brass/10 font-medium text-content'
                    : 'border-line-strong text-content-muted hover:border-brass/60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => togglePerson(person.personId)}
                  className="h-4 w-4 accent-brass"
                />
                {person.name} <span className="text-content-faint">· {person.currentAge}</span>
              </label>
            );
          })}
        </div>
        {selectedPersonIds.size === 0 ? (
          <p role="alert" className="mt-3 text-xs text-clay">
            Select at least one person to run a simulation.
          </p>
        ) : null}
      </section>
    );
  }

  function renderWhenFields() {
    return (
      <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">When</h2>
        <div className="mt-4 space-y-6">
          {people.map((person, index) =>
            selectedPersonIds.has(person.personId) ? (
              <div key={person.personId} className="grid gap-5 sm:grid-cols-3">
                <Field
                  label={`${person.name}'s retirement age`}
                  htmlFor={`retirementAge-${index}`}
                  hint={`Currently ${person.currentAge} — contributions (see Settings) stop and drawdown can start from this age`}
                  error={errorFor(`people.${index}.retirementAge`)}
                >
                  <input
                    id={`retirementAge-${index}`}
                    inputMode="numeric"
                    value={values.people[index]!.retirementAge}
                    onChange={(event) => setPersonField(index, 'retirementAge', event.target.value)}
                    onBlur={() => blur(`people.${index}.retirementAge`)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label={`${person.name}'s State Pension claim age`}
                  htmlFor={`spClaimAge-${index}`}
                  hint="Leave blank to use the earliest eligible age"
                  error={errorFor(`people.${index}.statePensionClaimAge`)}
                >
                  <input
                    id={`spClaimAge-${index}`}
                    inputMode="numeric"
                    value={values.people[index]!.statePensionClaimAge}
                    onChange={(event) => setPersonField(index, 'statePensionClaimAge', event.target.value)}
                    onBlur={() => blur(`people.${index}.statePensionClaimAge`)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label={`${person.name}'s plan end age`}
                  htmlFor={`planEndAge-${index}`}
                  hint="The age this plan is modelled to"
                  error={errorFor(`people.${index}.planEndAge`)}
                >
                  <input
                    id={`planEndAge-${index}`}
                    inputMode="numeric"
                    value={values.people[index]!.planEndAge}
                    onChange={(event) => setPersonField(index, 'planEndAge', event.target.value)}
                    onBlur={() => blur(`people.${index}.planEndAge`)}
                    className={inputClass}
                  />
                </Field>
              </div>
            ) : null,
          )}
        </div>
      </section>
    );
  }

  function renderSpendingFields() {
    return (
      <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Spending</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="Annual spending" htmlFor="annualSpending" hint="In retirement, today's money" error={errorFor('annualSpending')}>
            <input
              id="annualSpending"
              inputMode="decimal"
              value={values.annualSpending}
              onChange={(event) => setValues((c) => ({ ...c, annualSpending: event.target.value }))}
              onBlur={() => blur('annualSpending')}
              className={inputClass}
            />
          </Field>
          {filteredValues.people.length > 1 ? (
            <Field
              label="Survivor annual spending"
              htmlFor="survivorAnnualSpending"
              hint="Once only one of you remains"
              error={errorFor('survivorAnnualSpending')}
            >
              <input
                id="survivorAnnualSpending"
                inputMode="decimal"
                value={values.survivorAnnualSpending}
                onChange={(event) => setValues((c) => ({ ...c, survivorAnnualSpending: event.target.value }))}
                onBlur={() => blur('survivorAnnualSpending')}
                className={inputClass}
              />
            </Field>
          ) : null}
          <Field label="Inflation" htmlFor="inflationPct" hint="Annual, %" error={errorFor('inflationPct')}>
            <input
              id="inflationPct"
              inputMode="decimal"
              value={values.inflationPct}
              onChange={(event) => setValues((c) => ({ ...c, inflationPct: event.target.value }))}
              onBlur={() => blur('inflationPct')}
              className={inputClass}
            />
          </Field>
        </div>
      </section>
    );
  }

  function renderStrategyFields() {
    return (
      <div className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Equity allocation" htmlFor="equityAllocationPct" hint="%" error={errorFor('equityAllocationPct')}>
            <input
              id="equityAllocationPct"
              inputMode="decimal"
              value={values.equityAllocationPct}
              onChange={(event) => setValues((c) => ({ ...c, equityAllocationPct: event.target.value }))}
              onBlur={() => blur('equityAllocationPct')}
              className={inputClass}
            />
          </Field>
          <Field label="Target success rate" htmlFor="targetSuccessRatePct" hint="%" error={errorFor('targetSuccessRatePct')}>
            <input
              id="targetSuccessRatePct"
              inputMode="decimal"
              value={values.targetSuccessRatePct}
              onChange={(event) => setValues((c) => ({ ...c, targetSuccessRatePct: event.target.value }))}
              onBlur={() => blur('targetSuccessRatePct')}
              className={inputClass}
            />
          </Field>
          <Field label="Flat effective tax rate" htmlFor="flatEffectiveTaxRatePct" hint="%, on taxable drawdown only" error={errorFor('flatEffectiveTaxRatePct')}>
            <input
              id="flatEffectiveTaxRatePct"
              inputMode="decimal"
              value={values.flatEffectiveTaxRatePct}
              onChange={(event) => setValues((c) => ({ ...c, flatEffectiveTaxRatePct: event.target.value }))}
              onBlur={() => blur('flatEffectiveTaxRatePct')}
              className={inputClass}
            />
          </Field>
        </div>

        {people.map((person, index) =>
          selectedPersonIds.has(person.personId) ? (
            <div key={person.personId} className="grid gap-5 sm:grid-cols-2">
              <Field
                label={`${person.name}'s PCLS age`}
                htmlFor={`pclsAge-${index}`}
                hint="The 25% tax-free pension lump sum, taken at this age — leave blank to never take it within this plan"
                error={errorFor(`people.${index}.pclsAge`)}
              >
                <input
                  id={`pclsAge-${index}`}
                  inputMode="numeric"
                  value={values.people[index]!.pclsAge}
                  onChange={(event) => setPersonField(index, 'pclsAge', event.target.value)}
                  onBlur={() => blur(`people.${index}.pclsAge`)}
                  className={inputClass}
                />
              </Field>
              <Field
                label={`${person.name}'s State Pension override`}
                htmlFor={`spOverride-${index}`}
                hint="Only if your real forecast differs from the standard estimate — leave blank otherwise"
                error={errorFor(`people.${index}.statePensionAnnualOverride`)}
              >
                <input
                  id={`spOverride-${index}`}
                  inputMode="decimal"
                  value={values.people[index]!.statePensionAnnualOverride}
                  onChange={(event) => setPersonField(index, 'statePensionAnnualOverride', event.target.value)}
                  onBlur={() => blur(`people.${index}.statePensionAnnualOverride`)}
                  className={inputClass}
                />
              </Field>
            </div>
          ) : null,
        )}

        <div>
          <p className="text-sm font-medium text-content">Withdrawal order</p>
          <p className="mt-0.5 text-xs text-content-faint">Applied literally, in this order — not an optimiser.</p>
          <ol className="mt-2.5 space-y-1.5">
            {values.wrapperWithdrawalOrder.map((wrapper, index) => (
              <li
                key={wrapper}
                className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2 text-sm text-content"
              >
                <span>
                  {index + 1}. {WRAPPER_LABELS[wrapper]}
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${WRAPPER_LABELS[wrapper]} earlier`}
                    disabled={index === 0}
                    onClick={() => moveWrapper(index, -1)}
                    className="min-h-[32px] min-w-[32px] rounded border border-line-strong text-content-muted transition hover:border-brass disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${WRAPPER_LABELS[wrapper]} later`}
                    disabled={index === values.wrapperWithdrawalOrder.length - 1}
                    onClick={() => moveWrapper(index, 1)}
                    className="min-h-[32px] min-w-[32px] rounded border border-line-strong text-content-muted transition hover:border-brass disabled:opacity-30"
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <button
          type="button"
          onClick={() => {
            setValues((current) => ({
              ...current,
              equityAllocationPct: '60.000',
              targetSuccessRatePct: '90.000',
              flatEffectiveTaxRatePct: '20.000',
              wrapperWithdrawalOrder: DEFAULT_WRAPPER_WITHDRAWAL_ORDER,
            }));
          }}
          className="text-xs font-medium text-content-muted underline underline-offset-2 hover:text-content"
        >
          Reset to defaults
        </button>
      </div>
    );
  }

  const previewStrip = (
    <div className="rounded-card border border-line bg-paper-sunken/40 p-4">
      {locked ? (
        <ComputingState iterationCount={runner.poll.run?.iterationCount ?? 2000} />
      ) : dirty ? (
        <p className="text-sm text-content-muted">Assumptions changed — results below are from your last run</p>
      ) : runner.poll.run?.status === 'complete' ? (
        <p className="text-sm text-content-muted">
          Simulation complete.{' '}
          {resultsHref ? (
            <Link href={resultsHref} className="font-medium text-content underline underline-offset-2">
              View full results
            </Link>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-content-faint">Run a simulation to see results here.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleRunSimulation()}
          disabled={locked || runner.saving}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition enabled:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-brass dark:text-ink-950"
        >
          {runner.saving ? 'Saving…' : 'Run simulation'}
        </button>
        {resultsHref ? (
          <button
            type="button"
            onClick={() => router.push(resultsHref)}
            className="inline-flex min-h-[44px] items-center px-2 text-sm text-content-muted transition hover:text-content"
          >
            View results
          </button>
        ) : null}
      </div>
    </div>
  );

  if (mode === 'guided') {
    return (
      <div className="space-y-7">
        {runner.formError ? (
          <div role="alert" className="rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay">
            {runner.formError}
          </div>
        ) : null}
        <ScenarioWizard
          renderNameFields={renderNameFields}
          renderPersonPicker={renderPersonPicker}
          renderWhenFields={renderWhenFields}
          renderSpendingFields={renderSpendingFields}
          renderStrategyFields={renderStrategyFields}
          selectedCount={selectedPersonIds.size}
          reviewAssumptions={validation.ok ? validation.value : null}
          reviewError={!validation.ok ? liveErrors.form ?? 'A few things still need fixing before this can run.' : null}
          personNames={personNames}
          onExit={() => setMode('direct')}
          onRunSimulation={() => void handleRunSimulation()}
          saving={runner.saving}
          locked={locked}
        />
        {previewStrip}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {runner.formError ? (
        <div role="alert" className="rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay">
          {runner.formError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-content-muted">New to this? A guided setup walks through what each field means.</p>
        <button
          type="button"
          onClick={() => setMode('guided')}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-brass/50 bg-brass/10 px-4 text-sm font-medium text-content transition hover:border-brass"
        >
          Guide me through this
        </button>
      </div>

      <fieldset disabled={locked} className="space-y-7 disabled:opacity-60">
        {renderNameFields()}

        {renderPersonPicker()}
        {renderWhenFields()}
        {renderSpendingFields()}

        <section className="rounded-card border border-line bg-paper-sunken/50">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="flex w-full min-h-[44px] items-center justify-between px-5 py-3.5 text-left sm:px-6"
          >
            <span className="font-serif text-lg text-content">Strategy</span>
            <span className="text-xs uppercase tracking-wider text-content-faint">
              Advanced {advancedOpen ? '▲' : '▼'}
            </span>
          </button>

          {advancedOpen ? <div className="border-t border-line px-5 pb-6 pt-5 sm:px-6">{renderStrategyFields()}</div> : null}
        </section>

        {/* Suppressed when nobody's selected — the person-picker's own "Select at
            least one person" message already covers that case clearly; showing
            parseScenarioAssumptions's raw "people must be a non-empty array" on top
            of it is redundant, technical-sounding noise. */}
        {liveErrors.form && selectedPersonIds.size > 0 ? (
          <p role="alert" className="text-sm text-clay">
            {liveErrors.form}
          </p>
        ) : null}
      </fieldset>

      {previewStrip}
    </div>
  );
}