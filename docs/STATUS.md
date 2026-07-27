# Project Status

Last updated: 2026-07-27 (Phase 2 implemented, browser-verified, independently
code-reviewed, and deployed to the household's real stack; three post-deployment
additions since — holdings editing, holdings totals, and balance-history editing — see
the "Since Phase 2 deployment" sections below)

## Done

- **`docs/PROPOSAL.md`** — full research brief, features proposal, and implementation plan. Nine rounds of review (see Sections 6–13 for the changelog), including eight independent architecture-review passes covering UK tax/pension mechanics, mobile/offline architecture, and a full technical build-readiness review of Section 5.
- **`docs/DESIGN_SPEC.md`** — P1 interaction design spec (user flows, screen specs, states, components, copy, accessibility).
- **`docs/design-mockup.html`** — visual design direction ("ledger & brass" palette), demonstrates the stale/computing/offline state machine live.
- **Phase 0 implementation** — merged to `main`. Next.js 14 + TypeScript + Tailwind scaffold, Drizzle schema/migrations against Postgres, Docker Compose, GitHub Actions CI, `deploy.sh` runbook, passphrase auth (argon2id, signed sessions, brute-force lockout, CSRF), Tailscale Serve HTTPS, and backup tooling with an in-app staleness indicator. New docs: `docs/DEPLOYMENT.md`, `docs/RESTORE_TEST.md`.
- **Phase 0 code review** (independent model, real source pasted for review, ~84k tokens, 17 searches verifying load-bearing security claims) — see below. Fixes applied and merged.
- **Phase 1 implementation** — household/people/accounts data model and the manual net worth dashboard. Details below.
- **Phase 1 code review** (two independent passes — see below) — fixes applied and merged.
- **Phase 2 implementation** — portfolio tracking and live market-data pricing (Alpha Vantage). Details below. Deployed to the household's real stack via `./deploy.sh` 2026-07-27 — live now, not just merged.
- **Phase 2 code review** (two independent passes, run in parallel, no access to each other's findings or to this document's own Phase 2 claims — see below) — one genuine high-severity bug (an uncaught exception could crash the page) and two medium ones fixed; test count now 409 (up from 358 at the end of Phase 1), all passing against a real Postgres, plus the full Playwright E2E suite (9/9) and a full browser walkthrough of both the priced and unpriced paths including a real Alpha Vantage call.

## Phase 2 — what shipped

