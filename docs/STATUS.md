# Project Status

Last updated: 2026-07-26 (Phase 1)

## Done

- **`docs/PROPOSAL.md`** — full research brief, features proposal, and implementation plan. Nine rounds of review (see Sections 6–13 for the changelog), including eight independent architecture-review passes covering UK tax/pension mechanics, mobile/offline architecture, and a full technical build-readiness review of Section 5.
- **`docs/DESIGN_SPEC.md`** — P1 interaction design spec (user flows, screen specs, states, components, copy, accessibility).
- **`docs/design-mockup.html`** — visual design direction ("ledger & brass" palette), demonstrates the stale/computing/offline state machine live.
- **Phase 0 implementation** — merged to `main`. Next.js 14 + TypeScript + Tailwind scaffold, Drizzle schema/migrations against Postgres, Docker Compose, GitHub Actions CI, `deploy.sh` runbook, passphrase auth (argon2id, signed sessions, brute-force lockout, CSRF), Tailscale Serve HTTPS, and backup tooling with an in-app staleness indicator. New docs: `docs/DEPLOYMENT.md`, `docs/RESTORE_TEST.md`.
- **Phase 0 code review** (independent model, real source pasted for review, ~84k tokens, 17 searches verifying load-bearing security claims) — see below. Fixes applied and merged.
- **Phase 1 implementation** — household/people/accounts data model and the manual net worth dashboard. Details below.

## Phase 1 — what shipped

Data model (`src/lib/db/schema.ts`, migration `drizzle/0001_household_people_accounts.sql`, generated not hand-written): `household`, `person`, `pension_contribution`, `account`, `holding`, `balance_snapshot`, `debt_terms`. All money `NUMERIC(14,2)`; nullable `account.person_id` with `household_id` as the fallback owner for joint accounts; ISA split into `cash_isa`/`ss_isa`/`lisa`; `ON DELETE RESTRICT` on every ownership edge; `balance_snapshot` carries both the `(account_id, captured_at DESC)` index and the unique `(account_id, snapshot_date)` constraint.

Screens: Guided Setup (`/setup`), Net Worth Dashboard (`/`), Accounts List (`/accounts`), Add/Edit Account (`/accounts/new`, `/accounts/[id]/edit`), Account Detail (`/accounts/[id]`), and a deliberately minimal `/settings` for people, income, pension contributions and backup status.

345 tests pass (Phase 0's 108 plus 237 new), including two `*.integration.test.ts` suites that run against a real Postgres — one asserting schema/migration properties the database alone can answer, one driving the Server Actions through the whole setup-to-dashboard journey. Both skip without `TEST_DATABASE_URL`; CI now runs a Postgres service and sets it.

### Judgment calls worth knowing about

- **Debt balances are stored negative; the form asks for a positive "amount outstanding".** Net worth is then a plain sum with no per-type sign rule for a future query to forget. The alternative — storing what the user typed — would let someone enter 376500 for a mortgage and see it as an asset.
- **`tax_wrapper` is derived from the account type, never entered.** The mapping is total and fixed, and the design spec's form lists no wrapper field. Asking would invite a Cash ISA tagged `none`, which would drop out of every wrapper-aware calculation from Phase 4.5 on.
- **`debt_terms.current_balance` is written by the same action that writes the (negative) snapshot**, so the two cannot drift.
- **The Add/Edit form has no balance field on edit.** That screen is scoped to static details; balances append a dated snapshot through "Update balance". Two ways to change one figure, one of which rewrites history, is what the append-only model exists to avoid.
- **Asset-class breakdown shows property gross with debt as its own negative class**, unlike the mockup's "Property equity" row (which nets the mortgage off *and* lists it separately, so its figures don't sum to its own hero total). Every breakdown now sums exactly to net worth, which is asserted.
- **`pension_contribution.amount` is annual**, matching `person.annual_gross_income`. The proposal says "per contribution: amount" without naming a period. No `frequency` column was invented.
- **`overpayment_allowance_balance_basis` is an enum** (`original_balance` | `current_balance` | `annual_opening_balance`) — the proposal names the column but not its values; these are what UK mortgage terms actually say, and Phase 4.5 has to branch on it.
- **Client forms use `src/lib/ui/useActionForm.ts`, not `useFormState`.** Same reason Phase 0's `PassphraseForm` avoided it: it isn't exported by the declared `react-dom@18.3.1`, only by Next's vendored canary. It also makes every form untestable outside a Next server. Trade-off: these forms need JavaScript, where `<form action={…}>` would have degraded to a plain POST.
- **Loading skeletons are `<Suspense>` boundaries inside the pages, not `loading.tsx` files.** A route-level loading file forces the whole route to stream, which downgrades `redirect('/setup')` and `notFound()` from real 307/404 responses to instructions only a JS-capable client can act on. Verified: first login with no household returns a genuine 307 from `/`, `/accounts` and `/settings`, and an unknown account id returns 404.

### Deliberately not built (and why)

