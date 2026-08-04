'use client';

import { useState } from 'react';
import { validateEmergencyFundTarget } from '@/lib/accounts/validation';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass';

/**
 * The household's emergency-fund target — Phase 4.5's Cash Allocation Advisor,
 * waterfall step 1. Deliberately as plain as `PersonPanel`'s pension fields: a direct
 * £ target, not a derived "N months of expenses" formula (see the plan this shipped
 * against), and no consumer beyond the advisor's own engine yet.
 */
export function EmergencyFundForm({
  currentTarget,
  updateAction,
}: {
  /** NUMERIC string, or null when not set. */
  currentTarget: string | null;
  updateAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [value, setValue] = useState(currentTarget ?? '');
  const { state, pending, onSubmit } = useActionForm(updateAction);
  const validation = validateEmergencyFundTarget({ emergencyFundTarget: value });
  const errors = serverErrorsOf(state);

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex-1">
        <label htmlFor="emergencyFundTarget" className="block text-xs font-medium text-content">
          Target balance
        </label>
        <input
          id="emergencyFundTarget"
          name="emergencyFundTarget"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Not set"
          className={`${inputClass} tabular mt-1.5`}
        />
        {errors.emergencyFundTarget ? (
          <p role="alert" className="mt-1 text-xs text-clay">
            {errors.emergencyFundTarget}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={!validation.ok || pending}
        className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition enabled:hover:border-brass enabled:hover:text-content disabled:cursor-not-allowed disabled:opacity-45"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      {formErrorOf(state) ? (
        <p role="alert" className="w-full text-xs text-clay">
          {formErrorOf(state)}
        </p>
      ) : null}
    </form>
  );
}