Blocking verification task (per `docs/PROPOSAL.md`'s Phase 2 row) resolved first, before any schema or UI work depended on the answer: **Alpha Vantage returns LSE (`.LON`) quotes in pounds (GBP), not pence (GBX)** — confirmed 2026-07-27 via `scripts/verify-quote-provider.ts` against the household's real holdings, `VUAG.LON` (107.76) and `VHYG.LON` (79.52) against real-world prices of £107.84 and £79.52 (Yahoo Finance / Hargreaves Lansdown, 24 Jul 2026) — an exact match. No normalization is applied; see `LSE_QUOTES_ARE_GBX` in `src/lib/portfolio/quotes.ts`. The provider itself changed from what the proposal assumed: EODHD and Twelve Data's free tiers turned out to be US-only (LSE coverage needs a paid plan, $19.99–$79/mo); **Alpha Vantage** is genuinely free and documents LSE tickers via a `.LON` suffix, which its ~25 req/day limit comfortably covers for a household with a handful of tickers refreshed at most daily.

New: `quote_cache` table (migration `drizzle/0003_third_hydra.sql`), the provider boundary and refresh/staleness logic (`src/lib/portfolio/quotes.ts`), bigint fixed-point valuation math (`src/lib/portfolio/valuation.ts`), current-value/gain-loss columns on the Account Detail holdings table, and a new `/portfolio` screen (household-wide, ticker-aggregated holdings table with an expand-in-place account breakdown, and a by-ticker allocation panel) — Portfolio's sidebar slot is unreserved.

**A pre-existing local-dev footgun, found (not introduced) while browser-verifying this phase**: running `npm run dev` or `npm run test:e2e` directly against a `.env.local` — rather than via `docker compose`, which passes `.env` straight through as container env vars — sends every value through Next's `@next/env`/`dotenv-expand`, which treats a bare `$word` as a variable reference and silently strips it, even inside single quotes. `APP_PASSPHRASE_HASH` is exactly this shape (`$argon2id$v=19$...`), so local non-Docker dev has apparently always been one `npm run dev` away from a baffling "not a valid argon2id hash" error with no clue that `$` was the cause. Not a Phase 2 regression — this would have bitten Phase 0/1 local dev identically — just not previously hit or documented. Now documented in `.env.example` (the fix: escape every `$` as `\$` in `.env.local` specifically) rather than fixed in code, since it's Next's own env-loading behaviour, not this app's.

### Judgment calls worth knowing about

- **`quote_cache` is a mutable single-row-per-symbol cache, not append-only history** — the opposite shape from `balance_snapshot`, deliberately: a quote is re-fetchable market data with no household-authored history to protect, unlike a balance the household typed in. Keyed by provider symbol (not `holding_id`), so a ticker held in two accounts shares one row and one API call.
- **`resolveProviderSymbol` maps a GBP-currency account's ticker to `{ticker}.LON`, and any other currency to the bare ticker, assumed US-listed.** This also means a quote's currency always equals the holding's account currency by construction — there is no FX conversion anywhere in Phase 2. Documented limitation: an LSE-listed non-GBP security, or a genuinely non-US/non-UK holding, resolves to a wrong or empty lookup; the provider boundary returns a typed "not found" rather than a fabricated price, so this degrades to "Price unavailable," never a wrong number.
- **A confirmed "no quote for this symbol" (e.g. an OEIC/unit trust, priced by NAV with no exchange ticker — the household's own third holding is exactly this) is cached as `price: null`, not left unrecorded.** Otherwise a symbol that will never resolve would get re-fetched on every single page load within the staleness window, wasting a meaningful fraction of the free-tier daily budget on a lookup guaranteed to fail. It's still rechecked once the staleness window passes, in case the provider adds coverage later.
- **The Portfolio page's allocation breakdown is by ticker, not by asset class (equities/bonds/cash), despite that being DESIGN_SPEC.md's stated example.** Account-level asset class (`src/lib/accounts/types.ts`) collapses every securities-holding account type into just `investments`/`pensions` — too coarse to be informative within a portfolio view on its own, and a true equities/bonds/cash split needs either fundamentals data (Phase 4's stock-workbench remit) or a new manual per-holding classification field, neither of which exists yet. By-ticker needed no new data and is what the same screen's holdings table already wants.
- **Benchmark comparison ("+3.2% vs FTSE All-World") is not built.** `holding.costBasis` carries no acquisition date, so a true time-weighted return vs. an index isn't computable from the current schema. What **is** built — gain/loss vs. cost basis — is a different, narrower number and is labelled as such throughout, never presented as benchmark-relative performance.
- **Quote price is `NUMERIC(14,4)`, not the `money()` helper's 2dp `NUMERIC(14,2)`.** It's multiplied against `holding.quantity`'s `NUMERIC(18,6)` in `src/lib/portfolio/valuation.ts`; rounding a price to the penny before that multiplication would compound error on fractional-share holdings — the same reasoning already applied to why quantity itself isn't 2dp. Valuation math is bigint fixed-point throughout (`parseScaledDecimal`/`formatScaledDecimal`), never a float.
- **Live pricing degrades gracefully with zero provider connected** — `alphaVantageApiKey()` is nullable, unlike every other required-env-var getter in `src/lib/env.ts`, and both the Account Detail and Portfolio pages render fully (with "Price unavailable" in place of figures) when it's unset. Verified in a real browser: the account-detail and portfolio screens render correctly and identically-structured with the key unset (all holdings show "Price unavailable," £0 total, "No market-data provider configured") and with a real key (live £107.76 VUAG price, correct valuation and gain/loss math, correct allocation percentages).

### Deliberately not built (and why)

- **No benchmark-relative performance** — see judgment calls above; the data model doesn't support it honestly yet.
- **No true asset-class (equities/bonds/cash) allocation breakdown** — same reasoning; by-ticker is what's honestly buildable today.
- **No FX conversion.** A holding priced in a non-GBP currency is excluded from the Portfolio page's GBP total/allocation and flagged with its own currency on expand, rather than silently mixed into a GBP-labelled sum. None of the household's actual holdings hit this today.
- **No manual price entry fallback** for holdings the provider can't price (the household's OEIC). Considered and deliberately deferred — "Price unavailable" ships today with no added scope; manual entry remains an easy addition later if wanted.
- **Holdings and account balance don't sync** — flagged by the household after this phase shipped, confirmed against `addHolding` (`src/lib/household/actions.ts`): it only writes to the `holding` table, never to `balance_snapshot`, which is the only thing that moves an account's balance and the net worth total. So an S&S ISA's stored balance and the live value of its holdings can silently drift apart — add a holding worth £5,388 and the account still shows whatever it last did until "Update balance" is used separately. **Wanted, not yet scoped.** A real fix here isn't just "write the balance automatically on every holding change" — that would need deciding whether a holdings-derived balance ever gets a `balance_snapshot` of its own (and if so, whether that conflicts with the "one balance, one source of truth per day" append-only model this whole area is built around, per the `debt_terms`/`current_balance` precedent in Phase 1 and DESIGN_SPEC.md's "Update balance" flow), or whether it's a one-tap "sync balance to current holdings value" action the household triggers deliberately rather than an automatic write on every holding edit. Needs a design decision before implementation, not just a schema change.

### Not verified in this pass

- ~~Docker Compose deployment of this specific change~~ Done — `./deploy.sh` run against the real household stack 2026-07-27: pre-migration dump taken (`backups/pre-migration/pre-migration-20260727T175901Z.sql`), migration `0003` applied cleanly to the live database, `quote_cache` confirmed present via `\d quote_cache`, app container recreated and healthy. `ALPHA_VANTAGE_API_KEY` added to the real `.env` afterward and the app container force-recreated to pick it up — confirmed present inside the running container via `printenv`.
- Alpha Vantage's actual behaviour once the free-tier daily limit is genuinely exhausted (the "Note"/"Information" rate-limit handling in `fetchGlobalQuote` is tested against constructed fixtures, not a real exhausted-quota response).

## Phase 1 — what shipped

Data model (`src/lib/db/schema.ts`, migration `drizzle/0001_household_people_accounts.sql`, generated not hand-written): `household`, `person`, `pension_contribution`, `account`, `holding`, `balance_snapshot`, `debt_terms`. All money `NUMERIC(14,2)`; nullable `account.person_id` with `household_id` as the fallback owner for joint accounts; ISA split into `cash_isa`/`ss_isa`/`lisa`; `ON DELETE RESTRICT` on every ownership edge; `balance_snapshot` carries both the `(account_id, captured_at DESC)` index and the unique `(account_id, snapshot_date)` constraint.

Screens: Guided Setup (`/setup`), Net Worth Dashboard (`/`), Accounts List (`/accounts`), Add/Edit Account (`/accounts/new`, `/accounts/[id]/edit`), Account Detail (`/accounts/[id]`), and a deliberately minimal `/settings` for people, income, pension contributions and backup status.

358 tests pass (up from 345 after the code-review fixes below added coverage for each), including two `*.integration.test.ts` suites that run against a real Postgres — one asserting schema/migration properties the database alone can answer, one driving the Server Actions through the whole setup-to-dashboard journey. Both skip without `TEST_DATABASE_URL`; CI now runs a Postgres service and sets it.

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

## Phase 2 code review — findings and fixes

Two independent passes, run in parallel with no access to each other's output or to this
document's own Phase 2 write-up (to avoid anchoring on the author's self-assessment):
one focused on money/valuation-math correctness, one on security, architecture
consistency, and test coverage. Every finding below was re-verified against the actual
files before being treated as real, the same discipline Phase 0/1's reviews used.

Both passes independently converged on the same critical finding, which is a strong
signal it was real:

- **A malformed-but-well-shaped price from Alpha Vantage could crash the entire page,
  directly contradicting this module's own "a provider outage must not break the page"
  claim.** `ensureFreshQuotes`'s `'ok'` branch called `normalizeQuotePrice` with no
  try/catch; that function throws on anything that isn't a plain decimal with ≤4
  fractional digits (a value like `"N/A"`, a thousands separator, or unexpectedly more
  decimal places), and neither `src/app/portfolio/page.tsx` nor
  `src/app/accounts/[id]/page.tsx` wrapped the call in a try/catch either. Every *other*
  failure mode this module handles (non-2xx, invalid JSON, rate-limit signal, a missing
  price field) was deliberately caught and turned into a typed result; this one shape of
  malformed "ok" response was the sole gap, and it was untested — every existing test fed
  a well-formed 4-decimal price through the happy path. **Fixed**: the entire
  fetch-normalize-write sequence inside `ensureFreshQuotes`'s per-symbol loop is now
  wrapped in one try/catch that degrades exactly like a rate-limited/network-error
  response (serve the last cached price, marked stale, or omit the symbol), with a
  `console.error` for diagnostics. Two new integration tests cover it directly: a
  malformed price with no prior cache (omits the symbol, writes nothing), and a malformed
  price when a stale cache exists (falls back to it, marked stale).
- **A negative or zero price was accepted with no validation** — the same
  `parseScaledDecimal` call that rejects non-numeric input happily parses a leading `-`,
  and nothing downstream rejected it, so a corrupted response could produce a real,
  rendered (if nonsensical) negative valuation rather than "Price unavailable." This is
  the opposite of the module's own stated philosophy ("the provider boundary returns a
  typed 'not found' rather than a fabricated price") — a negative price is a fabricated
  price that wasn't being caught. **Fixed**: `normalizeQuotePrice` now rejects any value
  `<= 0`, caught by the same try/catch above. New unit tests cover zero and negative
  prices explicitly.
- **The Portfolio page's cross-account ticker aggregation could silently mix currencies
  into one wrong number, not just a missing one, once account currency ever varies** —
  found by the money-math pass. `aggregateByTicker` grouped purely by ticker string, with
  no awareness of currency; the page then picked one "representative" account currency
  per ticker (an arbitrary `.find()`), resolved one provider symbol from it, and priced
  the *entire* combined quantity — summed across every account holding that ticker
  string regardless of each account's actual currency — against that single quote. A real
  (not contrived) example: Vodafone trades under the bare ticker `VOD` both on the LSE in
  GBP and as a NYSE ADR in USD; 100 GBP shares and 50 USD shares of `VOD` would have
  summed to 150 shares priced entirely off one quote. **Not reachable today** — grepping
  confirmed `account.currency` is never set to anything but its schema default `'GBP'`
  anywhere in the app; there is no create/edit path that changes it yet — but STATUS.md's
  own Phase 2 write-up asserted this "degrades to 'Price unavailable,' never a wrong
  number," and that claim was only true for the single-holding path (Account Detail's
  `valueHoldings`), not this cross-account aggregation path. Worth fixing before a future
  phase adds currency editing, not after. **Fixed**: `aggregateByTicker` now groups by
  `(ticker, currency)`, not ticker alone — `HoldingForAggregation`/`TickerAggregate` both
  carry currency, and two holdings of the same bare ticker under different account
  currencies now produce two separate aggregates, each correctly priced in its own
  currency, rather than one merged (and wrong) one. The Portfolio page's fragile
  `representativeCurrency` lookup was removed entirely in favor of reading
  `aggregate.currency` directly. Threaded through to the UI too: `PortfolioHoldingRowView`
  gained a `rowKey` (ticker+currency) distinct from the display-only `ticker`, since two
  rows can now legitimately share a ticker — `PortfolioHoldingsTable`'s React key and
  expand/collapse state key off `rowKey`, not `ticker`, to avoid a key collision if this
  ever becomes reachable. New unit test proves the two-currency case produces two
  aggregates, not one merged sum.
- **No server-side log when a refetch came back rate-limited or errored** (as distinct
  from falling back to a genuinely-missing quote) — a single-operator self-hosted app has
  no way to notice from logs why prices stopped refreshing (revoked key, exhausted quota,
  provider outage), inconsistent with the logging discipline (`logAndWrap`) the rest of
  the codebase applies to failures worth knowing about. **Fixed**: both the
  rate-limited/network-error path and the newly-added catch block now log
  `[quotes] <symbol>: <reason>` server-side.

Findings checked and confirmed **not** bugs, worth recording so they aren't
re-litigated: the core fixed-point arithmetic (`currentValuePence`, `roundDiv`,
`parseScaledDecimal`/`formatScaledDecimal`) was hand-verified against several cases,
including the half-penny rounding boundary, and is correct; the API key never leaks into
a client-rendered prop, RSC payload, or logged/displayed error message (traced every use
of `apiKey` across the codebase); the outbound request URL is built via `URLSearchParams`
(not string concatenation), so there's no query-injection or SSRF risk regardless of
ticker content, and the existing ticker regex constrains it further; `getPortfolioHoldings`
correctly scopes to the household and `quote_cache`'s deliberate lack of household scoping
is never treated as if it had any; the migration is purely additive and safe against a
live database; the known `timestamptz`-as-string gotcha (Phase 1) does not recur, since
`quote_cache.fetchedAt` is read exclusively via Drizzle's typed `select()`; and the
one-multiplication-on-summed-quantity vs. sum-of-per-account-values discrepancy between
the Portfolio and Account Detail pages (up to a penny, from independent rounding) is a
documented, immaterial tradeoff, not a bug.

## Phase 1 code review — findings and fixes

Two independent passes, deliberately different in method: one given condensed, hand-picked excerpts of the changed files (the same method Phase 0's review used); one given the actual full `git diff` of the merged Phase 1 commit (~10,900 lines) to read directly, after the excerpt-based pass was already running — a condensed excerpt had introduced two false-positive findings during Phase 0's review, so this phase tested whether the real diff would find things the excerpt missed or clear things it got wrong. It did both. Every finding below was independently re-verified against the actual files in this repo before being treated as real, not taken on either review's word.

Verdict from both passes: the money-arithmetic core (bigint pence, strict boundary parsing, the debt sign convention, the three breakdowns summing exactly to net worth) is sound and had no bug on the happy path. One genuine correctness gap and several smaller robustness gaps were found and are now fixed:

- **Changing an account's type across the asset/liability boundary corrupted the sign of its entire balance history.** `updateAccount` let `type` change freely (e.g. `cash` → `debt`) and re-derived `tax_wrapper` to match, but every existing `balance_snapshot` row had been signed at write time under the *old* type's convention (liability negative, asset positive) — nothing re-signed them. A mistyped `cash` account switched to `debt` kept its positive balance, so net worth silently double-counted it and the asset-class breakdown showed a liability as a positive slice (or the reverse, going the other way). The existing integration test for this screen only asserted that the `debt_terms` row survived a type change away from debt — it never checked what happened to net worth, so the suite walked straight past the gap. **Fixed by refusing the edit**: `updateAccount` now reads the account's current type first and returns a form-banner error if the change would cross the liability boundary, rather than allowing it and leaving the history mis-signed. This is a deliberate narrowing of `DESIGN_SPEC.md`'s edge case, which addressed what happens to the *form fields* ("hidden, not deleted") but not what happens to the *signed history* — there's no correct in-place answer to that, so the edit is refused; re-creating the account is the correct fix for "I picked the wrong type." Two new integration tests cover both directions of the refusal.
- **`createHousehold`'s "refuse a second household" guard was check-then-insert with no database backing.** Two concurrent first-time-setup submissions (a double-click, two tabs, a retry after a slow response) could both observe "no household yet" and both insert — after which `getSetupState()`'s undefined-order `LIMIT 1` could scope subsequent writes to either household nondeterministically, silently splitting the data. Same defect class Phase 0's review found in the login lockout counter. **Fixed** with a database backstop: a unique index on a constant expression (`household_singleton`, migration `drizzle/0002_household_singleton.sql`) allows at most one row in the table ever; the losing insert of a race now hits that constraint and is treated the same as "already done" rather than surfaced as an error. Verified both that the index actually rejects a second row at the Postgres level and with a new integration test that fires two `createHousehold` calls concurrently via `Promise.all` (not just sequentially, which can't reproduce the race) and asserts exactly one household exists afterward.
- **`useActionForm` could flash a false "couldn't save" error on a successful save.** `/accounts/new` and `/accounts/[id]/edit` wrap `createAccount`/`updateAccount` in a `redirect()`-on-success function, invoked through the hook. When a Server Action invoked imperatively from a client component redirects, Next 14 performs the navigation itself and the awaited call resolves `undefined` rather than rejecting — so `result.ok` threw a `TypeError` that the hook's `catch` treated as a failed save. Neither redirecting flow was exercised by the E2E suite (Guided Setup's `createAccount` doesn't redirect; the standalone `/accounts/new` E2E test stops at validation). **Fixed**: the hook now returns early when the resolved result is `undefined`, since the redirect is already under way and there's nothing to render.
- **The archived-accounts panel's copy contradicted what the trend chart actually does.** It read "their history is kept and still counts towards past points on your net worth trend," but `getSnapshotsForTrend` filters out archived accounts entirely — archiving an account silently rewrites the whole historical trend line, the exact outcome archive-over-delete was chosen to prevent (per `DESIGN_SPEC.md`'s own rationale). Correctly including archived history (counted up to the archive date, not carried past it) is a real query change, not a copy fix, and was judged out of scope for a review-driven patch — so the **copy was corrected** to say what the app actually does: excluded from the trend as well as the totals, with the balance history kept and viewable, not plotted.
- **`deletePensionContribution` and `deleteHolding` deleted by row id alone**, with no household-ownership check — the only two mutations in the file that skip it, and the full-diff review noted they also skip the `requireHouseholdId()` bug-detection call every other action makes. Not an exploitable boundary in a single-household deployment (nothing to escape into), but a latent one and a defense-in-depth gap. **Fixed**: both now join through their owning row (`pension_contribution → person → household_id`, `holding → account → household_id`) before deleting, matching every other mutation's pattern; `deleteHolding` also now resolves the account id for cache revalidation from that same lookup rather than trusting the form's copy of it.
- **`updateBalance` silently no-op'd if a debt account had no `debt_terms` row yet.** `createAccount` only inserts `debt_terms` when terms were provided at creation, so a debt account can legitimately have none — and the balance-sync line was a plain `UPDATE`, which matches zero rows in that case. **Fixed**: it's now an upsert, so recording a balance for a debt account creates the terms row (balance populated, everything else left null) the first time, instead of leaving `current_balance` silently absent.
- **`setupStep`'s `defaultStep` could exceed its own `furthest` cap** in one state (`personCount === 0`, `accountCount > 0`) — reachable only via a joint account created outside the wizard (the schema allows a person-less joint account; the wizard UI doesn't gate against it existing already). Not reachable through Guided Setup itself, but self-contradictory: an unqualified visit would render the account picker while the equivalent explicit `?step=accounts` request would be refused. **Fixed** with a one-line clamp so the default is never past what an explicit request for the same state is allowed to reach; new unit test covers it directly.

