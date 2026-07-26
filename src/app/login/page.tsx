import type { Metadata } from 'next';
import { PassphraseForm } from './PassphraseForm';

export const metadata: Metadata = {
  title: 'Unlock — Household Finance',
};

/**
 * Screen: Passphrase Gate (DESIGN_SPEC.md, route `/login`).
 *
 * Visual language nods to docs/design-mockup.html: ink panel, stone-paper card, brass
 * mark, serif for the one large piece of type. Full styling is Phase 7 — this is
 * deliberately restrained.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brass to-brass-strong font-serif text-base font-bold text-ink-950"
          >
            £
          </span>
          <span className="text-sm font-medium uppercase tracking-[0.14em] text-content-muted">
            Household Finance
          </span>
        </div>

        <div className="rounded-card border border-line bg-paper-raised p-6 shadow-card">
          <h1 className="font-serif text-2xl text-content">Locked</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-content-muted">
            Enter the household passphrase to see your accounts.
          </p>

          <div className="mt-6">
            <PassphraseForm next={searchParams.next} />
          </div>
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-content-faint">
          This app is reachable only from your own devices over Tailscale. Nothing here
          is exposed to the public internet.
        </p>
      </div>
    </main>
  );
}
