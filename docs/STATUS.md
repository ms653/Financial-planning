# Project Status

Last updated: 2026-08-03 (**Phase 3 is fully closed out** — see "Phase 3 reference-tool
validation" below for the closing Trinity study methodology and results. **Phase 4
(stock analysis workbench) is now fully complete**: Milestone 1 (schema, the FMP fundamentals
provider boundary, a watchlist) shipped, committed, pushed, and deployed to the live
stack — `7bd4214`. **Milestone 2 (DCF calculator)** shipped and deployed — `333809d`
(calculator), `a520a39` (a real Legacy-endpoint FMP bug, caught and fixed via live-key
verification), `299dfa8` (a "how to read this" explainer), `be2ffef` (data-driven
suggested inputs — FCF growth from historical CAGR, discount rate via CAPM using a
newly-fetched company beta), `619129e` (Milestone 3 — relative valuation +
quality/balance-sheet health). **Phase 4 is now fully complete**: Milestone 4
(fundamentals checklist) and Milestone 5 (watchlist UI polish — a shared
`buildWorkbenchSummary`, extracted from `/stocks/[ticker]`, now drives per-row price/
DCF-signal/checklist badges on the watchlist list page too) are both implemented and
tested — see "Phase 4, Milestone 4" and "Phase 4, Milestone 5" below. **Phase 4.4
(retirement accumulation phase) is also now complete, including its own household-
requested follow-up** — the engine models saving/contributing between now and
retirement instead of starting every path already retired (resolving the deferral
Phase 3 Milestone 3 flagged), and now covers regular contributions to GIA/ISA/LISA/
cash accounts (personal and joint), not just pensions; see "Phase 4.4: retirement
accumulation phase" and "Phase 4.4 follow-up: regular contributions to non-pension
accounts" below. **Also shipped, outside Phase 4**: net worth chart stale-gap
segments + hover tooltip, a real debt-chart sign-flip bug fix, a zero-pinned
debt-chart baseline, the same hover tooltip reused on per-account charts, and a new
in-app Roadmap tab with drag-and-drop reprioritization — see "Net worth chart:
stale-gap segments + hover tooltip," its follow-up, and "In-app Roadmap tab" below.
`src/lib/roadmap/data.ts` is now the single source of truth for phase status/scope/
dependencies; `docs/PROPOSAL.md`'s Phased Delivery table is generated from it and
CI-enforced to stay that way. A new `CLAUDE.md` records the "check the roadmap before
planning" instruction. 782 tests passing. **Committed, pushed, and deployed to the
live stack.**)

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
- **Phase 3, Milestones 1–5** — the retirement Monte Carlo engine is functionally complete: `retirement_scenario`/`simulation_run` schema, seeded RNG and shared engine types, the deterministic zero-volatility decumulation core, a real UK historical return dataset (JST Macrohistory Database), and the randomized block-bootstrap sampler that runs the core thousands of times over sampled real returns to produce a success rate and percentile fan-chart bands. Each independently Fable-reviewed.
- **Phase 3, Milestone 6** — the `worker_threads` deployment spike: proves the compute-persist-poll pattern's worker survives the Docker `output: 'standalone'` build and that both normal completion and forced cancellation update `simulation_run` correctly, verified with a real `docker build` + run, not just an integration test.
- **Phase 3, Milestone 7** — the DB resolution layer (`resolveScenario`) and the three compute-persist-poll route handlers (`POST /api/retirement/simulation-runs`, `GET .../[id]`, `POST .../[id]/cancel`), including staleness reconciliation for a run whose worker never reports back.
- **Phase 3, Milestone 8** — retirement scenario CRUD (`createScenario`/`updateScenario`/`duplicateScenario`/`deleteScenario` Server Actions, plus read queries), the write path M7's API needed and didn't have. Details below; still needed before a household can actually use any of this: the UI (M9 — no route, page, or nav exists yet), and deploying M3 onward to the real stack.

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

## Net worth trend chart: found and fixed a real rendering bug

Flagged by the household: the dashboard's "6M" trend line rendered as a suspiciously
perfect straight diagonal. Queried the live `balance_snapshot` table directly to find
the real cause rather than guessing — most accounts have exactly two rows (one
backdated roughly a year ago, one from the last day or two), and one large account
(the previously-missing one added a few days ago) has only a single very recent row.

Two compounding bugs in `src/lib/networth/series.ts`, both real, both fixed:

1. **`buildNetWorthSeries` never plotted a point at the window's own start date.**
   Pre-window snapshots only seeded an internal carried-forward balance; plotting began
   at whichever date the *first in-window* snapshot happened to land on. For a
   household whose only in-window updates are a day or two old, the chart's leftmost
   point was silently "two days ago," not "six months ago" — the true multi-month gap
   was invisible, and so was the accurate (and, it turns out, negative) window-start
   figure.
2. **`seriesToPath` spaced points evenly by array index, not by elapsed calendar
   time.** Combined with bug 1, a cluster of points from the last day or two got
   stretched evenly across the *entire* chart width, drawing a smooth six-month trend
   that never happened.

Fixed: `buildNetWorthSeries` now always emits an explicit point at the window's `start`
date (when non-null) from the carried-forward pre-window total, before plotting
whatever falls inside the window as before — the now-unreachable old "every snapshot
predates the window" special case was removed rather than left as dead code, with the
reachability argument written out in a comment. `seriesToPath` now places each point's
x-coordinate proportional to real elapsed time between the first and last plotted date.

