# Project Status

Last updated: 2026-07-26

## Done

- **`docs/PROPOSAL.md`** — full research brief, features proposal, and implementation plan. Nine rounds of review (see Sections 6–13 for the changelog), including eight independent architecture-review passes covering UK tax/pension mechanics, mobile/offline architecture, and a full technical build-readiness review of Section 5.
- **`docs/DESIGN_SPEC.md`** — P1 interaction design spec (user flows, screen specs, states, components, copy, accessibility).
- **`docs/design-mockup.html`** — visual design direction ("ledger & brass" palette), demonstrates the stale/computing/offline state machine live.
- **Phase 0 implementation** — on branch `phase-0`, six commits, **not yet merged to `main`**. See below.

## Phase 0 — awaiting review on branch `phase-0`

Built to PROPOSAL.md's Phase 0 row: Next.js 14 + TypeScript + Tailwind at the repo root, Drizzle schema and migrations against Postgres, Docker Compose (Postgres + app + one-shot migrator), GitHub Actions CI (lint / `tsc --noEmit` / `vitest run` / migration-drift check), `deploy.sh` runbook, passphrase auth per the full Security notes spec, Tailscale Serve HTTPS documented, and backup tooling with an in-app staleness indicator.

New docs: **`docs/DEPLOYMENT.md`** (setup, Tailscale HTTPS, deploys, backups) and **`docs/RESTORE_TEST.md`** (quarterly restore test).

**Review focus — this branch contains auth code:**
- `src/lib/auth/session.ts` — hand-rolled HMAC session token (chosen over iron-session because it must verify in the edge-runtime middleware, so it uses Web Crypto only). The signature is verified before the payload is parsed.
- `src/lib/auth/passphrase.ts` — argon2id; deliberately no bcrypt fallback branch, with the reasoning in a comment.
- `src/lib/auth/lockout.ts` — global rather than per-IP keying, deliberately.
- `src/middleware.ts` — the gate itself, including the rolling-refresh re-issue.

Verified working against a real Postgres 16 and a real running server: migrations apply, login/logout, session issue/verify/expiry/tamper-rejection, rolling refresh, 5-failure lockout and its 60s expiry, open-redirect rejection, cross-origin Server Action rejection, all four backup-indicator states, and the full `pg_dump → age → decrypt → restore` chain.

**Not verified in the sandbox** (no Docker registry access there, no tailnet): `docker compose build`/`up`, and Tailscale Serve itself. `docker compose config` validates. The scripts are shell-syntax-checked but `deploy.sh`, `scripts/backup.sh`, and `scripts/restore-test.sh` have not been run against real containers — worth a careful first run.

**One decision to confirm:** Next 14.2.35 (latest 14.x) carries open advisories fixable only by a major bump, which PROPOSAL.md explicitly rules out as chasing currency. Most don't apply to this app (no public exposure, no i18n Pages Router, no custom server). Worth a conscious accept.

## Next steps

1. Review the `phase-0` branch diff — auth code especially — then merge to `main` and push.
2. On the deploy machine: run through `docs/DEPLOYMENT.md` §1–2 (env, `docker compose up`, `tailscale serve`), then §4 to set up the backup key, remote, and cron entry. Confirm the in-app indicator goes from "No backup yet" to "Backup healthy".
3. Phase 1 per the Phased Delivery table: household/people/accounts data model (`date_of_birth`, nullable `person_id` with household fallback for joint accounts, Cash ISA/S&S ISA/LISA as distinct sub-types, `NUMERIC` money, currency column), manual net worth dashboard.
4. Continue in phase order through Phase 8 as specified in `docs/PROPOSAL.md`.

## Notes for Phase 1

- Schema is deliberately one table (`backup_run`) — the reasoning is in `src/lib/db/schema.ts`. Phase 1 adds the household model there and runs `npm run db:generate`; CI fails if a schema change lands without a committed migration.
- `src/lib/auth/csrf.ts` (`sameOriginGuard`) is implemented and tested but unused — Phase 0 has no mutating route handlers. The first one (Phase 3's simulation-run endpoints) must call it; Server Action CSRF protection does not extend to route handlers.
- `scripts/restore-test.sh` carries a `TODO(phase-1)` for asserting account/balance row counts once those tables exist.
