'use client';

import { useRef, useState, useTransition } from 'react';
import { login, type LoginResult } from './actions';

/**
 * The Passphrase Gate's interactive half.
 *
 * DESIGN_SPEC.md lists this screen in the Screen Inventory without a full spec, so it
 * follows the conventions the rest of that document establishes: real named states
 * (default / loading / error), inline error text rather than a browser `alert()`, copy
 * that says what happened without technical detail, and no data lost on failure.
 *
 * State transitions:
 *  - default   — empty field, submit enabled.
 *  - loading   — field and submit disabled while argon2id verification runs (~50-100ms,
 *                but deliberately shown, since on a phone over Tailscale it can be
 *                noticeably longer).
 *  - error     — wrong passphrase, lockout, or a configuration problem. The field keeps
 *                focus and is re-selected so a retype doesn't need a manual clear.
 *
 * `useState` + `useTransition` rather than `useFormState`: the latter is not exported
 * by react-dom 18.3.1 outside Next's bundled canary, and relying on that would make
 * the type check depend on which React the bundler resolves.
 */
export function PassphraseForm({ next }: { next: string | undefined }) {
  const [result, setResult] = useState<LoginResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      // On success `login` redirects, so nothing after this resolves.
      const outcome = await login(formData);
      setResult(outcome);
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  const isLocked = result?.kind === 'locked';
  const disabled = isPending || isLocked;

  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="next" value={next ?? ''} />

      <label
        htmlFor="passphrase"
        className="block text-sm font-medium text-content-muted"
      >
        Passphrase
      </label>

      <input
        ref={inputRef}
        id="passphrase"
        name="passphrase"
        type="password"
        autoComplete="current-password"
        autoFocus
        disabled={disabled}
        aria-invalid={result ? true : undefined}
        aria-describedby={result ? 'passphrase-error' : 'passphrase-hint'}
        className="mt-2 w-full rounded-lg border border-line-strong bg-paper-raised px-3 py-2.5 text-base text-content shadow-sm outline-none transition focus:border-brass disabled:opacity-60"
      />

      {result ? (
        <p
          id="passphrase-error"
          role="alert"
          aria-live="polite"
          className="mt-3 rounded-lg border border-clay/40 bg-clay-bg px-3 py-2 text-sm text-clay"
        >
          {result.message}
        </p>
      ) : (
        <p id="passphrase-hint" className="mt-3 text-sm text-content-faint">
          One shared passphrase for the household.
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="mt-5 w-full rounded-lg bg-ink-950 px-4 py-2.5 text-sm font-semibold tracking-wide text-content-ink transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Checking…' : 'Unlock'}
      </button>

      {/* Live region so a screen reader announces the loading state, not just the result. */}
      <span aria-live="polite" className="sr-only">
        {isPending ? 'Checking your passphrase' : ''}
      </span>
    </form>
  );
}