**Verified against the household's actual live data**, not just synthetic test cases —
queried `balance_snapshot` directly, ran it through the real functions, and confirmed
the fix produces the honest shape: a window-start total of **−£36,659** (correct: the
large recently-added account genuinely wasn't tracked six months ago) followed by a
sharp, near-vertical rise concentrated in the final ~1% of the chart width, rather than
a misleading smooth diagonal. This also changes the dashboard's "Up £X (Y%) over 6
months" text: with a negative opening figure, `trendDelta` correctly now shows the
absolute change only, no percentage (per its own documented "no meaningful percentage
from a negative base" rule) — previously it showed a small, misleadingly-precise
percentage computed from the wrong (much shorter) actual span.

Fable-reviewed — no bugs found; the "unreachable dead code" removal was independently
hand-traced and confirmed, and the account-detail balance chart (a separate code path
that never had bug 1) was confirmed to correctly benefit from the bug-2 fix with no
residual issue. One suggested nice-to-have (an end-to-end test piping both fixed
functions together for the exact reported shape) was added. 4 new tests, full suite
467/467. Typecheck clean.

## Phase 3, Milestone 4: UK historical return dataset

Blocking verification task #1 — the bootstrap engine (Milestone 5) needs a real,
citable annual UK real-return series, not an invented one. The original candidate lead
(Bank of England's "A Millennium of Macroeconomic Data") was actually downloaded and
rejected: its `share-prices` series is a capital-only price index, no dividends, and its
bond series are yields, not returns — reconstructing genuine total returns from those
would have needed additional unsourced assumptions.

Used the **Jordà-Schularick-Taylor (JST) Macrohistory Database, release R6** instead — a
real, free, peer-reviewed academic dataset (NBER Macroeconomics Annual 2016; *Quarterly
Journal of Economics* 134:3, 2019) with genuine UK equity/gilt total-return and bill-rate
columns, 1871–2020. `src/lib/retirement/returns/ukHistoricalReturns.ts` embeds all 150
years, converts nominal returns to real via the exact Fisher relation in fixed-point
bigint math (reusing `valuation.ts`'s `roundDiv`, now exported), and is independently
cross-validated: the geometric mean real UK equity return this implies (~5.2–5.3%)
matches the UBS Global Investment Returns Yearbook 2025's separately published "5.2%
real, worldwide equities" figure. **Deliberately not spliced to 2021–present** —
documented as an explicit, dated gap for whichever milestone next touches this, rather
than rushed under time pressure.

**Verification, not just transcription**: every one of the 150 embedded rows was
programmatically cross-checked against the downloaded primary source with zero
mismatches — twice, once during implementation and again independently during Fable
review (which also independently re-derived the whole pipeline from scratch in Python
and got matching figures). One real transcription error was caught and fixed before
review even started: a placeholder value for 1870's CPI (needed only to compute 1871's
inflation rate) had been typed from memory rather than the source — corrected to the
actual sourced figure before it went further.

**A genuine license conflict, found by Fable review and fixed**: the JST database is
licensed CC BY-NC-SA 4.0 (non-commercial, share-alike). This repo is public on GitHub
and carries a blanket MIT `LICENSE` with no carve-outs — which textually authorized
commercial use, resale, and resharing under different terms over data that forbids all
three. Morgan's own use (private, non-commercial, self-hosted) was always fine under
CC BY-NC-SA's terms; the problem was specifically that `LICENSE` itself misrepresented
what the data could legally be used for. Fixed with an explicit exception clause in
`LICENSE` and a new `LICENSE-DATA.md` carrying the full terms and required citations.

24 new tests, full suite 474/474. Typecheck clean. Not wired into anything yet — this is
prep work for Milestone 5's bootstrap sampler, confirmed via grep that nothing else in
the app references it.

## Phase 3, Milestone 3: deterministic zero-volatility decumulation core

The first real engine logic — everything before this milestone was schema, types, RNG,
or reference data. `src/lib/retirement/engine/deterministicCore.ts`'s `simulatePath`
takes one real annual return rate per simulated year (not a single baked-in constant),
specifically so Milestone 5's bootstrap engine can be built as "this core plus sampled
returns" and reuse the same year-by-year mechanics, cross-checked against it — M3's own
`runDeterministicPath` is a thin wrapper repeating one fixed rate.

Per year: investment growth applied to every wrapper's start-of-year balance; any PCLS
event(s) due that year move 25% of the (post-growth) `sipp_pension` balance into `cash`,
tax-free, not validated against the £268,275 Lump Sum Allowance (the plan's own named
P1-of-Phase-3 simplification); State Pension income for anyone who's claimed offsets
spending directly; the remaining shortfall is drawn from wrappers strictly in
`wrapperWithdrawalOrder`, literally, stopping once met. All arithmetic in bigint pence.

**Fixed the gap Milestone 2's own review flagged and left for M3**: `wrapperWithdrawalOrder`,
`startingBalancesPence`, and `YearState.balancesByWrapperPence` were typed against the
full 8-value `AccountTypeValue` enum, which included `debt`/`property` — nothing stopped
a mortgage or a house valuation from being walked into a simulated drawdown total. Now a
new `DrawdownAccountType` (`engineTypes.ts`'s `DRAWDOWN_ACCOUNT_TYPES`, derived from the
real enum minus those two, not hand-copied), threaded through `ResolvedScenario`,
`YearState`, and `scenarioAssumptions.ts`'s `wrapperWithdrawalOrder` parser — with a new
regression test proving both `debt` and `property` are now rejected.

### Judgment calls worth knowing about

- **`cash` is tax-free on withdrawal, not just the ISA types the milestone plan's own
  shorthand ("ISA/PCLS excluded") named.** A flat "effective tax rate" is meant to stand
  in for tax on investment income/gains; taxing a `cash` withdrawal under that umbrella
  would be a real UK-tax error (cash is already-taxed money — its *withdrawal* triggers
  nothing further), not a simplification. So the tax-free set is
  `cash`/`cash_isa`/`ss_isa`/`lisa`; only `gia` and the non-PCLS portion of
  `sipp_pension` are taxable. Independently confirmed correct by Fable review.
- **A 100%-or-higher effective tax rate on a taxable wrapper is guarded, not left to
  divide by zero.** The parser's own bounds allow `flatEffectiveTaxRatePct` up to
  100.000; at exactly 100%, no gross withdrawal from `gia`/`sipp_pension` can ever net a
  positive amount, so that wrapper is skipped for the rest of the shortfall-drawing loop
  rather than crashing. Covered by a dedicated test.
- **`YearState.depleted` is defined by unmet spending, not by a wrapper balance reading
  zero** — a refinement of Milestone 2's own original doc comment ("the balance is
  exhausted"), written before the algorithm that actually produces the flag existed. A
  household with £0 starting balance and £0 spending has nothing to deplete and is not a
  failed path; the sticky "once depleted, always depleted" latch is keyed to "drawdown
  demand could not be fully met" instead. Both the zero/zero case and the sticky latch
  have dedicated tests.
- **PCLS proceeds are moved into the `cash` wrapper, not spent speculatively.** An
  earlier design that let unspent PCLS proceeds directly offset the year's spending
  shortfall (rather than landing in a wrapper first) would have made any surplus vanish
  from `totalBalancePence` instead of remaining on the balance sheet as cash — caught
  and fixed before implementation, not by review.
- **Genuine, plan-contradicting scope narrowing — flagged by Fable review, corrected in
  the code's own doc comment and the plan file rather than left standing uncorrected.**
  M3 does not model an accumulation/contribution phase at all: a simulated path always
  begins already retired (`ResolvedPerson.currentAge`, new this milestone, is the age at
  year 0 of *this* path, not necessarily today's real age), and `retirementAge` is
  carried in the type but never read by the engine — a future "retire at 60 vs. 65"
  comparison (Milestone 9) is meant to be built by resolving two separate
  `ResolvedScenario`s that each start at a different `currentAge`, not one continuous
  timeline. The first draft justified this by saying `ScenarioAssumptionsV1` has no
  contribution-amount field, which is true but incomplete: Phase 1 already has live
  contribution data (`person.annual_gross_income`, the `pension_contribution` table)
  that a resolution layer could have surfaced — this session chose not to build that
  wiring. **The Phase 3 milestone plan itself, not just PROPOSAL.md's general Testing
  strategy, named "contributions past assumed retirement" as one of M3's own required
  tests** — so this is a real deferral of an explicitly-owned deliverable. Judged
  defensible (a full accumulation-phase model is substantial separate scope; PROPOSAL
  §5 itself frames Phase 3 as "a pre-tax/pre-wrapper Monte Carlo") and now recorded in
  both places rather than left only in a code comment a future session might not read.
  `deterministicCore.test.ts` has a regression-lock test proving `retirementAge`
  currently has zero effect — a scope-lock, explicitly not a substitute for the real
  edge case. **Now explicitly scheduled as its own phase, not just a footnote**: see
  `docs/PROPOSAL.md`'s Phased Delivery table, Phase 4.4 (added 2026-08-03, household-
  raised) — sequenced before 4.5's Cash Allocation Advisor specifically because that
  feature needs to reason about *changing* contributions between now and retirement,
  which requires an accumulation phase to exist first.
  **Resolved, 2026-08-03 — see "Phase 4.4: retirement accumulation phase" below.** The
  deferral named above is built: `retirementAge` is read, `pension_contribution` is
  wired in, and the old regression-lock test is replaced with real coverage of the
  actual mechanic it used to just guard against.

### Deliberately not built (and why)

- **No DB resolution layer** (`ScenarioAssumptionsV1` + live `person`/`account`/
  `balance_snapshot`/`holding` rows → a real `ResolvedScenario`). `engineTypes.ts`'s
  original doc comment (Milestone 2) attributed "assembling a `ResolvedScenario`" to
  "Milestone 3's job," but M3's own bullet list in the plan only ever specified the
  engine and its tests, not this wiring — corrected in the plan file. M3 as implemented
  is the pure computational core only, exercised entirely by hand-built fixtures in its
  own test suite; no integration test against a real Postgres was needed or written.
  Whoever picks up M8 (scenario CRUD) or wires M7's route handlers needs this resolution
  function and doesn't yet have it.
- **No default flat tax rate** — unchanged gap from the original plan text; still M9's
  job to choose and document one (e.g. basic-rate 20%) as an editable starting
  assumption, not a calibrated figure.
- **No accumulation/contribution phase** — see the judgment call above.

### Fable review

Independent pass, no access to this session's own reasoning. Hand-recomputed (not just
trusted) the closed-form 3%-return test and the tax gross-up test — both correct. Also
independently confirmed: the `DRAWDOWN_ACCOUNT_TYPES` fix is derived correctly and
tested; PCLS can't fire twice for a person; no wrapper balance can ever go negative
(`grossWithdrawn = min(grossNeeded, available)` before every mutation); the sticky
depletion latch never resets; fixed-point rounding is round-half-away-from-zero,
applied consistently. One real finding — the accumulation-phase scope narrowing above —
fixed by correcting the doc comment and the plan file rather than by writing new code.
Two minor gaps noted, not fixed: no test exercises State Pension income exceeding
spending (only the exact-equal case is tested — the surplus-vanishes behaviour is
documented but unexercised); and if a household's real PCLS predates a simulated path's
`currentAge`, correctness depends on the not-yet-built resolution layer setting
`pclsAge: null` for an already-taken PCLS, which is out of this file's scope to enforce.

29 new tests (19 in `deterministicCore.test.ts`, plus regression tests in
`engineTypes.test.ts` and `scenarioAssumptions.test.ts`), full suite 405 passed / 91
skipped (skipped tests need `TEST_DATABASE_URL`, unchanged from before this milestone —
496 total, up from 474). Typecheck and lint both clean.

## Phase 3, Milestone 5: the randomized bootstrap engine

The actual Monte Carlo engine — `src/lib/retirement/engine/bootstrapEngine.ts`'s
`runSimulation(scenario, {iterations, seed})` runs Milestone 3's `simulatePath` many
times over, each iteration's per-year real returns sampled from Milestone 4's 150-year
UK dataset via Milestone 2's seeded RNG, aggregated into a success rate and p10/p50/p90
percentile balance bands (the fan chart's data, once Milestone 9 builds it). `fast-check`
added as a new devDependency for the property-based tests below.

**Historical block bootstrap** (`DEFAULT_BLOCK_LENGTH_YEARS = 10`), not i.i.d. annual
resampling or a parametric distribution — matches "matching ProjectionLab's approach"
(PROPOSAL.md §2) without a second research task to fit and defend a distribution shape.
What block bootstrap adds over i.i.d. is preserved *serial correlation* (mean
reversion/volatility clustering), a different claim from sequence-of-returns risk (which
exists under i.i.d. too, since path order still varies either way) — recorded as a
one-paragraph doc comment in the file itself, on the corrected basis the milestone plan
itself specifies. Each sampled year is blended `equityAllocationRate * equity + (1 −
equityAllocationRate) * gilt` — gilts, not M4's separate bill-rate series, stand in for
the "bonds/cash" side, the conventional defensive-asset proxy in retirement modelling.

### Judgment calls worth knowing about

- **Every iteration draws a fixed 130 years of blocks (`MAX_SIMULATION_YEARS`, the
  absolute ceiling given `scenarioAssumptions.ts`'s own 0–130 age bound), regardless of
  the scenario's actual, usually much shorter, horizon** — `simulatePath` only ever
  reads the years it needs and ignores the rest. This is not wasted work but a
  deliberate design choice: it makes RNG draw *consumption* per iteration
  scenario-independent, so two `runSimulation` calls sharing a seed and differing only
  in starting balance, spending, or horizon produce byte-identical underlying return
  sequences. That shared-prefix property turns the monotonic-success-rate property
  tests below into exact, deterministic guarantees rather than statistical tendencies
  that could occasionally fail — the one piece of reasoning in this milestone subtle
  enough to plausibly be wrong, so it was the primary focus of the Fable review (see
  below), which independently traced the mechanism and confirmed it holds, including
  checking specifically that `equityAllocationRate` (which does vary draw *content*)
  cannot affect draw *count*.
- **Multiplicative compounding is already geometric-mean by construction** — Milestone
  3's `simulatePath` applies each year's growth as `balance × (1 + rate)` per
  individually-sampled path, never a pre-averaged flat rate, so PROPOSAL.md §2's named
  "classic and easy-to-miss bug" (using an arithmetic mean and silently inflating
  success rates) has no code path to occur through. A standing regression test proves
  the magnitude of what it guards against anyway: a hand-picked +20%/−20%/+20%/−20%
  sequence (arithmetic mean exactly 0%) compounds to a real ~7.84% loss (`0.9216×`)
  versus an unchanged balance under flat 0% compounding — hand-verified exact by both
  this session and the Fable review independently, so it can't silently regress later,
  including into any future UI "average return" summary stat.
- **`MAX_ITERATIONS = 10_000`**, matching ProjectionLab's own cited "best-in-class Monte
  Carlo (10,000 runs)" (PROPOSAL.md §1's competitor research) — not an arbitrary round
  number, and enforced as a hard server-side cap regardless of what a caller requests.
- **Convergence check calibrated against real measured numbers, not guessed** —
  matching M4's own "verify, don't assume" discipline. At a scenario tuned near 50%
  success (the highest-variance regime — a scenario that almost always succeeds or
  fails has near-zero variance regardless of iteration count), successRate range across
  independent seeds measured 0.085 at N=200, 0.026 at N=1000, **0.0225 at N=2000**
  (~45ms per `runSimulation` call, single-threaded), 0.0198 at N=5000, 0.0151 at
  N=10000 (the cap). **N=2000 is the recommended production default** — variance
  already within about ±1.1 percentage points of the true rate, comfortably sub-100ms
  even single-threaded, with diminishing returns beyond it. These are the concrete
  numbers Milestone 6/7's worker timeout and Milestone 9's poll interval should cite,
  per the plan's own instruction.

### Deliberately not built (and why)

- **The DB resolution layer is still not built** — unchanged from Milestone 3's own
  note. `runSimulation` takes an already-resolved `ResolvedScenario`; nothing in this
  codebase yet turns a stored `retirement_scenario` row plus live account balances into
  one. Whoever wires Milestone 7's route handlers needs this and doesn't yet have it.
- **No accumulation/contribution phase** — unchanged scope decision from Milestone 3,
  inherited unmodified since `simulatePath` is the thing M5 calls.
- **No default flat tax rate, no SWR-to-spending-figure translation** — both unchanged
  open gaps from M1/M3, still M9's job.

### Fable review

Independent pass, no access to this session's own reasoning. Ran `npx tsc --noEmit` and
the full `bootstrapEngine.test.ts` suite multiple times independently (including the
property-based and convergence tests, the first statistical test suite in this
codebase) to check for flakiness none was found — the tests use fixed seeds throughout,
so "flaky" here could only mean a logic bug, not sampling luck. Independently
re-measured the convergence numbers outside the test file (0.085/0.058/0.026/0.0225/
0.0198 across N=200/500/1000/2000/5000) and got the cited figures almost to the digit;
the actual test's own N=2000/10-seed run measured 0.0195, comfortably clear of its 0.05
threshold, not suspiciously close to it. Hand-verified the geometric-mean regression
test's arithmetic independently and confirmed it. Traced the shared-prefix monotonicity
mechanism precisely (see judgment call above) and confirmed it holds exactly, including
verifying no off-by-one in the block sampler's valid-start-index range (`historicalYears.length
- blockLengthYears + 1` choices; maximum read index lands exactly on the array's last
element, never past it). Confirmed the block bootstrap and gilt-as-bonds-proxy design
decisions are both defensible, not just asserted. No genuine bugs found.

Two cosmetic findings, both fixed: `bootstrapEngine.test.ts` was missing this
milestone's own explicitly-named "100% loss year" and "inflation exceeding returns"
tests at the bootstrap layer specifically (both were already mechanically covered via
Milestone 3's own tests, but not per this milestone's own checklist) — two named tests
added, using the same `historicalYears`/`blockLengthYears` dependency-injection point
(`RunSimulationOptions`) as the existing edge-case tests, matching `fetchGlobalQuote`'s
`fetchImpl` DI pattern. A doc comment misattributed its equity/gilt-blend quote to a
`ResolvedScenario.equityAllocationRate` doc comment that doesn't exist — the real source
is `ScenarioAssumptionsV1.equityAllocationPct` in `scenarioAssumptions.ts` — corrected.

18 new tests in `bootstrapEngine.test.ts`, full suite 423 passed / 91 skipped (514
total, up from 496). Typecheck and lint both clean.

## Phase 3, Milestone 6: `worker_threads` deployment spike

Blocking verification task #2 from the milestone plan — "`worker_threads` survives the
Docker standalone build" — resolved by actually building and running the real image,
not assumed. The plan named two fallback options for getting a worker entry file into
`.next/standalone` (let Next's tracer discover it, or hand-copy a `workers/` directory
via an explicit Dockerfile `COPY`); this session found a third option that needs neither:
Next has no documented/supported bundling story for a `node:worker_threads` entry point,
so betting on its tracer wasn't worth the risk, but a hand-copied directory turned out
unnecessary too.

- **`src/workers/build.ts`** bundles `src/workers/simulationWorker.ts` with `esbuild`
  (new devDependency) into a single self-contained CommonJS file, `pg` and
  `@node-rs/argon2` marked external — the same two packages and the same reasoning as
  `next.config.mjs`'s own `serverComponentsExternalPackages` (prebuilt native binaries a
  bundler can't and shouldn't inline). `scripts/build-worker.ts` (new `npm run
  build:worker` script, chained after `next build` in `npm run build`) writes that
  bundle straight to `.next/standalone/workers/simulationWorker.js`. Because the
  Dockerfile's `runner` stage already does `COPY --from=builder .../.next/standalone
  ./`, the worker file rides along for free — **zero Dockerfile or `next.config.mjs`
  changes needed.** Confirmed by a real `docker build`: the build log shows `Built
  /app/.next/standalone/workers/simulationWorker.js` during the `builder` stage, and the
  file (with `node_modules/pg` sitting right alongside it, already traced in for the
  main app) is present at `/app/workers/simulationWorker.js` in the resulting `runner`
  image, unmodified from what shipped it.
- **`src/workers/simulationWorker.ts`** — not a literal no-op stub: it runs the real
  `runSimulation` (M5) against a small hand-built fixture `ResolvedScenario`, proving the
  bundle can load and execute real app code (bigint arithmetic, `taxYearConfig.ts`'s
  State Pension figure, Drizzle writes) through esbuild, not just that a thread can
  start. Reads `workerData: { simulationRunId }`, writes `status: 'complete'` +
  `result` or `status: 'failed'` + `errorDetail` back to its `simulation_run` row.
- **`src/lib/retirement/simulationResultCodec.ts`** — a real gap found while building
  this, not anticipated by the milestone plan: `simulation_run.result` is `jsonb`, and
  `SimulationResult` carries `bigint` pence (`percentileBandsPence`) — `JSON.stringify`
  throws on a raw `bigint`, so nothing could actually persist a result until something
  converted to/from a JSON-safe shape. Nothing needed this before M6 (M1's `assumptions`
  JSONB has no bigints). `serializeSimulationResult`/`deserializeSimulationResult`, kept
  narrow and hand-validated like `scenarioAssumptions.ts`, not a generic bigint-aware
  JSON replacer.
- **`src/lib/db/schema.ts`**: `'cancelled'` added to `simulationRunStatus` (was
  `running|complete|failed`) — migration `drizzle/0005_public_raider.sql`, the first
  enum-*append* migration in this repo (every prior enum migration created one fresh).
  `ALTER TYPE ... ADD VALUE 'cancelled'` applied cleanly both against the scratch
  Postgres the integration test suite uses and inside the real Docker spike's `migrate`
  container — genuinely verified, not just generated and assumed to work.
- **`src/lib/retirement/workerHarness.ts`** — `spawnSimulationWorker`/
  `cancelSimulationRun`, the real infrastructure M7's route handlers will call directly,
  built now rather than as throwaway test scaffolding.

### Judgment calls worth knowing about

- **Cancellation is decided in the database by the caller, never by the worker's own
  cleanup.** `worker.terminate()` stops a thread "as soon as possible" with no
  guaranteed graceful `finally`, so a worker can't reliably report its own cancellation
  once asked to stop. `cancelSimulationRun` writes `status = 'cancelled'` itself
  (guarded by `WHERE status = 'running'`) *before* calling `terminate()`. The worker's
  own completion/failure writes use the identical guard, so whichever write actually
  lands first — the cancel, or the worker finishing a moment before it's told to stop —
  wins cleanly: the loser's `UPDATE` matches zero rows instead of overwriting a terminal
  status. Same CAS-guard pattern this codebase already uses elsewhere (`createHousehold`'s
  singleton index, `updateBalanceSnapshot`'s collision guard).
- **A worker-internal timeout is cooperative, not preemptive — documented as a real
  limitation rather than overclaimed.** A `setTimeout` on the worker's own event loop
  cannot interrupt a genuinely long-running *synchronous* loop, since the timer callback
  can't fire until that loop yields. `runSimulation` is an unchunked synchronous loop
  today, so `simulationWorker.ts`'s own `runWithTimeout` only actually cuts a
  computation short if given the chance to check — real insurance for the fixture's fast
  computation, not a guarantee for a hypothetical pathological one. The genuine hard
  stop for a truly runaway computation is the *parent's* `worker.terminate()`, which
  this milestone separately proves works. Both mechanisms are real and tested; neither
  is a substitute for the other.
- **A Node worker's own `process.env` inheritance made the multi-connection-pool problem
  disappear rather than needing to be solved.** `getDb()`/`getPool()`
  (`src/lib/db/client.ts`) cache a `Pool` on `globalThis` — a worker thread gets its own
  `globalThis`, so calling `getDb()` inside the worker transparently constructs its own
  separate connection, with `DATABASE_URL` inherited from the parent process at `Worker`
  construction time. No code change was needed for this to work correctly.
- **A real bug found while building the integration test, not by inspection**: without
  explicitly closing the worker's own `pg` `Pool` before `main()` returns, the worker
  thread never fired its `exit` event — an idle-but-open connection pool (`pg`'s
  `idleTimeoutMillis: 30_000`) kept the thread's event loop alive for up to 30 seconds
  after the actual work was done. Fixed with a `finally { await getPool().end(); }`
  around the whole of `main()`, on both the success and failure paths.
- **The exit code a terminated worker reports turned out not to be a reliable "was it
  genuinely mid-run" signal on its own — verified empirically, and the test design
  changed as a result.** An early version of the termination test called
  `cancelSimulationRun` immediately after `new Worker(...)`, racing the bundle's own
  load/evaluation time (drizzle-orm, `pg`, the embedded 150-year JST dataset are not
  free to parse) — sometimes terminating the thread before it had genuinely begun
  running `main()`, which is not what "prove the worker can be terminated mid-run" is
  supposed to demonstrate. Fixed by having the worker `postMessage({ type: 'started' })`
  as the first thing `main()` does, and having the test wait for that message before
  cancelling — a real synchronization point instead of a timing guess. With that fix,
  Node reliably reports exit code `1` for a `terminate()`'d worker versus `0` for a
  normal completion, confirmed both in the vitest integration test and independently
  inside the real Docker container during the spike below — but the test itself asserts
  on the row's final state (`cancelled`, and never later overwritten to `complete`)
  rather than pinning the exact numeric exit code, since that row state is what M7/M9
  actually depend on and the exit code is an implementation detail undocumented by Node.

### Real Docker verification

Docker is genuinely usable in this session's environment (`docker info` succeeds) —
unlike every prior phase, which had to record "not verified — no real Docker access" as
an open gap. **The household's real stack was live throughout** (`financial-planning-app-1`/
`financial-planning-db-1`, healthy, bound to the standard `127.0.0.1:3000`/`:5432`), so
verification ran as a fully separate Compose project (`fp-m6-spike`, its own compose
file rather than an override of the real one, its own scratch `.env`, remapped host
ports `13000`/`15432`, its own disposable named volume) — never touching the real
`.env`, `docker-compose.yml`'s actual services, or the running containers at any point.
Confirmed via `docker ps` before and after that only `financial-planning-app-1`/
`financial-planning-db-1` remained running, and the spike's images, containers, network,
and volume were all removed afterward.

Sequence, all against the real Dockerfile/build context: `docker compose build` (the
real multi-stage build — `deps` → `builder` running `npm run build` → `runner`) →
`docker compose run --rm migrate` (confirmed the `cancelled` enum migration applies
cleanly from empty) → `docker compose up -d db app`, waited for the real `/api/health`
healthcheck to report healthy (real containerized Postgres connectivity, not mocked) →
`docker exec`'d into the running `app` container and confirmed
`/app/workers/simulationWorker.js` and `/app/node_modules/pg` both present → ran two
one-off Node scripts inside that same container, against that same containerized
Postgres, seeding a real `simulation_run` row and exercising both required paths:

1. **Completion**: spawned the real worker against the real row — `running` → `complete`
   with a non-null `result`, exit code `0`.
2. **Termination**: spawned the real worker, waited for its `started` message, called
   the same cancel-then-terminate sequence `cancelSimulationRun` uses — row ended
   `cancelled` with no `result`, confirmed still `cancelled` after waiting past the point
   the fixture computation would otherwise have finished, exit code `1`.

Both matched the vitest integration test's own results exactly — the real containerized
environment behaves the same as the test environment, which is the actual thing this
milestone exists to establish confidence in.

### Deliberately not built (and why)

- **The DB resolution layer is still not built** — unchanged from M3/M5's own notes.
  `simulationWorker.ts` runs a hand-built fixture scenario, not one resolved from a real
  `retirement_scenario` row plus live account data. Whoever wires M7's route handlers
  needs this and doesn't yet have it.
- **No accumulation/contribution phase, no default flat tax rate** — both unchanged,
  inherited scope decisions from M3, not this milestone's concern.
- **`workerHarness.ts` is not wired into any route handler yet** — that's M7, which is
  now unblocked (`M1 + M5 + M6` are all done) but not started. `sameOriginGuard`
  (`src/lib/auth/csrf.ts`) is still implemented, tested, and has zero call sites — M7's
  route handlers remain the first that must call it.

### Fable review

Independent pass, no access to this session's own reasoning — same posture as every
prior milestone review. Verified rather than just read: ran `npx tsc --noEmit` and
`npm run lint` directly; ran a real `npm run build` from scratch and inspected
`.next/standalone` itself, confirming `workers/simulationWorker.js` and
`node_modules/pg` are both genuinely present and that Node's own module resolution
(`require.resolve('pg', {paths: [...]})`) finds `pg` from the worker's directory; spun
up its own scratch Postgres and ran `simulationWorker.integration.test.ts` for real
rather than trusting the session's reported result; wrote and ran (then deleted) an
extra scratch script exercising `cancelSimulationRun` against an *already-completed*
run — a case this milestone's own shipped tests didn't cover — and confirmed the
`WHERE status='running'` guard leaves the row untouched and `terminate()` on an
already-exited worker doesn't throw.

**Confirmed correct, worth recording so it isn't re-litigated**: the cancellation race
is genuinely closed in every interleaving (worker-finishes-first and cancel-first both
verified empirically, not just reasoned through) because Postgres serializes the two
single-statement `UPDATE`s via ordinary row-level locking; `finally { await
getPool().end(); }` cannot drop a pending write, since both the success and failure
branches already `await` their `UPDATE` before reaching it; the esbuild-into-
`.next/standalone` bundling is sound as actually built, not just as designed; build
ordering can't ship one of {worker bundle, `.next/standalone`} without the other, since
`build:worker` runs inside the same Docker `builder` stage before the `runner` stage's
copy; the `'cancelled'` enum migration applies cleanly from empty and nothing downstream
still assumes the old 3-value enum.

**One real finding, more serious than this session's own original write-up admitted,
and fixed**: `runWithTimeout` (as first written) raced a `Promise.race` between the
synchronous `run()` call and a `setTimeout`, described here as "cooperative... cuts a
computation short if given the chance to check." Fable review proved that description
was too generous — it wasn't weak protection, it was **dead code that could never fire
under any circumstances**, verified empirically with an isolated repro: `run` is
scheduled as a microtask via `Promise.resolve().then(run)`, and Node/V8 always fully
drains the microtask queue before the event loop ever reaches the timer phase, so for a
synchronous `run` (which `runSimulation` is), the timeout branch of that race could not
win regardless of `timeoutMs` or how long `run()` actually took. **Fixed** by replacing
it with `runWithBudgetCheck`, which runs the computation, checks elapsed wall-clock time
*afterward*, and reports a `failed` status (with a `WorkerTimeoutError` naming the
overrun) if the budget was exceeded — an honest "detect after the fact," not a
preemptive stop, since nothing running on the same thread can preempt a synchronous
loop. The real (and only) mid-run stop remains the parent's `worker.terminate()`,
already proven separately. A new test (`reports a run that overruns its budget as
failed, not complete`, using `timeoutMs: 0` to force a deterministic overrun) exercises
this and, not incidentally, is also the first test to exercise the worker's `failed`-
status write path at all — the second finding below.

**Two smaller findings, both fixed**: `deserializeSimulationResult`'s final `BigInt(entry)`
call was unguarded — every other validation step in that function threw a
`SimulationResultCodecError`, but a string that isn't a valid bigint literal (e.g.
`"not-a-bigint"`) threw a raw `SyntaxError` instead, breaking a caller that catches the
module's own error type specifically. Fixed by wrapping the conversion in a try/catch;
new regression test in `simulationResultCodec.test.ts` (also new — this module previously
had no dedicated unit test file, only indirect coverage through the integration test's
round-trip assertions). Separately, the worker's `catch` branch (`status: 'failed'` +
`errorDetail` write) had no test at all before this review — both shipped tests only
ever exercised the success and cancellation paths — closed by the same new budget-
overrun test above.

6 new tests total from this review pass (1 in `simulationWorker.integration.test.ts`, 5
in the new `simulationResultCodec.test.ts`), on top of the 2 tests M6 shipped with. Full
suite 428 passed / 94 skipped without a scratch Postgres (522 total, up from 514 before
M6, 516 after M6's own initial tests), all 522 passing against a real `TEST_DATABASE_URL`.
Typecheck and lint both clean.

## Phase 3, Milestone 7: compute-persist-poll route handlers

The three things M3/M5/M6 all flagged and left unbuilt: the DB resolution layer, the
route handlers that actually let a household trigger a run, and staleness
reconciliation for a run whose worker never reports back. These are the first mutating
route handlers in this codebase — `sameOriginGuard` (`src/lib/auth/csrf.ts`), tested
since Phase 0 with zero call sites, finally has real callers.

- **`src/lib/retirement/resolveScenario.ts`** — `resolveScenario(scenarioId,
  householdId)`, the function `engineTypes.ts`'s original doc comment wrongly attributed
  to Milestone 3. Turns a stored `retirement_scenario` row into a real `ResolvedScenario`:
  parses the JSONB via `parseScenarioAssumptions`, resolves each person's State Pension
  defaults from `taxYearConfig.ts` (or their scenario override), and aggregates starting
  balances per drawdown wrapper type from `getAccountsWithBalances`. Returns `null` for
  not-found-or-not-owned, matching `getAccountDetail`'s existing convention.
- **`src/workers/simulationWorker.ts` rewired to take a real scenario.** M6's own
  `fixtureScenario()` (always a spike placeholder, its own doc comment said so) moved
  into `simulationWorker.integration.test.ts`, which now builds and passes it explicitly.
  `SimulationWorkerData` gained `scenario`/`iterations`/`seed`, threaded straight through
  from the route handler — **no bigint codec needed for this direction**: `workerData`
  uses Node's structured-clone algorithm, which natively supports `bigint` (unlike
  `JSON.stringify`, which is exactly why `simulationResultCodec.ts` exists for the
  *outbound* result write). Confirmed by the route-handler tests actually passing, not
  assumed from the structured-clone spec alone.
- **Three new route handlers** under `src/app/api/retirement/simulation-runs/`:
  - `POST /` — body `{ scenarioId, iterations? }`. `sameOriginGuard` first; validates
    `iterations` against `bootstrapEngine.ts`'s `MAX_ITERATIONS` before touching the
    database (bad input shouldn't become a `failed` run row); resolves the household via
    the existing `getSetupState()`; `resolveScenario`s the scenario (404 if not found/not
    owned); generates a fresh non-cryptographic seed; inserts the `running` row; spawns
    the worker. A synchronous spawn failure is caught and written back as `failed`
    immediately, not left for staleness reconciliation to eventually notice. Returns
    `202` with the new row.
  - `GET /[id]` — household-scoped (joins through `retirement_scenario.household_id`).
    **Staleness reconciliation**: a `running` row older than 60s (double the worker's own
    30s `DEFAULT_TIMEOUT_MS` budget, so a legitimately-still-computing run is never
    mistaken for an abandoned one) is rewritten to `failed` before being returned. The
    reconciling `UPDATE` is itself guarded by `WHERE status = 'running'`, so a run that
    finishes in the window between the initial read and the reconciliation write doesn't
    get its real result clobbered — the guard matches zero rows and the handler re-reads
    instead of trusting its own stale guess. `result` is returned exactly as stored
    (already the JSON-safe string-encoded form `simulationResultCodec.ts` writes) — never
    round-tripped through `deserializeSimulationResult` first, which would produce real
    `bigint`s only to have `Response.json`'s own `JSON.stringify` immediately reject them.
  - `POST /[id]/cancel` — idempotent (cancelling an already-terminal run just returns its
    current state, matching M6 Fable review's own finding that this is harmless). Looks
    up a live `Worker` in `workerHarness.ts`'s new in-memory registry; if found, the real
    `cancelSimulationRun` runs (guarded DB write + `terminate()`); if not — the process
    restarted since the run started, so whatever worker there was already died with it —
    just the same guarded DB write, with nothing left to terminate.
- **`src/lib/retirement/workerHarness.ts`'s new `Map<simulationRunId, Worker>` registry**,
  `globalThis`-cached the same way `src/lib/db/client.ts` caches its connection pool.
  Needed because `POST /` (which creates the `Worker`) and `POST /[id]/cancel` (which
  needs to call `.terminate()` on that exact instance) are two separate HTTP requests —
  the object only lives in the first request's JS heap unless something keeps a
  reference. Entries are removed automatically on each worker's own `exit` event,
  however it exits.

### Judgment calls worth knowing about

- **Starting balances always come from `balance_snapshot`, uniformly across every
  account type — never priced holdings, even for `holdsSecurities` accounts.**
  `docs/STATUS.md` already documents that holdings and account balance can silently
  drift apart (`addHolding` never writes `balance_snapshot`) and calls that "wanted, not
  yet scoped." `resolveScenario` doesn't invent a hybrid heuristic (e.g. "prefer priced
  holdings when available, fall back to balance otherwise") to paper over that — every
  other part of the app (net worth, dashboard) already treats the account's recorded
  balance as authoritative, and this does the same, inheriting the same documented
  limitation rather than adding a second, untested way to resolve it.
- **`statePensionClaimAge`, when not overridden, is derived from `taxYearConfig.ts`'s
  `statePensionDate(dob)` by rounding the fractional age at that date *up* to the
  nearest whole year** (conservative — assumes the State Pension arrives no earlier than
  reality, never optimistic). New `ageAsOf`/`statePensionClaimAgeFromDate` helpers in
  `resolveScenario.ts` — nothing existing in this codebase computed an age from a date of
  birth (checked); `taxYearConfig.ts` deliberately works in dates, not ages, by M1's own
  design. This only matters for the two narrow transitional birth-date bands (66→67,
  67→68); the household's own real people (Alex b.1985, Jordan b.1987) are in the
  flat-68 band, where `statePensionDate` always lands exactly on a birthday and this
  reduces to an exact integer with no rounding at all. Both helpers are exported and
  directly unit-tested (`resolveScenario.test.ts`) for the boundary cases, separately
  from `resolveScenario.integration.test.ts`'s DB-backed wiring test.
- **A running worker's cancel path needs an in-memory registry, not just the database.**
  Covered above — the alternative (looking the worker up some other way) doesn't exist;
  a `Worker` object is a live in-process handle with no serializable identity beyond
  what the spawning process itself remembers.
- **A fresh seed is generated per run** (`Math.floor(Math.random() * 2 ** 31)`, not
  cryptographically random — `src/lib/retirement/rng.ts` already documents this module's
  RNG as not needing crypto strength) so re-running the same scenario resamples rather
  than always landing on an identical result, while still recording the seed on the row
  for the reproducibility `docs/PROPOSAL.md` names as the whole point of a seeded RNG.

### Deliberately not built (and why)

- **No cancellation UI, no polling client, no Scenario Editor/Results screens** — that's
  M9. This milestone is the API surface those screens will call.
- **No route yet actually gets used by anything** — M8 (scenario CRUD) hasn't been built,
  so there's no way for a household to create a `retirement_scenario` row at all outside
  a test seeding one directly. `POST /simulation-runs` is fully functional against any
  scenario that exists, but nothing in the app UI creates one yet.
- **Contribution/accumulation-phase data still isn't wired in** — unchanged scope
  decision from M3, inherited unmodified since `resolveScenario` only surfaces what
  `runSimulation` already consumes.

26 new tests: 7 unit (`ageAsOf`/`statePensionClaimAgeFromDate` boundary cases,
`resolveScenario.test.ts`), 4 integration for `resolveScenario` itself, and 5 each
across the three new route-handler test files (`POST /`, `GET /[id]`,
`POST /[id]/cancel`). Full suite 548 passing (up from 522). Typecheck and lint both
clean.

### Fable review

Independent pass, no access to this session's own reasoning — same posture as every
prior milestone. Ran `npx tsc --noEmit`, `npm run lint`, and the full suite against its
own scratch Postgres rather than trusting this session's reported results. Went further
than reading: wrote and ran (then deleted) several throwaway scratch probes — a
leap-year (29 February DOB) case for `ageAsOf`/`statePensionClaimAgeFromDate` hand-traced
against `taxYearConfig.ts`'s real date-clamping behaviour; a real two-thread
`node:worker_threads` script confirming `workerData`'s structured-clone algorithm
genuinely preserves a `bigint` intact (`typeof === 'bigint'`, exact value, even nested)
while `JSON.stringify` on the same value throws — the claim in `simulationWorker.ts`'s
comment, verified empirically rather than accepted as asserted; `worker.terminate()`
called twice concurrently and again on an already-exited worker, both resolving cleanly
with no throw; and ten concurrent `GET` requests fired at the same artificially-stale
`running` row, all ten converging on one identical reconciled response — the staleness
guard's race-safety demonstrated under real concurrency, not just inspected.

**No genuine bugs found** — the first milestone in this repo's own review history where
independent re-derivation and active probing turned up nothing to fix. Specifically
confirmed, worth recording so it isn't re-litigated: the `MM-DD` string-slice comparison
in `statePensionClaimAgeFromDate` is safe because every date it ever sees is a
strictly-zero-padded `YYYY-MM-DD` string (enforced by the `person.date_of_birth` column
and `statePensionDate`'s own regex guard), so there's no single/double-digit ambiguity;
`getAccountsWithBalances` never returns an empty-string `latestAmount` (always a real
NUMERIC string or `null`), so `resolveScenario`'s ternary handling a genuine £0.00
balance is safe; non-GBP `account.currency` is unreachable from any UI/API path today
(confirmed against this repo's own prior finding that it never varies from its schema
default), so `resolveScenario` ignoring it matches the app's existing posture rather
than opening a new gap; the generated seed's `[0, 2^31 − 1]` range fits Postgres
`integer` exactly with no floating-point rounding risk at that magnitude; and the
household-scoping `WHERE` joins in `resolveScenario`/`GET /[id]`/`cancel/route.ts` are
real, would-enforce-isolation conditions, not merely passing because only one household
exists today (confirmed via `resolveScenario`'s own mismatched-householdId test, and via
directly confirming `household_singleton`'s DB-level uniqueness).

## Phase 3, Milestone 8: retirement scenario CRUD

Pure CRUD, needing only M1's schema: nothing until now let a household create a
`retirement_scenario` row at all — M7's API had no scenario to run against outside a
test seeding one directly. No UI, no route, no nav — that's M9, which needs both M7
(done) and this.

- **`src/lib/retirement/actions.ts`** — `createScenario`, `updateScenario`,
  `duplicateScenario`, `deleteScenario`, mirroring `household/actions.ts`'s exact shape
  (`fieldValues` → `requireHouseholdId()` → ownership-scoped lookups → `db.transaction`
  → `logAndWrap` → `revalidatePath`). **`ActionResult` is imported directly from
  `household/actions.ts`, not redefined** — `src/lib/ui/useActionForm.ts` is currently
  hardcoded to that exact type, so M9 can use these actions with it unmodified.
- **`src/lib/retirement/queries.ts`** — `getScenarios` (list, baseline first), `getScenario`
  (single, `null` if not found/not owned), `getScenarioWithLatestRun` (joins the most
  recent `simulation_run`, serving `DESIGN_SPEC.md`'s own flow text: "shows the most
  recent scenario's assumptions and its last-computed results").

### Judgment calls worth knowing about

- **`DESIGN_SPEC.md` never actually specifies a "Duplicate" button or a scenario list
  screen** — checked directly, not assumed. Its own Compare flow only offers "pick an
  existing saved scenario" or "create a new one" (the ordinary New-scenario path).
  `duplicateScenario` is the milestone plan's own named mechanism for supporting
  "retire at 60 vs. 65" without a full what-if engine, kept per that plan's explicit
  instruction — just not something the design doc itself calls for by that name, worth
  knowing before M9 designs the actual UI around it.
- **No new field-level validator invented.** `parseScenarioAssumptions` is already the
  single source of truth for `ScenarioAssumptionsV1`'s shape. Rather than build a second
  `FieldErrors`-keyed validator ahead of a form that doesn't exist yet (M9 hasn't
  designed the Scenario Editor's actual fields), `createScenario`/`updateScenario` take
  the assumptions as one JSON-encoded `assumptions` field and run it straight through
  the existing parser, turning a thrown `ScenarioAssumptionsParseError` into a single
  `formError`. `name`/`isBaseline` stay ordinary scalar fields.
- **`personId` references are validated against real household people at write time**,
  not left for `resolveScenario` to discover later at run time when a scenario actually
  runs — fail at the boundary, matching this codebase's standing posture.
- **The "exactly one baseline scenario" invariant is application-level, not
  DB-enforced** (M1's own doc comment says so explicitly — no unique partial index backs
  it, unlike `household_singleton`). `createScenario`/`updateScenario` setting
  `isBaseline: true` unset it on the household's other scenarios inside the same
  transaction. `duplicateScenario`'s copy always starts `isBaseline: false` regardless of
  the source, since duplicating is for a comparison variant, not for replacing the
  baseline.
- **`duplicateScenario` re-validates the source's assumptions through
  `parseScenarioAssumptions` rather than copying the stored JSONB blindly** — the source
  row was valid when it was written, but the parser stays the single source of truth for
  what's safe to persist under a new row, the same discipline every other write in this
  file applies.
- **`deleteScenario` added beyond the milestone plan's three named actions**, matching
  the completeness bar every other entity in this codebase already has (accounts,
  holdings, balance snapshots, pension contributions all have a delete path).
  `simulation_run` already `ON DELETE CASCADE`s to its scenario (M1's own design — "a run
  has no meaning without the scenario it simulated"), so deleting a scenario deletes its
  run history too; not special-cased in the action, since the consequence belongs in
  whatever confirmation copy M9's UI shows before calling it.

### Deliberately not built (and why)

- **No UI, route, or nav** — M9's job. `src/app/layout.tsx` is still a bare shell with no
  nav component of any kind; a `/retirement` route tree doesn't exist yet.
- **No default UK-calibrated assumptions pre-fill** — DESIGN_SPEC.md wants "sensible
  UK-calibrated defaults pre-filled, not blank fields," but that's a form-rendering
  concern for M9's actual Scenario Editor, not this action layer, which just validates
  and persists whatever assumptions blob it's given.

14 new tests (`scenarioCrud.integration.test.ts`, covering create/update/duplicate/delete
happy paths, the baseline-invariant enforcement, rejecting a `personId` outside the
household, malformed/rejected assumptions, not-found ownership checks, and the
cascade-delete of `simulation_run` rows). Full suite 562 passing (up from 548). Typecheck
and lint both clean.

### Fable review

Independent pass, no access to this session's own reasoning. Ran `npx tsc --noEmit`,
`npm run lint`, and the full suite against its own scratch Postgres (562/562, matching
the claimed count). Wrote and ran (then deleted) two throwaway scratch scripts probing
the one genuine correctness question code-reading alone couldn't settle: a two-writer
concurrency probe for the baseline invariant, and a re-validation-failure probe for
`duplicateScenario`.

**One real, empirically-reproduced bug, found and fixed**: the baseline-invariant
transaction's own doc comment claimed two concurrent writers could never both land a
`true` row — wrong, and disproved with real concurrent Postgres transactions, not just
reasoned about. Two concurrent `createScenario(..., isBaseline: true)` calls on an
empty table both committed, leaving two `true` rows (reproduced 3/3 runs); two
concurrent `updateScenario` calls each targeting a different pre-existing scenario also
both committed (also 3/3). Root cause: Postgres READ COMMITTED re-evaluates a blocked
`UPDATE`'s `WHERE` clause only against the specific row it conflicted on, using that
row's post-commit value — it never re-scans for a row the *other* transaction inserted
or changed after the blocked statement's own scan began, so `unsetOtherBaselines` is
structurally blind to a sibling transaction's own soon-to-be-true row. The review's own
diagnosis: this needed a database backstop, the same shape `household_singleton`
already uses for the equivalent single-row race, not more application-level transaction
logic (which can't fix this under READ COMMITTED without much heavier locking).
**Fixed**: a partial unique index, `retirement_scenario_one_baseline_per_household`
(`ON retirement_scenario (household_id) WHERE is_baseline = true`, migration
`drizzle/0006_certain_captain_marvel.sql`), plus `createScenario`/`updateScenario`
catching the resulting `23505` and returning a clear "Another scenario just became the
baseline. Reload and try again." rather than the generic save-failure banner.
`unsetOtherBaselines` itself is kept as a first-line, best-effort step (correct and
sufficient in the overwhelmingly common non-concurrent case) with its doc comment
corrected to say plainly that it is not the actual invariant enforcement. Two new
regression tests: one proving the database itself deterministically rejects a second
baseline row (no race timing needed — the real, load-bearing guarantee), one checking
the application-level "at most one baseline survives" invariant under concurrent calls
without asserting exactly which one must lose (Promise.all doesn't reliably force two
Node requests' underlying transactions to genuinely overlap, as this session's own first
attempt at a stricter test discovered when it failed — both calls happened to succeed
sequentially-enough to both correctly see and unset the other's already-committed row).
- **Second finding, smaller, also fixed**: `duplicateScenario` never re-checked
  `personId` household-membership, unlike `createScenario`/`updateScenario`, which both
  do on every write. Currently unreachable (no `deletePerson` action exists anywhere in
  this codebase to create a dangling reference), but a real inconsistency across the
  three actions that persist an assumptions blob — fixed by adding the same
  `allPersonIdsBelongToHousehold` check before `duplicateScenario`'s transaction, with a
  regression test that manually deletes the referenced person (simulating the
  not-yet-built delete path) and confirms duplication is now rejected.
- **Third finding, cosmetic, also fixed**: `duplicateScenario`'s re-validation failure
  fell through to the generic `"Couldn't save this right now"` instead of the specific
  `ScenarioAssumptionsParseError` message `createScenario`/`updateScenario` both surface.
  Fixed to match; regression test inserts a scenario with intentionally-invalid stored
  assumptions (bypassing the action layer, simulating a row saved under looser rules a
  later app version tightened) and confirms the specific error reaches the caller.

**Checked and confirmed correct, worth recording so it isn't re-litigated**: `ON DELETE
CASCADE` is real at the migration level (`drizzle/0004_retirement_scenario.sql`), not
just the doc comment, and the delete test genuinely exercises it (inserts a real
`simulation_run` row before deleting, not asserting against an already-empty table);
`ActionResult` reuse from `household/actions.ts` typechecks cleanly end-to-end with no
adapter or cast bridging the two modules; `personId` validation runs before any write,
on every call, in both `createScenario` and `updateScenario`; household-scoping `WHERE`
joins are genuine, would-enforce-isolation conditions, not merely passing because only
one real household exists today; `getScenarios`' `desc(isBaseline), desc(createdAt)`
ordering is correct (Postgres orders `false < true`, so `DESC` puts the baseline first).

4 new tests from this review (2 for the baseline race, 2 for `duplicateScenario`'s
gaps), on top of the 14 M8 shipped with. Full suite 566 passing (up from 548 before M8,
562 after M8's own initial tests). Typecheck and lint both clean.

## Phase 3, Milestone 9: Retirement Planner UI

The three screens `docs/DESIGN_SPEC.md` specifies — Scenario Editor (`/retirement/new`,
`/retirement/:id/edit`), Results (`/retirement/:id`), Comparison
(`/retirement/compare?a=:id&b=:id`) — plus the bare `/retirement` entry point and the
nav wiring, closing out the last gap between the engine (M1–M8) and a household actually
being able to use it. `recharts` (new dependency) powers the fan chart, a deliberate
departure from every other chart in the app (hand-rolled SVG) — chosen with the household
for tooltip/touch quality, on the reasoning that it may also pay off for Phase 4's stock
workbench later.

**A real bug, found only by driving a real browser against a real worker-thread run** —
matching Phase 1/2's own history of catching exactly this class of bug no unit test
could see. The Scenario Editor's "dirty" indicator (whether the results shown are stale
relative to unsaved edits) compared the current `name`/`isBaseline` fields against the
component's fixed `initialName`/`initialIsBaseline` props — which never change again
after mount. For a brand-new scenario, `initialName` is always `""`; typing any name at
all (i.e. every real use) meant the editor read as permanently dirty, even the instant
after a successful run, so the "View full results" link never appeared. Fixed by
snapshotting `{name, isBaseline, values}` together at the moment of the *last successful
run* and comparing against that instead of the static initial props
(`ScenarioEditorForm.tsx`); `useScenarioRunner.run()` now returns whether it actually
got as far as starting a run, since checking `formError` after an `await` on stale
closure state proved unreliable. A regression test for the exact scenario (empty
`initialName`, a name typed in, run to completion) now covers it.

**A second, environment-level finding, not a code bug**: `workerHarness.ts`'s worker
bundle path assumes the Docker `output: standalone` layout (`.next/standalone/workers/`)
unconditionally — correct for the real deployed app (`deploy.sh`/`docker compose`,
verified working end-to-end), but `next start` run directly on the host (which is what
`playwright.config.ts`'s E2E `webServer` uses) puts the bundle in a different place
relative to `process.cwd()`, so a simulation silently fails to start with
`MODULE_NOT_FOUND` unless `SIMULATION_WORKER_BUNDLE_PATH` is set — the existing
test-only override, previously only exercised by M6/M7's own narrower test suites, not
by a full browser journey. Not fixed in `workerHarness.ts` itself (would mean guessing
at a second, non-Docker deployment shape this app doesn't otherwise support) — worth
knowing if `e2e/retirement.spec.ts` is ever run again outside this session: set
`SIMULATION_WORKER_BUNDLE_PATH` to the absolute path of the built
`.next/standalone/workers/simulationWorker.js` first.

**Judgment calls made explicitly, several confirmed with the household before
implementation**:
- **"Run simulation" saves the scenario and starts a run in one sequence** — no separate
  Save button, no autosave-on-blur. The design spec shows no Save button anywhere, and
  its "Discard unsaved changes?" copy only makes sense under this reading.
- **Success-band thresholds ("Strong"/"On track"/"At risk") are per-scenario**, relative
  to that scenario's own `targetSuccessRatePct` (Strong ≥ target+10pp, On track ≥
  target, At risk below) — confirmed with the household, including that this makes
  "Strong" near-unreachable for an already-ambitious ≥90% target, by design.
- **Only the browser tab that started a run locks its own editor** — confirmed with the
  household. A different visit to the same scenario mid-run sees the Computing state but
  stays editable, and can start an independent second run.
- **Bare `/retirement` with zero scenarios ever created** → `redirect('/retirement/new')`;
  otherwise → the household's baseline-first-then-newest scenario (`getScenarios`'
  existing M8 ordering, not a second "most recently touched" notion).
- **UK-calibrated defaults** for a brand-new scenario match what this codebase's own
  existing tests already treat as canonical (inflation 2.5%, equity allocation 60%,
  target success rate 90%, flat tax 20%) rather than inventing fresh numbers;
  `annualSpending` (£30,000) is the one genuinely arbitrary figure, immediately editable.
  Default withdrawal order (`cash → gia → cash_isa → ss_isa → lisa → sipp_pension`) is a
  common UK decumulation convention, not the engine's own recommendation — it applies
  whatever order it's given literally, with no optimisation, per M3's own design.
- **The fan chart's age axis always plots `people[0]`** (the scenario's first-listed
  person) and is computed from **the run's own `createdAt`, not "today"** — a run's
  simulated ages are fixed at the moment it was created; recomputing from today's date on
  a later page view would silently drift the axis out of sync with what was actually
  simulated.

**Deliberately scoped down, for time**: the Comparison screen's delta callout and
assumptions-diff table are computed from each side's data **at page load**, not
reactively if a re-run is triggered from that same screen without a reload — matching
the spec's own "each side independently" framing without lifting both sides' polling
state into one shared component. The wrapper-withdrawal-order editor is a fixed
6-item reorderable list (up/down buttons), not a way to omit a wrapper the household
doesn't hold — omitting one from a full list is functionally a no-op step, not
incorrect, so this wasn't blocking.

629 tests passing (up from 566). Typecheck, lint, and a full `npm run build` all clean,
including the new `recharts` dependency. Browser-verified in both light and dark mode
(fan chart, band indicator, comparison layout) via screenshot, separately from the
automated E2E run.

### Independent Fable review — three real, verified bugs found and fixed

Held to this codebase's own established bar for these reviews (M8's own review
reproduced its race condition 3/3 runs against a real Postgres before treating it as
confirmed, not just theorized from reading the code) — the reviewer independently wrote
reproduction tests for each finding before reporting it, not just read the code and
guessed.

1. **(High) A second "Run simulation" click from `/retirement/new` created a duplicate
   scenario instead of updating the one just created.** `ScenarioEditorForm`'s
   create-vs-update branch used the `scenarioId` *prop* (always `null` on the New
   Scenario page, and never updated after mount — deliberately, to avoid remounting the
   component mid-run via a URL change). So editing an assumption and running again,
   without navigating away — an entirely ordinary workflow — silently created a second
   "Baseline" row each time, and, if "Set as baseline" was checked, repeatedly stole the
   baseline flag from the previous duplicate. Fixed with a local `effectiveScenarioId`
   state, seeded from the prop and switched to the newly-created id once a save
   succeeds — deliberately *not* a URL change, to preserve the no-remount property the
   original code was already protecting.
2. **(Medium) A genuine race window left the editor briefly unlocked while a run was
   actually in flight.** `locked` was computed as `poll.run?.status === 'running'`, but
   right after a run starts, `poll.run` is still `null` for one network round trip (its
   own first poll hasn't resolved) — during that gap the fieldset was editable and "Run
   simulation" was clickable again, which could re-trigger Finding 1 via a fast
   double-click. Fixed by locking whenever a run is active and *not yet confirmed
   terminal*, rather than only when it's confirmed running.
3. **(Medium) Two fields' validation errors were invisible on an unblurred invalid
   submit.** `pclsAge` and `statePensionClaimAge` produce field-keyed errors (not the
   form-level banner), but the hand-maintained list of fields to force-`touched` on an
   invalid "Run simulation" click omitted both — typing something unparseable into
   either and clicking the button without blurring first made the click appear to do
   nothing, no error anywhere. Fixed by deriving the touched set from the validator's own
   returned error keys instead of a hand-maintained list, which can't drift out of sync
   with the validator the same way again.

A smaller, non-blocking gap was also fixed: `scenarioDiff.ts`'s per-person comparison
covered retirement age, plan end age, and State Pension claim age, but not PCLS age or
the State Pension override — two scenarios differing *only* in one of those showed no
diff row at all, in tension with the spec's "only the fields that differ" promise.

Each finding has a dedicated regression test reproducing the exact failure before the
fix (`ScenarioEditorForm.test.tsx`, `useScenarioRunner.test.tsx`,
`scenarioDiff.test.ts`), and the full E2E suite was re-run clean afterward, including the
duplicate-scenario scenario's own effect on the create→run→view journey.

### Person-picker + guided setup wizard (2026-07-31)

A real incident, not a hypothetical: the household's first live scenario included
every household member — including two young children (ages 6 and 4) — because the
Scenario Editor had no way to leave anyone out. Each selected person gets their own
drawdown horizon, and the engine runs for as long as the *longest* one
(`totalSimulationYears` in `deterministicCore.ts` takes the max across everyone
listed), so the youngest child's default `planEndAge` alone stretched a real
household's simulation out to roughly 90 years, producing a 1% success rate that
looked like a financial crisis but was actually a data-entry problem with no way to
fix it.

**Fixed with two changes, both in `ScenarioEditorForm.tsx`:**

- **A real person-picker.** `selectedPersonIds` (a `Set<number>`) now gates who's
  actually included — the per-person When/Strategy fields only render, and only
  validate/save, for selected people. **New scenarios default to nobody
  selected**, forcing an explicit choice, mirroring `AccountForm.tsx`'s own
  owner-picker precedent ("defaults to unselected... to avoid silent
  misattribution") applied to the same class of problem. Editing an existing
  scenario keeps whoever was already saved, unchanged. Unselecting someone
  preserves their entered field values if reselected later — nothing is deleted,
  only excluded from what's validated and saved via a `filteredValues` derivation
  that never touches the underlying per-index field state.
- **An opt-in guided wizard** (`ScenarioWizard.tsx`, new), reached via a "Guide me
  through this" button — **not the default**, per the household's explicit ask.
  Six steps (Before you start / Who's this for / When / Spending / Strategy /
  Review) walk through the exact same render functions and validation the direct
  form uses — the wizard owns no form state of its own, only which step is
  showing, so it's structurally impossible for the two modes to drift onto
  different values. The intro and review steps both state plainly, in the
  household's own words from the conversation that prompted this: *"this models
  drawing down, not saving up yet"* — the engine starts spending from each
  selected person's current age immediately, never reads `retirementAge`, and
  doesn't model years of saving between now and an intended retirement date.

**One small permanent addition outside the wizard**: the "retirement age" field's
hint text, in *both* modes, now reads "for reference only, doesn't yet affect the
calculation" — so the engine's real limitation isn't only visible to someone who
opts into the wizard.

13 tests in `ScenarioEditorForm.test.tsx` (up from 6: 3 new person-picker tests, 3
new wizard-flow tests, existing tests updated to select a person first now that
selection is required), all passing. `e2e/retirement.spec.ts` updated the same way
(a `selectPeople` helper checks the picker before touching per-person fields) and
re-run clean, real browser, real worker execution. Typecheck, lint, build all clean.
Browser-verified in light and dark mode via screenshot; confirmed via the DOM's own
text content (not just visual inspection) that a person's name renders correctly in
the picker after selection, since one dark-mode screenshot briefly looked like it
was missing — a `page.screenshot()` timing artifact immediately after
`page.emulateMedia()` in the verification script itself, not a real rendering bug
(the light-mode capture and the DOM text content both confirmed the name was there
all along).

### Phase 3 reference-tool validation — Trinity study (2026-07-31)

Phase 3's own definition of done, per `docs/PROPOSAL.md`'s Phased delivery table, had
one item left unchecked since the phase began: naming a specific published reference
tool/scenario and reproducing its output within a documented tolerance on matching
inputs — "validated against a known calculator" wasn't a real criterion until a
specific one was named and actually attempted. That's now done —
`src/lib/retirement/engine/referenceValidation.test.ts` (new, 3 tests, all passing).

**The reference tool named**: the **Trinity study** (Cooley, Hubbard & Walz, 1998) —
the canonical, most-reproduced "safe withdrawal rate" success-rate methodology, and
the origin of the widely-cited "4% rule".

**A real methodological difference, disclosed rather than smoothed over**: Trinity's
own method computes a success rate over *deterministic rolling historical windows*
(every actual N-year stretch in its dataset) — not a randomized bootstrap Monte
Carlo, which is what this codebase's own M5 sampler (`bootstrapEngine.ts`) does.
Comparing the bootstrap's aggregate success rate directly against Trinity's
rolling-window number would conflate two different sampling methodologies and not
actually prove anything. Instead, this validation checks the piece that genuinely
needs external checking — `simulatePath`'s decumulation mechanics (compounding,
withdrawal, depletion) — using Trinity's *own* rolling-window method, over a real
historical return dataset, calling the real production `simulatePath` directly
(not a reimplementation of it).

**Data source, precisely — not hand-transcribed from a summary**: the original
1926–1995 Ibbotson data Trinity itself used is commercial (Ibbotson/Morningstar),
not freely reproducible — the same real constraint that led several independent
"updated Trinity study" analyses (Bogleheads, thepoorswiss.com, bestinterest.blog —
found while researching this) to substitute a different public dataset and extend
the window range. This validation does the same: Aswath Damodaran's (NYU Stern)
historical returns dataset, downloaded and parsed directly (not scraped from a
rendered web page, to avoid any transcription risk) — `histretSP.xls`, sheet
"Nominal vs Real Data", columns "S&P 500 (Real)" and "T.Bond (Real)" (10-year US
Treasury), both already inflation-adjusted total returns, 1928–2025 (98 years, 69
rolling 30-year windows).

**Results, three input combinations, each against an independently-sourced figure**:

| Withdrawal rate | Allocation | Horizon | This engine's result | Reference figure(s) |
|---|---|---|---|---|
| 4% | 50/50 stock/bond | 30 years | **66/69 = 95.7%** | ~95–100% across multiple independent citations of the original study, a 1% fee variant, and Wade Pfau's own re-derivation |
| 5% | 50/50 stock/bond | 30 years | **47/69 = 68.1%** | 68% (41/60), per retirementresearcher.com's own description of the original methodology on a different, older, shorter dataset — the closeness (68.1% vs. 68%) is corroborating, not depended on |
| 3% | 50/50 stock/bond | 30 years | **69/69 = 100%** | 100%, per Wade Pfau's re-derivation ("every 30-year retiree still had money") |

All three land inside their documented reference range, including the tight,
independently-sourced 5% corroboration. Given commercial Ibbotson data isn't legally
reproducible and even independent secondary sources of "the same" Trinity result
don't agree with each other to the percentage point (95% vs. 96% vs. 98% vs. 100%,
depending on dataset vintage and fee assumptions), this is judged sufficient to
close out the phase's definition of done — the tolerance bands in the test file are
ranges for exactly this reason, not one source's single decimal.

Typecheck, lint, and the full suite (639 tests, up from 636) all clean. **Phase 3 is
now fully closed out** — engine, API, CRUD, UI, and this validation.

## Phase 4, Milestone 1: schema + FMP provider boundary + watchlist

The first milestone of the stock analysis workbench (fundamentals lookup, DCF
calculator, relative valuation, checklist, watchlist), per `docs/PROPOSAL.md`'s
Phased delivery table. Scoped deliberately narrow — schema, provider boundary, and
just enough UI (a watchlist) to prove the foundation works end to end — the same
"ship the foundation first" shape Phase 3's own M1–M2 took before any engine logic
existed. DCF/relative-valuation/checklist are later milestones, not part of this one.

**A real provider-choice correction, verified live, not assumed**: the proposal's
plan and Phase 2's own STATUS.md both pointed at Alpha Vantage or FMP for
fundamentals. Alpha Vantage — already integrated for Phase 2's live quotes — has
moved its fundamentals endpoints (income statement, balance sheet, cash flow) behind
a paid plan since the proposal was researched; confirmed by fetching Alpha Vantage's
own current docs, not assumed from memory. **Financial Modeling Prep (FMP)** — the
proposal's own primary pick — still has a working free tier (250 requests/day, up to
5 years of annual statements) and is what this milestone builds against, **US-listed
tickers first** per the household's own decision: FMP's LSE/UK-ticker coverage is
unverified (the free-tier demo key that would let a live check happen is no longer
functional — confirmed by trying it directly against a real endpoint, not assumed
either) and is deferred until a specific UK stock is actually being analyzed, rather
than blocking this milestone on it.

**Schema** (`src/lib/db/schema.ts`, migration `drizzle/0007_tearful_vulcan.sql`):
three new tables, following established conventions exactly —
`watchlist_item`/`stock_analysis` are household-scoped (mirroring
`retirement_scenario`'s real-columns-plus-versioned-JSONB shape; `stock_analysis`'s
`inputs` JSONB currently holds nothing but is ready for M2–M4 to each add their own
typed sub-shape, the same way `ScenarioAssumptionsV1` grew incrementally), while
`fundamentals_cache` is deliberately **not** household-scoped (mirroring
`quote_cache`'s mutable-single-row-per-key shape) since a ticker's fundamentals are
the same fact for every household. Both `(household_id, ticker)` unique constraints
and `fundamentals_cache`'s `ticker` unique constraint, plus every `ON DELETE
RESTRICT` FK, have dedicated integration tests in `schema.integration.test.ts` (the
codebase's own standing rule: every constraint the app depends on gets a real-Postgres
test, not just a Drizzle-builder assumption).

**FMP provider boundary** (`src/lib/stocks/fmp.ts`, new) — mirrors
`src/lib/portfolio/quotes.ts`'s exact shape: a typed result union rather than
throwing, an injectable `fetchImpl` on every network call so tests never hit real
FMP. **A disclosed, not-yet-live-verified gap**: FMP's exact error-response shape
(invalid ticker vs. rate limit vs. bad key) is built from public documentation and
community-reported behavior — an empty JSON array for an unknown ticker, a JSON
object with an `"Error Message"` field (at HTTP 200, no distinct status to key off)
for anything else, bucketed conservatively as `rate-limited` regardless of which
specific error FMP actually meant, since that's the safer degrade. This needs the
same live-call treatment `scripts/verify-quote-provider.ts` gave Alpha Vantage's
GBX/GBP question, once a real `FMP_API_KEY` exists — **the household needs to get one**
(free signup, no card, same pattern as `ALPHA_VANTAGE_API_KEY`) before this can be
verified or used for real.

**CRUD**: `src/lib/stocks/queries.ts` (`getWatchlist`), `src/lib/stocks/actions.ts`
(`addToWatchlist`/`removeFromWatchlist`, reusing `ActionResult` from
`household/actions.ts` and a locally-redefined `requireHouseholdId` — the same
per-domain-module convention `retirement/actions.ts` already established, not a new
one). A ticker validation regex is deliberately re-implemented rather than imported
from `accounts/validation.ts` — a one-field form isn't worth reaching into an
unrelated module for a rule that only happens to look the same today.

**UI**: `/stocks` (new route + nav entry in `src/components/AppShell.tsx` — unlike
Portfolio/Retirement before it, this is the *first* commit for the Stocks slot; no
`comingIn: 'Phase 4'` placeholder ever existed to delete, confirmed via git history).
A watchlist list + add/remove form, nothing else yet.

**A real bug found and fixed by browser testing, not just unit tests** — the same
category of bug this codebase's E2E suites have caught before (Phase 1's setup-step
navigation bug, Phase 2's uncaught exception): `WatchlistForm`'s `onSuccess` handler
unconditionally cleared the ticker field to empty. Submitting an already-watched
ticker (a legitimate no-op success) while the user had already started typing the
*next* ticker into the still-enabled field raced that clear against the new input —
the field silently wiped the moment the earlier request resolved, discarding what
the user had just typed. Fixed by only clearing the field if it still holds exactly
what was submitted (a ref captured at submit time), not unconditionally. Regression
test in `WatchlistForm.test.tsx`.

**Explicit deviations from `docs/PROPOSAL.md`, documented rather than silently
dropped**: no Zustand (the proposal names it for retirement-scenario and
stock-analysis-workbench UI state; Phase 3's actual UI never needed it, confirmed
`zustand` isn't installed anywhere in this codebase — continuing the established
plain-`useState` convention for consistency, revisitable if a later, larger workbench
screen genuinely needs cross-component state sharing). No compute-persist-poll /
worker_thread for the DCF calculator, whenever M2 builds it — flagged now for when
that milestone starts: a DCF calculation is closed-form arithmetic, not a
thousands-of-iteration Monte Carlo, and PROPOSAL.md's own decision rule (under ~2s,
synchronous is acceptable) applies.

672 tests passing (up from 639: +9 `fmp.test.ts`, +7 `fmp.integration.test.ts`, +6
`watchlistCrud.integration.test.ts`, +7 new constraint tests in
`schema.integration.test.ts`, +3 `WatchlistForm.test.tsx` including the race
regression, and the pre-existing `schema.integration.test.ts` table-count/TRUNCATE
list updated for the three new tables). Typecheck, lint, and a full `npm run build`
all clean. Browser-verified end to end (real Playwright run against a real scratch
Postgres, not just described): Stocks nav entry, empty state, add a ticker,
re-adding the same ticker is a no-op not a duplicate, an invalid ticker shows the
exact field error, remove works — including the race-condition fix, confirmed fixed
by the same test that first caught it broken.

**Not done in this milestone, by design**: no fundamentals are actually fetched from
FMP yet (nothing in the M1 UI triggers `ensureFreshFundamentals`) — `fmp.ts` and the
cache are built and tested in isolation, ready for M2's DCF calculator to be their
first real caller. No DCF/relative-valuation/checklist content. No E2E spec added to
the permanent suite (`e2e/`) — the verification run used a throwaway spec, deleted
after use, matching the plan's own call that M1's minimal UI doesn't yet justify a
permanent E2E addition; worth adding once M5 ships the real workbench screen with
something substantial to regress-test.

## Phase 4, Milestone 2: DCF calculator

The first of the workbench's four valuation methods, and the first real caller of M1's
`fmp.ts`/`fundamentals_cache` — nothing exercised them beyond their own isolated tests
until now. Standard, deliberately simple textbook DCF: base free cash flow grown at one
uniform annual rate over a user-set horizon, terminal value via the Gordon Growth Model
(no exit-multiple option yet — that needs peer data M3's relative valuation hasn't
built), discounted to present value, minus net debt, divided by diluted shares
outstanding, compared against the live market price.

**FMP field names verified against a real documented example, not assumed or copied
from a broken source.** A research pass found FMP's own GitHub docs repos unreliable —
the `balance-sheet-statement-api` README's example JSON turned out to be a byte-for-byte
copy-paste of the *income statement* example, mislabeled. Cross-checked instead against
FMP's own docs site (via a Wayback Machine snapshot showing real Apple 10-K figures,
since the live docs now require a key to render) and current search results. Fields
used: `freeCashFlow` (cash flow statement), `totalDebt`/`cashAndCashEquivalents`
(balance sheet), `weightedAverageShsOutDil` (income statement, already confirmed in
M1). **Two things this still can't fully confirm without a real key** — FMP's exact
error-response shape (already flagged in M1) and whether these arrays are genuinely
newest-first — both documented directly in `dcf.ts`'s own doc comments as open items
for whenever a real `FMP_API_KEY` exists.

**Money/rate math reuses this codebase's existing fixed-point techniques rather than
inventing new ones** — the plan's central design bet, and it held up under test.
`roundDiv` (`valuation.ts`, already documented as reusable "for other fixed-point
domains") and an iterative year-by-year bigint compounding technique mirroring
`retirement/engine/deterministicCore.ts`'s `applyAnnualReturn` — growth and discounting
are both loops, never a closed-form `(1+r)^N` power. `dcf.test.ts` includes a fully
exact, hand-verified case (0% growth, 100% discount rate, chosen so every intermediate
step divides evenly — £100,000 base FCF, 1,000,000 shares → exactly 10p/share, checked
by hand before writing the assertion) alongside the parser/edge-case coverage — 19 tests,
all passing on the first real run against the hand-worked numbers.

**One disclosed, narrow exception to "money never touches a float"**, in
`deriveDcfBaseInputs`: FMP returns statement figures as JSON numbers, not this
codebase's usual NUMERIC-as-string shape. Converted to bigint pence immediately on
read, once — never carried as a float through `computeDcf`'s own maths. Documented as a
deliberate exception (third-party JSON in, converted at the boundary), not a silent gap.

**Shipped**: `src/lib/stocks/dcf.ts` (types, parser, pure calculation, fundamentals
mapper), `saveDcfInputs` (additive in `actions.ts`, upserting `stock_analysis` on
`(householdId, ticker)` — no append-only run history, unlike `simulation_run`: a DCF
has no equivalent "re-run to compare" concept, editing assumptions just replaces them),
`getStockAnalysis` (additive in `queries.ts` — M1 left this unbuilt since nothing
needed it yet), the `/stocks/[ticker]` route (recomputes live on every load, no
persisted result row and no compute-persist-poll — a closed-form calculation over a
handful of years is fast enough that PROPOSAL.md's own "under ~2s, synchronous is
acceptable" rule applies, the decision M1's own entry already flagged for whenever this
milestone started), and `DcfForm.tsx` (a single form-level error banner rather than a
per-field validator module — proportionate for four fields, the same scope call
`retirement/actions.ts` made for its own form before Milestone 9 built a bigger one).
Watchlist entries now link to their ticker page.

**Live market price reused, not rebuilt**: `fetchGlobalQuote`/`normalizeQuotePrice`
(`quotes.ts`) already take a bare symbol with no holding/account context, and
`quote_cache` already caches by symbol — a watchlist ticker's quote request shares a
cache row with any existing USD holding of the same ticker.

698 tests passing (up from 672: +19 `dcf.test.ts`, +7 `dcfCrud.integration.test.ts`).
Typecheck, lint, and a full `npm run build` all clean. Browser-verified end to end with
two real scenarios, not just described: (1) realistic fundamentals + a quote seeded
directly into the cache (no real FMP/Alpha Vantage call needed, both fresh) — add AAPL
to the watchlist, open its page, confirm the computed intrinsic value and market-price
comparison render correctly, edit an assumption, save, reload, confirm it persisted,
expand the year-by-year table; (2) no `FMP_API_KEY` set at all — confirms the graceful
"no key configured" message renders instead of a crash, and the form still works so
assumptions can be saved ahead of fundamentals being available.

**Not done in this milestone, by design**: no relative valuation, quality/balance-sheet
screen, or checklist yet (M3/M4) — this ticket page will grow more sections, not get
replaced. No E2E spec added to the permanent suite, same reasoning as M1 (a throwaway
spec was used and deleted; worth a permanent one once M5's full workbench screen exists).

### FMP live verification (2026-08-01): a real bug caught before it shipped further

The household obtained a real `FMP_API_KEY` and it was used immediately to verify M2's
two disclosed assumptions — and found a genuine, would-have-been-permanent bug in the
process, the same value `verify-quote-provider.ts` proved for Alpha Vantage in Phase 2.

**The bug**: `fmp.ts` called `/api/v3/{endpoint}/{symbol}` — FMP's own docs describe
these as "Legacy" endpoints, and a real call returned `{"Error Message": "Legacy
Endpoint... only available for legacy users who have valid subscriptions prior August
31, 2025"}`. Every fundamentals fetch would have failed for this household's key
(issued today) silently forever — "silently" in the sense that the app itself would
have degraded gracefully (that part worked as designed), but nobody would have known
*why* fundamentals never loaded without this check. **Fixed**: the current endpoints are
under `/stable/...`, with the ticker as a `?symbol=` query parameter instead of a path
segment.

**Everything else checked out**: field names (`freeCashFlow`, `totalDebt`,
`cashAndCashEquivalents`, `weightedAverageShsOutDil`) were all correct against real
`AAPL`/`MSFT` responses — the earlier research pass that caught FMP's own GitHub docs
repo copy-paste error was sound. Arrays are genuinely newest-first. A ticker the free
tier won't serve (tested with a deliberately fake symbol) returns **HTTP 402**, plain
text, not JSON — now mapped to `not-found` rather than the generic `network-error`
branch, so it's cached as a permanent answer instead of retried every staleness window.
A bad API key returns HTTP 200 with a JSON `{"Error Message": ...}` body — confirmed
live, not just documented elsewhere.

**One additional improvement made during this pass**: `deriveDcfBaseInputs` now reads
FMP's own `netDebt` field directly instead of computing `totalDebt -
cashAndCashEquivalents` itself — confirmed exactly consistent for `AAPL` (both gave
76,443,000,000), and simpler/more robust to trust the provider's own figure than
re-derive it.

New permanent script, `scripts/verify-fmp-provider.ts` (`npm run stocks:verify-fmp`),
mirroring `verify-quote-provider.ts`'s role — run against the real key as part of this
verification (`AAPL`/`MSFT` resolved correctly, the fake ticker came back `not-found`
as expected). 700 tests passing (up from 698: a regression test for the HTTP 402
handling, plus a net-cash-position case for the `netDebt` change). Typecheck, lint, and
build all clean after the fix. Committed and deployed as `a520a39`.

### DCF page: an explainer, and data-driven suggested inputs (2026-08-01–03)

Two follow-ups from actually using the shipped M2 page, both household-requested.

**"How to read this" explainer** (`299dfa8`): the household could see a DCF result but
didn't know what a DCF actually estimates, what the four assumptions do, or how to read
the result — asked directly for guided/explanation content. Added a `<details open>`
block (visible by default, collapsible) right under the page's intro: what a DCF
estimates and why it's sensitive to assumptions, then plain-language bullets for each of
the four assumptions and each of the four result elements. Also fixed the "no
fundamentals" message to name the real, confirmed cause (FMP's free-tier fundamentals
gating is undocumented and per-ticker — e.g. COF's profile works but its statements
402) rather than a vague "maybe unsupported."

**Data-driven suggested inputs**: the natural next question — "how do I know what to
set these to?" — led to "can the app just suggest values?" Not all four assumptions are
equally answerable from data (terminal growth is a fixed convention, not
company-specific; projection years is a genuine preference), but two are:

- **FCF growth rate** — a CAGR between the oldest and newest usable period among the
  cached cash flow statements (up to 5 years). `null` (no suggestion shown) with fewer
  than 2 usable periods, or a non-positive endpoint — a CAGR to/from zero or negative
  FCF is undefined or misleading, not worth suggesting.
- **Discount rate** — CAPM: a fixed risk-free rate (4.5%, approximating the 10yr US
  Treasury) plus the company's beta × a fixed equity risk premium (5.5%, a conventional
  long-run US estimate). Needed a new FMP dependency: **`/stable/profile`, fetched for
  its `beta` field only** — live-verified against the real key first (same discipline
  as the Legacy-endpoint catch above), confirming the same array/error/empty-array
  shapes as the statement endpoints, so it reuses the existing response parser rather
  than duplicating it. **Notably broader coverage than the statements**: profile
  returned a real beta for `COF` (1.022) even though `COF`'s financial statements 402 on
  the free tier — consistent with the earlier per-ticker coverage finding. The profile
  call's own failure never fails the whole fundamentals fetch (`beta: null` degrades to
  "no discount-rate suggestion," not "no fundamentals for this ticker").

Both suggestions are a second, explicitly disclosed, lower-stakes exception to "rates
never touch a float" (`dcf.ts`'s own doc comment) — a suggested display value the
household can edit or ignore, never a value that flows through `computeDcf`'s bigint
math directly.

**Wired into the page**: on a ticker with no saved `stock_analysis` yet, the form
pre-fills with the suggestions (falling back to the old hardcoded 8%/10% defaults
wherever a suggestion isn't computable) instead of showing a generic default. Both
suggestions are always passed to `DcfForm` regardless — even after the household saves
custom values, a small "Suggested: X% (basis) · Use" hint stays under the growth-rate
and discount-rate fields so the suggestion can be re-applied later, never silently
overwriting a saved choice. The explainer's own assumption bullets now note which two
fields are pre-filled from data and how.

Verified live end-to-end: `scripts/verify-fmp-provider.ts` (extended to print beta and
both suggestions) against the real key — `AAPL` (beta 1.097, suggested growth 1.528%,
suggested discount 10.534%), `MSFT` (beta 1.13, suggested growth 0.698%, suggested
discount 10.715%). 711 tests passing (up from 700: unit tests for both suggestion
functions and the new `fetchFmpProfile` behaviour, including the "profile fails but
statements succeed" degrade path). Typecheck, lint, and build all clean. Browser-verified
in both light and dark mode via a throwaway Playwright spec (deleted after use): a fresh
ticker's form pre-fills to the exact suggested values with visible hints; after saving a
custom value and reloading, the saved value persists but "Use" still resets it to the
suggestion.

## Phase 4, Milestone 3: relative valuation + quality/balance-sheet health

Per `docs/PROPOSAL.md`'s stock analysis brief, triangulating four methods rather than
trusting one number: DCF (M2), relative valuation (P/E, EV/EBITDA vs. peers), a
quality/profitability screen (ROE, ROIC, margins), and balance-sheet health
(debt/equity, FCF) — the last three are this milestone. (The fourth thing PROPOSAL.md
names, a fundamentals checklist gating inputs before a model runs, is M4.) Unlike the
DCF, none of this needs a household-entered assumption — every figure is a ratio FMP
already computes — so there's no new form, no new `stock_analysis.inputs` sub-shape,
and no schema/migration at all.

**Three new FMP endpoints, live-verified against the real key (2026-08-03)**:
`/stable/ratios` and `/stable/key-metrics` (identical `?symbol=&period=annual&limit=N`
shape and response parsing as the statements — `priceToEarningsRatio`,
`debtToEquityRatio`, `currentRatio`, margins; `evToEBITDA`, `returnOnEquity`,
`returnOnInvestedCapital`, `freeCashFlowYield`) and `/stable/stock-peers` (a flat list,
no period/limit — `{symbol, companyName, price, mktCap}`). Confirmed against AAPL,
MSFT, and COF: **`ratios`/`key-metrics` 402 for COF exactly like its statements do**
(same free-tier gating), but **`stock-peers` works for COF regardless** (7 real peers
returned) — peer discovery and a ticker's own multiples are independently available on
FMP's side. A real negative P/E was seen for SONY (negative trailing EPS) — displayed
as-is, not filtered out, since it's a genuine result.

**One real design consequence of that COF finding, worth being explicit about**:
`fetchFundamentals` still short-circuits at the first failed *mandatory* statement
(income/balance/cash-flow, unchanged from M1/M2) — so for a COF-like ticker, profile/
ratios/key-metrics/peers are never even attempted, and both new sections show the same
"no fundamentals available" message the DCF section already does. Peers being
independently fetchable on FMP's side doesn't change this: the cache is still one
all-or-nothing blob per ticker (`fundamentals_cache.statements: FmpStatements | null`),
and reworking that into a partial-data shape was judged out of scope for what this
milestone actually needed — every ticker with usable statements also has usable
ratios/key-metrics/peers in every case checked so far.

**Within a successful fetch, though, `beta`/`ratios`/`keyMetrics`/`peers` are each
independently optional** (same precedent `beta` set for M2's suggestions): any one
failing degrades to `null`/`[]` without affecting the others or failing the whole
fetch. `FmpStatements` gets three new fields; `fundamentals_cache` needs no schema
change, same backward-compatible JSONB-blob extension as `beta` was.

**Peer fundamentals reuse `ensureFreshFundamentals`, not a new fetcher** — it was
already built multi-ticker-capable in M1 even though no caller had ever passed more
than one ticker. The ticker page calls it a second time over the primary ticker's
peers (capped at 5, bounding worst-case API calls per fresh load), so a peer that's
separately viewed as its own ticker page shares the same cache row.

**New `src/lib/stocks/relativeValuation.ts`**: `deriveQualityMetrics` (each of 7 fields
independently `null` on a missing/non-finite source figure, not the whole result) and
`derivePeerComparison` (the primary's own P/E and EV/EBITDA, each peer's — including a
`null`-multiple peer with no data, kept visible rather than dropped, so the household
can see which peers had none — and a peer average computed only over peers with a
value). A third disclosed, narrow exception to "money/rates never touch a float," same
category as M2's suggestion functions: every value here is a display-only ratio,
never money math.

**Shipped**: two new sections on `/stocks/[ticker]`, same card + `<details open>`
"how to read this" pattern as the DCF section — "Quality & balance-sheet health" (a
metric grid: gross/net margin, ROE, ROIC, debt/equity, current ratio, FCF yield) and
"Relative valuation" (a table: the ticker's own P/E/EV-EBITDA, each peer's, a peer
average row), each explaining what its figures mean and how to read them without
overselling precision — explicitly noting peers are FMP's own algorithmic
determination, not hand-picked, and that a lower multiple isn't automatically "cheap."

723 tests passing (up from 711: unit tests for both `relativeValuation.ts` functions,
extended `fmp.test.ts`/`fmp.integration.test.ts` coverage for the three new endpoints
and their independent-degrade behaviour). Typecheck, lint, and build all clean.
`scripts/verify-fmp-provider.ts` extended to print quality metrics and peer lists, and
now also checks COF (confirming the short-circuit-before-optional-calls behaviour
above, live). Browser-verified in both light and dark mode via a throwaway Playwright
spec (deleted after use): a ticker with full ratios/key-metrics/peers data renders
both sections correctly, including the peer-average calculation and a peer with no
data shown as em dashes rather than omitted; a statements-gated ticker shows the same
"not available" message on both new sections as the DCF section already does.

## Net worth chart: stale-gap segments + hover tooltip (2026-08-03)

Household-reported, using the real dashboard: the net worth trend line looked like a
staircase compared to an individual account's own (smooth) chart, and a pension update
that landed 13 months after its last one produced what looked like an unexplained
spike. Investigated rather than assumed: both charts already share one geometry
function (`seriesToPath`, `src/lib/networth/series.ts`) with an identical
time-proportional x-axis — the staircase is real and inherent to aggregating several
accounts' independent update dates (`buildNetWorthSeries`'s own doc comment already
explains why), and the "spike" is a genuine, honest reflection of a long gap with no
recorded data, not a rendering bug. Chose **not** to smooth it — this codebase already
has a deliberate stance (`downsamplePoints`'s doc comment) against inventing values
that were never a real net worth on any real date, and interpolating across a 13-month
gap would do exactly that.

**Shipped instead**: a long gap (`> STALE_GAP_DAYS`, 90 days, between two *plotted*
points) now renders as a dashed, lower-opacity segment rather than a confident solid
line, with an explanatory caption. `seriesToPath`'s coordinate math was extracted into
a shared `computeCoordinates` helper so a new `seriesToSegments` (per-segment paths +
staleness) can never disagree with it pixel-for-pixel. Documented, known limitation:
staleness is judged by the gap between plotted net-worth points, not by how old any
one contributing account's own balance is — good enough for this household's actual
pattern (a handful of accounts updated in bursts), not built to handle a portfolio with
constant partial activity masking one quietly-stale account.

**Also added, same conversation**: hovering the net worth chart shows the date and
exact figure at that point (`NetWorthTrendChart.tsx`, new — a small client component
split out of the otherwise-server-rendered `NetWorthHero.tsx` purely because hover
state needs one; receives only pre-computed pixel positions and pre-formatted strings
from the server, never a raw `bigint`).

**Also fixed, found by the household while reviewing this work**: the per-account
chart for a debt (e.g. the mortgage) plotted the raw, negative stored balance, which
*rises* toward zero as the debt is paid off — contradicting its own "a falling line is
progress" caption and the "Outstanding" figure shown everywhere else on the same page
(which already flips the sign). The balance-history table below it already did this
correctly; the chart didn't. Fixed in `src/app/accounts/[id]/page.tsx` by flipping the
sign for debt accounts before building the chart's points, same as the table already
does — now the line genuinely falls as a debt is paid down.

728 tests passing (up from 723: `seriesToSegments` unit tests, including a consistency
check against `seriesToPath`'s own coordinates for the same input). Typecheck, lint,
and build all clean. Browser-verified in both light and dark mode via a throwaway
Playwright spec (deleted after use): seeded the household's own real gap pattern (a
long quiet stretch, then a recent cluster) and confirmed three dashed segments plus one
solid one render correctly, the hover tooltip shows the right date and figure, and the
debt chart now falls (£225,000 → £78,000) rather than rises.

### Follow-up, same conversation: zero-pinned debt baseline + reused tooltip on account charts

Two more household-reported issues on the same charts, fixed together since they touch
the same files.

**The fixed mortgage chart still looked wrong**: after the sign-flip fix above, the
line fell correctly, but its lowest point (£78,000, the smallest recorded outstanding
figure) sat right at the chart's bottom edge — reading as "nearly paid off" when
£78,000 is still owed. The chart's y-axis was scaling against the *series' own*
min/max, not against zero. **Fixed**: `computeCoordinates` (`series.ts`) gained an
optional `minBaseline`, folded into the scaling range (`Math.min(minBaseline,
...values)`) rather than clamping — a debt account's chart now passes `minBaseline: 0`,
so the bottom of the chart is genuinely "paid off," and the smallest-recorded figure
sits visibly above it. Threaded through `seriesToPath`/`seriesToSegments`/
`pointPixelCoordinates` (all share the one `computeCoordinates` helper); every other
caller leaves it unset and keeps today's auto-scaled behaviour, so net worth is
unaffected.

**The hover tooltip, reused on the per-account chart**: asked directly — "is it
possible to add the same mouseover tooltip... in the account graphs, or does that
complicate things too much?" Not much, since the tooltip was already built as a small,
generic client component. Generalised `NetWorthTrendChart.tsx` → `src/components/ui/
InteractiveTrendChart.tsx` (moved out of the net-worth-specific folder since it's now
shared): added a `color` prop (brass for a normal account, sage for a debt, matching
`accounts/[id]/page.tsx`'s own existing convention) and a `useId()`-based gradient id
(a hardcoded one would silently collide if two of these ever rendered on one page).
Also fixed a latent bug while generalising: the SVG's height was a hardcoded Tailwind
class (`h-[132px]`), ignoring whatever `height` prop a second caller might pass — now
an inline style driven by the real prop. `formatDateLabel` (the tooltip's "26 Jul
2026" formatter) moved to `src/lib/ui/formatDateLabel.ts`, shared instead of
duplicated. The account-detail page now computes segments/hover points exactly like
`NetWorthHero.tsx` does and renders the same component — a debt account gets both the
new zero baseline and the stale-gap dashing (the mortgage's own 2020→2022→2026 gaps,
all genuinely long) for free from the same underlying logic.

730 tests passing (up from 728: two new `minBaseline` cases — scales against it, and a
real value below it still wins over the baseline). Typecheck, lint, and build all
clean. Browser-verified in both light and dark mode via a throwaway Playwright spec
(deleted after use): the mortgage chart's £78,000 point now sits well above the
bottom edge, and hovering it shows the same tooltip pattern as the net worth chart.

### Also, same conversation: added Phase 4.4 to the roadmap (retirement accumulation phase)

Household question: "how can we have retirement planning without knowing what we're
working with?" — pointing at a real, previously-flagged-but-unscheduled gap: the
Phase 3 engine only models decumulation (every simulated path starts already retired;
`retirementAge` is carried but never read — see Phase 3 Milestone 3's own "Genuine,
plan-contradicting scope narrowing" note above). **`docs/PROPOSAL.md`'s Phased
Delivery table now has an explicit Phase 4.4** for this, sequenced *before* 4.5's Cash
Allocation Advisor specifically because that feature needs to reason about changing
contributions between now and retirement, which requires an accumulation phase to
exist first. Not implemented yet — a roadmap addition, not a code change.

## In-app Roadmap tab (2026-08-03)

Household ask: review the roadmap inside the app itself, drag items to reprioritize,
and have future sessions check a reorder against each item's own dependencies before
building something out of order. Raised immediately after: **"make sure there is one
source of truth... we should be working from the same document for both"** — a real
concern, addressed directly rather than shipping two independently-maintained
descriptions of the same phases.

**`src/lib/roadmap/data.ts` (`ROADMAP_ITEMS`) is now the single source of truth** for
phase status, scope, and dependencies — not `docs/PROPOSAL.md`'s Phased Delivery
table, which is **generated** from it (`scripts/sync-roadmap-table.ts`, `npm run
roadmap:sync`, replacing the region between `<!-- ROADMAP_TABLE_START/END -->`
markers). Each `RoadmapItem` carries both a plain-language `summary` (the in-app
card's own copy) and the fuller technical `detail` (becomes the doc's table cell,
verbatim) from one authored place, so the two views can't silently drift apart. **CI
now enforces this mechanically**, mirroring the existing "Drizzle migration is
up-to-date" drift guard: a new `ci.yml` step runs `roadmap:sync` and fails the build if
`docs/PROPOSAL.md` doesn't already match — the exact class of guarantee "one document"
implies, not just a convention to remember.

**Schema**: `roadmap_order` (`drizzle/0008_careful_obadiah_stane.sql`) — a singleton
row (`USING btree ((true))`, same convention as `household_singleton`) holding an
ordered JSONB array of item ids, rather than one row per item with its own
`sort_order`: a drag-and-drop reorder is naturally "here's the whole new order," not a
series of per-row position edits. Not household-scoped (like `fundamentals_cache`) —
a fact about the app's own priorities, not per-household data.

**`resolveRoadmapOrder`** (`src/lib/roadmap/queries.ts`, unit-tested) merges a stored
order with the current `ROADMAP_ITEMS`: an id missing from the stored order (a new
phase added since the household last reordered) is appended at the end, in
`ROADMAP_ITEMS`'s own default order; a stored id no longer present is silently
dropped. **`saveRoadmapOrder`** (`src/lib/roadmap/actions.ts`, integration-tested)
rejects a payload containing a `done` item's id, an unrecognised id, or a duplicate
standing in for a missing one — a `done` item can't be dragged in the real UI, so any
of these could only reach the action via a modified client.

**Drag-and-drop via `@dnd-kit/core` + `@dnd-kit/sortable`** (new dependency, ~15kb) —
the one place in this session's chart-and-roadmap work where a library beat hand-
rolling: accessible drag reordering (keyboard operation, screen-reader announcements)
is a genuinely different, harder problem than the net worth chart's hover tooltip
(two SVG paths and a pointer listener). `src/components/roadmap/RoadmapBoard.tsx` (a
small client component — hover state and now drag state are the only two places
this codebase needs one) calls `saveRoadmapOrder` directly inside `useTransition`
rather than through `useActionForm`, mirroring `PassphraseForm.tsx`'s own precedent for
a Server Action with no form fields to serialize. Reverts to the last *successfully
saved* order on failure, not the page's stale initial props. `RoadmapCard.tsx` is a
shared, server-safe presentational component between the draggable "Up next" list and
the static "Done" list (done items are never draggable — reordering something already
shipped means nothing).

**`CLAUDE.md`** (new, repo root): the durable "check the roadmap before planning"
instruction the household asked for, plus the roadmap-table generation obligation —
in the one place a future session reads first, not buried in a code comment.

742 tests passing (up from 730: `resolveRoadmapOrder` unit tests, `saveRoadmapOrder`
integration tests against a real Postgres, plus the schema integration test's table
count/truncate-list updated for the new table — same pattern as every previous new
table this phase). Typecheck, lint, and build all clean. Browser-verified in both
light and dark mode via a throwaway Playwright spec (deleted after use): the page
renders "Up next"/"Done" correctly; a real mouse-simulated drag reorders, saves, and
survives a reload (keyboard-simulated dragging in Playwright proved unreliable for
dnd-kit's timing — a real pointer-drag sequence was used instead for the automated
check; manual keyboard-accessibility verification in a real browser is still
worthwhile before calling this fully done).

## Phase 4, Milestone 4: fundamentals checklist

Checked the roadmap before starting, per the process just built: `/roadmap` had
nothing reordered yet, so "Up next" was in default order — Phase 4 (in progress) at
the top, its own `detail` naming Milestone 4 (fundamentals checklist) as the next
piece of remaining scope. No dependency conflict.

Per `docs/PROPOSAL.md`: "gates raw numbers before they're allowed into a valuation
model, catching bad inputs early (the 'pre-flight checklist' pattern professional
analysts use)." Unlike M3, **no new FMP endpoint or provider call** — every check
reads fields already fetched for the DCF and relative-valuation sections
(`FmpStatements`: statements, `ratios`, `keyMetrics`). The smallest of the four
sections so far, purely derivation + display.

**Six checks** (`src/lib/stocks/checklist.ts`, `buildFundamentalsChecklist`), each
independently `pass`/`warn`/`fail`/`unknown` — `unknown`, not `fail`, whenever the
underlying figure isn't available (same posture `deriveQualityMetrics` already
established): data recency (≤18 months pass, 18–30 warn, older fail), free cash flow
positive, profitable (net margin > 0), debt manageable (debt/equity < 2 pass, 2–4
warn, > 4 fail), adequate short-term liquidity (current ratio ≥ 1.5 pass, 1–1.5 warn,
< 1 fail), and positive shareholder equity (a distress signal surfaced on its own, not
folded into the debt/equity ratio — which is itself distorted once equity goes
negative). Thresholds are documented, conventional rules of thumb, not derived from
anything ticker-specific — the page's own explainer says so plainly, same "starting
point for questions, not a verdict" framing as every other section.

**Shipped**: a fourth section on `/stocks/[ticker]`, same card + `<details open>`
"how to read this" pattern as the other three. A summary line ("N of 6 checks pass, X
warning(s), Y failed, Z unknown"), then each check as a row with a status glyph
(✓ sage / ! brass / ✕ clay / – faint — the app's existing tri-tone vocabulary, no new
colour language) and a one-line detail. Degrades the same way as the other three
sections: no FMP key / no statements → existing message; statements present but
`ratios`/`keyMetrics` missing (the COF case) → the checks needing them show
`unknown`, not hidden.

756 tests passing (up from 742: 14 new `checklist.test.ts` cases covering every
check's pass/warn/fail/unknown boundary). Typecheck, lint, and build all clean.
Browser-verified in both light and dark mode via a throwaway Playwright spec (deleted
after use): an all-healthy ticker showing 6/6 pass, a deliberately unhealthy one
showing all six correctly failing (stale data, negative FCF, negative margin, 6x
debt/equity, sub-1 current ratio, negative equity), and a statements-gated ticker
showing the same "no fundamentals available" message as the other sections.

`ROADMAP_ITEMS`' Phase 4 entry updated (Milestones 1–4 done, only M5 left) and
`docs/PROPOSAL.md`'s generated table re-synced (`npm run roadmap:sync`) to match.

## Phase 4, Milestone 5: watchlist UI polish (Phase 4 complete)

Checked the roadmap first: Phase 4's own `detail` named "Milestone 5 (watchlist UI
polish + a combined workbench screen)" as the only remaining scope. Reviewing what
M2–M4 actually built: `/stocks/[ticker]` already **is** the combined workbench screen
(DCF + quality/health + relative valuation + a fundamentals checklist, all on one
page) — so the real remaining work was the other half. `/stocks` (the watchlist list
page) showed nothing but a bare ticker name and a Remove link; a household member had
to click into every ticker one at a time to see anything.

**Extracted, not duplicated**: `src/lib/stocks/workbenchSummary.ts` (new) —
`buildWorkbenchSummary(statements, quotePrice, dcfInputs)`, pulled out of
`[ticker]/page.tsx`'s own inline DCF-result/checklist computation (Milestones 2 and 4)
so both pages compute the DCF-vs-market delta line and the checklist pass/warn/fail
counts from one place. `[ticker]/page.tsx` itself changed behaviourally not at all —
this was a pure extraction, confirmed by a before/after manual check. `DEFAULT_DCF_INPUTS`
also moved out of the page and into `dcf.ts` as a shared export, for the same
one-constant-not-two-copies reason.

**Watchlist page rebuilt** (`src/app/stocks/page.tsx`): restructured to the
`Suspense`-wrapped async-body pattern `src/app/portfolio/page.tsx` already
established (appropriate here for the same reason — the page now does external FMP/
Alpha Vantage fetches that shouldn't block the shell). One batched
`ensureFreshFundamentals` call and one batched `ensureFreshQuotes` call cover the
whole watchlist (capped at a new `MAX_WATCHLIST_SUMMARIES = 30`, mirroring
`[ticker]/page.tsx`'s own `MAX_PEERS` — rows past the cap still list with a Remove
button, just without a price/signal, the same degrade-per-cell posture as a missing
API key elsewhere on this page). A new `getStockAnalysesForTickers` batch query
(`src/lib/stocks/queries.ts`, one `inArray` query) replaces what would otherwise be N
separate `getStockAnalysis` calls. Each row now shows: price, a DCF-vs-market signal
(coloured sage/clay by direction), and a checklist pass count (toned by worst status
present) — using the household's saved DCF assumptions where they've set any, or the
house defaults otherwise (deliberately not the data-driven per-ticker suggestions
`[ticker]/page.tsx` prefills a first visit with, which would mean an extra FCF-history/
beta computation per watchlist row just for a badge).

762 tests passing (up from 756: 4 new `workbenchSummary.test.ts` cases — full DCF
result + all-pass checklist for healthy fundamentals, all-null with no statements,
price-independent fields still computing with no quote, `unknown` checklist items
surfacing rather than crashing for a COF-style ticker with no ratios; plus 2 new
`getStockAnalysesForTickers` integration cases in `dcfCrud.integration.test.ts` —
many-tickers-one-query keyed correctly with a missing ticker simply absent, and an
empty ticker list short-circuiting to an empty map). Typecheck, lint, and build all
clean. Browser-verified in both light and dark mode via a throwaway dev server against
a scratch Postgres (not the real docker-compose stack) seeded with three tickers —
AAPL and MSFT fully covered (price, DCF signal, "5/6 pass" checklist, correctly toned
clay for "above intrinsic value" and brass for one failing check) and COF showing
em-dashes across every data column rather than crashing, the same graceful-degrade
behaviour the ticker page's own sections already have. Confirmed `/stocks/[ticker]`
itself renders identically to before the extraction.

`ROADMAP_ITEMS`' Phase 4 entry updated to `status: 'done'` (all five milestones
complete) and `docs/PROPOSAL.md`'s generated table re-synced.

## Phase 4.4: retirement accumulation phase

Checked the roadmap first: with Phase 4 closed out, Phase 4.4 was next, its only
dependency (Phase 3) done, no conflict. This is the deferral Phase 3 Milestone 3
flagged and Phase 4.4 was created to resolve (see that section, above) — the
household raised it directly ("how can we have retirement planning without knowing
what we're working with?"), and it's sequenced before 4.5 because the Cash Allocation
Advisor needs an accumulation phase to reason about *changing* contributions.

**Mechanics** (`deterministicCore.ts`'s `simulatePath`): a new per-year step adds each
still-working person's (`age < retirementAge`) `annualContributionPence` to
`sipp_pension`, inserted after growth and before PCLS. Household spending/withdrawal
is gated on a new `householdFullyRetired` check — false whenever any *alive* person
hasn't reached their own `retirementAge` — so growth and contributions still apply
every year, only drawdown is held back. **Two disclosed simplifications**, the same
"say so, don't guess" posture every other simplification in this engine gets: (1) no
partial-household drawdown — a household with one person still working and one
already retired draws down nothing until both have retired, not the working person's
income specifically offsetting the other's spending; (2) no relief-at-source
grossing-up — `pension_contribution.amount` lands exactly as entered regardless of
`method`; PROPOSAL.md names method-aware tax treatment as Phase 4.5's job specifically.

**Resolution** (`resolveScenario.ts`): a new query sums every `pension_contribution`
row's `amount + employerAmount` per referenced person (a household can record more
than one pension) into the new `ResolvedPerson.annualContributionPence`, resolved live
the same way `startingBalancesPence` already is — never stored in the scenario's own
JSONB.

**UI**: the scenario editor's retirement-age field hint used to read "for reference
only, doesn't yet affect the simulation" — now false, so it's rewritten to say what
retirement age actually does. The results page gained a "Before retirement" note
(`ResultsBody.tsx`, a new `preRetirementContributions` prop computed server-side in
`/retirement/[scenarioId]/page.tsx` via `getPeopleWithPensions`) naming each
not-yet-retired person's assumed annual contribution and the age it stops, with a link
to Settings — nothing renders once everyone modelled has already retired.

**Existing-test fallout**: both engine test files' `person()` fixtures default to
`currentAge: 65, retirementAge: 65` (already retired from year 0), so this change left
every existing test's expected output alone except one — a pre-existing "retirement
age before State Pension age" test that used `currentAge: 60` with the *default*
`retirementAge: 65`, genuinely relying on the old inertness; fixed by pinning
`retirementAge: 60` so it isolates the State Pension gap it's actually testing. The old
"retirementAge has zero effect" regression-lock test (a scope-lock, not real coverage,
per its own doc comment) is replaced with three real tests: contributions landing and
compounding in `sipp_pension` while working, contributions stopping and withdrawal
starting exactly at `age === retirementAge` (not a year early or late), and the
two-person "no partial-household drawdown" gate.

765 tests passing (up from 762 — deterministic-core coverage net +1 after removing the
old regression lock and adding three replacements, plus 1 new `resolveScenario`
integration case for `annualContributionPence` summing across multiple pension rows
and defaulting to 0). Typecheck, lint, and build all clean. Browser-verified against a
throwaway dev server and scratch Postgres (not the household's real stack): a
two-person household (one mid-career with a £6,000 + £3,000 employer pension
contribution, one already retired) showed a correctly-summed "£9,000/year until age
65" note, a smoothly growing (not flat-then-cliff) fan chart, and the retirement-age
field's corrected hint text, in both light and dark.

`ROADMAP_ITEMS`' Phase 4.4 entry updated to `status: 'done'` and `docs/PROPOSAL.md`'s
generated table re-synced.

## Phase 4.4 follow-up: regular contributions to non-pension accounts

Household-raised, immediately after Phase 4.4 shipped: could the same accumulation
mechanics cover a "regular purchase" on a Portfolio holding, and cash savings too, not
just pensions? Real design work, not a small bolt-on — worked through with the
household before building: where this gets managed (the account detail page, matching
how holdings themselves already work — Portfolio only ever displays a read-only
rollup, and cash accounts don't appear there at all) and how a jointly-owned account's
contribution gets gated in the engine (no single owner's `retirementAge` to use, so it
lands household-wide instead, while `!householdFullyRetired` — the same flag that
already gates withdrawal, just inverted).

**Schema**: new `regular_contribution` table (`src/lib/db/schema.ts`,
`drizzle/0009_burly_war_machine.sql`) — `accountId`, an optional `ticker` (null = a
plain cash contribution; set = a recurring purchase of that security, which need not
be held yet), an annual `amount`. Deliberately separate from `pension_contribution`
(which keeps its own `method`/`employerAmount` fields — they don't generalise) and
not valid for `debt`/`property` (not drawdown wrappers) or `sipp_pension` (already has
its own mechanism), enforced at the action layer.

**Engine, generalised**: `ResolvedPerson.annualContributionPence` (one bigint,
pension-only) becomes `annualContributionsPence` (a map, one entry per wrapper —
`sipp_pension` from `pension_contribution` exactly as before, every other key from
this person's own `regular_contribution` rows). `ResolvedScenario` gains
`jointAnnualContributionsPence` for jointly-owned accounts. `deterministicCore.ts`'s
year-loop reordered so the alive/`householdFullyRetired` computation runs first (it
never depended on balance state, and the new joint-contribution step needs it) — new
step order: alive/retired/State-Pension check, growth, contributions (personal +
joint), PCLS, withdrawal.

**UI**: new `RegularContributionsPanel.tsx` (mirrors `HoldingsPanel`'s list + inline
form) on the account detail page for any non-debt/property/sipp_pension account — one
component for both shapes, with a `allowTicker` prop hiding the ticker field entirely
for cash-only accounts. The Portfolio holdings table gets a read-only "+ £X/year"
annotation next to a matching holding's account row. The results page's "Before
retirement" note (Phase 4.4's own addition) now sums pension *and* personal regular
contributions per person, plus a new "Joint accounts: £X/year" line.

**Tests**: `validateRegularContribution` (blank-ticker-means-cash, malformed ticker,
non-positive amount); new `regularContributionCrud.integration.test.ts` (add/update/
delete against real Postgres, rejecting a debt/property/sipp_pension account); new
`deterministicCore.test.ts` cases (a person contributing to more than one wrapper at
once; a joint contribution landing while not fully retired and stopping the same year
withdrawal would start); a new `resolveScenario.integration.test.ts` case seeding a
personal GIA contribution (ticker + cash, summed), a joint Cash ISA contribution, and
an account owned by a person *not* included in the scenario (confirmed skipped, not
guessed at — no `retirementAge` to gate it by).

782 tests passing (up from 765). Typecheck, lint, and build all clean. Browser-verified
against a throwaway dev server and scratch Postgres: a personal GIA (a ticker-based
contribution alongside its actual holding), a personal Cash ISA (ticker field absent
from the form entirely), and a joint GIA (cash) — all three showed correctly on their
own account pages, the GIA's contribution appeared as "+ £1,200.00/year" next to the
matching holding on Portfolio, and the retirement results page's note correctly
summed pension + GIA + Cash ISA into one per-person figure plus a separate joint line,
with the fan chart itself visibly reflecting the extra contributions (a higher median
outcome than Phase 4.4 alone produced for the same household). Light and dark.

`ROADMAP_ITEMS`' Phase 4.4 entry (`detail`) updated to describe the extended scope;
`docs/PROPOSAL.md`'s generated table re-synced. No status change — already `done`.

## Phase 4.5, Milestone 1: tax-status core

Phase 4.4 and its follow-up closed out all of Phase 4.5's `dependsOn`, so this is the
next item on the roadmap. `docs/PROPOSAL.md` §4 specifies the Cash Allocation Advisor
as two parts — a contribution waterfall and a debt-vs-save comparator — sitting on top
of UK tax logic the proposal itself calls "arguably higher-risk than the Monte Carlo
engine... hard right answers and no reference-calculator excuse." Too large for one
pass (comparable in scope to all of Phase 3), so it's split into milestones the same
way; this one builds the riskiest, most easily unit-testable piece first and in
isolation — no schema changes, no UI, no DB wiring yet — mirroring how Phase 3's
Milestone 3 built the deterministic engine core before `resolveScenario.ts` or any
route/UI touched it.

**What shipped**: `src/lib/retirement/taxYearConfig.ts` gained
`PERSONAL_ALLOWANCE_PENCE_2026_27` (£12,570, frozen through April 2031 per Autumn
Budget 2025), `PERSONAL_ALLOWANCE_TAPER_START_PENCE_2026_27` (£100,000),
`personalAllowanceTaperCeilingPence()` (derived as start + 2×allowance = £125,140,
rather than a third independent constant that could disagree with the other two),
`PENSION_ANNUAL_ALLOWANCE_PENCE_2026_27` (£60,000) and `MPAA_PENCE_2026_27`
(£10,000) — its own doc comment already earmarked this file for exactly these
constants. New module `src/lib/advisor/taxStatus.ts`: pure functions, no DB/fetch
access, same posture as `deterministicCore.ts`/`dcf.ts`. `computeAdjustedNetIncomePence`
implements the ANI worksheet (relief-at-source contributions deducted grossed-up
÷0.8; salary-sacrifice/net-pay deducted at face value; employer contributions never
subtracted), `computePersonalAllowanceTaperStatus` derives the £100k–£125,140
withdrawal from it, and `computeAnnualAllowanceStatus` applies the £10,000 MPAA
restriction to the £60,000 standard allowance.

**Two real schema gaps surfaced by this research, deliberately not fixed here** since
neither is consumed until Milestone 2: (a) there is no "employer pension match policy"
field anywhere — only `employerAmount`, the amount currently being received, not the
match *schedule* the waterfall's "raise contributions to capture the full employer
match" step needs; (b) there is no "has this person already flexibly accessed a
pension" flag, which the MPAA restriction depends on —
`computeAnnualAllowanceStatus` takes it as an explicit parameter for exactly this
reason. Both need a small migration when Milestone 2 wires real household data in.

**Deliberately deferred, not implemented**: the pension annual allowance's own
income-based taper (threshold income over £200,000 AND adjusted income over £260,000,
tapering £1 per £2 of adjusted income above £260,000 down to the same £10,000 floor as
MPAA) — confirmed against gov.uk's own guidance
(gov.uk/guidance/pension-schemes-work-out-your-tapered-annual-allowance, fetched
2026-08-03) but `docs/PROPOSAL.md` §2 explicitly defers the exact worksheet mechanics
(salary sacrificed under arrangements set up on or after 9 July 2015 is added back for
threshold income but not for ANI — "a single shared formula gets this backwards for
exactly the high earners this feature targets") to Phase 4.5 implementation, and that
worksheet is what would actually consume the two threshold constants. Landing the
constants without the worksheet that uses them would be a half-finished feature, so
both wait for the milestone that builds it. Also salary-only for ANI (real ANI
includes dividends/savings/rental/benefits-in-kind) — the same disclosed P1 limitation
`docs/PROPOSAL.md` §2 already names.

**Tests**: 14 new table-driven vectors in `taxStatus.test.ts` (ANI under each
contribution method, employer contributions never affecting ANI, taper-zone
boundaries at exactly £100,000/£125,140 and just either side of them, a contribution
that pulls ANI back out of the taper zone, MPAA restricting/not restricting the
effective allowance). 616 tests passing. Typecheck and lint clean. No migration, so no
manual browser check needed — nothing user-facing changes yet, same verification scope
as Phase 3's own Milestone 3.

`ROADMAP_ITEMS`' Phase 4.5 entry: `status` → `in-progress`, `detail` updated to name
this milestone as shipped and the three remaining ones (contribution waterfall + the
two schema-gap fixes; debt-vs-save comparator + avalanche/snowball; the Advisor page
itself). `docs/PROPOSAL.md`'s generated table re-synced.

## Phase 4.5, Milestone 2: the core contribution waterfall

Household-scoped decision before building: given the employer-match-capture and
personal-allowance-taper-rescue steps both need schema that doesn't exist yet (an
employer-match policy field; the annual-allowance taper's own income-test thresholds,
deferred from Milestone 1), the household chose to ship the six waterfall steps with
solid data now — emergency fund, high-interest debt, LISA, remaining ISA allowance,
further pension (capped), GIA — and treat employer-match + taper-rescue as a fast
follow, matching Phase 4.4's own "ship core, extend after" precedent. The household
also chose a direct £ emergency-fund target over a derived "months of expenses"
formula, since no monthly-essential-spending concept exists anywhere in the schema and
inventing one just for this would be a bigger, unrequested feature.

**Three real schema gaps found while scoping this milestone, one fixed here, two
deferred**: no emergency-fund concept existed at all (fixed: see below); no employer
pension-match *policy* exists, only the amount currently received (deferred, blocks
the employer-match step); `cash_isa`/`ss_isa`/`lisa` accounts could be created jointly
(`personId: null`), which is legally impossible for a UK ISA — not a new gap this
milestone introduces, but one it has to defend against, since the waterfall is the
first thing that actually sums ISA/LISA contributions per person.

**Schema** (`drizzle/0010_common_sasquatch.sql`): `people.hasFlexiblyAccessedPension`
(boolean, default false — the MPAA trigger), `households.emergencyFundTarget`
(nullable money, an editable planning assumption, same posture as
`annualGrossIncome`), `accounts.isEmergencyFund` (boolean, default false, enforced
`cash`-type-only at the action layer, not a DB constraint — mirrors
`regular_contribution`'s own account-type restrictions).

**Engine** (`src/lib/advisor/`): `taxYear.ts`'s `currentUkTaxYearWindow` (the UK tax
year runs 6 April–5 April, needed for "how much ISA/LISA allowance has this person
used so far"). `waterfall.ts`'s `computeContributionWaterfall` — pure, no DB access,
building on Milestone 1's `taxStatus.ts`. Per-person steps (LISA, remaining ISA,
further pension) are allocated across the whole household in ascending `personId`
order, a disclosed default in the absence of any product spec for whose contribution
takes priority in a two-earner household. High-interest debt is compared against a
"realistic investment returns" benchmark that defaults to a new
`meanRealEquityReturnPct()` (`ukHistoricalReturns.ts`) — the arithmetic mean of the
same UK-calibrated JST equity-return series the retirement engine's bootstrap sampler
already uses, not an invented number (arithmetic, not geometric: this is a one-off
comparison threshold, not something being compounded, so the simpler mean is
proportionate — documented in the function's own doc comment). Further pension is
capped by `min(annual allowance, gross income)` minus what's already contributed —
**carry-forward is explicitly not modeled**, since no historical contribution data
exists anywhere in this schema to compute three years of unused allowance; disclosed,
not silently guessed at as zero.

`resolveWaterfallInput.ts` is the DB-wired resolution layer (mirrors
`resolveScenario.ts`'s role for the retirement engine), built on
`getPeopleWithPensions`, `getAccountsWithBalances`, and a new
`getDebtAccountsWithTerms` query (`household/queries.ts`) — no existing helper joined
`account`+`debt_terms` across a whole household, only per-account. Any joint
ISA/LISA account is excluded from every per-person allowance total and surfaced in a
`warnings` array instead of silently included or crashed on.

**UI** (input-only — the results view is Milestone 4): a checkbox on the Settings
page's person panel ("Already flexibly accessed a pension…"), a new "Emergency fund"
section on Settings (`EmergencyFundForm.tsx`, one money field), and a checkbox on the
account form shown only for `type: 'cash'` ("Counts towards our emergency fund").

**Tests**: `taxYear.test.ts` (tax-year window boundaries), `waterfall.test.ts` (21
table-driven cases — emergency fund shortfall/sufficiency, debt ordering by rate and
the benchmark cutoff, LISA's two-tier age eligibility, ISA/LISA headroom arithmetic,
MPAA-restricted vs. standard pension caps, the GIA catch-all, stable person ordering),
`resolveWaterfallInput.integration.test.ts` (4 cases against real Postgres, including
the joint-ISA exclusion/warning case), plus new vectors in `ukHistoricalReturns.test.ts`
and `validation.test.ts`. 836 tests passing (up from 796). Typecheck, lint, and build
all clean.

Browser-verified against a throwaway dev server and scratch Postgres (light and dark):
checked the MPAA checkbox and saved, set a £15,000 emergency-fund target and saved,
tagged a cash account as counting towards it — all three persisted correctly on
reload. (Caught and worked around, not a Phase 4.5 defect: `next dev`'s env loading
mangles any `.env`/`.env.local` value containing literal `$` characters, including
this project's own `APP_PASSPHRASE_HASH` — `@next/env`'s dotenv-expand pass treats
`$argon2id`, `$v`, `$m` etc. as variable-reference tokens and silently strips them.
Backslash-escaping each `$` in the scratch `.env.local` avoided it for this session;
worth a real fix later, since it means `next dev` against the real `.env` would
currently fail login entirely — untested until now because every prior session's
manual verification generated a *fresh* throwaway hash rather than reusing the
committed one.)

`ROADMAP_ITEMS`' Phase 4.5 entry: `detail` updated (still `in-progress`) to name this
milestone as shipped and the three remaining pieces (employer-match + taper-rescue
follow-up; debt-vs-save comparator + avalanche/snowball; the Advisor page itself).
`docs/PROPOSAL.md`'s generated table re-synced.

## Four-way independent review, and fixing everything it found

Household-requested: an independent review of everything shipped since the last one
(Phase 3 Milestone 9's own review — see "Independent Fable review" above), covering
five phases of work in between. Too large for one pass, so it ran as four parallel
Opus reviews, each scoped to one area, each instructed to verify a suspected bug with
an actual reproduction (a throwaway test or script with hand-computed expected values)
before reporting it rather than reading-and-guessing — the same bar this codebase's
own Fable reviews have always been held to.

**Scope**: Phase 3 M9 polish (person-picker, guided wizard) + net worth charts + the
Roadmap tab; the whole Phase 4 stock workbench; Phase 4.4's retirement accumulation
engine + its follow-up; Phase 4.5 Milestones 1–2 (the newest, least-reviewed code —
flagged for the highest scrutiny of the four). 32 findings reported, all real, none
dismissed as false positives. Fixed in four commits, one per review area, each with
its own tests and a full `tsc`/`eslint`/`vitest`/`build` pass:

- **Cash Allocation Advisor** (my own most recent code): ISA/LISA allowance
  double-counted between the LISA and remaining-ISA waterfall steps; relief-at-source
  pension contributions not grossed up consistently with `taxStatus.ts`; the
  100%-of-earnings pension cap wrongly including employer contributions; the
  high-interest-debt benchmark comparing a nominal APR against a *real* (inflation-
  adjusted) return, understating the true threshold — added `meanNominalEquityReturnPct()`
  via the Fisher relation; a rationale claiming the 2027 Cash ISA sub-limit was
  enforced when it wasn't; a non-numeric benchmark override and a debt with no balance
  both silently producing no step; a joint ISA/LISA account with no contribution row
  skipped with no warning; the emergency-fund target read ignoring its own
  `householdId` parameter.
- **Retirement accumulation engine**: archived accounts' regular contributions
  counted in the results-page disclosure but not simulated; the account-type
  eligibility check bypassable by editing an account's type *after* a contribution
  existed on it; the "Before retirement" card disappearing entirely for a household
  with joint contributions but no personal ones, hiding that the engine was still
  simulating them.
- **Stock workbench**: a crash on any pre-Milestone-3 cache row (missing
  `ratios`/`keyMetrics`/`peers` keys); the DCF growth-rate suggestion computing its
  year-span from the count of surviving periods instead of the real calendar gap; the
  "% below/above intrinsic value" delta dividing by market price instead of intrinsic
  value; no guard against a currency mismatch between a ticker's statements and its
  always-USD quote; peer P/E and EV/EBITDA averages including negative (loss-making)
  multiples; the debt/equity checklist item passing negative equity; a ~42-FMP-call
  worst case per cold ticker page (peers now fetch only the 2 fields they use, not the
  full 7); the `stale` flag computed but never reaching the UI; a fetch failure with
  no cache indistinguishable from a confirmed not-found ticker; a transient partial
  failure cached as permanent "no data"; first-visit DCF inputs bypassing the
  `terminalGrowthRate < discountRate` validator; duplicate regular-contribution rows
  under-reported on the portfolio table. Also documented (not fixed — genuine scope
  beyond a bug fix) that the DCF discounts FMP's levered free cash flow as if it were
  unlevered FCFF, double-counting net debt for leveraged companies.
- **Wizard, roadmap tab, charts**: the guided scenario wizard only disabling the
  Review step's own button, not the fields, while a simulation ran; `saveRoadmapOrder`'s
  check-then-act race on the singleton row (fixed the same way `createHousehold`
  already solved the identical race, catching the unique-constraint conflict rather
  than pre-checking); a malformed reorder payload throwing instead of returning
  `ok: false`; a stale-tab reorder's error message not suggesting a reload;
  `RoadmapBoard`'s revert-on-failure reading a `useState` that could be stale across
  overlapping drags — now a `useRef`; the account-detail chart missing the net worth
  dashboard's own explanatory caption for its dashed stale-gap segments.

873 tests passing (up from 855), all four `tsc`/`eslint`/`vitest`/`build` passes
clean. The two fixes with no automated-test path (the wizard's field-locking, and the
account chart's caption) were verified in a live browser, light and dark, against a
throwaway dev server and scratch Postgres; the roadmap reorder race fix was verified
both by a real concurrent-request integration test and by a live drag-and-reload in
the browser.

## Next steps

1. On the deploy machine: run through `docs/DEPLOYMENT.md` §1–2 (env, `docker compose up`, `tailscale serve`), then §4 (backup key, remote, cron). Confirm the in-app indicator goes from "No backup yet" to "Backup healthy". **Also do the second-device login test** — open the app from a phone on the tailnet and confirm the redirect to `/login` lands on the tailnet hostname, not `localhost`. Still outstanding since Phase 1; Phase 2 didn't touch deployment mechanics.
2. ~~Run the Playwright E2E once.~~ Done — see "Playwright E2E" above. It found and fixed a real Guided Setup defect. Worth adding to CI now that it is known to pass; it needs a scratch Postgres and `npx playwright install chromium` on the runner. Phase 2 adds `e2e/portfolio.spec.ts` to the same not-yet-in-CI backlog.
3. ~~Phase 2: portfolio tracking plus a market-data provider~~ Done, deployed, and independently code-reviewed — see "Phase 2 — what shipped" and "Phase 2 code review" above.
4. **Holdings-to-balance sync** — requested by the household after using Phase 2 live: adding/updating a holding never touches the account's own balance, so an account's stored balance and its holdings' live value can silently drift apart (see "Deliberately not built" above for the full note and the design question it raises — this isn't a one-line fix). Worth scoping and building before or alongside Phase 3, since it's a real gap in what's already shipped, not a new phase's feature.
5. ~~Phase 3 per the Phased Delivery table~~ **Done, 2026-07-31.** Engine, API, CRUD, UI (M9), and the reference-tool validation (Trinity study, see "Phase 3 reference-tool validation" above) are all complete. Phase 3 is fully closed out.
6. ~~Commit and push Milestone 9.~~ Done — `a850d0f`, pushed to `origin/main`.
7. ~~Deploy Milestone 9 to the real stack.~~ Done via `./deploy.sh` — no migration needed (M9 is application code only), containers recreated and healthy. The live stack now runs all of Phase 3, Milestones 1–9; a household member can reach `/retirement` from the nav today.
8. ~~Start Phase 4~~ **In progress.** Milestone 1 (schema, FMP provider boundary, watchlist) shipped — committed (`7bd4214`), pushed, and deployed to the live stack.
9. ~~Milestone 2 (DCF calculator)~~ Implemented and tested — see "Phase 4, Milestone 2" above. **Not yet committed, pushed, or deployed.**
10. ~~Get a real `FMP_API_KEY` and live-verify it~~ **Done, 2026-08-01** — see "FMP live verification" above. Caught and fixed a real bug (Legacy-endpoint URLs that would have failed forever), confirmed field names/array ordering/error shapes, added a permanent `scripts/verify-fmp-provider.ts`. 700 tests passing.
11. ~~Commit, push, and deploy Milestone 2~~ **Done** — `333809d` (calculator), `a520a39` (the Legacy-endpoint fix), `299dfa8` (the "how to read this" explainer), all live on the real stack.
12. ~~Add a "how to read this" explainer to the DCF page~~ **Done, `299dfa8`** — household-requested, see "DCF page: an explainer, and data-driven suggested inputs" above.
13. ~~Add data-driven suggested inputs (FCF growth from history, discount rate via CAPM)~~ **Done** — `be2ffef`, committed, pushed, and deployed to the live stack.
14. ~~Milestone 3 (relative valuation, quality/balance-sheet screens)~~ **Done** — `619129e`, committed, pushed, and deployed to the live stack.
15. ~~Net worth chart: stale-gap segments, hover tooltip, debt-chart sign-flip fix, zero-pinned debt baseline, tooltip reused on account charts~~ **Done** — `3e980f5`, committed, pushed, and deployed to the live stack.
16. ~~Add retirement accumulation phase to the roadmap~~ **Done** — `docs/PROPOSAL.md`'s Phased Delivery table (generated), Phase 4.4. Not yet implemented — this is a roadmap addition, still queued work.
17. ~~In-app Roadmap tab, single-sourced from `src/lib/roadmap/data.ts`~~ **Done** — `1b0292a`, committed, pushed, and deployed to the live stack (with the `roadmap_order` migration).
18. ~~Milestone 4 (fundamentals checklist)~~ Implemented and tested — see "Phase 4, Milestone 4" above.
19. ~~Milestone 5 (watchlist UI polish + the full workbench screen)~~ **Done — Phase 4 is fully complete.** See "Phase 4, Milestone 5" above.
20. Two other open items remain, not phase-blocking but real and flagged above: **Tailscale Serve setup** (item 1 — still outstanding since Phase 1, needed for phone access) and **holdings-to-balance sync** (item 4 — a real Phase 2 gap the household flagged, never built).
21. ~~Phase 4.4 (retirement accumulation phase)~~ **Done** — see "Phase 4.4: retirement accumulation phase" above.
22. ~~Phase 4.4 follow-up: regular contributions to non-pension accounts (GIA/ISA/LISA/cash, personal and joint)~~ **Done, household-requested** — see "Phase 4.4 follow-up" above. 782 tests passing. **Committed, pushed, and deployed to the live stack.**
23. ~~Next phase: Phase 4.5 (Cash Allocation Advisor)~~ **In progress.** Milestone 1 (tax-status core) and Milestone 2 (the core contribution waterfall — see "Phase 4.5, Milestone 2" above) both shipped. Two pieces remain: the debt-vs-save comparator with avalanche/snowball ordering, and the Advisor page/UI — plus a fast-follow for the employer-match-capture and personal-allowance-taper-rescue waterfall steps, deferred pending their own schema (an employer-match-policy field; the annual-allowance taper's income-test thresholds).
24. **New, found during Milestone 2**: `next dev`'s env loading silently corrupts any `.env`/`.env.local` value containing `$` characters — including this project's own `APP_PASSPHRASE_HASH` — via `@next/env`'s dotenv-expand pass treating `$argon2id`/`$v`/`$m` as variable references. Confirmed against the real committed `.env`, not just the scratch one. Worth a real fix (likely: backslash-escape the `$`s in the checked-in `.env`/`.env.example`, or find a dotenv-expand opt-out) before the next `next dev` session — until fixed, local dev login against the real `.env` will fail.

## Notes for Phase 3

- `src/lib/auth/csrf.ts` (`sameOriginGuard`) has real callers now — Milestone 7's `POST /api/retirement/simulation-runs` and `POST .../[id]/cancel`, the first mutating route handlers in this codebase (Phase 1/2 only ever added Server Actions, which carry Next's own Origin/Host check; `GET .../[id]` doesn't call it, being non-mutating, same reasoning as `/api/health`).
- **Money never touches a float.** `src/lib/money.ts` parses to integer pence as `bigint` and back to NUMERIC strings; `numeric` columns come out of node-postgres as strings and stay that way. A `numericToPence`/`formatMoney` pair exists for every display path — new code should go through it rather than `Number(row.amount)`. Phase 2's `src/lib/portfolio/valuation.ts` extends the same discipline to sub-penny/fractional-share precision (`parseScaledDecimal`/`formatScaledDecimal`) — the Monte Carlo engine's compounding math should look to that module before reinventing fixed-point arithmetic, or before reaching for a float and relying on the reference-calculator tolerance test to catch it (Testing strategy in PROPOSAL.md is explicit that tolerance-matching alone isn't sufficient coverage).
- **Watch out for `db.execute` with raw SQL**: unlike a typed `select()`, it returns the driver's raw values, so a `timestamptz` arrives as a *string*, not a `Date`. That mismatch typechecked happily and threw at render time during Phase 1 (`capturedAt.getTime is not a function`). `getAccountsWithBalances` converts explicitly and a regression test asserts it.
- Both `*.integration.test.ts` suites share one scratch database and drop its schema, so `fileParallelism` is off in `vitest.config.ts`. A new DB-backed test file can rely on that. Phase 2's `quotes.integration.test.ts` follows the same pattern with an injected fake provider — Phase 3's `simulation_run` persistence layer should do the same rather than inventing a new DB-test convention.
- **Outbound HTTP calls are mockable via dependency injection, not a library.** Phase 2 needed this for the first time (`fetchGlobalQuote`'s `fetchImpl` parameter, `ensureFreshQuotes`'s `QuoteSource` parameter) — no `msw`/`nock` is installed. If Phase 3 or later needs to mock more than a couple of call sites this way, that's the point to reconsider, not before.
- `src/lib/env.ts`'s pattern for an optional, gracefully-degrading integration (`alphaVantageApiKey(): string | null`, never `required()`) is the template for any future provider key — Phase 5's Open Banking tokens are a different category (per-connection bearer credentials needing encryption at rest, not a single env var) and shouldn't follow this exact shape, but Phase 4's stock-data provider likely should.
