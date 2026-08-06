/**
 * The single source of truth for this project's roadmap — phase status, scope, and
 * dependencies. Two renderings come from this one file, so they can't silently drift
 * apart the way a hand-maintained duplicate would:
 *
 * 1. The in-app `/roadmap` page (`summary` — one or two plain-language sentences for
 *    household reading, `status` for the Done/In progress/Queued grouping).
 * 2. `docs/PROPOSAL.md`'s "Phased delivery" table (`detail` — the fuller technical
 *    scope/rationale/dependency text, written for building from) — **that table is
 *    generated, not hand-edited**. After changing anything here, regenerate it:
 *
 *      npm run roadmap:sync
 *
 * See `scripts/sync-roadmap-table.ts` for the generator, and `CLAUDE.md` at the repo
 * root for why this matters enough to be a standing instruction, not just a comment.
 *
 * `id` is a stable slug, never reused or renumbered even if a phase's own number
 * changes — the household's saved reorder (`roadmap_order`, `src/lib/roadmap/
 * queries.ts`) references these ids, not array position or `phaseLabel`.
 */

export interface RoadmapItem {
  id: string;
  phaseLabel: string;
  title: string;
  /** One or two plain-language sentences — the in-app card's own copy. */
  summary: string;
  /** The fuller technical scope/rationale — becomes `docs/PROPOSAL.md`'s table cell
   * for this phase, verbatim, via `npm run roadmap:sync`. */
  detail: string;
  status: 'done' | 'in-progress' | 'queued';
  /** Other items' ids this one's own written scope depends on — used to flag a
   * reprioritization that puts something ahead of a phase it actually needs first. */
  dependsOn?: string[];
}

