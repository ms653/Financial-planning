'use client';

import { useCallback, useState } from 'react';
import {
  PENSION_METHOD_LABELS,
  validatePensionContribution,
  validatePerson,
} from '@/lib/accounts/validation';
import { pensionContributionMethod, type PensionContributionMethodValue } from '@/lib/db/schema';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/**
 * One household member on the Settings screen: their details, and their pension contributions.
 *
 * Pension contribution entry is intentionally minimal — see the note on the Settings page. What
 * it does get right is the thing that matters: **method and employer amount are captured
 * separately from the member's own amount**, because adjusted net income and threshold/adjusted
 * income treat relief-at-source, net-pay and salary-sacrifice differently, and a single
 * "total contributions" figure can't derive a tax band from them.
 */

export interface PersonPanelData {
  id: number;
  name: string;
  dateOfBirth: string;
  annualGrossIncome: string | null;
  /** Pre-formatted for display; the raw NUMERIC string is what the form edits. */
  incomeLabel: string | null;
  contributions: Array<{
    id: number;
    method: PensionContributionMethodValue;
    amount: string;
    employerAmount: string;
  }>;
}

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass';

function Saving({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition enabled:hover:border-brass enabled:hover:text-content disabled:opacity-45"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

export function PersonPanel({
  person,
  updateAction,
  addContributionAction,
  deleteContributionAction,
}: {
  person: PersonPanelData;
  updateAction: (formData: FormData) => Promise<ActionResult>;
  addContributionAction: (formData: FormData) => Promise<ActionResult>;
  /** Bare `<form action>`, so it returns void — a single-button form has nothing to render. */
  deleteContributionAction: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [addingContribution, setAddingContribution] = useState(false);

  const [details, setDetails] = useState({
    name: person.name,
    dateOfBirth: person.dateOfBirth,
    annualGrossIncome: person.annualGrossIncome ?? '',
  });
  const [contribution, setContribution] = useState({
    amount: '',
    method: '',
    employerAmount: '0',
  });

  const onDetailsSaved = useCallback(() => setEditing(false), []);
  const {
    state: detailsState,
    pending: detailsPending,
    onSubmit: onDetailsSubmit,
  } = useActionForm(updateAction, { onSuccess: onDetailsSaved });

  const onContributionAdded = useCallback(() => {
    setContribution({ amount: '', method: '', employerAmount: '0' });
    setAddingContribution(false);
  }, []);
  const {
    state: contributionState,
    pending: contributionPending,
    onSubmit: onContributionSubmit,
  } = useActionForm(addContributionAction, { onSuccess: onContributionAdded });

  const detailsValidation = validatePerson(details);
  const contributionValidation = validatePensionContribution(contribution);

  const detailsErrors = serverErrorsOf(detailsState);
  const contributionErrors = serverErrorsOf(contributionState);

  return (
    <div className="rounded-card border border-line bg-paper-sunken/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-content">{person.name}</h3>
          <p className="tabular mt-0.5 text-xs text-content-faint">
            Born {person.dateOfBirth} ·{' '}
            {person.incomeLabel ? `${person.incomeLabel} a year` : 'Income not entered'}
          </p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-[36px] rounded-lg border border-line-strong px-3 text-xs font-medium text-content-muted transition hover:border-brass hover:text-content"
          >
            Edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={onDetailsSubmit} className="mt-4 space-y-4 border-t border-line pt-4">
          <input type="hidden" name="personId" value={person.id} />

          {formErrorOf(detailsState) ? (
            <div role="alert" className="rounded-lg border border-clay/50 bg-clay-bg px-3 py-2 text-sm text-clay">
              {formErrorOf(detailsState)}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor={`name-${person.id}`} className="block text-xs font-medium text-content">
                Name
              </label>
              <input
                id={`name-${person.id}`}
                name="name"
                value={details.name}
                onChange={(event) => setDetails((c) => ({ ...c, name: event.target.value }))}
                className={`${inputClass} mt-1.5`}
              />
              {detailsErrors.name ? (
                <p role="alert" className="mt-1 text-xs text-clay">
                  {detailsErrors.name}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`dob-${person.id}`} className="block text-xs font-medium text-content">
                Date of birth
              </label>
              <input
                id={`dob-${person.id}`}
                name="dateOfBirth"
                type="date"
                value={details.dateOfBirth}
                onChange={(event) => setDetails((c) => ({ ...c, dateOfBirth: event.target.value }))}
                className={`${inputClass} tabular mt-1.5`}
              />
              {detailsErrors.dateOfBirth ? (
                <p role="alert" className="mt-1 text-xs text-clay">
                  {detailsErrors.dateOfBirth}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`income-${person.id}`} className="block text-xs font-medium text-content">
                Yearly gross income
              </label>
              <input
                id={`income-${person.id}`}
                name="annualGrossIncome"
                inputMode="decimal"
                value={details.annualGrossIncome}
                onChange={(event) =>
                  setDetails((c) => ({ ...c, annualGrossIncome: event.target.value }))
                }
                placeholder="Optional"
                className={`${inputClass} tabular mt-1.5`}
              />
              {detailsErrors.annualGrossIncome ? (
                <p role="alert" className="mt-1 text-xs text-clay">
                  {detailsErrors.annualGrossIncome}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Saving label="Save" pending={detailsPending} />
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-[44px] px-2 text-sm text-content-muted transition hover:text-content"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-content-faint">
            Pension contributions
          </h4>
          {!addingContribution ? (
            <button
              type="button"
              onClick={() => setAddingContribution(true)}
              className="text-xs text-content-muted underline underline-offset-2 hover:text-content"
            >
              + Add contribution
            </button>
          ) : null}
        </div>

        {person.contributions.length === 0 ? (
          <p className="mt-2 text-xs text-content-faint">None recorded.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {person.contributions.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper px-3 py-2 text-xs"
              >
                <span className="text-content">
                  <span className="tabular font-medium">{entry.amount}</span> a year ·{' '}
                  {PENSION_METHOD_LABELS[entry.method]}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular text-content-faint">
                    Employer {entry.employerAmount}
                  </span>
                  <form action={deleteContributionAction}>
                    <input type="hidden" name="contributionId" value={entry.id} />
                    <button
                      type="submit"
                      className="text-content-faint underline underline-offset-2 transition hover:text-clay"
                    >
                      Remove
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}

        {addingContribution ? (
          <form onSubmit={onContributionSubmit} className="mt-3 space-y-3">
            <input type="hidden" name="personId" value={person.id} />

            {formErrorOf(contributionState) ? (
              <div role="alert" className="rounded-lg border border-clay/50 bg-clay-bg px-3 py-2 text-sm text-clay">
                {formErrorOf(contributionState)}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor={`contribution-amount-${person.id}`}
                  className="block text-xs font-medium text-content"
                >
                  Your yearly amount
                </label>
                <input
                  id={`contribution-amount-${person.id}`}
                  name="amount"
                  inputMode="decimal"
                  value={contribution.amount}
                  onChange={(event) => setContribution((c) => ({ ...c, amount: event.target.value }))}
                  placeholder="4800"
                  className={`${inputClass} tabular mt-1.5`}
                />
                {contributionErrors.amount ? (
                  <p role="alert" className="mt-1 text-xs text-clay">
                    {contributionErrors.amount}
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor={`contribution-method-${person.id}`}
                  className="block text-xs font-medium text-content"
                >
                  How it’s paid
                </label>
                <select
                  id={`contribution-method-${person.id}`}
                  name="method"
                  value={contribution.method}
                  onChange={(event) => setContribution((c) => ({ ...c, method: event.target.value }))}
                  className={`${inputClass} mt-1.5`}
                >
                  <option value="">Choose…</option>
                  {pensionContributionMethod.enumValues.map((method) => (
                    <option key={method} value={method}>
                      {PENSION_METHOD_LABELS[method]}
                    </option>
                  ))}
                </select>
                {contributionErrors.method ? (
                  <p role="alert" className="mt-1 text-xs text-clay">
                    {contributionErrors.method}
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor={`contribution-employer-${person.id}`}
                  className="block text-xs font-medium text-content"
                >
                  Employer’s yearly amount
                </label>
                <input
                  id={`contribution-employer-${person.id}`}
                  name="employerAmount"
                  inputMode="decimal"
                  value={contribution.employerAmount}
                  onChange={(event) =>
                    setContribution((c) => ({ ...c, employerAmount: event.target.value }))
                  }
                  placeholder="0"
                  className={`${inputClass} tabular mt-1.5`}
                />
                {contributionErrors.employerAmount ? (
                  <p role="alert" className="mt-1 text-xs text-clay">
                    {contributionErrors.employerAmount}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!contributionValidation.ok || contributionPending}
                className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition enabled:hover:border-brass enabled:hover:text-content disabled:cursor-not-allowed disabled:opacity-45"
              >
                Add contribution
              </button>
              <button
                type="button"
                onClick={() => setAddingContribution(false)}
                className="min-h-[44px] px-2 text-sm text-content-muted transition hover:text-content"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>

      {/* Belt-and-braces: the details form's submit is enabled only when valid, matching the
          other forms in the app. Rendered here so the disabled state has a visible reason. */}
      {editing && !detailsValidation.ok ? (
        <p className="mt-2 text-xs text-content-faint">
          Fix the fields above to save.
        </p>
      ) : null}
    </div>
  );
}