- **No connectivity badge**, though the design spec puts one in the chrome of every screen: its Connected/Offline/Syncing states need the service worker and write queue from Phase 6 behind them. One reporting "Connected" unconditionally would look like a working indicator while saying nothing. The dashboard carries a real "balances last updated" line from the newest snapshot instead, escalating in weight as it ages.
- **No optimistic UI or write queue** on balance updates — Phase 6. A plain server round trip is correct now; a "pending sync" badge with no queue behind it would be theatre.
- **No current-value or gain/loss columns on holdings.** There is no price source until Phase 2, whose provider choice carries a blocking GBX-vs-GBP verification task. Empty columns headed "Current value" would imply knowledge the app doesn't have.
- Portfolio, Retirement Planner, Stocks, Advisor and Reports remain unbuilt; the sidebar reserves their slots and names the phase, per the spec's "reserved but greyed out".

### Not verified in this pass

- Docker Compose and Tailscale Serve, same as Phase 0.

### Playwright E2E: now executed, and it found a real bug

`e2e/setup-and-dashboard.spec.ts` had never been run when Phase 1 was written (`cdn.playwright.dev` was blocked, so no browser could be downloaded). It has since been run against a real Postgres and a real Chromium: **5 of its 6 tests failed on first execution**, and the cause was a genuine defect in Guided Setup that nothing else in the suite could see.

**The bug: Guided Setup advanced its own steps on the user's behalf.** The step was chosen as "the furthest step the data allows". But both the people step and the accounts step are steps a household stays on while adding several things, and every write in setup is followed by `revalidatePath('/setup')` — so:

- adding the first person made `personCount > 0` and re-rendered the page onto the account-type picker. A second household member could not be added at all, and the step's own "Next: add an account" link was unreachable dead code.
- adding the first account made `getSetupState().complete` true, which redirected `/setup` to the dashboard — so the running list, "+ Add another" and "Finish setup" (steps 5 and 6 of the spec's flow) could never be reached.

Neither is visible to the server-side integration test, which calls the actions in sequence and asserts on rows: the rows were always correct. The defect was entirely in which step the page then renders — which is exactly the half only a browser can see, and exactly why the note this replaces mattered. Fixed by separating the two notions the original conflated — the data *caps* which step you may be on, the user decides when to leave one — in `src/lib/household/setupStep.ts`, now pure and unit-tested so this class of bug stops being browser-only.

Two of the spec's own locators were also wrong, and worth knowing when writing more: Playwright matches an accessible name as a case-insensitive **substring** by default, so `getByLabel('Name')` also matched "Household name" and "Account name" (it typed into whichever form was mounted, which mid-transition was the wrong one), and `getByRole('button', { name: 'Cash' })` was ambiguous between the "Cash" and "Cash ISA" type tiles. Both now pass `exact: true`.

All 6 tests now pass, verified over two consecutive full runs plus a `--repeat-each=3` run (18/18) to rule out the flakiness the first failures suggested. Still unexercised: any browser other than Chromium, and any mobile viewport.

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
2. ~~Run the Playwright E2E once.~~ Done — see "Playwright E2E" above. It found and fixed a real Guided Setup defect. Worth adding to CI now that it is known to pass; it needs a scratch Postgres and `npx playwright install chromium` on the runner.
3. Phase 2 per the Phased Delivery table: portfolio tracking plus a market-data provider, starting with the **blocking verification task** — confirm the provider returns the LSE GBP line rather than a USD cross-listing, and confirm whether it labels prices in pence (GBX) or pounds. The proposal names this the single most likely correctness bug in that phase.
4. Continue in phase order through Phase 8 as specified in `docs/PROPOSAL.md`.

## Notes for Phase 2

- `src/lib/auth/csrf.ts` (`sameOriginGuard`) is still implemented, tested and unused — Phase 1 added no route handlers, only Server Actions (which carry Next's own Origin/Host check). The first mutating route handler must call it; that protection does not extend to route handlers.
- `holding` has no price, valuation or last-fetched column yet, by design — Phase 2 chooses the provider and therefore the cache shape. `account.currency` and `balance_snapshot.currency` already exist for the GBX/GBP and USD-holdings cases to live in.
- **Money never touches a float.** `src/lib/money.ts` parses to integer pence as `bigint` and back to NUMERIC strings; `numeric` columns come out of node-postgres as strings and stay that way. A `numericToPence`/`formatMoney` pair exists for every display path — new code should go through it rather than `Number(row.amount)`.
- **Watch out for `db.execute` with raw SQL**: unlike a typed `select()`, it returns the driver's raw values, so a `timestamptz` arrives as a *string*, not a `Date`. That mismatch typechecked happily and threw at render time during Phase 1 (`capturedAt.getTime is not a function`). `getAccountsWithBalances` converts explicitly and a regression test asserts it.
- Both `*.integration.test.ts` suites share one scratch database and drop its schema, so `fileParallelism` is off in `vitest.config.ts`. A new DB-backed test file can rely on that.