Findings from either pass that were checked and found **not** to be bugs, worth recording so they aren't re-litigated: the debt sign convention itself (both `createAccount` and `updateBalance` apply exactly one logical negation per stored representation — confirmed by tracing both paths and by the existing tests pinning `'-374000.00'`/`'374000.00'` from one entry); the "latest balance" query (`getSnapshotsForTrend`/`getAccountsWithBalances`) already orders by `snapshotDate DESC, capturedAt DESC`, so a backfilled historical entry cannot override a genuinely later balance; and `updateAccount`'s `debt_terms` upsert `SET` list can't null `current_balance` on an unrelated edit, because `DebtTermsInput` (the type it spreads from) has no `currentBalance` field at all — the full-diff review flagged this as unverifiable from a paste and asked for it to be checked against the real file, and it checked out clean.

Smaller items noted by the full-diff review and judged not worth a review-driven fix, left for whenever the relevant area is next touched: Cash LISAs exist but the LISA type is hardcoded to the `investments` asset class and offered a holdings UI (net worth is unaffected; only the breakdown label is off); all "today" date logic is UTC, so a UK user in the ~1 hour of BST-vs-UTC offset near midnight could be blocked from recording "today's" balance; a person whose accounts net to exactly zero drops out of the by-person breakdown legend (the sum is unaffected, only the legend row); `updateAccount` reports success even if the `WHERE` clause matched zero rows (a stale edit on an account no longer existing).

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

