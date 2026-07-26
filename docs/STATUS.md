# Project Status

Last updated: 2026-07-26

## Done

- **`docs/PROPOSAL.md`** — full research brief, features proposal, and implementation plan. Nine rounds of review (see Sections 6–13 for the changelog), including eight independent architecture-review passes covering UK tax/pension mechanics, mobile/offline architecture, and a full technical build-readiness review of Section 5.
- **`docs/DESIGN_SPEC.md`** — P1 interaction design spec (user flows, screen specs, states, components, copy, accessibility).
- **`docs/design-mockup.html`** — visual design direction ("ledger & brass" palette), demonstrates the stale/computing/offline state machine live.
- **Phase 0 implementation** — merged to `main`. Next.js 14 + TypeScript + Tailwind scaffold, Drizzle schema/migrations against Postgres, Docker Compose, GitHub Actions CI, `deploy.sh` runbook, passphrase auth (argon2id, signed sessions, brute-force lockout, CSRF), Tailscale Serve HTTPS, and backup tooling with an in-app staleness indicator. New docs: `docs/DEPLOYMENT.md`, `docs/RESTORE_TEST.md`.
- **Phase 0 code review** (independent model, real source pasted for review, ~84k tokens, 17 searches verifying load-bearing security claims) — see below. Fixes applied and merged.

## Phase 0 code review — findings and fixes

Verdict was "conditionally safe": the hand-written crypto/auth logic (session token signing, passphrase verification, lockout, redirect sanitisation) held up under an independent pass — no forgery, expiry bypass, or open redirect could be constructed against it. Real infrastructure bugs were found and are now fixed:

- **`deploy.sh` could silently skip new migrations on the second and subsequent deploys.** `docker compose build` doesn't build services outside the active profile set, and `migrate` is profiled (`tools`) — so `docker compose run --rm migrate` would reuse a stale cached image with an old `drizzle/` directory, report nothing pending, exit 0, and the deploy would "succeed" against an un-migrated schema. Fixed: `docker compose run --build --rm migrate` forces a fresh image every time.
- **Login had a brute-force-lockout race.** The lockout counter was only incremented *after* the ~100ms argon2id verify completed, so concurrent requests could all pass the `status()` check before any of them recorded a failure — an attacker firing parallel guesses got more than 5 before the limiter caught up, with each in-flight verify also costing ~19 MiB (a cheap memory-amplification DoS vector). Fixed: the attempt is now reserved (counted) synchronously *before* verification, and released via `recordSuccess()` if the passphrase turns out correct or the hash turns out misconfigured.
- **Middleware login redirects could target `localhost` instead of the tailnet hostname**, depending on whether `tailscale serve` preserves or rewrites the Host header when proxying — unverified either way without a real tailnet, and wrong in one direction would make the app unreachable from any device but the host. Fixed: redirects now prefer `X-Forwarded-Proto`/`X-Forwarded-Host` (already established as trustworthy in this deployment by `src/lib/auth/csrf.ts`'s reasoning) over the raw request Host, falling back to it only when those headers are absent (plain local dev).
- **Node base image pinned to a floating tag with no floor.** `crypto.subtle.verify`'s constant-time guarantee (which the session token's forgery resistance depends on) was not constant-time in Node's WebCrypto HMAC implementation until 22.22.2 (CVE-2026-21713, fixed March 2026). A build today should already pull a patched version via the floating `node:22-bookworm-slim` tag, but nothing caught a stale cache. Fixed: the Dockerfile now asserts the Node version at build time and fails loudly below 22.22.2, rather than trusting the tag silently.
- **No documented incident response for a lost/stolen device.** Sessions are stateless — logout only clears the local cookie, and a copied token stays valid up to 30 days. Documented in `docs/DEPLOYMENT.md` §5: rotate `SESSION_SECRET` immediately, which invalidates every session on every device.

Two findings from the review turned out to be artifacts of condensing the code for the review prompt, not real bugs — worth noting so they aren't "fixed" again: `docker-compose.yml`'s `db` service does correctly set `POSTGRES_USER`/`POSTGRES_DB` (the review's pasted excerpt had dropped those lines), and the `Dockerfile` does have `WORKDIR /app` (same issue). Verified against the actual files before concluding either was real.

**Verified independently and confirmed accurate**, not just asserted in code comments: Next.js 14 Server Actions' built-in Origin/Host CSRF check is real and works as described (this repo's pinned `next@14.2.35` already postdates the CVE-2025-29927 middleware-bypass fix at 14.2.25); `@node-rs/argon2` genuinely ships prebuilt glibc binaries needing no compiler, justifying the no-bcrypt-fallback decision; the argon2id parameters (m=19456, t=2, p=1) are exactly OWASP's second recommended configuration; `crypto.subtle.verify` is constant-time by spec and (as of the Node version now asserted at build time) in practice.

**Not verified in this pass either** (still no real Docker registry access or tailnet in the sandbox): a live `docker compose up`, and Tailscale Serve itself, including the specific Host-header behavior the middleware fix above is defensive against. Worth a manual second-device login test on first real deploy.

## Next steps

1. On the deploy machine: run through `docs/DEPLOYMENT.md` §1–2 (env, `docker compose up`, `tailscale serve`), then §4 (backup key, remote, cron). Confirm the in-app indicator goes from "No backup yet" to "Backup healthy". **Also do the second-device login test** — open the app from a phone on the tailnet and confirm the redirect to `/login` lands on the tailnet hostname, not `localhost`.
2. Phase 1 per the Phased Delivery table: household/people/accounts data model (`date_of_birth`, nullable `person_id` with household fallback for joint accounts, Cash ISA/S&S ISA/LISA as distinct sub-types, `NUMERIC` money, currency column), manual net worth dashboard.
3. Continue in phase order through Phase 8 as specified in `docs/PROPOSAL.md`.

## Notes for Phase 1

- Schema is deliberately one table (`backup_run`) — the reasoning is in `src/lib/db/schema.ts`. Phase 1 adds the household model there and runs `npm run db:generate`; CI fails if a schema change lands without a committed migration.
- `src/lib/auth/csrf.ts` (`sameOriginGuard`) is implemented and tested but unused — Phase 0 has no mutating route handlers. The first one (Phase 3's simulation-run endpoints) must call it; Server Action CSRF protection does not extend to route handlers.
- `scripts/restore-test.sh` carries a `TODO(phase-1)` for asserting account/balance row counts once those tables exist.
