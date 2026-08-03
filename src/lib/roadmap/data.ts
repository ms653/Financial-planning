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
      'Extends the retirement engine to model the years between now and retirement — contributing and growing savings, not just spending them down from day one.',
    detail:
      'Retirement engine: accumulation phase (model saving/contributing between now and retirement, not just decumulation from day one). **A real, deliberately-flagged gap in the Phase 3 engine as shipped** — every simulated path today starts already retired at `currentAge`; `retirementAge` is carried in the type but never read (see `docs/STATUS.md`\'s Phase 3 Milestone 3 section, "Genuine, plan-contradicting scope narrowing," for the full record of this decision). Household-raised directly: retirement planning is incomplete without modeling what\'s actually being built up beforehand. **Sequenced here, before 4.5**, because the Cash Allocation Advisor needs to reason about *changing* contribution amounts between now and retirement (e.g. "what if we route this extra £200/month into the pension instead of the ISA") — which requires an accumulation phase to exist in the engine first, not the other way round. Reuses Phase 1\'s live contribution data (`person.annual_gross_income`, `pension_contribution`) already sitting unused for this purpose.',
    status: 'queued',
    dependsOn: ['phase-3-retirement-engine'],
  },
  {
    id: 'phase-4-5-cash-allocation',
    phaseLabel: '4.5',
    title: 'Cash allocation advisor',
    summary:
      "Where should extra money go each month — ISA, pension, or paying down debt? Needs the saving-up phase (4.4) built first, so it can reason about changing what you're contributing.",
    detail:
      "Cash Allocation Advisor (contribution waterfall + debt-vs-save comparator + avalanche/snowball debt ordering) — depends on Phase 1 debt/allowance fields, Phase 3's UK-calibrated return assumptions, and Phase 4.4's accumulation-phase engine.",
    status: 'queued',
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
      "Wrapper-aware withdrawal sequencing (ISA vs. pension vs. GIA drawdown order, PCLS timing optimization, CGT/dividend-allowance-aware GIA drawdown) — explicit maintenance burden as UK tax rules and allowances change most tax years. **Note**: Phase 3's engine already takes \"wrapper withdrawal order\" as a scenario input (Data model, above) — its Phase 3 treatment must be an honestly documented simplification (e.g. a fixed or user-specified order, not optimized), not a half-implementation of this phase arriving early and undocumented.",
    status: 'queued',
    dependsOn: ['phase-3-retirement-engine'],
  },
];
