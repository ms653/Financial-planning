'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ACCOUNT_TYPES, LISA_NOTE, accountTypeMeta } from '@/lib/accounts/types';
import {
  OVERPAYMENT_BASIS_LABELS,
  validateAccountCreate,
  validateAccountEdit,
  type FieldErrors,
} from '@/lib/accounts/validation';
import { overpaymentAllowanceBasis, type AccountTypeValue } from '@/lib/db/schema';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/**
 * Add/Edit Account, per DESIGN_SPEC.md's screen spec.
 *
 * The decisions this component is built around, all from that spec:
 *  - **Type picker is a grid of labelled tiles, not a dropdown.** "these are meaningfully
 *    different concepts (per the proposal's tax-wrapper distinctions) and deserve visual
 *    weight, not a buried select box."
 *  - **Selecting a type reveals the form beneath it**, rather than navigating: "keeps context,
 *    one back-navigable step instead of two."
 *  - **Owner is a multi-select chip control**, unselected by default. More than one selected
 *    means joint. "Defaults to unselected (forces an explicit choice) rather than defaulting
 *    to the first household member, to avoid silent misattribution."
 *  - **Debt terms are optional and deferrable**, in a section that says so.
 *  - **LISA gets an inline one-line note** so the distinct type feels justified.
 *  - **Validation is inline and on-blur, not only on submit**, and the submit button is
 *    disabled until required fields are valid.
 *  - **A failed save keeps everything typed**, with a banner at the top.
 *
 * Client-side validation calls the *same* pure validators as the Server Action, so the message
 * shown under a field on blur is character-for-character the message the server would produce.
 * The server still re-validates everything — this is for immediacy, not for trust.
 */

export interface AccountFormPerson {
  id: number;
  name: string;
}

export interface AccountFormInitial {
  accountId: number;
  name: string;
  type: AccountTypeValue;
  ownerIds: number[];
  isEmergencyFund: boolean;
  debtTerms: {
    interestRate: string | null;
    minimumPayment: string | null;
    overpaymentAllowancePct: string | null;
    overpaymentAllowanceBalanceBasis: string | null;
    ercRatePct: string | null;
    ercPeriodEnd: string | null;
  } | null;
}