## Since Phase 2 deployment: holdings are now editable

Requested by the household while using the Portfolio/Account Detail screens: holding rows
were delete-only, a deliberate P1 choice (`DESIGN_SPEC.md`: "read-only... no accidental
edit") made before live valuation existed, so a typo'd cost basis or quantity had to be
deleted and re-added, losing entry order. Now fixed via a real edit path, not a
delete-and-readd workaround.

- New `updateHolding` Server Action (`src/lib/household/actions.ts`) — a plain `UPDATE`,
  not a new dated row: a holding is current composition, not append-only history, same
  reasoning `deleteHolding` already used. Scoped by household via the same
  `holding → account → household_id` join every other holding mutation uses, and reuses
  `validateHolding` — the same ticker/quantity/cost-basis rules as "Add holding".
- `HoldingsPanel` (`src/components/accounts/HoldingsPanel.tsx`) gained an inline per-row
  edit form (an "Edit" link next to "Remove"), reusing the same field layout as "Add
  holding". Only one row editable at a time.
- Two new integration tests cover it (edit-in-place, and rejecting a nonexistent holding
  id); full suite was 411/411 against a scratch Postgres at the time. Committed
  (`5382c86`) together with the totals change below, pushed, and deployed via
  `./deploy.sh` the same day — live on the household's real stack.

## Since Phase 2 deployment: holdings totals

Requested alongside the editable-holdings change above: the Account Detail Holdings table
had no total row (cost basis, current value, gain/loss all had to be added up by eye), and
the Portfolio page's summary card showed total invested value but no total gain/loss.

- Account Detail's `HoldingsPanel` (`src/components/accounts/HoldingsPanel.tsx`) now has a
  `<tfoot>` totals row. Cost basis totals every holding — it's always known. Current value
  and gain/loss total only the holdings that actually have a live price; if some but not
  all priced, a line under the table says how many were excluded rather than the total
  silently understating (same "never fabricate" rule Phase 2 applies everywhere else).
  Computed server-side in `src/app/accounts/[id]/page.tsx` via `sumPence`/`gainLoss`, no
  new float ever touches the math.
- Portfolio's summary card (`src/app/portfolio/page.tsx`) gained a "vs. cost basis"
  gain/loss line next to the existing total-invested figure, same partial-sum caveat
  applied (excludes unpriced tickers, with a count shown when that happens).
- Both changes are pure display/aggregation — no schema change, no new action. Typecheck
  clean; full suite was 411/411 at the time. Committed (`5382c86`) and deployed together
  with the editable-holdings change above.
- Not verified in a real browser this pass — implemented and covered by the existing
  automated suite (which already exercises the underlying valuation math), but the actual
  rendered totals row hasn't been eyeballed against the household's real holdings yet.
  Still open as of the balance-history change below.

## Since Phase 2 deployment: balance history — view, edit, and delete individual entries

Triggered by a real incident: the household added a previously-missed account, and
because its opening balance landed as a single dated entry, the net worth trend showed
an unexplained jump. The underlying "Update balance" mechanism already upserts on
`(account_id, snapshot_date)` — resubmitting the same date silently corrects that day's
figure — but that's not discoverable (you'd have to already know the exact date), and it
can't retarget a wrong date at all, only overwrite the amount on a known one.

