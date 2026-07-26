import type { Config } from 'tailwindcss';

/**
 * Tokens mirror docs/design-mockup.html ("ledger & brass"). The full visual pass is
 * Phase 7 — this exists so Phase 0's two rendered screens don't default to generic
 * Tailwind blue/gray and then have to be unpicked later.
 *
 * Colours are wired to the CSS custom properties defined in src/app/globals.css so
 * the light/dark switch lives in one place.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: 'var(--ink-950)',
          800: 'var(--ink-800)',
          700: 'var(--ink-700)',
        },
        paper: {
          DEFAULT: 'var(--paper)',
          raised: 'var(--paper-raised)',
          sunken: 'var(--paper-sunken)',
        },
        brass: {
          DEFAULT: 'var(--brass)',
          strong: 'var(--brass-strong)',
        },
        sage: {
          DEFAULT: 'var(--sage)',
          bg: 'var(--sage-bg)',
        },
        clay: {
          DEFAULT: 'var(--clay)',
          bg: 'var(--clay-bg)',
        },
        content: {
          DEFAULT: 'var(--text-on-paper)',
          muted: 'var(--text-muted)',
          faint: 'var(--text-faint)',
          ink: 'var(--text-on-ink)',
          'ink-muted': 'var(--text-on-ink-muted)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
      },
      fontFamily: {
        serif: ['var(--serif)'],
        sans: ['var(--sans)'],
      },
      borderRadius: {
        card: '14px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
    },
  },
  plugins: [],
};

export default config;
