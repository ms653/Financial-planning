'use client';

import { useState } from 'react';
import { AssumptionsSummary } from './AssumptionsSummary';
import type { ScenarioAssumptionsV1 } from '@/lib/retirement/scenarioAssumptions';

/**
 * The opt-in guided setup for a retirement scenario — never the default (see
 * `ScenarioEditorForm.tsx`'s own "Guide me through this" toggle). Renders the exact
 * same field groups as the direct form, one at a time, via render-prop functions
 * passed in from the parent — this component owns no form state itself, only which
 * step is showing, so there is no way for the wizard and the direct form to
 * silently drift onto different values.
 *
 * Built in response to a real incident: a household ran their first scenario with
 * every household member included, including two young children, because nothing
 * explained what the engine actually models or that a scenario could be scoped to
 * fewer people. The Intro and Review steps repeat that explanation deliberately —
 * once on the way in, once right before "Run simulation" — rather than trusting a
 * single mention to stick.
 */

const STEPS = [
  { key: 'intro', label: 'Before you start' },
  { key: 'people', label: "Who's this for" },
  { key: 'when', label: 'When' },
  { key: 'spending', label: 'Spending' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'review', label: 'Review' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

export interface ScenarioWizardProps {
  renderNameFields: () => React.ReactNode;
  renderPersonPicker: () => React.ReactNode;
  renderWhenFields: () => React.ReactNode;
  renderSpendingFields: () => React.ReactNode;
  renderStrategyFields: () => React.ReactNode;
  selectedCount: number;
  /** `null` when the current values don't yet form a valid scenario — the Review
   * step shows `reviewError` instead of a summary in that case. */
  reviewAssumptions: ScenarioAssumptionsV1 | null;
  reviewError: string | null;
  personNames: ReadonlyMap<number, string>;
  onExit: () => void;
  onRunSimulation: () => void;
  saving: boolean;
  locked: boolean;
}

const navButtonClass =
  'inline-flex min-h-[40px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition hover:border-brass disabled:opacity-40';
const primaryButtonClass =
  'inline-flex min-h-[40px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition enabled:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-brass dark:text-ink-950';

export function ScenarioWizard({
  renderNameFields,
  renderPersonPicker,
  renderWhenFields,
  renderSpendingFields,
  renderStrategyFields,
  selectedCount,
  reviewAssumptions,
  reviewError,
  personNames,
  onExit,
  onRunSimulation,
  saving,
  locked,
}: ScenarioWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex]!;

  // The one place a step is actually gated: you can't proceed past choosing who
  // this scenario is for with nobody chosen — everything downstream (per-person
  // fields, validation) assumes at least one selected person exists.
  const canGoNext = step.key !== 'people' || selectedCount > 0;

  function goNext() {
    if (!canGoNext) return;
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }
  function goToStep(key: StepKey) {
    const index = STEPS.findIndex((s) => s.key === key);
    if (index >= 0) setStepIndex(index);
  }

  return (
    <div className="rounded-card border border-brass/40 bg-brass/5 p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ol className="flex flex-wrap items-center gap-2 text-xs">
          {STEPS.map((entry, index) => {
            const state = index === stepIndex ? 'current' : index < stepIndex ? 'done' : 'upcoming';
            return (
              <li key={entry.key}>
                <span
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                    state === 'current'
                      ? 'bg-ink-950 font-medium text-content-ink dark:bg-brass dark:text-ink-950'
                      : state === 'done'
                        ? 'bg-sage-bg text-sage'
                        : 'bg-paper-sunken text-content-faint'
                  }`}
                >
                  <span aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
                  {entry.label}
                </span>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={onExit}
          className="text-xs font-medium text-content-muted underline underline-offset-2 hover:text-content"
        >
          Exit guided setup
        </button>
      </div>

      <div className="mt-6">
        {step.key === 'intro' ? (
          <div className="space-y-4">
            <h2 className="font-serif text-2xl text-content">Before you start</h2>
            <p className="max-w-prose text-sm leading-relaxed text-content-muted">
              This runs your numbers through thousands of simulated market histories — not one
              guess, a range of possible outcomes — and reports how many of them didn’t run out
              of money.
            </p>
            <div className="rounded-card border border-clay/40 bg-clay-bg/60 px-4 py-3.5 text-sm leading-relaxed">
              <p className="font-medium text-clay">This models drawing down, not saving up yet.</p>
              <p className="mt-1 text-content-muted">
                The simulation starts spending immediately from each selected person’s current
                age — it doesn’t model years of future saving or pension contributions between
                now and retirement. If nobody here is retired yet, read the result as “what if I
                stopped saving today,” not “will I be fine when I actually retire.”
              </p>
            </div>
          </div>
        ) : null}

        {step.key === 'people' ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-serif text-2xl text-content">Who’s this for?</h2>
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-content-muted">
                Choose the people who’ll actually share this pot and draw down together —
                typically the adults, not children or other dependents. Everyone chosen gets
                their own drawdown horizon, and the simulation runs for as long as the longest
                one.
              </p>
            </div>
            {renderPersonPicker()}
          </div>
        ) : null}

        {step.key === 'when' ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-serif text-2xl text-content">When</h2>
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-content-muted">
                These ages anchor the simulation. State Pension claim age defaults to the
                earliest age you’re eligible. Plan end age is how many years the money needs to
                last — a cautious estimate is safer than an optimistic one, since outliving your
                money is the risk this whole exercise exists to catch.
              </p>
            </div>
            {renderWhenFields()}
          </div>
        ) : null}

        {step.key === 'spending' ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-serif text-2xl text-content">Spending</h2>
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-content-muted">
                Annual spending is in today’s money — the simulation adjusts for inflation
                itself, so don’t inflate this number yourself. Survivor spending is what the
                household would need with only one of you remaining; household costs rarely
                halve when household size does, so this is usually more than half the joint
                figure.
              </p>
            </div>
            {renderSpendingFields()}
          </div>
        ) : null}

        {step.key === 'strategy' ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-serif text-2xl text-content">Strategy</h2>
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-content-muted">
                Equity allocation is the % of the portfolio treated as growth assets for this
                simulation. Target success rate is the bar you’re aiming for, shown against your
                actual result afterwards — it isn’t an input to the maths itself. The tax rate is
                one simplified rate on taxable withdrawals only (ISA and tax-free lump sum
                withdrawals are excluded automatically). <strong className="font-medium text-content">PCLS</strong> is
                the Pension Commencement Lump Sum — the 25% you can take tax-free from a pension;
                “PCLS age” is when this scenario assumes you take it, leaving the rest to keep
                growing. The <strong className="font-medium text-content">State Pension override</strong> lets
                you replace the standard estimated amount with your own figure — useful if your
                real State Pension forecast differs (e.g. from a gap in your National Insurance
                record). Withdrawal order is applied exactly as listed — not an optimiser (a real
                withdrawal-order optimiser is on the roadmap as a later, optional phase, not
                something this build does yet).
              </p>
            </div>
            {/* renderStrategyFields() is deliberately "bare" (no card of its own) —
                the direct form embeds it inside its own collapsed "Strategy" box, so
                giving it a second wrapper there would nest two cards. The wizard has
                no such box, so without this it's the one step that renders without
                the white card every other step gets, sitting straight on the
                wizard's own tinted background instead. */}
            <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
              {renderStrategyFields()}
            </div>
            <button
              type="button"
              onClick={() => goToStep('review')}
              className="text-xs font-medium text-content-muted underline underline-offset-2 hover:text-content"
            >
              Skip — use sensible defaults
            </button>
          </div>
        ) : null}

        {step.key === 'review' ? (
          <div className="space-y-4">
            <h2 className="font-serif text-2xl text-content">Review</h2>
            <div className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
              <h3 className="mb-4 text-sm font-medium text-content">Name this scenario</h3>
              {renderNameFields()}
            </div>
            {reviewAssumptions ? (
              <>
                <AssumptionsSummary assumptions={reviewAssumptions} personNames={personNames} defaultOpen />
                <div className="rounded-card border border-clay/40 bg-clay-bg/60 px-4 py-3.5 text-sm leading-relaxed text-content-muted">
                  One more time: this starts spending from today, not from anyone’s planned
                  retirement age.
                </div>
                <button type="button" onClick={onRunSimulation} disabled={locked || saving} className={primaryButtonClass}>
                  {saving ? 'Saving…' : 'Run simulation'}
                </button>
              </>
            ) : (
              <p role="alert" className="text-sm text-clay">
                {reviewError}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-7 flex items-center justify-between border-t border-line pt-5">
        <button type="button" onClick={goBack} disabled={stepIndex === 0} className={navButtonClass}>
          Back
        </button>
        {step.key !== 'review' ? (
          <button type="button" onClick={goNext} disabled={!canGoNext} className={primaryButtonClass}>
            {step.key === 'strategy' ? 'Next: review' : 'Next'}
          </button>
        ) : null}
      </div>
    </div>
  );
}