- New **Balance history** panel (`src/components/accounts/BalanceHistoryPanel.tsx`) on
  every Account Detail page, below the existing trend chart — every dated entry for that
  account, newest first, each with its own Edit (amount *and* date) and Remove. Same
  interaction shape as the Holdings edit above: one row editable at a time, inline.
  Additive, not a replacement — `UpdateBalanceDrawer` is untouched and stays the way to
  record a *new* figure.
- Two new Server Actions (`src/lib/household/actions.ts`): `updateBalanceSnapshot`
  (retargeting onto a date another entry already owns is refused with a field error,
  rather than colliding with `updateBalance`'s own upsert or hitting a raw constraint
  violation) and `deleteBalanceSnapshot`. Both household-scoped via the same
  `balance_snapshot → account → household_id` join pattern as `updateHolding`.
- **A latent bug, found and fixed while building this**: `debt_terms.current_balance`
  is supposed to always mirror a debt account's *latest* snapshot, but `updateBalance`'s
  original resync logic just wrote whatever was *just entered*, trusting that write to be
  the latest — true only by the accident of the date input being capped at `max={today}`,
  and already wrong if you backdated a debt balance to an earlier date than an existing
  later one. Fixed by extracting `syncDebtCurrentBalance`, which re-reads whichever
  snapshot is *actually* latest (`ORDER BY snapshot_date DESC, captured_at DESC`) and
  upserts/nulls `current_balance` from that — now shared by `updateBalance`,
  `updateBalanceSnapshot`, and `deleteBalanceSnapshot`, so editing or deleting an
  arbitrary historical entry can't leave it stale either.
