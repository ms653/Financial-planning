'use client';

import { useState } from 'react';
import { validateHouseholdName, validatePerson } from '@/lib/accounts/validation';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/**
 * The forms behind Guided Setup's first two steps.
 *
 * Client components so validation can be inline and on-blur, matching the Add/Edit Account
 * form's behaviour — a household shouldn't get one standard of feedback during setup and a
 * different one afterwards. Same pattern throughout: the shared pure validators drive both the
 * inline messages and whether submit is enabled, and the Server Action re-validates.
 */

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass';

function SubmitButton({
  label,
  disabled,
  pending,
}: {
  label: string;
  disabled?: boolean;
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

function FormBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay">
      {message}
    </div>
  );
}

export function HouseholdForm({
  action,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const { state, pending, onSubmit } = useActionForm(action);
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  const validation = validateHouseholdName({ name });
  const serverErrors = serverErrorsOf(state);
  const error = serverErrors.name ?? (touched && !validation.ok ? validation.errors.name : undefined);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormBanner message={formErrorOf(state)} />

      <div>
        <label htmlFor="household-name" className="block text-sm font-medium text-content">
          Household name
        </label>
        <p className="mt-0.5 text-xs text-content-faint">
          Just a label for your own reference — nothing depends on it.
        </p>
        <input
          id="household-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={error ? true : undefined}
          placeholder="The Smith household"
          className={`${inputClass} mt-1.5`}
        />
        {error ? (
          <p role="alert" className="mt-1 text-xs text-clay">
            {error}
          </p>
        ) : null}
      </div>

      <SubmitButton label="Continue" disabled={!validation.ok} pending={pending} />
    </form>
  );
}

export function PersonForm({
  action,
  submitLabel = 'Add person',
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  submitLabel?: string;
}) {
  const [values, setValues] = useState({ name: '', dateOfBirth: '', annualGrossIncome: '' });
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Clear the form on success so the next person starts blank — the running list above shows
  // what has already been added.
  const { state, pending, onSubmit } = useActionForm(action, {
    onSuccess: () => {
      setValues({ name: '', dateOfBirth: '', annualGrossIncome: '' });
      setTouched({});
    },
  });

  const validation = validatePerson(values);
  const serverErrors = serverErrorsOf(state);
  const liveErrors = validation.ok ? {} : validation.errors;
  const errorFor = (field: string) =>
    serverErrors[field] ?? (touched[field] ? liveErrors[field] : undefined);

  function setValue(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormBanner message={formErrorOf(state)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="person-name" className="block text-sm font-medium text-content">
            Name
          </label>
          <input
            id="person-name"
            name="name"
            value={values.name}
            onChange={(event) => setValue('name', event.target.value)}
            onBlur={() => setTouched((c) => ({ ...c, name: true }))}
            aria-invalid={errorFor('name') ? true : undefined}
            className={`${inputClass} mt-1.5`}
          />
          {errorFor('name') ? (
            <p role="alert" className="mt-1 text-xs text-clay">
              {errorFor('name')}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="person-dob" className="block text-sm font-medium text-content">
            Date of birth
          </label>
          <input
            id="person-dob"
            name="dateOfBirth"
            type="date"
            value={values.dateOfBirth}
            onChange={(event) => setValue('dateOfBirth', event.target.value)}
            onBlur={() => setTouched((c) => ({ ...c, dateOfBirth: true }))}
            aria-invalid={errorFor('dateOfBirth') ? true : undefined}
            className={`${inputClass} tabular mt-1.5`}
          />
          {errorFor('dateOfBirth') ? (
            <p role="alert" className="mt-1 text-xs text-clay">
              {errorFor('dateOfBirth')}
            </p>
          ) : (
            <p className="mt-1 text-xs text-content-faint">
              Sets State Pension age and ISA age limits later on.
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="person-income" className="block text-sm font-medium text-content">
          Yearly gross income <span className="font-normal text-content-faint">(optional)</span>
        </label>
        <p className="mt-0.5 text-xs text-content-faint">
          Salary before any pension sacrifice. You can add or change this any time — it’s a
          planning assumption, not a record.
        </p>
        <input
          id="person-income"
          name="annualGrossIncome"
          inputMode="decimal"
          value={values.annualGrossIncome}
          onChange={(event) => setValue('annualGrossIncome', event.target.value)}
          onBlur={() => setTouched((c) => ({ ...c, annualGrossIncome: true }))}
          placeholder="52000"
          className={`${inputClass} tabular mt-1.5`}
        />
        {errorFor('annualGrossIncome') ? (
          <p role="alert" className="mt-1 text-xs text-clay">
            {errorFor('annualGrossIncome')}
          </p>
        ) : null}
      </div>

      <SubmitButton label={submitLabel} disabled={!validation.ok} pending={pending} />
    </form>
  );
}