type FormValues = {
  name: string;
  openingBalance: string;
  asOfDate: string;
  interestRate: string;
  minimumPayment: string;
  overpaymentAllowancePct: string;
  overpaymentAllowanceBalanceBasis: string;
  ercRatePct: string;
  ercPeriodEnd: string;
};

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
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-content">
        {label}
      </label>
      {hint ? <p className="mt-0.5 text-xs text-content-faint">{hint}</p> : null}
      <div className="mt-1.5">{children}</div>
      {error ? (
        // aria-live so a message appearing on blur is announced, not silently rendered.
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-xs text-clay">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass';

function SubmitButton({
  label,
  disabled,
  pending,
}: {
  label: string;
  disabled: boolean;
  pending: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition enabled:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-brass dark:text-ink-950"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

export function AccountForm({
  people,
  action,
  today,
  initial,
  submitLabel,
  cancelHref,
}: {
  people: AccountFormPerson[];
  action: (formData: FormData) => Promise<ActionResult>;
  /** Passed in from the server so the default date can't cause a hydration mismatch. */
  today: string;
  initial?: AccountFormInitial;
  submitLabel: string;
  cancelHref: string;
}) {
  const isEdit = initial !== undefined;
  const { state: serverState, pending, onSubmit } = useActionForm(action);

  const [type, setType] = useState<AccountTypeValue | ''>(initial?.type ?? '');
  const [ownerIds, setOwnerIds] = useState<number[]>(initial?.ownerIds ?? []);
  const [isEmergencyFund, setIsEmergencyFund] = useState<boolean>(initial?.isEmergencyFund ?? false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<FormValues>({
    name: initial?.name ?? '',
    openingBalance: '',
    asOfDate: today,
    interestRate: initial?.debtTerms?.interestRate ?? '',
    minimumPayment: initial?.debtTerms?.minimumPayment ?? '',
    overpaymentAllowancePct: initial?.debtTerms?.overpaymentAllowancePct ?? '',
    overpaymentAllowanceBalanceBasis: initial?.debtTerms?.overpaymentAllowanceBalanceBasis ?? '',
    ercRatePct: initial?.debtTerms?.ercRatePct ?? '',
    ercPeriodEnd: initial?.debtTerms?.ercPeriodEnd ?? '',
  });

  const meta = type === '' ? null : accountTypeMeta(type);
  const isDebt = meta?.isLiability ?? false;

  // Run the real validator over the current values on every render. Gives both the inline
  // messages and the submit button's enabled state, with no second copy of the rules.
  const validation = useMemo(() => {
    const payload = { ...values, type, ownerIds: ownerIds.map(String), isEmergencyFund };
    return isEdit ? validateAccountEdit(payload) : validateAccountCreate(payload);
  }, [values, type, ownerIds, isEmergencyFund, isEdit]);

  const liveErrors: FieldErrors = validation.ok ? {} : validation.errors;
  const serverErrors: FieldErrors = serverErrorsOf(serverState);
  const formError = formErrorOf(serverState);

  /** Show an error once the field has been blurred, or immediately if the server sent one. */
  function errorFor(field: keyof FormValues | 'type' | 'ownerIds'): string | undefined {
    return serverErrors[field] ?? (touched[field] ? liveErrors[field] : undefined);
  }

  function setValue(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function blur(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function toggleOwner(personId: number) {
    setTouched((current) => ({ ...current, ownerIds: true }));
    setOwnerIds((current) =>
      current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId],
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-7">
      {isEdit ? <input type="hidden" name="accountId" value={initial.accountId} /> : null}

      {/* Save failed: banner at the top, form values all retained. */}
      {formError ? (
        <div role="alert" className="rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay">
          {formError}
        </div>
      ) : null}

      <fieldset>
        <legend className="text-sm font-medium text-content">Account type</legend>
        <p className="mt-0.5 text-xs text-content-faint">
          The type sets the tax treatment, so it’s worth picking precisely.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACCOUNT_TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              // Explicit label: without it the accessible name is the decorative initial, the
              // label and the blurb run together ("C Cash Current account, savings…"), which is
              // both noisy to hear and ambiguous between "Cash" and "Cash ISA".
              aria-label={option.label}
              aria-pressed={type === option.value}
              onClick={() => {
                setType(option.value);
                blur('type');
              }}
              className={`min-h-[76px] rounded-card border px-3 py-2.5 text-left transition ${
                type === option.value
                  ? 'border-brass bg-brass/10 shadow-card'
                  : 'border-line bg-paper-raised hover:border-line-strong'
              }`}
            >
              <span
                aria-hidden="true"
                className="block font-serif text-sm font-semibold text-brass-strong dark:text-brass"
              >
                {option.initial}
              </span>
              <span className="mt-0.5 block text-[13px] font-medium text-content">{option.label}</span>
              <span className="mt-0.5 block text-[10.5px] leading-tight text-content-faint">
                {option.blurb}
              </span>
            </button>
          ))}
        </div>
        {/* The chosen type travels in a hidden input, since the tiles are buttons not radios. */}
        <input type="hidden" name="type" value={type} />
        {errorFor('type') ? (
          <p role="alert" className="mt-2 text-xs text-clay">
            {errorFor('type')}
          </p>
        ) : null}
      </fieldset>

      {/* The rest of the form is revealed by the type choice rather than on a second screen. */}
      {meta ? (
        <div className="space-y-6 border-t border-line pt-6">
          {type === 'lisa' ? (
            <p className="rounded-card border border-brass/40 bg-brass/10 px-3.5 py-3 text-xs leading-relaxed text-content-muted">
              {LISA_NOTE}
            </p>
          ) : null}

          <Field label="Account name" htmlFor="name" error={errorFor('name')}>
            <input
              id="name"
              name="name"
              value={values.name}
              onChange={(event) => setValue('name', event.target.value)}
              onBlur={() => blur('name')}
              aria-invalid={errorFor('name') ? true : undefined}
              aria-describedby={errorFor('name') ? 'name-error' : undefined}
              placeholder={isDebt ? 'Mortgage — 14 Elm Grove' : `${meta.label} — provider`}
              className={inputClass}
            />
          </Field>

          <fieldset>
            <legend className="text-sm font-medium text-content">Owner</legend>
            <p className="mt-0.5 text-xs text-content-faint">
              Select more than one person if it’s held jointly.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {people.map((person) => {
                const selected = ownerIds.includes(person.id);
                return (
                  <label
                    key={person.id}
                    className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition ${
                      selected
                        ? 'border-brass bg-brass/10 font-medium text-content'
                        : 'border-line-strong text-content-muted hover:border-brass/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="ownerIds"
                      value={person.id}
                      checked={selected}
                      onChange={() => toggleOwner(person.id)}
                      onBlur={() => blur('ownerIds')}
                      className="h-4 w-4 accent-brass"
                    />
                    {person.name}
                  </label>
                );
              })}
            </div>
            {ownerIds.length > 1 ? (
              <p className="mt-2 text-xs text-content-muted">
                This will be recorded as a joint account, owned by the household.
              </p>
            ) : null}
            {errorFor('ownerIds') ? (
              <p role="alert" className="mt-2 text-xs text-clay">
                {errorFor('ownerIds')}
              </p>
            ) : null}
          </fieldset>

          {/* Balance is captured on create only. On edit it would be a second, history-rewriting
              way to change a figure that "Update balance" already appends properly. */}
          {isEdit ? null : (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={isDebt ? 'Amount outstanding' : 'Current balance'}
                htmlFor="openingBalance"
                hint={isDebt ? 'Enter what you still owe, as a positive number.' : undefined}
                error={errorFor('openingBalance')}
              >
                <input
                  id="openingBalance"
                  name="openingBalance"
                  inputMode="decimal"
                  value={values.openingBalance}
                  onChange={(event) => setValue('openingBalance', event.target.value)}
                  onBlur={() => blur('openingBalance')}
                  aria-invalid={errorFor('openingBalance') ? true : undefined}
                  aria-describedby={errorFor('openingBalance') ? 'openingBalance-error' : undefined}
                  placeholder="12500"
                  className={`${inputClass} tabular`}
                />
              </Field>

              <Field label="As of" htmlFor="asOfDate" error={errorFor('asOfDate')}>
                <input
                  id="asOfDate"
                  name="asOfDate"
                  type="date"
                  max={today}
                  value={values.asOfDate}
                  onChange={(event) => setValue('asOfDate', event.target.value)}
                  onBlur={() => blur('asOfDate')}
                  aria-invalid={errorFor('asOfDate') ? true : undefined}
                  className={`${inputClass} tabular`}
                />
              </Field>
            </div>
          )}

          {type === 'cash' ? (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-content">
              <input
                type="checkbox"
                name="isEmergencyFund"
                checked={isEmergencyFund}
                onChange={(event) => setIsEmergencyFund(event.target.checked)}
                className="h-4 w-4 accent-brass"
              />
              Counts towards our emergency fund
            </label>
          ) : null}

          {isDebt ? (
            <fieldset className="rounded-card border border-line bg-paper-sunken/50 p-4">
              <legend className="px-1 text-sm font-medium text-content">Debt details</legend>
              <p className="text-xs text-content-faint">
                All optional — you can add these later. They’re used by the cash allocation
                advisor in a later phase, not by anything on your dashboard today.
              </p>

              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Field label="Interest rate" htmlFor="interestRate" hint="Yearly, e.g. 4.25" error={errorFor('interestRate')}>
                  <input
                    id="interestRate"
                    name="interestRate"
                    inputMode="decimal"
                    value={values.interestRate}
                    onChange={(event) => setValue('interestRate', event.target.value)}
                    onBlur={() => blur('interestRate')}
                    placeholder="4.25"
                    className={`${inputClass} tabular`}
                  />
                </Field>

                <Field label="Minimum payment" htmlFor="minimumPayment" hint="Per month" error={errorFor('minimumPayment')}>
                  <input
                    id="minimumPayment"
                    name="minimumPayment"
                    inputMode="decimal"
                    value={values.minimumPayment}
                    onChange={(event) => setValue('minimumPayment', event.target.value)}
                    onBlur={() => blur('minimumPayment')}
                    placeholder="1450"
                    className={`${inputClass} tabular`}
                  />
                </Field>

                <Field
                  label="Overpayment allowance"
                  htmlFor="overpaymentAllowancePct"
                  hint="The % you can overpay without a charge"
                  error={errorFor('overpaymentAllowancePct')}
                >
                  <input
                    id="overpaymentAllowancePct"
                    name="overpaymentAllowancePct"
                    inputMode="decimal"
                    value={values.overpaymentAllowancePct}
                    onChange={(event) => setValue('overpaymentAllowancePct', event.target.value)}
                    onBlur={() => blur('overpaymentAllowancePct')}
                    placeholder="10"
                    className={`${inputClass} tabular`}
                  />
                </Field>

                <Field
                  label="That allowance applies to"
                  htmlFor="overpaymentAllowanceBalanceBasis"
                  error={errorFor('overpaymentAllowanceBalanceBasis')}
                >
                  <select
                    id="overpaymentAllowanceBalanceBasis"
                    name="overpaymentAllowanceBalanceBasis"
                    value={values.overpaymentAllowanceBalanceBasis}
                    onChange={(event) => setValue('overpaymentAllowanceBalanceBasis', event.target.value)}
                    onBlur={() => blur('overpaymentAllowanceBalanceBasis')}
                    className={inputClass}
                  >
                    <option value="">Choose…</option>
                    {overpaymentAllowanceBasis.enumValues.map((basis) => (
                      <option key={basis} value={basis}>
                        {OVERPAYMENT_BASIS_LABELS[basis]}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Kept visibly separate from the allowance above: these are two different
                    numbers (the penalty-free limit, and the charge rate above it) and were
                    conflated into one field in an earlier draft of the proposal. */}
                <Field
                  label="Early repayment charge"
                  htmlFor="ercRatePct"
                  hint="The % charged on overpayments above the allowance"
                  error={errorFor('ercRatePct')}
                >
                  <input
                    id="ercRatePct"
                    name="ercRatePct"
                    inputMode="decimal"
                    value={values.ercRatePct}
                    onChange={(event) => setValue('ercRatePct', event.target.value)}
                    onBlur={() => blur('ercRatePct')}
                    placeholder="3"
                    className={`${inputClass} tabular`}
                  />
                </Field>

                <Field
                  label="Charge period ends"
                  htmlFor="ercPeriodEnd"
                  error={errorFor('ercPeriodEnd')}
                >
                  <input
                    id="ercPeriodEnd"
                    name="ercPeriodEnd"
                    type="date"
                    value={values.ercPeriodEnd}
                    onChange={(event) => setValue('ercPeriodEnd', event.target.value)}
                    onBlur={() => blur('ercPeriodEnd')}
                    className={`${inputClass} tabular`}
                  />
                </Field>
              </div>
            </fieldset>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <SubmitButton label={submitLabel} disabled={!validation.ok} pending={pending} />
            <Link
              href={cancelHref}
              className="inline-flex min-h-[44px] items-center px-2 text-sm text-content-muted transition hover:text-content"
            >
              Cancel
            </Link>
          </div>
        </div>
      ) : null}
    </form>
  );
}