export const ROADMAP_ITEMS: readonly RoadmapItem[] = [
  {
    id: 'phase-0-foundations',
    phaseLabel: '0',
    title: 'Foundations',
    summary:
      'The app itself: household login, automated backups, and the deployment setup that keeps everything running on your own laptop.',
    detail:
      'Repo scaffold, docker-compose, Drizzle schema + migration tooling, GitHub Actions CI (typecheck/test/lint), deploy runbook script (pull → build → dump → migrate → up), **Tailscale Serve HTTPS** (pulled forward from Phase 6 — session cookies need it from day one), passphrase auth gate per the full Security notes spec (argon2id, session cookie, brute-force lockout, CSRF), automated backup (pg_dump + encrypted off-machine copy) **with a visible in-app staleness indicator and a quarterly restore-test in the definition of done**.',
    status: 'done',
  },
  {
    id: 'phase-1-accounts-net-worth',
    phaseLabel: '1',
    title: 'Accounts & net worth',
    summary: 'Adding people and accounts by hand, and the net worth dashboard that adds it all up.',
    detail:
      "Household/people/accounts (with `date_of_birth` per person; nullable `person_id`/household-fallback ownership for joint accounts — a UK household norm, not an edge case; tax-wrapper flag: Cash ISA/S&S ISA/LISA/pension/GIA/none as distinct sub-types; per-person `annual_gross_income` and `pension_contribution` method for derived tax band/personal-allowance-taper status; plus debt interest rate, balance, minimum payment, overpayment allowance %, and separate ERC rate; money as `NUMERIC`, currency column on accounts/snapshots), manual net worth dashboard.",
    status: 'done',
  },
  {
    id: 'phase-2-portfolio',
    phaseLabel: '2',
    title: 'Portfolio tracking',
    summary: 'Live prices for your holdings, and a portfolio view showing what you actually own across accounts.',
    detail:
      'Portfolio tracking + market data provider (FMP/Finnhub, or EODHD/Twelve Data if LSE coverage is needed), with a `quote_cache` (or last-fetched columns on `holding`) respecting each provider\'s free-tier rate limits and doubling as the offline "cached reads" source. **Blocking verification task**: confirm the chosen provider returns the correct LSE GBP line (not a USD-denominated cross-listing) and correctly labels/normalizes pence (GBX) vs. pounds (GBP) — see Mobile/tablet access below for why this is the single most likely correctness bug in this phase.',
    status: 'done',
    dependsOn: ['phase-1-accounts-net-worth'],
  },
  {
    id: 'phase-3-retirement-engine',
    phaseLabel: '3',
    title: 'Retirement modelling',
    summary:
      'Runs thousands of simulated retirements to estimate how likely your money is to last — but only models spending down what you already have, not saving up beforehand (see Phase 4.4).',
    detail:
      'Retirement Monte Carlo engine (UK-calibrated 3.0–3.5% starting withdrawal rate as default, State Pension modeled as an income floor, flat effective-tax assumption, geometric-mean/bootstrapped returns) + **narrow retirement-timing scenario comparison only** (see Section 4 — this is not the broader Scenario Planning feature, which is Phase 4.6). **Definition of done includes naming a specific published reference tool/scenario** and reproducing its output within a documented tolerance on matching inputs. **Completed 2026-07-31**: engine, API, CRUD, UI, and the reference-tool validation are all in place — see `docs/STATUS.md`\'s "Phase 3 reference-tool validation" section for the named tool (the Trinity study), the exact methodology, and the results.',
    status: 'done',
    dependsOn: ['phase-1-accounts-net-worth'],
  },
  {
    id: 'phase-4-stock-workbench',
    phaseLabel: '4',
    title: 'Stock analysis workbench',
    summary:
      'A workbench for researching an individual stock pick: a DCF calculator, valuation vs. peers, quality/balance-sheet health, a pre-flight fundamentals checklist, and a watchlist that surfaces all of it at a glance.',
    detail:
      'Stock analysis workbench (DCF / relative valuation / checklist), complete — see `docs/STATUS.md`. All five milestones shipped: schema + FMP provider boundary + watchlist; DCF calculator; relative valuation + quality/balance-sheet health; fundamentals checklist; watchlist UI polish (a shared `buildWorkbenchSummary` — DCF-vs-market signal plus checklist pass count — extracted from `/stocks/[ticker]` so the watchlist list page shows the same signals per row instead of a bare ticker name).',
    status: 'done',
  },
  {
    id: 'phase-4-4-accumulation',
    phaseLabel: '4.4',
    title: 'Retirement: saving-up phase',
    summary:
      'Extends the retirement engine to model the years between now and retirement — contributing and growing savings across pensions, ISAs, GIAs and cash, not just spending them down from day one.',
    detail:
      'Retirement engine: accumulation phase, complete — including its own follow-up, extending contributions from pension-only to every non-pension wrapper. Every simulated path used to start already retired at `currentAge`, with `retirementAge` carried but never read (see `docs/STATUS.md`\'s Phase 3 Milestone 3 section, "Genuine, plan-contradicting scope narrowing," for the original decision). Now: a person still short of their own `retirementAge` contributes — pension via Phase 1\'s `pension_contribution` table, everything else (GIA/ISA/LISA/cash) via a new `regular_contribution` table, summed live in `resolveScenario.ts` — into their own wrappers instead of the household drawing down. A jointly-owned account\'s contribution has no single owner\'s `retirementAge` to gate on, so it lands household-wide instead, while at least one person hasn\'t yet retired. Household spending/withdrawal only starts once every alive person has reached their own retirement age. Two disclosed simplifications, not oversights: no partial-household drawdown (a working spouse\'s income isn\'t modelled as offsetting a retired partner\'s spending), and no relief-at-source grossing-up (contributions land exactly as entered; method-aware tax treatment is Phase 4.5\'s job). Surfaced in the UI, not just baked into the maths: the scenario editor\'s retirement-age field explains what it now does, the account detail page has a "Regular contributions" section (cash accounts get a cash-only form; investment accounts can target a specific ticker), the Portfolio holdings table shows a read-only annotation, and the results page\'s "Before retirement" note names each not-yet-retired person\'s combined assumed contribution plus any joint total.',
    status: 'done',
    dependsOn: ['phase-3-retirement-engine'],
  },
  {
    id: 'phase-4-5-cash-allocation',
    phaseLabel: '4.5',
    title: 'Cash allocation advisor',
    summary:
      "Where should extra money go each month — ISA, pension, or paying down debt? Needs the saving-up phase (4.4) built first, so it can reason about changing what you're contributing.",
    detail:
      'Cash Allocation Advisor (contribution waterfall + debt-vs-save comparator + avalanche/snowball debt ordering) — depends on Phase 1 debt/allowance fields, Phase 3\'s UK-calibrated return assumptions, and Phase 4.4\'s accumulation-phase engine. Milestone 1 (tax-status core) done: `src/lib/advisor/taxStatus.ts` computes adjusted net income and the personal-allowance taper (£100,000–£125,140) from `people.annualGrossIncome` and `pension_contribution`\'s method/employer fields, plus the £60,000 pension annual allowance restricted to the £10,000 MPAA. Milestone 2 (the core contribution waterfall) done: `src/lib/advisor/waterfall.ts` computes six ordered steps — emergency fund (a new household-level `emergency_fund_target` plus a per-account `is_emergency_fund` tag), high-interest debt (compared against a UK-calibrated realistic-returns benchmark), LISA, remaining ISA allowance, further pension (capped by the annual allowance/MPAA, no carry-forward modelled), GIA — resolved from real household data by `resolveWaterfallInput.ts`, which also defends against jointly-owned ISA/LISA accounts (legally impossible in the UK, not yet blocked at the form layer) by excluding and flagging them. Milestone 3 (debt-vs-save comparator + avalanche/snowball ordering) done: `src/lib/advisor/debtComparator.ts` compares each below-benchmark debt\'s APR against GIA/ISA, LISA, and relief-at-source pension investing alternatives — a this-year snapshot, not a multi-year projection — costing the specific amount considered against the penalty-free overpayment allowance and, separately, the ERC rate on any excess, and flagging LISA\'s 25% early-withdrawal charge as a net loss whenever the household already owns a home. `src/lib/advisor/debtOrdering.ts` provides avalanche/snowball ordering across every household debt. Milestone 4 (the Advisor page) done: `src/app/advisor/page.tsx` surfaces both the waterfall and the comparator together, with a user-selectable avalanche/snowball toggle. Fast-follow done: `src/lib/advisor/taperRescue.ts` surfaces a personal-allowance-taper-rescue recommendation — anyone with adjusted net income in the £100,000–£125,140 band loses their personal allowance at £1 per £2, an effective ~60% marginal rate, so a pension contribution there is flagged as "worth weighing" (not an automatic reorder) against the household\'s own high-interest debt, costed via a new `src/lib/advisor/loanPayoff.ts` amortization estimate. Employer-match-capture remains a disclosed, permanent-for-now limitation — still needs its own schema (an employer-match-policy field) this phase deliberately didn\'t add. The taper rescue itself has one disclosed gap of its own: the Tax-Free Childcare / 30-funded-hours cliff at exactly £100k ANI, the spec\'s own "strongest version of this recommendation," isn\'t modeled — no children/dependents schema exists anywhere in this app.',
    status: 'done',
    dependsOn: ['phase-1-accounts-net-worth', 'phase-3-retirement-engine', 'phase-4-4-accumulation'],
  },
  {
    id: 'phase-4-6-scenario-planning',
    phaseLabel: '4.6',
    title: 'Scenario planning',
    summary: 'Side-by-side what-if comparisons — early retirement, a house purchase, a major expense.',
    detail:
      "Scenario planning (broader what-if comparisons: early retirement, house purchase, major expense) — reuses the Phase 3 engine and Phase 4.5's account-aware logic.",
    status: 'queued',
    dependsOn: ['phase-3-retirement-engine', 'phase-4-5-cash-allocation'],
  },
  {
    id: 'phase-4-7-reporting',
    phaseLabel: '4.7',
    title: 'Reporting',
    summary: 'An exportable household financial statement, including tax-lot detail for taxable investments.',
    detail:
      'Reporting (household financial statement, GIA tax-lot detail vs. CGT/dividend allowances) — reuses the CGT/dividend-allowance logic built for Phase 4.5.',
    status: 'queued',
    dependsOn: ['phase-4-5-cash-allocation'],
  },
  {
    id: 'phase-4-8-fire-planning',
    phaseLabel: '4.8',
    title: 'FIRE planning',
    summary:
      'Financial-independence tracking — your FIRE number, current savings rate, and a Coast FIRE projection — plus honest UK-specific guidance on bridging the gap between an early retirement and pension access age.',
    detail:
      "FIRE (Financial Independence, Retire Early) metrics, reusing the Phase 3 engine rather than a separate calculator: a **FIRE number** (target annual spending ÷ a safe withdrawal rate — Phase 3 already defaults to a UK-calibrated 3.0–3.5% rate for long retirements, more conservative and more defensible than the commonly-cited flat 4% rule, which most current FIRE research itself now qualifies down to ~3–3.5% for 35–50-year horizons); a **savings rate** metric (not currently tracked anywhere in this app despite being the single most-cited FIRE input); and a **Coast FIRE** projection (the age at which current savings alone, left to compound with no further contributions, reach the FIRE number by a target retirement age) — computed by running the existing engine with contributions zeroed from today, not new simulation code. Early retirement itself is not a new scenario type: Phase 4.6 already names it as a scenario-comparison case, so this phase is the FIRE-specific *metrics layer* on top of that, not a duplicate retirement calculator. **The UK-specific piece genuinely worth calling out**: pension access age is 55 today, rising to 57 from April 2028, so anyone retiring before then needs a funded 'bridge' from ISA/GIA drawdown while their pension keeps compounding untouched — modeling that bridge accurately is exactly Phase 8's wrapper-aware withdrawal sequencing (ISA vs. pension vs. GIA order), so a first version here can show the FIRE number/savings rate/Coast FIRE date against Phase 3's existing fixed-order assumption, but the bridge-years figure only becomes fully accurate once Phase 8 ships — a disclosed limitation, not a hard blocker for shipping this phase first.",
    status: 'queued',
    dependsOn: ['phase-3-retirement-engine', 'phase-4-6-scenario-planning'],
  },
  {
    id: 'phase-5-open-banking',
    phaseLabel: '5',
    title: 'Bank sync (Open Banking)',
    summary:
      'A time-boxed spike to see whether automatic bank/account syncing is realistically possible in the UK right now, with manual entry staying as the fallback.',
    detail:
      "UK Open Banking sync spike (evaluate Enable Banking's current personal-access terms first, per Section 3 — verify directly, don't assume the recommendation is still current by the time this phase starts, given how fast this specific provider landscape has churned; fall back to manual-entry-only if impractical). **Deliberately sequenced after the app's core differentiators** (net worth, portfolio, retirement modeling, stock analysis), not before them — three separate personal-use UK aggregation routes have died in roughly a year (Section 3), which is repeated empirical validation for this sequencing, not just a hedge. Hard-timebox this to a defined evaluation window (e.g. a few days) rather than letting it run open-ended.",
    status: 'queued',
  },
  {
    id: 'phase-6-mobile-offline',
    phaseLabel: '6',
    title: 'Mobile & offline access',
    summary:
      'A phone-friendly version that keeps working with patchy signal, plus alerts (drift, withdrawal-rate warnings, price targets).',
    detail:
      'PWA manifest, mobile-lite views, offline layer (Serwist-based service worker + IndexedDB read-cache with staleness badges + idempotency-keyed write-queue with edit-timestamp-based conflict handling, home-screen-install prompting for iOS storage persistence, foreground-flush-on-reconnect sync — per the full tiered offline model in Mobile/tablet access above; this is real engineering scope, not a manifest file), Alerts (portfolio drift, withdrawal-rate warnings, price targets) — HTTPS is already live from Phase 0, not a Phase 6 task.',
    status: 'queued',
  },
  {
    id: 'phase-7-visual-design',
    phaseLabel: '7',
    title: 'Visual design pass',
    summary: 'A dedicated pass on look and feel across the whole app.',
    detail: 'Visual design pass.',
    status: 'queued',
  },
  {
    id: 'phase-8-wrapper-sequencing',
    phaseLabel: '8 (later, optional)',
    title: 'Wrapper-aware withdrawal sequencing',
    summary:
      'A more advanced retirement feature: choosing the smartest order to draw down ISA vs. pension vs. taxable accounts. Ongoing maintenance as UK tax rules change, so kept optional and last.',
    detail:
      "Wrapper-aware withdrawal sequencing (ISA vs. pension vs. GIA drawdown order, PCLS timing optimization, CGT/dividend-allowance-aware GIA drawdown) — explicit maintenance burden as UK tax rules and allowances change most tax years. **Note**: Phase 3's engine already takes \"wrapper withdrawal order\" as a scenario input (Data model, above) — its Phase 3 treatment must be an honestly documented simplification (e.g. a fixed or user-specified order, not optimized), not a half-implementation of this phase arriving early and undocumented. Also what makes Phase 4.8's FIRE bridge-years figure (ISA/GIA drawdown before pension access age) fully accurate, rather than resting on Phase 3's fixed-order assumption.",
    status: 'queued',
    dependsOn: ['phase-3-retirement-engine'],
  },
];
