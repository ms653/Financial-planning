# Financial Planning App — Research Brief, Features Proposal & Implementation Plan

Status: reviewed (Sonnet draft, Fable review incorporated — see Section 6)
Owner: personal/household use only, single deployment

---

## 1. Market & Competitive Research

| Tool | Model | Strengths | Gaps |
|---|---|---|---|
| [Empower](https://www.wallstreetzen.com/blog/kubera-vs-empower-personal-dashboard-app/) | Free (monetized via advisory upsell) | Best free investment/net-worth tracker; fee analysis; now tracks crypto | Data used for advisor lead-gen; shallow retirement modeling; no true household multi-user; no stock analysis |
| [Monarch Money](https://www.wallstreetzen.com/blog/kubera-vs-empower-personal-dashboard-app/) | $99.99/yr | Budgeting + net worth combined; solid household/partner sharing | Investment analysis and retirement modeling are thin |
| [Kubera](https://www.wallstreetzen.com/blog/kubera-app-review/) | $150/yr | Most sophisticated tracker for complex assets (property, crypto, private equity) | Zero budgeting, zero retirement modeling, zero stock analysis |
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
- Trinity-study-informed safe withdrawal rate as a *starting* assumption, but adjustable — Morningstar's Dec 2025 research puts a starting safe rate at **3.9%**, up from 3.7% in 2024, but that figure is conditional (roughly 30–50% equity allocation, 90% success target over a 30-year horizon) — it is not a universal constant. The app should expose the underlying assumptions (equity allocation, horizon, target success rate) as parameters the user can change, not bake 3.9% in as a hardcoded default logic.
- Target a 85–95% simulation success rate as the "safe" bar, shown as a distribution rather than a single pass/fail.
- Withdrawal sequencing across account types (taxable / tax-deferred / Roth) and Social Security timing is where Boldin beats ProjectionLab — but it's a much bigger lift than "solvable": it requires modeling tax brackets, capital-gains rates, RMDs, Social Security taxation, and possibly IRMAA, all of which change annually. **Scope this down**: P1 ships a pre-tax Monte Carlo using a flat effective-tax-rate assumption; tax-aware account-ordering logic becomes its own later phase with an explicit note that it needs periodic maintenance as tax rules change — don't present it as a one-time build.
- **Jurisdiction assumption**: this section assumes US retirement account types (401k/IRA/Roth) and US Social Security. If the household isn't US-based, this section and the account model both need revisiting — see Open Question #0 below.

Sources: [UngrindFi — Safe Withdrawal Rate 2026](https://ungrindfi.com/blog/safe-withdrawal-rate), [The Poor Swiss — Updated Trinity Study](https://thepoorswiss.com/updated-trinity-study/), [Life by Numbers — Monte Carlo Retirement Calculator](https://www.lifebynumbers.net/us/calculators/monte-carlo-retirement)

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
- **[SimpleFIN Bridge](https://www.simplefin.org/ecosystem.html)** — $1.50/mo or $15/yr, personal-use pricing, connects up to 25 institutions, daily refresh. This is the aggregator self-hosted tools like Actual Budget standardize on for exactly this use case (private individual, not a fintech company). **Recommended.**
- Plaid / Yodlee — enterprise-oriented, built for companies onboarding many end users, not priced or designed for a single household. Not recommended here.

**Market & fundamentals data:**
- **Finnhub** — generous free tier for real-time quotes and basic company data. However, historical OHLC price series and full financial-statement history (income statement, balance sheet, cash flow — exactly what the DCF calculator and "performance vs S&P 500" chart need) are commonly gated behind paid tiers; confirm current free-tier endpoint coverage before relying on it in Phase 3, don't assume it from the marketing page.
- **Financial Modeling Prep** — purpose-built for deep fundamentals (income statement/balance sheet history, DCF-ready data). Given the gap above, treat FMP as the **primary** source for fundamentals/DCF data, with Finnhub as a supplement for live quotes — not the other way around.
- Alpha Vantage (25 req/day) and Polygon.io (no free tier) — ruled out as primary: too tight or not free, respectively.
- Verify exact current pricing/limits directly against each provider's own docs before committing — API tier terms shift often and general "best APIs" roundup articles go stale fast.

Architect this as a pluggable provider interface (one file per provider behind a shared type), the same pattern the sibling Warhammer-app uses for its Sanity client with graceful fallback — so a provider can be swapped or added later without touching calculators or UI.

Sources: [APIScout — Best Stock Market APIs 2026](https://apiscout.dev/guides/best-stock-market-financial-apis-2026), [Actual Budget — SimpleFIN Setup](https://actualbudget.org/docs/advanced/bank-sync/simplefin/)

---

## 4. Features Proposal

### P1 — Foundation
- **Household model** — a household has multiple people; each person has their own accounts; dashboards roll up to household level and drill down to individual level.
- **Accounts** — cash, brokerage, retirement (401k/IRA/Roth), property, debt. Manual entry always supported; SimpleFIN sync optional per account.
- **Net worth dashboard** — trend over time, broken down by person and by asset class.
- **Portfolio view** — holdings, cost basis, allocation, performance vs. a benchmark (e.g. S&P 500).
- **Retirement Monte Carlo engine** — editable assumptions (spending, inflation, Social Security timing, account withdrawal order), success-rate output, scenario comparison (e.g. retire at 60 vs 65).

### P2 — Growth
- **Stock analysis workbench** — fundamentals lookup, DCF calculator, relative valuation, quality/balance-sheet checklist, watchlist.
- **Scenario planning** — side-by-side "what-if" comparisons (early retirement, house purchase, major expense) reusing the Monte Carlo engine.
- **Reporting** — exportable household financial statement, tax-lot detail for capital gains awareness.

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
     └─ account (cash | brokerage | retirement | property | debt)
         └─ holding (for brokerage/retirement accounts)
         └─ balance_snapshot (time series)
household
 └─ retirement_scenario (assumptions JSONB, linked to people for SS/withdrawal modeling)
 └─ stock_analysis (per ticker: DCF inputs, relative valuation inputs, checklist state)
```

### Local-first architecture
- Runs via `docker compose up` on your laptop: one container for Postgres, one for the Next.js app.
- All financial data stays on your machine — nothing leaves except outbound calls to SimpleFIN/Finnhub/FMP for sync.
- Auth: a single passphrase gate is sufficient (no need for Supabase magic-link/multi-tenant auth — this isn't a public-signup product). Household members share the one deployment.
- **Backup is not optional**: all household financial data lives in one Postgres container on one laptop with no redundancy by default. Phase 0 must include an automated `pg_dump` on a schedule plus an encrypted copy shipped off-machine (e.g. to cloud storage, encrypted before upload), and full-disk encryption on the laptop should be a stated prerequisite, not an afterthought.

### Provider abstraction
`lib/data-providers/{simplefin,finnhub,fmp}.ts` behind one shared interface per data type (account sync, quotes, fundamentals) — swappable without touching UI or calculator code, same fallback-gracefully pattern the Sanity client already uses in the sibling repo.

### Mobile/tablet access
No separate native app. The same Next.js app is a responsive PWA (installable manifest, mobile-friendly layouts for dashboard + quick-entry views). Reached from phone/iPad via **Tailscale** back to the laptop — WireGuard-encrypted point-to-point, no public port exposed, no separate hosting bill.

**Known limitation**: this only works while the laptop is on, awake, and running the containers — precisely the moments you're "away" and might most want mobile access are the moments it can fail. PWA install and service workers also require HTTPS, so the `tailscale cert` step needs to be part of setup, not assumed. If this limitation proves annoying in practice, the upgrade path is moving the Docker deployment to an always-on mini-PC or NAS on the home network, with the laptop and phone both as Tailscale clients — worth flagging now so it's not a surprise later, not necessarily worth building for on day one.

### Security notes
- Secrets (SimpleFIN token, market data API keys) in `.env.local`, never committed.
- No third-party analytics or telemetry given the sensitivity of the data.
- Passphrase + Tailscale network boundary is the security model; revisit if this ever needs to run somewhere other than your own hardware.

### Phased delivery
| Phase | Scope |
|---|---|
| 0 | Repo scaffold, docker-compose, DB schema, passphrase auth gate, automated backup (pg_dump + encrypted off-machine copy) |
| 1 | Household/people/accounts, manual net worth dashboard |
| 2 | SimpleFIN sync integration |
| 3 | Portfolio tracking + market data provider (FMP primary for fundamentals, Finnhub for live quotes) |
| 4 | Retirement Monte Carlo engine (flat effective-tax assumption, geometric-mean/bootstrapped returns, validated against a known calculator) + scenario comparison |
| 5 | Stock analysis workbench (DCF / relative valuation / checklist) |
| 6 | PWA manifest, mobile-lite views, Tailscale access + HTTPS cert documented |
| 7 | Visual design pass |
| 8 (later, optional) | Tax-aware withdrawal sequencing (bracket-aware account ordering, RMDs, SS taxation) — explicit maintenance burden as tax rules change annually |

---

## Open questions for you
0. **Jurisdiction** — is the household US-based? The retirement-account model (401k/IRA/Roth) and Social Security modeling assume US rules; a different country changes Section 2 and the account model materially.
1. Confirm SimpleFIN Bridge (~$1.50/mo) is an acceptable ongoing cost for bank/brokerage sync, or would you rather start manual-entry-only and add sync later?
2. Any specific account types to plan for now (e.g. non-US accounts, crypto, private equity/RSUs) that would affect the account model in Phase 0–1?
3. Household size — just the two of you, or should the person model allow for more (e.g. dependents tracked but not full users)?
4. Is the "laptop must be on for phone access" limitation (Section 5, mobile/tablet access) acceptable for now, or should we plan for an always-on mini-PC/NAS from the start instead of as a later upgrade?

---

## 6. Review Notes (Fable pass)

This proposal was independently reviewed by a second model (Fable) before being finalized. Verdict: **approve with changes**, since incorporated inline above. Summary of what changed as a result:

- Retirement methodology tightened: explicit return-model choice (geometric mean, bootstrap vs. parametric), a validation acceptance criterion against a known calculator, and the 3.9% withdrawal rate reframed as conditional rather than universal.
- Tax-aware withdrawal sequencing descoped out of P1 into its own later phase, with a maintenance caveat — it was originally understated as "a solvable modeling problem."
- Market data provider order flipped: FMP primary for fundamentals/DCF, Finnhub as a supplement — Finnhub's free-tier depth for historical statements is not guaranteed.
- Added: jurisdiction as an open question, an explicit backup requirement in Phase 0, and the Tailscale/laptop-as-server availability limitation with its upgrade path.
- Flagged for you: some of the original research citations (competitive landscape roundups in particular) are SEO/affiliate content rather than primary sources — treat the qualitative comparisons as directionally useful, not gospel, and re-verify anything load-bearing (pricing, API limits) against the vendor's own docs at build time.