- **Deleting an account down to zero snapshots is a supported state, not a special
  case** — `latestAmount: null` is already read and tested elsewhere
  (`src/lib/networth/breakdown.test.ts`: a no-snapshot account contributes £0 to net
  worth, not an error).
- Seven new integration tests: edit-in-place, retarget to a free date, reject a
  colliding date, delete a non-latest entry (latest untouched), delete a debt account's
  latest entry (confirm `current_balance` resyncs), delete an account's only snapshot
  (confirm both `latestAmount` and `current_balance` go `null`), and reject
  edit/delete against a nonexistent snapshot id. Full suite: 418/418 against a scratch
  Postgres. Typecheck clean.
- Not yet deployed, and not yet verified in a real browser — same open item as the
  totals change above, now covering three unverified-in-browser changes in a row. Worth
  doing a proper browser pass before the next one ships blind.

## Phase 3, Milestone 1: schema foundation

First step of the retirement Monte Carlo engine (see the full 10-milestone plan agreed
before starting — not reproduced here; ask for it if it's not still in the session's
plan file). M1 is schema only: nothing computes a simulation yet.

- **New tables** (`src/lib/db/schema.ts`, migration `drizzle/0004_retirement_scenario.sql`):
  `retirement_scenario` (household-scoped, `assumptions` JSONB) and `simulation_run`
  (append-only per scenario, `status` enum `running|complete|failed`, `result` JSONB,
  cascades on its scenario). **First JSONB columns in this codebase** — deliberately
  left untyped at the Drizzle level; `src/lib/retirement/scenarioAssumptions.ts`'s
  `parseScenarioAssumptions` is the only code path meant to read the column as a typed
  shape, guarded by a `schemaVersion` field that throws on anything unrecognised rather
  than guessing. Starting portfolio composition is **not** stored in the blob — derived
  live from `account`/`balance_snapshot`/`holding` at run time, same principle as State
  Pension age from date of birth.
