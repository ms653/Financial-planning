'use client';

import { useCallback, useState } from 'react';
import type { ActionResult } from '@/lib/household/actions';

/**
 * Submit a form to a Server Action and keep its result.
 *
 * This generalises the pattern Phase 0 already established in
 * `src/app/login/PassphraseForm.tsx`, and for the same stated reason: `useFormState` and
 * `useFormStatus` "are not exported by react-dom 18.3.1 outside Next's bundled canary, and
 * relying on that would make the type check depend on which React the bundler resolves".
 * Phase 1 adds five more forms, so the pattern is worth having in one place rather than
 * hand-rolled five times.
 *
 * The practical consequence of the canary hooks, beyond the type check Phase 0 flagged, is that
 * a component calling them cannot render outside a Next server at all — every component test
 * dies on the first hook call. This phase adds real financial data entry, so forms that can't be
 * tested are the wrong trade.
 *
 * Submission therefore uses plain React 18 primitives: a submit handler that builds `FormData`
 * from the form element and calls the Server Action directly. Calling a Server Action as an
 * ordinary async function from a client component is a supported Next pattern — the network hop,
 * the POST, and the built-in Origin/Host CSRF check are all unchanged. Only *who* triggers it
 * differs.
 *
 * **The trade-off, stated plainly**: `<form action={serverAction}>` degrades to a real form POST
 * when JavaScript hasn't loaded, and this does not — these forms need JS. That is acceptable
 * here (the app is a single-household tool reached over a tailnet, which becomes an
 * offline-capable PWA in Phase 6 where JS is load-bearing regardless) but it is a genuine loss,
 * and worth revisiting if the project moves to a React whose *stable* release has form actions.
 */
export interface ActionFormState {
  /** The most recent result, or `{ ok: true }` before the first submit. */
  state: ActionResult;
  pending: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  /** Clear a previous error, e.g. when a drawer is reopened. */
  reset: () => void;
}

const INITIAL: ActionResult = { ok: true };

function isRedirect(error: unknown): boolean {
  // Next signals redirect()/notFound() from a Server Action with a `digest` marker. Swallowing
  // one would silently break navigation, so it is rethrown for the framework to handle.
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND');
}

export function useActionForm(
  action: (formData: FormData) => Promise<ActionResult>,
  options: { onSuccess?: () => void } = {},
): ActionFormState {
  const [state, setState] = useState<ActionResult>(INITIAL);
  const [pending, setPending] = useState(false);
  const { onSuccess } = options;

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);

      setPending(true);
      void (async () => {
        try {
          const result = await action(formData);
          setState(result);
          if (result.ok) onSuccess?.();
        } catch (error) {
          if (isRedirect(error)) throw error;
          // A thrown action is a bug or a dropped connection, not a validation failure. Logged
          // for diagnosis, shown as the generic banner — never as a technical string.
          console.error('[form] action threw', error);
          setState({ ok: false, errors: {}, formError: 'Couldn’t save this right now' });
        } finally {
          setPending(false);
        }
      })();
    },
    [action, onSuccess],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, pending, onSubmit, reset };
}

/** Field errors from the last submit, or an empty map. Saves an `ok` check at every call site. */
export function serverErrorsOf(state: ActionResult): Record<string, string> {
  return state.ok ? {} : state.errors;
}

export function formErrorOf(state: ActionResult): string | undefined {
  return state.ok ? undefined : state.formError;
}
