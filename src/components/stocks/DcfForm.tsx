'use client';

import { useMemo, useState } from 'react';
import type { ActionResult } from '@/lib/household/actions';
import { DcfInputsParseError, parseDcfInputs, type DcfInputsV1 } from '@/lib/stocks/dcf';
import { formErrorOf, useActionForm } from '@/lib/ui/useActionForm';

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass tabular';

/** Form values are plain strings throughout (including `projectionYears`) — the same
 * "state holds what the user typed, parsing happens at validation time" convention
 * `ScenarioEditorForm.tsx` uses, so a field mid-edit (e.g. temporarily empty) doesn't
 * force a fallback number into view. */
interface DcfFormValues {
  growthRatePct: string;
  discountRatePct: string;
  terminalGrowthRatePct: string;
  projectionYears: string;
}

function toFormValues(inputs: DcfInputsV1): DcfFormValues {
  return {
    growthRatePct: inputs.growthRatePct,
    discountRatePct: inputs.discountRatePct,
    terminalGrowthRatePct: inputs.terminalGrowthRatePct,
    projectionYears: String(inputs.projectionYears),
  };
}

/**
 * DCF assumptions form. Only four fields, unlike the retirement Scenario Editor's much
 * larger surface — a single form-level error banner (not a per-field validator module)
 * is proportionate here, the same scope call `retirement/actions.ts`'s own doc comment
 * made before Milestone 9 built a dedicated field-level validator for its own,
 * considerably larger form: "rather than invent a FieldErrors-keyed validator ahead of
 * a form that doesn't exist." Live-validates by calling the real `parseDcfInputs`
 * directly — the same "one set of rules, not two" reasoning every other form in this
 * codebase already follows — rather than duplicating its checks.
 */
/** A small "Suggested: X% (basis) · Use" hint, shown only when a suggestion actually
 * exists — never implies a number was computed when it wasn't. `onUse` just fills the
 * field; the household still has to hit "Save assumptions" for it to persist, same as
 * typing the value themselves. */
function SuggestionHint({ value, basis, onUse }: { value: string | null; basis: string; onUse: (value: string) => void }) {
  if (value === null) return null;
  return (
    <p className="mt-1 text-xs text-content-faint">
      Suggested: {value}% ({basis}){' '}
      <button
        type="button"
        onClick={() => onUse(value)}
        className="underline underline-offset-2 hover:text-content"
      >
        Use
      </button>
    </p>
  );
}

export function DcfForm({
  ticker,
  initialInputs,
  action,
  suggestions,
}: {
  ticker: string;
  initialInputs: DcfInputsV1;
  action: (formData: FormData) => Promise<ActionResult>;
  /** Data-driven suggestions for growth/discount rate, computed from the ticker's
   * fetched fundamentals — see `dcf.ts`'s `suggestGrowthRatePct`/
   * `suggestDiscountRatePct`. `null` per-field when no suggestion is computable.
   * Absent entirely (not just `null`) renders no hints at all — used by nothing
   * today, but keeps this component usable without fundamentals wired up. */
  suggestions?: { growthRatePct: string | null; discountRatePct: string | null };
}) {
  const [values, setValues] = useState<DcfFormValues>(() => toFormValues(initialInputs));
  const { state, pending, onSubmit } = useActionForm(action);

  const validation = useMemo(() => {
    const candidate = {
      schemaVersion: 1 as const,
      growthRatePct: values.growthRatePct,
      discountRatePct: values.discountRatePct,
      terminalGrowthRatePct: values.terminalGrowthRatePct,
      projectionYears: Number(values.projectionYears),
    };
    try {
      return { ok: true as const, value: parseDcfInputs(candidate) };
    } catch (error) {
      const message = error instanceof DcfInputsParseError ? error.message : 'Check these values';
      return { ok: false as const, message };
    }
  }, [values]);

  function field(key: keyof DcfFormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="ticker" value={ticker} />
      <input type="hidden" name="inputs" value={validation.ok ? JSON.stringify(validation.value) : ''} />

      {formErrorOf(state) ? (
        <p role="alert" className="text-sm text-clay">
          {formErrorOf(state)}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dcf-growth" className="block text-sm font-medium text-content">
            FCF growth rate
          </label>
          <p className="mt-0.5 text-xs text-content-faint">Annual, %, during the projection years</p>
          <input
            id="dcf-growth"
            inputMode="decimal"
            value={values.growthRatePct}
            onChange={(event) => field('growthRatePct', event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
          <SuggestionHint
            value={suggestions?.growthRatePct ?? null}
            basis="5yr FCF history"
            onUse={(value) => field('growthRatePct', value)}
          />
        </div>
        <div>
          <label htmlFor="dcf-discount" className="block text-sm font-medium text-content">
            Discount rate
          </label>
          <p className="mt-0.5 text-xs text-content-faint">Required rate of return, %</p>
          <input
            id="dcf-discount"
            inputMode="decimal"
            value={values.discountRatePct}
            onChange={(event) => field('discountRatePct', event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
          <SuggestionHint
            value={suggestions?.discountRatePct ?? null}
            basis="CAPM, using beta"
            onUse={(value) => field('discountRatePct', value)}
          />
        </div>
        <div>
          <label htmlFor="dcf-terminal-growth" className="block text-sm font-medium text-content">
            Terminal growth rate
          </label>
          <p className="mt-0.5 text-xs text-content-faint">Perpetuity growth, %, after the projection years</p>
          <input
            id="dcf-terminal-growth"
            inputMode="decimal"
            value={values.terminalGrowthRatePct}
            onChange={(event) => field('terminalGrowthRatePct', event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="dcf-years" className="block text-sm font-medium text-content">
            Projection years
          </label>
          <p className="mt-0.5 text-xs text-content-faint">1–20</p>
          <input
            id="dcf-years"
            inputMode="numeric"
            value={values.projectionYears}
            onChange={(event) => field('projectionYears', event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>

      {!validation.ok ? <p className="text-xs text-clay">{validation.message}</p> : null}

      <button
        type="submit"
        disabled={!validation.ok || pending}
        className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition enabled:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-brass dark:text-ink-950"
      >
        {pending ? 'Saving…' : 'Save assumptions'}
      </button>
    </form>
  );
}
