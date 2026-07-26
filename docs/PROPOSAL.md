# Financial Planning App — Research Brief, Features Proposal & Implementation Plan

Status: revised for UK jurisdiction (see Section 7)
Owner: personal/household use only, single deployment, UK-based household

---

## 1. Market & Competitive Research

| Tool | Model | Strengths | Gaps |
|---|---|---|---|
| [Empower](https://www.wallstreetzen.com/blog/kubera-vs-empower-personal-dashboard-app/) | Free (monetized via advisory upsell) | Best free investment/net-worth tracker; fee analysis; now tracks crypto | Data used for advisor lead-gen; shallow retirement modeling; no true household multi-user; no stock analysis |
| [Monarch Money](https://www.wallstreetzen.com/blog/kubera-vs-empower-personal-dashboard-app/) | $99.99/yr | Budgeting + net worth combined; solid household/partner sharing | Investment analysis and retirement modeling are thin |
| [Kubera](https://www.wallstreetzen.com/blog/kubera-app-review/) | ~$225–249/yr (risen from $150 — pricing in this category shifts, verify current before citing) | Most sophisticated tracker for complex assets (property, crypto, private equity) | Zero budgeting, zero retirement modeling, zero stock analysis |
| [Copilot Money](https://www.wallstreetzen.com/blog/kubera-vs-empower-personal-dashboard-app/) | Paid, iOS-only | Most polished design in the category | Apple-only; no household support; no deep analysis |
| [ProjectionLab](https://marriagekidsandmoney.com/projectionlab-review/) | Free tier + paid | Best-in-class Monte Carlo (10,000 runs), clean scenario comparison | No portfolio/stock tracking, no account aggregation |
| [Boldin (fka NewRetirement)](https://www.boldin.com/retirement/newretirement-vs-best-retirement-planning/) | Subscription | Best Roth-conversion/IRMAA/tax modeling, multi-pension support | Less visual, more subscription upsells |
| [Ghostfolio](https://ghostfol.io/en) | Open source, self-hosted | Private, portfolio/dividend tracking for stocks/ETF/crypto | No retirement modeling, no household model, no budgeting |
| [Maybe Finance](https://apps.umbrel.com/app/maybe) | Was open source, self-hosted | Net worth aggregation across accounts/property | **Discontinued** — pivoted to B2B, no longer maintained (cautionary tale for depending on someone else's project) |

**Gap this project fills:** nobody ships all four of (a) real net-worth/portfolio tracking, (b) genuine fundamental stock analysis tooling, (c) rigorous Monte Carlo retirement modeling, and (d) true household multi-person support, as one private, self-hosted tool. Today's users stitch together 2–3 subscriptions (e.g. Kubera + ProjectionLab + a personal spreadsheet for stock picks). That's viable as a personal build precisely because there's no need to hit a broad market segment or price tier — this problem is more tractable size-wise for one household's use than as a commercial product for arbitrary users, so a focused build is the right call.

Sources: [WallStreetZen — Kubera vs Empower](https://www.wallstreetzen.com/blog/kubera-vs-empower-personal-dashboard-app/), [WallStreetZen — Kubera review](https://www.wallstreetzen.com/blog/kubera-app-review/), [Marriage Kids and Money — ProjectionLab review](https://marriagekidsandmoney.com/projectionlab-review/), [Boldin vs NewRetirement comparison](https://www.boldin.com/retirement/newretirement-vs-best-retirement-planning/), [Ghostfolio](https://ghostfol.io/en), [Maybe on Umbrel](https://apps.umbrel.com/app/maybe)

---

## 2. Methodology Grounding

**Retirement modeling** — the app should implement, not just display:
- Monte Carlo simulation over thousands of randomized market-return sequences (matching ProjectionLab's approach), not a single deterministic projection — this is what correctly captures sequence-of-returns risk. The return model must be specified explicitly and validated, not assumed: decide up front whether draws come from a historical bootstrap or a parametric distribution, use **geometric** (not arithmetic) mean returns to avoid silently inflating success rates — a classic and easy-to-miss bug — and be explicit about real (inflation-adjusted) vs. nominal returns throughout. Acceptance criterion for Phase 4: reproduce a known calculator's output (e.g. ProjectionLab or Vanguard's public tool) within a reasonable tolerance on the same inputs, so we know the engine isn't quietly wrong.
- Trinity-study-informed safe withdrawal rate as a *starting* assumption, but adjustable — and **the US 4%/3.9% figure does not transfer to the UK**. UK-specific research (Blanchett, Buffenoir, Kemp & Watt, Morningstar 2016, using purely UK market data) puts a UK-realistic safe withdrawal rate at **3.0–3.5%**, sometimes cited as closer to 3.7% in more recent commentary — meaningfully lower than the US figure, because UK long-run real equity returns have historically run about 1.3–1.6 percentage points below US returns, alongside higher platform/fund charges. The app should default to a UK-calibrated rate but expose it as an editable parameter (equity allocation, horizon, target success rate), not hardcode either the US or UK number.
- Target a 85–95% simulation success rate as the "safe" bar, shown as a distribution rather than a single pass/fail.
- **UK retirement accounts and rules differ substantially from the US model** — this is not a relabeling exercise:
  - **Workplace pension / SIPP** (defined contribution) — the UK equivalent of a 401k/IRA. Funds are locked until age 55 (rising to 57 in April 2028).
  - **25% Pension Commencement Lump Sum (PCLS)** — up to 25% of a defined-contribution pot can be withdrawn tax-free, capped at a **Lump Sum Allowance of £268,275** across all pensions combined (this cap starts to bite once total pots exceed roughly £1,073,100). The remaining 75% is taxable at the marginal rate (20%/40%/45%) when drawn, whether taken as a lump sum upfront or via ad-hoc UFPLS withdrawals.
  - **State Pension** — currently £241.30/week (~£12,548/year) for 2026/27, uprated annually by the "triple lock" (highest of CPI inflation, average earnings growth, or 2.5%). This is a meaningful, near-guaranteed income floor that should be modeled as a scenario input, claimed from State Pension age — currently 66, but the rise to 67 **is already underway starting 2026** (not a future event), with a further rise toward 68 legislated for the following decade. The engine should treat State Pension age as a per-person date input rather than a fixed constant, since it depends on date of birth.
  - **ISA wrapper (Stocks & Shares ISA / Cash ISA / LISA)** — up to **£20,000/year** per person across all ISA types combined. Gains, interest, and dividends inside an ISA are **entirely tax-free, permanently** — no CGT, no dividend tax, ever, and no need to track cost-basis for tax purposes on ISA holdings. This materially simplifies modeling for ISA-held assets versus a General Investment Account (GIA). The **Lifetime ISA (LISA)** is a distinct sub-type worth modeling separately: it has its own **£4,000/year sub-limit** (counting toward, not on top of, the £20,000 total), a **25% government bonus** on contributions, and a **25% withdrawal penalty** if funds are withdrawn before age 60 for reasons other than a first home purchase — this account type needs its own constraints, not just an "ISA" label. **Forward-looking rule change to model now, not retrofit later**: per Autumn Budget 2025, from **6 April 2027** Cash ISA contributions will be capped at **£12,000/year for under-65s**, within the overall £20,000 combined allowance, and Stocks & Shares-to-Cash-ISA transfers will be barred. This directly affects the Cash Allocation Advisor's ISA-allocation logic (Section 4), so the £20,000 combined limit needs a **dated sub-limit parameter** for the cash-ISA portion rather than being treated as a single flat number indefinitely.
  - **GIA (General Investment Account)** — any holdings outside a pension/ISA wrapper are subject to two separate taxes that need distinct rates in the model: **Capital Gains Tax** (£3,000/year tax-free allowance, then **18%/24%** depending on whether you're a basic or higher/additional-rate taxpayer) and **dividend tax** (£500/year tax-free dividend allowance, then **10.75%/35.75%+** depending on tax band). These are two different allowances and two different rate schedules — don't conflate them in the reporting logic. Unlike a pension, GIA funds are accessible at any age but get no tax shelter.
  - There is no UK direct equivalent of Required Minimum Distributions (RMDs) — UK drawdown is flexible with no forced withdrawal schedule, which actually *simplifies* the modeling relative to the US case.
  - **Tax band is a derived value, not an independent input — don't store it as a static field.** Pension contributions reduce the income figures HMRC actually tests against, so a self-declared "I'm a higher-rate taxpayer" flag would silently go stale the moment contribution amounts change. Store **annual gross income per person** instead (an editable planning assumption — defined as pre-sacrifice contractual salary, the cleanest anchor point for the arithmetic below — not precise payslip data), plus per-contribution **method** (relief-at-source / net pay / salary sacrifice) and **employer contribution amount**, and derive the actual test values from those in the engine rather than a single flat "income minus contributions" subtraction.
  - **This is two genuinely different HMRC tests, not one formula — don't conflate them** (an earlier draft of this section did exactly that):
    - **Personal allowance taper** (below) uses **adjusted net income (ANI)**: relief-at-source contributions are deducted *grossed up* (÷0.8, i.e. ×1.25), while net-pay-arrangement and salary-sacrifice contributions already reduce taxable pay before ANI is calculated, so they're not subtracted a second time if `annual_gross_income` is defined as pre-sacrifice salary. ANI is also technically total taxable income (salary + dividends + savings interest + rental + benefits-in-kind), not just salary — P1 should explicitly scope to salary-only and document that as a known limitation (understates ANI for anyone with meaningful investment income) rather than silently getting it wrong.
    - **Pension annual-allowance taper** (Section 4) uses a *different* pair of figures — **threshold income** and **adjusted income** — with different rules: adjusted income **adds** pension contributions rather than subtracting them, and critically, salary sacrificed under arrangements set up on or after 9 July 2015 is **added back** for threshold income (an anti-avoidance rule) — so salary sacrifice reduces ANI for the personal-allowance test but does **not** reduce threshold income for the annual-allowance test. A single shared formula gets this backwards for exactly the high earners this feature targets. Exact HMRC worksheet mechanics for both tests should be finalized against gov.uk guidance during Phase 3 implementation rather than fully specified here.
  - This surfaces the **personal allowance taper**: between £100,000 and £125,140 of adjusted net income, the personal allowance withdraws at £1 per £2 earned, creating an effective marginal rate around 60% on earned income in that band (dividend/savings income in the same band sees a different effective rate, since those tax rates differ and rose further from April 2026/2027 per Autumn Budget 2025 — don't hardcode "60%" as income-type-agnostic if the engine ever models non-salary income here). This band survives Autumn Budget 2025 unchanged — the personal allowance freeze was *extended* to April 2031, so £100k–£125,140 holds for the foreseeable planning horizon. Pension contributions are the standard lever to pull income back under £100k and reclaim the allowance — a genuinely high-value recommendation for the Cash Allocation Advisor (Section 4), and one only reachable if income, not a static band label, is the stored primitive.
  - **Forward-looking rule to note now**: from **April 2029**, salary-sacrificed pension contributions above £2,000/year lose their National Insurance exemption (Autumn Budget 2025). Doesn't change 2026/27 arithmetic, but any NI-savings framing the engine ever surfaces needs to be date-aware.
- Withdrawal sequencing across wrapper types (SIPP/pension vs. ISA vs. GIA) and State Pension timing is still where the real modeling complexity sits — but it's a materially different (and arguably somewhat simpler, given no RMDs and ISA's full tax exemption) problem than the US version. **Scope this down the same way as before**: P1 ships a pre-tax/pre-wrapper Monte Carlo using a flat effective-tax-rate assumption across total drawdown; wrapper-aware sequencing (draw ISA first vs. pension first, PCLS timing, CGT/dividend-allowance-aware GIA drawdown) becomes its own later phase.

Sources: [RetirementExpert.co.uk — UK Safe Withdrawal Rate 2026](https://retirementexpert.co.uk/pension-drawdown/safe-withdrawal-rate), [PoundSense — Pension Lump Sum Allowance 2026](https://www.poundsense.co.uk/blog/pension-lump-sum-allowance-2026), [TaxFly — Pension Tax-Free Lump Sum 25% Rule 2026/27](https://www.taxfly.co.uk/guides/pension-tax-free-lump-sum-25-percent), [PoundSense — Pension Triple Lock 2026](https://www.poundsense.co.uk/blog/pension-triple-lock-2026), [OakNorth — ISA Season 2026](https://oaknorth.co.uk/blog/isa-season-2026-make-most-20000-allowance/), [Wealthify — Capital Gains Tax Allowance 2026/27](https://www.wealthify.com/blog/how-much-is-the-capital-gains-tax-allowance), [UK Dividend Tax Calculator — Dividends Inside an ISA](https://ukdividendtaxcalculator.co.uk/dividend-tax-and-isa)

**Stock analysis** — "industry standard" means triangulating multiple valuation methods rather than trusting one number:
- **DCF (discounted cash flow)** — intrinsic value from projected free cash flows; most rigorous but most assumption-sensitive.
- **Relative valuation** — P/E, EV/EBITDA vs. sector peers.
- **Quality/profitability screen** — ROE, ROIC, margins.
- **Balance-sheet health** — debt/equity, free cash flow.
- A **fundamentals checklist** gates raw numbers before they're allowed into a valuation model, catching bad inputs early (the "pre-flight checklist" pattern professional analysts use).

Conviction should scale with how many of these methods agree — the app should show all four side by side per stock, not just one verdict.

Sources: [Margin Lab — Stock Analysis Template 2026](https://margin-lab.com/blog/stock-analysis-template), [Invest Viable — Fundamental Analysis Checklist](https://investviable.com/blog/fundamental-analysis-checklist)

---

## 3. Data Sources

**Account aggregation (bank/brokerage balances):**
- **SimpleFIN Bridge is US/Canada-only and does not cover UK banks** — the original recommendation doesn't carry over and needs replacing, not relabeling.
- UK account aggregation runs through the **Open Banking** standard (mandated by the CMA for the 9 largest UK banks, adopted more broadly since). The realistic providers are:
  - **Moneyhub** — UK-founded Open Finance platform, notably covers pensions and investments as well as bank accounts (not just current/savings accounts), which matters here given SIPPs are a core account type. Worth investigating first for that reason.
  - **TrueLayer** — strong UK/EU coverage (95%+ of accounts), but positioned and priced for payment initiation/merchant use cases; account-data-only personal use may not be its sweet spot.
  - **Yapily**, **Plaid** (also operates in UK/EU) — both viable, both enterprise/B2B-first in pricing model.
  - **Unlike SimpleFIN, none of these UK providers advertise simple, cheap, self-serve personal-use pricing** (SimpleFIN's $1.50/mo personal tier is the exception, not the norm, in this space) — they're built for fintechs onboarding many end users, and typically require a business agreement or sandbox-first evaluation. **This needs direct investigation (contact/sign-up flow, actual personal-use pricing if any) before Phase 2 is planned**, not just a citation from a roundup article.
- **Recommendation given that uncertainty**: don't gate Phase 1 on account sync working at all. Ship manual entry first (which was already the plan), and treat live UK Open Banking sync as a Phase 2 spike — evaluate Moneyhub's actual personal-access terms first — with manual entry remaining a permanent fallback if sync turns out to be impractical to get affordably as an individual.

**Market & fundamentals data:**
- **Financial Modeling Prep** and **Finnhub** (same recommendation as before — FMP primary for fundamentals/DCF, Finnhub for live quotes) both have solid **global/US** coverage, but **LSE-listed stock coverage should not be assumed** — verify UK ticker coverage specifically before relying on either for FTSE holdings.
- If the household's portfolio is UK/LSE-heavy (rather than mostly US/global funds held inside a SIPP or ISA, which is common for UK investors and would mean FMP/Finnhub's US-centric coverage is actually fine), **EODHD** and **Twelve Data** both explicitly advertise LSE fundamentals coverage and are worth evaluating as a UK-specific alternative or supplement.
- Alpha Vantage (25 req/day) and Polygon.io (no free tier) — still ruled out as primary: too tight or not free, respectively.
- Verify exact current pricing/limits and UK-ticker coverage directly against each provider's own docs before committing — API tier terms and coverage shift often and general "best APIs" roundup articles go stale fast.

Architect this as a pluggable provider interface (one file per provider behind a shared type), the same pattern the sibling Warhammer-app uses for its Sanity client with graceful fallback — so a provider can be swapped or added later without touching calculators or UI. This matters more here than it did in the US-only draft, since UK coverage may genuinely require a different provider mix.

Sources: [OpenBankingTracker — UK Open Banking APIs 2026](https://openbankingtracker.com/open-banking-apis-uk), [Finexer — Top 12 Open Banking API Providers in the UK 2026](https://blog.finexer.com/top-12-open-banking-providers/), [Twelve Data — London Stock Exchange](https://twelvedata.com/exchanges/XLON), [EODHD — LSE fundamental data](https://eodhd.com/financial-summary/LS4C.F)

---

## 4. Features Proposal

### P1 — Foundation
- **Household model** — a household has multiple people; each person has their own accounts; dashboards roll up to household level and drill down to individual level.
- **Accounts** — cash, GIA (general investment account/brokerage), ISA (Stocks & Shares / Cash / LISA), SIPP/workplace pension, property, debt. Each account carries a **tax wrapper flag** (ISA / pension / GIA / none) since that determines whether gains/dividends are taxable — this is load-bearing for both the net worth view and later CGT/dividend-allowance-aware reporting. LISA needs its own sub-type (not just "ISA"), since it carries a separate £4,000/year sub-limit, a 25% bonus, and an early-withdrawal penalty that a generic ISA doesn't have. Manual entry always supported; live sync optional per account once a UK aggregation provider is confirmed (see Section 3).
- **Net worth dashboard** — trend over time, broken down by person, by asset class, and by tax wrapper.
- **Portfolio view** — holdings, cost basis, allocation, performance vs. a benchmark (e.g. FTSE 100/250 or a global index, depending on what the household actually holds).
- **Retirement Monte Carlo engine** — editable assumptions (spending, inflation, State Pension claiming age and amount, PCLS timing, wrapper withdrawal order), success-rate output, scenario comparison (e.g. retire at 60 vs 65, before vs after State Pension access age).

### P2 — Growth
- **Stock analysis workbench** — fundamentals lookup, DCF calculator, relative valuation, quality/balance-sheet checklist, watchlist.
- **Scenario planning** — side-by-side "what-if" comparisons (early retirement, house purchase, major expense) reusing the Monte Carlo engine.
- **Reporting** — exportable household financial statement; tax-lot detail for GIA holdings specifically, tracked against the £3,000 CGT allowance and £500 dividend allowance (ISA/pension holdings need no such tracking, since they're tax-free/tax-deferred respectively).
- **Cash Allocation Advisor** — "where should my next £X go" recommendation, in two parts:
  - **Contribution waterfall** — a priority-ordered decision tree over the household's actual accounts: emergency fund topped up → pension contributions raised to at least the level needed to capture the **full employer match** (i.e. claim any portion of the match not currently being captured — an instant, effectively-guaranteed return, always first) → **if a specific person's adjusted net income sits in the £100,000–£125,140 personal allowance taper zone, surface a pension-contribution recommendation to pull that person's income back under £100k** — but present it as a strong candidate to weigh, not an automatic override of the steps below. The taper rescue is a **one-off ~60% uplift on the contribution amount**, while a debt's interest rate is a **recurring annual cost** — for a card at 35% APR, clearing it can still beat the pension move over a multi-year horizon; the advisor should compare relief-rate against APR × expected payoff duration (or at minimum surface the horizon dependence) rather than presenting 60% > APR as self-evident. This step also requires the **household can actually afford the extra contribution** while still servicing any debt minimums and without raiding the emergency fund — pension contributions are irrecoverable until access age, so this precondition must be checked, not assumed. It's a strong argument in one specific case worth calling out explicitly: **parents facing the Tax-Free Childcare / 30-funded-hours cliff at exactly £100k ANI** (a hard cliff, not a taper — losing up to £2,000/child/year plus funded hours entirely) can see effective marginal rates well over 100%, making the pension move dominant even against expensive debt; the advisor should flag this case specifically when applicable, since it's the strongest version of this recommendation. → high-interest debt (credit cards, personal loans — anything with a rate that beats realistic investment returns) cleared → LISA if eligible (25% government bonus) → remaining ISA allowance → further pension contributions (tax relief, **capped by the £60,000/year annual allowance including any available carry-forward, and by 100% of relevant UK earnings** — lower if tapered for high earners via the threshold/adjusted-income test (Section 2) or restricted to £10,000 by the Money Purchase Annual Allowance for anyone who's already flexibly accessed a pension; the waterfall must not recommend contributions past these caps) → GIA. LISA eligibility is two-tier and the engine needs both: you can only **open** one between ages 18–39, but once open you can keep **contributing** (and earning the 25% bonus) up to age 50 — an under-45 cutoff would be wrong on both counts. Personal-allowance-taper status and annual-allowance-taper status are **two separate derived calculations** (ANI vs. threshold/adjusted income — see Section 2), not one shared "income minus contributions" formula, and not a static self-declared band — this is what lets the advisor react correctly when contribution amounts and methods change. Uses live account data (remaining ISA/LISA/pension annual allowance, current debt balances/rates) rather than generic advice.
  - **Debt-vs-save comparator** — for lower-rate debt where the answer isn't obvious (mortgage overpayment vs. investing being the classic UK case), don't hardcode a verdict — show the numbers side by side. This needs two distinct mortgage figures, not one: the **penalty-free overpayment allowance** (most UK mortgages allow ~10%/year of the balance without charge — the exact balance basis, original loan vs. current outstanding, varies by lender and must be checked per mortgage) and, separately, the **Early Repayment Charge rate** actually charged on any overpayment *above* that allowance — these are two different numbers and the comparator needs both to correctly cost out a lump sum that exceeds the free allowance. Also needed: expected investment return **inclusive of** (not net of — the bonus/relief add to the return, they don't subtract from it) the LISA bonus or pension tax relief where relevant. **LISA is a poor fit for anyone already comparing against mortgage overpayment**: if they already own a home, LISA funds can only be withdrawn penalty-free for a first home purchase or from age 60 — an early withdrawal for any other reason (including redirecting it toward the mortgage) incurs a 25% government withdrawal charge, which is a **net loss on the original contribution**, not just a clawback of the bonus. The comparator must model this lock-in explicitly rather than treating LISA as freely comparable liquidity. Frame the remaining trade-off as "here's the numbers," since which side wins depends on risk tolerance and current mortgage rates, not a fixed rule.
  - For **multiple debts**, support both avalanche (highest interest first — mathematically optimal) and snowball (smallest balance first — psychological wins) ordering as a user-selectable toggle, since the "right" choice is behavioral, not financial. Both orderings need the debt's **current balance** and **minimum payment**, not just its interest rate.
  - Uses the `debt_terms` fields already scoped into the Phase 1 data model (interest rate, current balance, minimum payment, overpayment allowance, ERC rate — see Section 5's data model and field-naming fix below); this feature doesn't introduce new fields, it consumes ones Phase 1 already ships.

### P3 — Stretch
- **Mobile-lite companion** — read-only dashboard + quick manual entry, via a responsive PWA, reachable from phone/iPad over Tailscale when away from the laptop.
- **Alerts** — portfolio drift from target allocation, withdrawal-rate warnings, price targets on watchlist stocks.
- **Visual design pass** — once functionality is proven, invest in the "beautiful, professional-grade" styling using Claude's design tooling, as you mentioned deferring.

---

## 5. Implementation Plan

### Tech stack
Reuse the pattern already proven in the sibling Warhammer-app repo, minus the CMS half (no editorial content here):
- **Next.js 14 App Router** — server components by default, `'use client'` only where interactive state is needed (calculators, what-if sliders).
- **Postgres**, running locally via Docker — no need for hosted Supabase; this is a single-household, local-first tool, not a multi-tenant SaaS.
- **Tailwind CSS** for styling scaffolding now, refined later in the design pass.
- **Zustand** for the retirement-scenario and stock-analysis-workbench in-memory state (mirrors the existing army-builder store pattern).
- **Vitest + Testing Library**, **Playwright** for E2E — same as the sibling project.

### Data model (high level)
```
household
 └─ person (1..n)
     └─ annual_gross_income (editable planning assumption, defined as pre-sacrifice contractual salary — drives derived tax band, personal-allowance-taper status (ANI), and annual-allowance-taper status (threshold/adjusted income); these are two different calculations, not one formula — see Section 2. Salary-only for P1; total taxable income including dividends/savings/rental is a documented limitation, not silently ignored.)
     └─ pension_contribution (per contribution: amount, method [relief_at_source | net_pay | salary_sacrifice], employer_amount) — method and employer amount are both required inputs, not just the total, since ANI and threshold/adjusted income treat each method differently
     └─ account (cash | gia | isa | lisa | sipp_pension | property | debt)
         └─ tax_wrapper (isa | pension | gia | none)   -- drives tax treatment in reporting
         └─ holding (for gia/isa/sipp accounts)
         └─ balance_snapshot (time series)
         └─ debt_terms (debt accounts only: interest_rate, current_balance, minimum_payment, overpayment_allowance_pct, overpayment_allowance_balance_basis, erc_rate_pct, mortgage_erc_period_end)  -- feeds the Cash Allocation Advisor. Note: overpayment_allowance_pct is the penalty-free limit; erc_rate_pct is the separate charge rate on overpayments above it — these were conflated as a single "erc_limit" field in an earlier draft and are now split.
household
 └─ retirement_scenario (assumptions JSONB — spending, inflation, State Pension age/amount per person, PCLS timing, wrapper withdrawal order)
 └─ stock_analysis (per ticker: DCF inputs, relative valuation inputs, checklist state)
```

### Local-first architecture
- Runs via `docker compose up` on your laptop: one container for Postgres, one for the Next.js app.
- All financial data stays on your machine — nothing leaves except outbound calls to the chosen UK Open Banking provider (Section 3) and market-data providers (FMP/Finnhub or EODHD/Twelve Data) for sync.
- Auth: a single passphrase gate is sufficient (no need for Supabase magic-link/multi-tenant auth — this isn't a public-signup product). Household members share the one deployment.
- **Backup is not optional**: all household financial data lives in one Postgres container on one laptop with no redundancy by default. Phase 0 must include an automated `pg_dump` on a schedule plus an encrypted copy shipped off-machine (e.g. to cloud storage, encrypted before upload), and full-disk encryption on the laptop should be a stated prerequisite, not an afterthought.

### Provider abstraction
`lib/data-providers/{moneyhub-or-chosen-ob-provider,finnhub,fmp,eodhd}.ts` behind one shared interface per data type (account sync, quotes, fundamentals) — swappable without touching UI or calculator code, same fallback-gracefully pattern the Sanity client already uses in the sibling repo. This is more valuable than it was in the US-only draft: the account-sync provider in particular is unconfirmed pending the Phase 5 spike (Section 3), so the interface needs to work with zero sync providers connected (manual-entry-only) through Phases 1–4.

### Mobile/tablet access
No separate native app. The same Next.js app is a responsive PWA (installable manifest, mobile-friendly layouts for dashboard + quick-entry views). Reached from phone/iPad via **Tailscale** back to the laptop — WireGuard-encrypted point-to-point, no public port exposed, no separate hosting bill.

**Known limitation**: this only works while the laptop is on, awake, and running the containers — precisely the moments you're "away" and might most want mobile access are the moments it can fail. PWA install and service workers also require HTTPS, so the `tailscale cert` step needs to be part of setup, not assumed. If this limitation proves annoying in practice, the upgrade path is moving the Docker deployment to an always-on mini-PC or NAS on the home network, with the laptop and phone both as Tailscale clients — worth flagging now so it's not a surprise later, not necessarily worth building for on day one.

### Security notes
- Secrets (Open Banking provider tokens, market data API keys) in `.env.local`, never committed.
- No third-party analytics or telemetry given the sensitivity of the data.
- Passphrase + Tailscale network boundary is the security model; revisit if this ever needs to run somewhere other than your own hardware.

### Phased delivery
| Phase | Scope |
|---|---|
| 0 | Repo scaffold, docker-compose, DB schema, passphrase auth gate, automated backup (pg_dump + encrypted off-machine copy) |
| 1 | Household/people/accounts (with tax-wrapper flag: ISA/LISA/pension/GIA/none; per-person `annual_gross_income` for derived tax band/personal-allowance-taper status; plus debt interest rate, balance, minimum payment, overpayment allowance %, and separate ERC rate), manual net worth dashboard |
| 2 | Portfolio tracking + market data provider (FMP/Finnhub, or EODHD/Twelve Data if LSE coverage is needed) |
| 3 | Retirement Monte Carlo engine (UK-calibrated 3.0–3.5% starting withdrawal rate as default, State Pension modeled as an income floor, flat effective-tax assumption, geometric-mean/bootstrapped returns) + scenario comparison. **Definition of done includes naming a specific published reference tool/scenario** (selected from Section 1's competitor list, e.g. ProjectionLab or a UK-specific tool with published worked examples) and reproducing its output within a documented tolerance on matching inputs — "validated against a known calculator" isn't a criterion until a specific one is named. |
| 4 | Stock analysis workbench (DCF / relative valuation / checklist) |
| 4.5 | Cash Allocation Advisor (contribution waterfall + debt-vs-save comparator + avalanche/snowball debt ordering) — depends on Phase 1 debt/allowance fields and Phase 3's UK-calibrated return assumptions |
| 5 | UK Open Banking sync spike (evaluate Moneyhub personal-access terms first; fall back to manual-entry-only if impractical). **Deliberately sequenced after the app's core differentiators (net worth, portfolio, retirement modeling, stock analysis), not before them** — since UK Open Banking providers lack SimpleFIN-style self-serve personal pricing, this may turn out to be a dead end, and a stalled spike shouldn't block the features that actually make this tool worth using. Hard-timebox this to a defined evaluation window (e.g. a few days) rather than letting it run open-ended. |
| 6 | PWA manifest, mobile-lite views, Tailscale access + HTTPS cert documented |
| 7 | Visual design pass |
| 8 (later, optional) | Wrapper-aware withdrawal sequencing (ISA vs. pension vs. GIA drawdown order, PCLS timing optimization, CGT/dividend-allowance-aware GIA drawdown) — explicit maintenance burden as UK tax rules and allowances change most tax years |

---

## Open questions for you
1. **Account sync** — given UK Open Banking providers don't have SimpleFIN's cheap personal-use pricing, and the sync spike is now sequenced late (Phase 5, after the core features), are you fine with manual entry being the primary way you'll use the app through most of the build?
2. Any specific account types to plan for now (e.g. non-UK accounts/assets from before moving, employee share schemes/RSUs, crypto) that would affect the account model in Phase 0–1?
3. Household size — just the two of you, or should the person model allow for more (e.g. dependents tracked but not full users)?
4. Is the "laptop must be on for phone access" limitation (Section 5, mobile/tablet access) acceptable for now, or should we plan for an always-on mini-PC/NAS from the start instead of as a later upgrade?
5. Is the household's portfolio mostly UK/LSE-listed, mostly US/global funds (common even inside a SIPP/ISA), or a mix? This determines whether FMP/Finnhub's coverage is sufficient or whether EODHD/Twelve Data's LSE-specific data is actually needed (Section 3).

---

## 6. Review Notes (Fable pass)

This proposal was independently reviewed by a second model (Fable) before being finalized. Verdict: **approve with changes**, since incorporated inline above. Summary of what changed as a result:

- Retirement methodology tightened: explicit return-model choice (geometric mean, bootstrap vs. parametric), a validation acceptance criterion against a known calculator, and the 3.9% withdrawal rate reframed as conditional rather than universal.
- Tax-aware withdrawal sequencing descoped out of P1 into its own later phase, with a maintenance caveat — it was originally understated as "a solvable modeling problem."
- Market data provider order flipped: FMP primary for fundamentals/DCF, Finnhub as a supplement — Finnhub's free-tier depth for historical statements is not guaranteed.
- Added: jurisdiction as an open question, an explicit backup requirement in Phase 0, and the Tailscale/laptop-as-server availability limitation with its upgrade path.
- Flagged for you: some of the original research citations (competitive landscape roundups in particular) are SEO/affiliate content rather than primary sources — treat the qualitative comparisons as directionally useful, not gospel, and re-verify anything load-bearing (pricing, API limits) against the vendor's own docs at build time.

---

## 7. Revision Notes (UK jurisdiction pass)

The original draft assumed a US household (401k/IRA/Roth, Social Security, SimpleFIN Bridge for bank sync). Revised throughout for a UK household:

- **Retirement methodology**: US 4%/3.9% safe withdrawal rate replaced with UK-specific research putting a realistic starting rate at 3.0–3.5%, reflecting historically lower UK real equity returns and higher fund/platform charges. Section 2 now covers workplace pension/SIPP, the 25% Pension Commencement Lump Sum and its £268,275 Lump Sum Allowance cap, the State Pension (£241.30/week, triple-lock-uprated) as an income floor, and the ISA/GIA tax-wrapper distinction — none of which have a direct US equivalent worth reusing.
- **Account model**: 401k/IRA/Roth replaced with GIA/ISA/SIPP-pension, each carrying a tax-wrapper flag, since ISA holdings are entirely tax-free while GIA holdings are subject to the £3,000 CGT allowance and £500 dividend allowance — a distinction the original US-flat model didn't need to make.
- **Account aggregation**: SimpleFIN Bridge doesn't operate in the UK. Replaced with a note that UK Open Banking providers (Moneyhub, TrueLayer, Yapily, Plaid) don't have an equivalent cheap personal-use tier as far as this research found — so Phase 2 is now framed as a spike to confirm real terms, with manual entry as a durable fallback rather than a temporary stopgap.
- **Market data**: added a caveat that FMP/Finnhub's LSE coverage isn't guaranteed, and named EODHD/Twelve Data as UK-specific alternatives, gated on how UK/LSE-heavy the actual portfolio turns out to be (see Open Question 5).
- **Re-reviewed by Fable** (diff-only, no file re-read, ~42k tokens — down from ~53k on the first pass by handing it the diff directly instead of the whole document). Findings incorporated:
  - GIA tax rates were ambiguous/incomplete — added the missing **18%/24% CGT rates** (basic vs. higher/additional rate) alongside the dividend tax rates, and made clear these are two separate allowances with two separate rate schedules.
  - LISA was listed as just another ISA type but has distinct rules — added its **£4,000/year sub-limit, 25% government bonus, and 25% early-withdrawal penalty** (before 60, non-house-purchase) to both Section 2 and the P1 account list.
  - State Pension age framing tightened — the rise from 66 to 67 is **already underway starting 2026**, not a future event as the previous wording implied; the engine should treat State Pension age as a per-person, date-of-birth-driven input rather than a constant.
- **Third Fable pass** (diff-only again, ~41k tokens, 0 tool calls), on the Cash Allocation Advisor addition. Fixed: LISA eligibility age was wrong (it's open 18–39, contribute-to-50, not "under-45"); the debt-vs-save comparator had the LISA bonus backwards (inclusive of, not net of); added that LISA is a poor comparator option for a homeowner since early withdrawal for anything but a first home or age-60 access costs a 25% government charge — a net loss, not just a clawback; and added missing balance/minimum-payment fields needed for the avalanche/snowball toggle to actually work.

---

## 8. Fourth Fable Pass — Full-Document Review with Web Verification

Unlike the first three passes (diff-only, no tools, reasoning from what was pasted in), this pass was given the **full document** and **permission to web-search and verify claims** (~57k tokens, 8 searches) — a deliberately deeper review after three narrower ones kept finding real issues. Verdict: **ship-ready with minor fixes**; every previously-corrected UK tax/pension figure re-checked out against current sources (State Pension £241.30/week confirmed, dividend rates confirmed at the new April 2026 figures, LSA £268,275 = 25% of £1,073,100 confirmed, LISA mechanics confirmed, pension access age 57 from 2028 confirmed). New findings, all incorporated above:

- **Kubera's listed price was stale** ($150/yr; it's risen to ~$225–249/yr) — updated with a caveat that comparison-table pricing churns and should be re-verified before being relied on.
- **A real rule change was missing entirely**: from 6 April 2027, Cash ISA contributions will be capped at £12,000/year for under-65s (Autumn Budget 2025), within the overall £20,000 allowance — this directly affects the Cash Allocation Advisor's ISA-allocation logic and is now modeled as a dated sub-limit parameter rather than left out.
- **ERC terminology was conflated**: the ~10%/year figure is the *penalty-free overpayment allowance*, not the Early Repayment Charge itself (the separate percentage charged on overpayments *above* that allowance) — the comparator needs both numbers to correctly cost an over-limit overpayment. Fields renamed/split accordingly (`overpayment_allowance_pct` + `erc_rate_pct`).
- **Internal inconsistency fixed**: the P2 Cash Allocation Advisor description called the debt fields "new," while the Phase 1 data model already listed them — now the P2 section explicitly says it consumes fields Phase 1 ships, rather than re-introducing them.
- **Waterfall wording fixed**: "unmatched employer pension contribution captured" was ambiguous enough to risk being implemented backwards — reworded to "raise contributions to capture the full employer match."
- **Pension annual allowance gap fixed**: the "further pension contributions" waterfall step had no cap — added the £60,000/year annual allowance (tapered for high earners, £10,000 Money Purchase Annual Allowance if a pension's already been flexibly accessed) as a hard constraint the advisor must respect.
- **Phase sequencing risk addressed**: the UK Open Banking sync spike sat in Phase 2, ahead of the features that are the actual point of the app (portfolio tracking, retirement modeling), despite the doc's own doubt that UK sync has an affordable personal-use path. **Re-sequenced to Phase 5**, after the core differentiators, explicitly hard-timeboxed so a dead-end spike can't stall real value. Phases renumbered accordingly (portfolio tracking and retirement engine moved up to 2–3, stock workbench and Cash Allocation Advisor to 4–4.5).
- **Unverifiable acceptance criterion fixed**: "validated against a known UK calculator" named no calculator — Phase 3's definition of done now requires naming a specific reference tool/scenario before the phase is considered complete, rather than leaving it as an unfalsifiable checkbox.

---

## 9. Design Correction — Tax Band as a Derived Value

Following on from the fourth Fable pass, a follow-up conversation surfaced a design flaw not caught by any review pass: the plan implied storing "tax band" as a static per-person field. That's wrong, because pension contributions change adjusted net income, which is what determines band in the first place — a self-declared band would go stale the moment someone changes their contributions. Fixed by storing `annual_gross_income` per person instead and deriving band, personal-allowance-taper status (£100k–£125,140, ~60% effective marginal rate), and annual-allowance-taper status from income minus pension contributions at calculation time. Also added: the Cash Allocation Advisor now explicitly checks for personal-allowance-taper exposure and treats reclaiming it via pension contributions as a top-priority move, ahead of high-interest debt — since a guaranteed ~60%-marginal-rate rescue plus tax relief will typically beat clearing most debt.

---

## 10. Fifth Fable Pass — Verifying the Tax Band Derivation

Given a diff again (curated context), but with real room to search (~52k tokens, 6 searches) and no tight response cap, since the last few passes have been cheap enough to afford the depth. Verdict: **the derivation direction was right but the arithmetic in Section 9 shipped two real defects** — worth catching before this became a spec engineers build against.

- **Conflated two different HMRC tests.** The personal-allowance taper (uses *adjusted net income*) and the pension annual-allowance taper (uses *threshold income* and *adjusted income*) are genuinely different calculations, not one shared "income minus pension contributions" formula as Section 9 had implied. They even disagree on salary sacrifice: it reduces ANI for the personal-allowance test, but is **added back** (doesn't reduce) threshold income for the annual-allowance test, per an anti-avoidance rule for sacrifice arrangements from 9 July 2015 onward. A single formula would have told a high earner they could sacrifice their way out of the annual-allowance taper — they can't. Section 2 now specifies these as two separate calculations and defers exact worksheet mechanics to Phase 3 implementation against HMRC's own guidance, rather than fully inventing the formula here.
- **`annual_gross_income` had no defined semantics.** Relief-at-source contributions need to be grossed up (×1.25) before deducting for ANI; net-pay and salary-sacrifice contributions already reduce taxable pay before ANI exists, so subtracting them again double-counts. Fixed by defining `annual_gross_income` as pre-sacrifice contractual salary and adding a required contribution `method` field (relief-at-source / net pay / salary sacrifice) plus employer contribution amount, since the annual-allowance test needs employer contributions as an input the old model didn't capture at all.
- **ANI is technically total taxable income** (salary, dividends, savings interest, rental, benefits-in-kind), not just salary. P1 is now explicitly scoped to salary-only with that documented as a known limitation, rather than silently understating ANI for anyone with investment income.
- **The new waterfall step was overstated.** "Generally the single highest-value move" ignored that the taper rescue is a one-off ~60% uplift while debt interest is a recurring annual cost — over a long payoff horizon, clearing high-APR debt can still win. Reworded to compare relief-rate against APR × payoff duration rather than asserting the pension move always wins, and added an explicit affordability precondition (can the household actually make the contribution while servicing debt minimums, without raiding the emergency fund).
- **A stronger version of the argument was missing entirely**: the Tax-Free Childcare / 30-funded-hours **cliff** at exactly £100k ANI (not a taper — a hard loss of up to £2,000/child/year plus funded hours) can push effective marginal rates over 100% for parents of young children, making the pension move genuinely dominant in that specific case. Now called out explicitly as the strongest version of the recommendation.
- **Missing caps added**: the annual-allowance contribution cap now explicitly includes available carry-forward and the 100%-of-relevant-UK-earnings limit, neither of which the waterfall previously mentioned.
- **Forward-looking note added** (matching the doc's existing pattern for the 2027 cash ISA cap): from April 2029, salary-sacrificed pension contributions above £2,000/year lose their NIC exemption — doesn't change current arithmetic, but any future NI-savings framing needs to be date-aware.
- Confirmed correct and unchanged: the £100k–£125,140 taper band and ~60% earned-income marginal rate (Autumn Budget 2025 extended the personal allowance freeze to April 2031, so this band holds), and the £60,000 annual allowance / £10,000 MPAA figures.
