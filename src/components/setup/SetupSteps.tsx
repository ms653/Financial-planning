'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { validateHouseholdName, validatePerson } from '@/lib/accounts/validation';
import type { ActionResult } from '@/lib/household/actions';

/**
 * The forms behind Guided Setup's first two steps.
 *
 * Client components so validation can be inline and on-blur, matching the Add/Edit Account
 * form's behaviour — a household shouldn't get one standard of feedback during setup and a
 * different one afterwards. Same pattern throughout: the shared pure validators drive both the
 * inline messages and whether submit is enabled, and the Server Action re-validates.
 */

const EMPTY_STATE: ActionResult = { ok: true };

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass';

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
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
  const [state, formAction] = useFormState(
    async (_previous: ActionResult, formData: FormData) => action(formData),
    EMPTY_STATE,
  );
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  const validation = validateHouseholdName({ name });
  const serverErrors = state.ok ? {} : state.errors;
  const error = serverErrors.name ?? (touched && !validation.ok ? validation.errors.name : undefined);

  return (
    <form action={formAction} className="space-y-4">
      <FormBanner message={state.ok ? undefined : state.formError} />

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

      <SubmitButton label="Continue" disabled={!validation.ok} />
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
  const [state, formAction] = useFormState(
    async (_previous: ActionResult, formData: FormData) => action(formData),
    EMPTY_STATE,
  );
  const [values, setValues] = useState({ name: '', dateOfBirth: '', annualGrossIncome: '' });
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validation = validatePerson(values);
  const serverErrors = state.ok ? {} : state.errors;
  const liveErrors = validation.ok ? {} : validation.errors;
  const errorFor = (field: string) =>
    serverErrors[field] ?? (touched[field] ? liveErrors[field] : undefined);

  function setValue(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  // Cleared after a successful add so the next person starts from a blank form. Keyed on the
  // action result rather than tracked separately, which is what makes the running list in the
  // step above work without extra state.
  const key = state.ok ? 'clean' : 'errored';

  return (
    <form action={formAction} key={key} className="space-y-4">
      <FormBanner message={state.ok ? undefined : state.formError} />

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

      <SubmitButton label={submitLabel} disabled={!validation.ok} />
    </form>
  );
}