- **`src/lib/retirement/taxYearConfig.ts`** — versioned typed constants, Phase 4.5's
  future home for personal-allowance/taper figures too, not a second file. Two real
  facts encoded, both independently sourced this session (not estimated):
  - State Pension: £241.30/week for 2026/27 (`docs/PROPOSAL.md` §2's own cited figure);
    the annual figure is *derived* by ×52 (£12,547.60), not a second constant that could
    disagree with the weekly one.
  - **State Pension age by date of birth** — fetched directly from gov.uk's own "State
    Pension age timetable" publication (Pensions Act 2007/2014) rather than approximated
    from the proposal's "66 rising to 67" summary: the exact monthly transition bands
    for 66→67 (2026–2028) and the literal per-band target dates for 67→68 (2044–2046).
    **The 67→68 figure is flagged as legislation-only, not settled** — gov.uk's own
    document states that timetable "could change as a result of the review," and two
    government reviews were reported ongoing as of mid-2026. This matters concretely for
    this household: both Alex (b. 1985) and Jordan (b. 1987) fall in the flat-68 band
    under current law, not 67 — worth knowing before either of their scenarios gets built.
- **The M1-flagged "mortality/single-survivor spending" schema gap is resolved**, not
  deferred: `ScenarioAssumptionsV1.people[].planEndAge` (required, not a real actuarial
  prediction — a planning horizon each person's data ends at) plus a household-level
  `survivorAnnualSpending`, required whenever more than one person is modelled. Chosen
  now specifically so this doesn't get discovered mid-engine-build at Milestone 5, per
  the plan's own warning.
- **No default flat effective tax rate is specified anywhere in `PROPOSAL.md`** (unlike
  the 3.0–3.5% withdrawal rate) — recorded as an open item for whichever milestone builds
  the scenario-editor UI, not silently defaulted here.
- 26 new tests (`taxYearConfig.test.ts`, `scenarioAssumptions.test.ts`, extensions to
  `src/lib/db/schema.integration.test.ts` for JSONB round-tripping and the new
  RESTRICT/CASCADE edges) — full suite 444/444 against a scratch Postgres. Typecheck
  clean. `drizzle-kit generate` confirms the committed migration matches the schema
  exactly (CI's own drift check, run manually this session).
- **A real bug caught by the test suite before it shipped**: the first draft of
  `scenarioAssumptions.ts` validated the percent fields (`inflationPct`, etc.) through
  the money parser (`numericToPence`, 2dp), which rejected a perfectly valid `"2.500"`
  (the `percent` schema column is 3dp). Fixed with a dedicated percent validator; worth
  noting since it's exactly the kind of silent-drift bug this module exists to prevent,
  caught here only because tests were written before moving on, not after.
- Next: Milestone 2 (seeded RNG + shared engine types) per the plan, or Milestone 4/6/8
  (UK return dataset research / worker-thread deploy spike / scenario CRUD), all of
  which can run in parallel with M2 and each other once M1 exists.

## Milestone 1 — Fable review

Two independent Fable-model review passes, in the same spirit as `PROPOSAL.md`'s own
eight prior "Fable Pass" sections: one on the M1 code, one on the full Phase 3 milestone
plan itself. Both independently re-verified the State Pension figures/bands against
gov.uk directly (not just re-citing the earlier transcription) and confirmed them
correct — the highest-risk area, since it's hand-rolled calendar arithmetic with no
library, checks out clean.

**Two real gaps found in the code and fixed before this milestone was called done**:
- `wrapperWithdrawalOrder` was validated only as "an array of strings," then unsafely
  cast to `AccountTypeValue[]` — a payload like `["not_a_real_type"]` passed as if
  trusted, typed data, directly contradicting this module's own stated purpose. Now
  checked against the real `accountType` enum values.
- No magnitude bounds on percent/age/money fields — `equityAllocationPct: "150.000"`,
  `retirementAge: -5`, and a money field carrying UI-input formatting (`"£30,000"`
  instead of canonical `"30000"`) all passed. Now bounded: percent fields take an
  explicit `{min, max}` per field (not all percents share the same valid range), ages
  are whole numbers 0–130 (the same sanity bound `validateAccountEdit`'s date-of-birth
  check already uses elsewhere in this codebase), and money fields require the
  canonical decimal form a stored assumption should already be in, rather than
  tolerating raw keystroke formatting the way `money.ts`'s UI-input parser deliberately
  does. `statePensionDate` also gained input-format validation it was missing (throw on
  a malformed date rather than let a string comparison land in an arbitrary band).
- 6 new tests covering all of the above. Full suite now 450/450.

**Plan document also revised** (`/Users/morganstrutton/.claude/plans/glistening-sauteeing-backus.md`,
not part of this repo — ask if it's needed and it isn't already in context): a missing
cancellation path (`DESIGN_SPEC.md`'s Scenario Editor "Running" state requires an
explicit cancel, which no milestone had covered) folded into M6/M7; M8 was wrongly
serialized behind M7 in the original sequencing when it only depends on M1 — corrected;
the block-bootstrap justification in M5 conflated sequence-of-returns risk with serial
correlation — corrected to cite the real distinction; M3's citation of Phase 8 for
skipping PCLS Lump-Sum-Allowance validation was a stretch (Phase 8 is about *timing*
optimization, not amount-cap validation) — relabelled as its own simplification; M10's
calibration plan now separates tax-mapping mismatch from return-methodology mismatch as
two distinct risks rather than one; and a previously unowned gap — translating the
3.0–3.5% UK-calibrated safe withdrawal rate (a rate) into `annualSpending` (an absolute
figure) — is now explicitly assigned to Milestone 9.

Deployed via `./deploy.sh` after this review — see the deploy log for confirmation.

## Phase 3, Milestone 2: seeded RNG + shared engine types

`src/lib/retirement/rng.ts` (seeded, deterministic `mulberry32` PRNG — `Math.random()`
can't be seeded at all, so it was never an option) and `src/lib/retirement/engineTypes.ts`
(shared types for the deterministic and randomized engines Milestones 3/5 will build,
plus a `RATE_SCALE` fixed-point convention for rate-shaped values, reusing
`valuation.ts`'s `roundDiv` — now exported rather than module-private, specifically for
this reuse). No simulation logic yet; this is shared infrastructure only.

Fable-reviewed — no real bugs. The mulberry32 transcription was independently
hand-verified bit-for-bit correct against a canonical reference, and the fixed-point
rate-scaling arithmetic was hand-traced and confirmed correct. Two fixes applied
anyway: the RNG's own tests only asserted self-consistency (two same-seed generators
agreeing with each other), which a subtly-wrong-but-internally-consistent transcription
would still pass — added a hardcoded reference-vector test pinning real output values,
independently re-verified by actually running the code rather than trusting the
review's numbers at face value. Also fixed a doc comment in `src/lib/money.ts` that
went stale ("`number` appears in exactly one place") the moment this milestone added a
second justified non-money `number` (`SimulationResult.successRate`).

**Flagged for Milestone 3, not fixed now**: the shared types' wrapper-keyed fields
(`wrapperWithdrawalOrder`, `startingBalancesPence`, `balancesByWrapperPence`) type their
key as the full `AccountTypeValue` enum, which includes `debt`/`property` — neither a
real decumulation wrapper. Nothing stops M3 from accidentally aggregating a debt
balance into a simulation total; recorded in the plan file as something M3 must resolve
before writing its aggregation logic, not carried forward silently.

13 new tests, full suite 463/463. Typecheck clean.

## Next steps

1. On the deploy machine: run through `docs/DEPLOYMENT.md` §1–2 (env, `docker compose up`, `tailscale serve`), then §4 (backup key, remote, cron). Confirm the in-app indicator goes from "No backup yet" to "Backup healthy". **Also do the second-device login test** — open the app from a phone on the tailnet and confirm the redirect to `/login` lands on the tailnet hostname, not `localhost`. Still outstanding since Phase 1; Phase 2 didn't touch deployment mechanics.
2. ~~Run the Playwright E2E once.~~ Done — see "Playwright E2E" above. It found and fixed a real Guided Setup defect. Worth adding to CI now that it is known to pass; it needs a scratch Postgres and `npx playwright install chromium` on the runner. Phase 2 adds `e2e/portfolio.spec.ts` to the same not-yet-in-CI backlog.
3. ~~Phase 2: portfolio tracking plus a market-data provider~~ Done, deployed, and independently code-reviewed — see "Phase 2 — what shipped" and "Phase 2 code review" above.
4. **Holdings-to-balance sync** — requested by the household after using Phase 2 live: adding/updating a holding never touches the account's own balance, so an account's stored balance and its holdings' live value can silently drift apart (see "Deliberately not built" above for the full note and the design question it raises — this isn't a one-line fix). Worth scoping and building before or alongside Phase 3, since it's a real gap in what's already shipped, not a new phase's feature.
5. Phase 3 per the Phased Delivery table: the retirement Monte Carlo engine (UK-calibrated withdrawal rate, State Pension as an income floor, seeded RNG per PROPOSAL.md's Compute execution model) plus the narrow retirement-timing scenario comparison. Definition of done includes naming and reproducing a specific published reference tool/scenario within a documented tolerance — not yet named.
6. Continue in phase order through Phase 8 as specified in `docs/PROPOSAL.md`.

## Notes for Phase 3

- `src/lib/auth/csrf.ts` (`sameOriginGuard`) is still implemented, tested and unused — neither Phase 1 nor Phase 2 added a route handler, only Server Actions (which carry Next's own Origin/Host check). The first mutating route handler must call it; that protection does not extend to route handlers. Phase 3's compute-persist-poll pattern (PROPOSAL.md's Compute execution model) is likely where the first one appears — a `simulation_run` status-polling endpoint is naturally a route handler, not a Server Action.
- **Money never touches a float.** `src/lib/money.ts` parses to integer pence as `bigint` and back to NUMERIC strings; `numeric` columns come out of node-postgres as strings and stay that way. A `numericToPence`/`formatMoney` pair exists for every display path — new code should go through it rather than `Number(row.amount)`. Phase 2's `src/lib/portfolio/valuation.ts` extends the same discipline to sub-penny/fractional-share precision (`parseScaledDecimal`/`formatScaledDecimal`) — the Monte Carlo engine's compounding math should look to that module before reinventing fixed-point arithmetic, or before reaching for a float and relying on the reference-calculator tolerance test to catch it (Testing strategy in PROPOSAL.md is explicit that tolerance-matching alone isn't sufficient coverage).
- **Watch out for `db.execute` with raw SQL**: unlike a typed `select()`, it returns the driver's raw values, so a `timestamptz` arrives as a *string*, not a `Date`. That mismatch typechecked happily and threw at render time during Phase 1 (`capturedAt.getTime is not a function`). `getAccountsWithBalances` converts explicitly and a regression test asserts it.
- Both `*.integration.test.ts` suites share one scratch database and drop its schema, so `fileParallelism` is off in `vitest.config.ts`. A new DB-backed test file can rely on that. Phase 2's `quotes.integration.test.ts` follows the same pattern with an injected fake provider — Phase 3's `simulation_run` persistence layer should do the same rather than inventing a new DB-test convention.
- **Outbound HTTP calls are mockable via dependency injection, not a library.** Phase 2 needed this for the first time (`fetchGlobalQuote`'s `fetchImpl` parameter, `ensureFreshQuotes`'s `QuoteSource` parameter) — no `msw`/`nock` is installed. If Phase 3 or later needs to mock more than a couple of call sites this way, that's the point to reconsider, not before.
- `src/lib/env.ts`'s pattern for an optional, gracefully-degrading integration (`alphaVantageApiKey(): string | null`, never `required()`) is the template for any future provider key — Phase 5's Open Banking tokens are a different category (per-connection bearer credentials needing encryption at rest, not a single env var) and shouldn't follow this exact shape, but Phase 4's stock-data provider likely should.
