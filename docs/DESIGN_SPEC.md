# Financial Planning App — P1 Interaction Design Spec

Design Agent output, working inline (no Jira epic — this repo doesn't use the Jira pipeline). Grounded in `docs/PROPOSAL.md` Sections 1–5. Scope: **P1 Foundation only** — household/accounts, net worth dashboard, portfolio view, retirement Monte Carlo engine. P2/P3 features (stock workbench, Cash Allocation Advisor, scenario planning, reporting) are referenced only where P1 needs to leave room for them.

No visual design system exists yet (styling is explicitly deferred — Phase 7 in the proposal). This spec defines structure, states, and interaction patterns; a follow-up visual mockup applies a look to it.

---

## Foundational decisions

- **Primary device**: laptop first (where most data entry and analysis happens), phone/iPad second (viewing + quick entry, tiered offline per the proposal's Mobile/tablet access section). Every screen below is specified device-agnostically with device-specific notes where layouts genuinely diverge.
- **No role/permission split between household members.** Anyone who knows the passphrase has full read/write access to all household data — matches the single-passphrase, no-multi-tenant-auth architecture already locked in. A future read-only mode for one partner is plausible but explicitly out of scope; not blocking on it.
- **Navigation**: persistent left sidebar on laptop (collapsible), bottom tab bar on mobile. Five primary sections for P1: **Net Worth** (home), **Accounts**, **Portfolio**, **Retirement Planner**, **Settings**. P2 sections (Stocks, Advisor, Reports) get sidebar slots reserved but greyed out/hidden until built, so P1's nav doesn't need restructuring later.
- **A persistent connectivity indicator** lives in the top chrome on every screen (small badge, not a full screen) — see Component Decisions.

---

## User Flows

### Flow: First-time setup
Entry point: passphrase gate, first successful login, no household exists yet
1. User submits passphrase → System validates, creates session, detects no household record exists
2. System redirects to a guided setup screen (not the empty dashboard) → shows "Let's set up your household"
3. User adds household members (name + date of birth per person, at least one required) → System creates person records
4. User is prompted "Add your first account" → System shows account-type picker
5. User selects a type, fills type-specific fields → System creates the account, shows it in a running list with a "+ Add another" affordance
6. User adds accounts until done, taps "Finish setup" → System redirects to Net Worth Dashboard
Exit point: Net Worth Dashboard, now showing real (if minimal) data instead of an empty state

### Flow: Daily/regular check-in
Entry point: app opened (already authenticated, session valid)
1. User opens app → System loads Net Worth Dashboard, shows cached data instantly, revalidates in background if connected
2. User views trend, toggles breakdown (by person / asset class / tax wrapper) → System re-renders the same chart with new grouping, no navigation
3. User taps an account in the list → System navigates to Account Detail
4. User reviews balance history, returns via back navigation → System returns to Dashboard with prior toggle state preserved
Exit point: Dashboard or Account Detail, session remains open

### Flow: Manual balance update
Entry point: "+" quick-action (global, always reachable) or an account's detail screen
1. User taps "+" → System shows a picker: "Update a balance" / "Log a transaction" (transactions are P2/GIA-tax-lot scope; P1 only needs "Update a balance", but the picker leaves room)
2. User selects an account, enters a new balance and effective date (defaults to today) → System validates (numeric, non-negative unless account type is `debt`)
3. User confirms → System writes optimistically: the new balance appears in the UI immediately with a small "syncing" indicator, request fires in the background
4. System confirms the write → indicator clears; OR system is offline → entry is queued locally, indicator persists as "pending sync" until connectivity returns
Exit point: returns to whichever screen the "+" was triggered from, with the update visible

### Flow: Run a retirement scenario
Entry point: Retirement Planner section, "New scenario" or editing an existing one
1. User opens Retirement Planner → System shows the most recent scenario's assumptions and its last-computed results (if any), clearly labeled with when they were computed
2. User edits an assumption (e.g. moves the "retire at" slider) → System marks results as **stale** (visually distinct, doesn't hide the old results — see Screen 7 states) but does not auto-recompute
3. User makes further edits, then taps "Run simulation" → System validates inputs, creates the run, shows a computing state
4. System polls the run status → on completion, replaces the stale results with new ones, updates the "computed at" timestamp
5. If the connection drops mid-poll → System shows "Reconnecting…" without discarding the in-progress run; polling resumes once reachable, since the run itself lives server-side and isn't lost
Exit point: Retirement Planner results screen, now current

### Flow: Compare two scenarios
Entry point: an existing scenario's results screen, "Compare" action
1. User taps "Compare" → System shows a picker of other saved scenarios (or "create a new one to compare")
2. User selects one → System shows the Scenario Comparison screen, both results side by side
3. User can edit either scenario from this screen (returns to that scenario's editor, same stale/re-run mechanic as above) → System updates the comparison once both are current
Exit point: Comparison screen, or back into an individual scenario's editor

### Flow: Offline / degraded access
Entry point: app opened, or connectivity lost mid-session
1. System detects the backend is unreachable → connectivity badge switches to "Offline"
2. User navigates the app normally → cached screens (Net Worth, Portfolio, most recent Retirement results) render fully, each showing a "last synced ⟨time⟩" badge
3. User attempts an action that needs the live backend (e.g. "Run simulation", refreshing a live quote) → System blocks the action with an explicit "Reconnect to run this" state, not a spinner that never resolves or a silent failure
4. User can still log a manual balance update → queues locally per the Manual balance update flow above
5. Connectivity returns → System auto-flushes the queue, badge switches to "Connected", any blocked actions become available again without the user re-navigating
Exit point: normal connected use resumes

---

## Screen Inventory

**Screen: Passphrase Gate**
- Route: `/login`, shown whenever there's no valid session
- Entry points: app cold-launch, session expiry, explicit logout
- Purpose: authenticate before any household data is shown
- Exit points: Net Worth Dashboard (existing household) or Guided Setup (first run)

**Screen: Guided Setup**
- Route: `/setup`, shown only when a household exists with zero people/accounts
- Entry points: first successful login only
- Purpose: get to a non-empty, useful dashboard as fast as possible
- Exit points: Net Worth Dashboard

**Screen: Net Worth Dashboard**
- Route: `/` (home)
- Entry points: nav sidebar/tab, post-login default, post-setup redirect
- Purpose: the at-a-glance household financial position
- Exit points: Account Detail, Portfolio, Retirement Planner (all reachable via nav or in-page links)

**Screen: Accounts List**
- Route: `/accounts`
- Entry points: nav
- Purpose: browse/manage every account, grouped by owner
- Exit points: Account Detail, Add Account

**Screen: Add/Edit Account**
- Route: `/accounts/new`, `/accounts/:id/edit` — modal or full screen depending on device (see spec)
- Entry points: Accounts List "+", Guided Setup
- Purpose: create or modify an account's static details (type, owner, wrapper-specific fields)
- Exit points: Accounts List, or back to Account Detail if editing

**Screen: Account Detail**
- Route: `/accounts/:id`
- Entry points: Accounts List, Net Worth Dashboard account rows
- Purpose: single-account balance history, holdings (if investment type), and quick balance update
- Exit points: Manual balance update (in-page), Edit Account, back to Accounts List

**Screen: Portfolio View**
- Route: `/portfolio`
- Entry points: nav
- Purpose: household-wide investment holdings, allocation, performance vs. benchmark
- Exit points: Account Detail (drill into a specific holding's account)

**Screen: Retirement Planner — Scenario Editor**
- Route: `/retirement/:scenarioId/edit` (or `/retirement/new`)
- Entry points: nav ("Retirement Planner"), "New scenario", editing from Results
- Purpose: set/adjust the assumptions behind a Monte Carlo run
- Exit points: Results (after running), or Results (viewing without running, if unchanged)

**Screen: Retirement Planner — Results**
- Route: `/retirement/:scenarioId`
- Entry points: Scenario Editor after a run, nav default (most recent scenario)
- Purpose: present the probabilistic outcome of a scenario
- Exit points: Scenario Editor (to adjust), Scenario Comparison

**Screen: Retirement Planner — Scenario Comparison**
- Route: `/retirement/compare?a=:id&b=:id`
- Entry points: "Compare" action on Results
- Purpose: side-by-side outcome comparison of 2 (or more) scenarios
- Exit points: either scenario's Results/Editor

**Screen: Settings**
- Route: `/settings`
- Entry points: nav
- Purpose: household member management, backup status, connectivity/session info
- Exit points: n/a (terminal utility screen)

---

## Screen Specifications

### Screen: Net Worth Dashboard

**Layout & content**
Top region: total household net worth as the single largest number on the page, with the "last synced" timestamp directly beneath it if offline/stale, and a trend sparkline/chart spanning a selectable window (1M/6M/1Y/All). Below that: a segmented control toggling the breakdown view — **By person / By asset class / By tax wrapper** — re-rendering the same chart area as a stacked or grouped view, not a new page. Below the chart: an account list, grouped by owner (including a "Joint" group for accounts with no single owner), each row showing account name, type badge, and current balance, sorted by balance descending within group.

**States**
- *Default/loaded*: as above, live figures.
- *Loading*: skeleton for the total figure, chart, and account rows — not a full-page spinner, since this is the landing screen and should feel instant even on first paint.
- *Empty*: only reachable if Guided Setup was skipped somehow (shouldn't normally happen) — "No accounts yet" with a primary CTA "Add your first account".
- *Error*: backend reachable but query failed — "Couldn't load your net worth right now" with a retry button; distinct from the offline state below.
- *Offline/stale*: not a separate screen state but an always-visible badge (see Component Decisions) plus the "last synced" timestamp under the total figure.

**Key interactions**
- Tapping the breakdown segmented control re-renders the chart in place (no navigation, no reload).
- Tapping an account row navigates to Account Detail.
- Tapping the total net worth figure has no action (it's not a button) — avoid the common mistake of making the hero number secretly clickable with no visual affordance.

**Edge cases**
- A household with only debt accounts (negative net worth): the total figure renders in a distinct (not alarming-red, just visually distinct — e.g. parentheses or a muted tone) style rather than defaulting to a "success green/failure red" binary, since negative net worth early in adulthood (e.g. a mortgage-heavy household) isn't a failure state.
- Very long time series (years of daily snapshots): the chart downsamples for the "All" window rather than rendering every point.

---

### Screen: Accounts List

**Layout & content**
Grouped list by owner (Person A, Person B, Joint), each group collapsible. Each row: account type icon, name, wrapper badge (ISA/Pension/GIA/none — small, consistent with the Dashboard's wrapper breakdown), balance, last-updated relative time. A persistent "+ Add account" action, always visible (not buried in a menu), since this is a core recurring action.

**States**
- *Default*: as above.
- *Loading*: skeleton rows.
- *Empty*: "No accounts yet — add your first one" with CTA (same copy pattern as Dashboard's empty state, deliberately consistent).
- *Error*: inline retry, same pattern as Dashboard.

**Key interactions**
- Tap a row → Account Detail.
- Tap "+ Add account" → Add Account.
- Long-press/overflow menu per row → Edit, Archive (not hard-delete — see Edge cases).

**Edge cases**
- **Archiving vs. deleting an account**: an account that's closed (e.g. an old ISA transferred elsewhere) shouldn't be hard-deleted, since its balance history is part of the household's net worth trend. Decision: accounts get an "Archived" state (excluded from current totals, filterable back in), never a destructive delete from this screen. Hard delete, if ever needed, is a Settings-level action with explicit confirmation.
- Joint accounts: shown once, in the "Joint" group, not duplicated under both people.

---

### Screen: Add/Edit Account

**Layout & content**
Step 1: account type picker (Cash, GIA, Cash ISA, S&S ISA, LISA, SIPP/Pension, Property, Debt) as a grid of labeled icons, not a dropdown — these are meaningfully different concepts (per the proposal's tax-wrapper distinctions) and deserve visual weight, not a buried select box. Step 2: a form that adapts to the chosen type:
- All types: name, owner (person picker, multi-select for joint — see below), starting balance, as-of date.
- `debt` type: additionally interest rate, minimum payment; overpayment allowance % and ERC rate marked **optional, add later** (these matter for the P2 Cash Allocation Advisor, not P1 — don't force the user through fields with no P1 payoff).
- `lisa` type: an inline note explaining the £4,000/year sub-limit and 25% bonus (brief, one line, not a wall of text) so the distinct type feels justified rather than arbitrary.
- `cash_isa`/`ss_isa`: no extra fields in P1 beyond the standard set — the tax-wrapper-specific logic (2027 cap, GBX handling) is backend/reporting concern, not a data-entry concern.

**Owner field**: a multi-select chip control (not radio buttons) — selecting more than one person marks it a joint account. Defaults to unselected (forces an explicit choice) rather than defaulting to the first household member, to avoid silent misattribution.

**States**
- *Default*: empty form (create) or pre-filled (edit).
- *Validation*: inline, on-blur per field (not only on submit) — "Balance can't be negative" etc. shown directly under the field. Submit button disabled until required fields are valid, not "click submit to find out what's wrong".
- *Error* (save failed): form retains all entered values, error banner at the top, does not clear the form — never lose entered data on a failed save.

**Key interactions**
- Type picker selection reveals the adapted form beneath it, doesn't navigate to a new screen (keeps context, one back-navigable step instead of two).
- Cancel from an edit discards unsaved changes with a confirmation only if the form is dirty (no confirmation needed if nothing changed).

**Edge cases**
- Changing an account's type after creation (e.g. correcting Cash ISA → S&S ISA) — allowed, but changing *away from* a `debt` type when `debt_terms` data exists prompts a confirmation that those fields will be hidden (not deleted, in case they switch back).

---

### Screen: Account Detail

**Layout & content**
Header: account name, type/wrapper badges, owner(s), current balance (large). A balance-history chart (same visual language as the Dashboard's trend chart, scoped to this account). Below: for investment-type accounts (GIA/ISA/SIPP), a holdings table (ticker, quantity, cost basis, current value, gain/loss) — P1 scope is display-only, editable manually; live pricing is P2 (market data provider). For `debt` accounts, the balance chart inverts framing (paying down is "progress," shown as a downward-trending "good" line, not styled as decline). A prominent "Update balance" action.

**States**
- *Default*: as above.
- *Loading*: skeleton.
- *Empty holdings* (investment account with no holdings logged yet): "No holdings added yet" + CTA, distinct from the account-level empty state.
- *Stale* (offline, cached): "last synced" badge, "Update balance" still available (queues per the offline flow).

**Key interactions**
- "Update balance" opens the Manual balance update flow as an in-page drawer (not full navigation) — the user shouldn't lose their place on the detail screen for such a lightweight action.
- Holdings rows are read-only in P1 tap targets (no accidental edit); an explicit "Edit holdings" mode toggle if editing is needed.

**Edge cases**
- An account with a single starting balance and no history yet: chart area shows a single point plus a light "history will build up as you update this account" note rather than an empty/broken-looking chart.

---

### Screen: Portfolio View

**Layout & content**
Household-wide, not per-account: total invested value, allocation breakdown (by asset class, e.g. equities/bonds/cash — pie or bar, not a chart type war worth over-specifying now), a holdings table aggregated across all investment accounts (ticker, total quantity across accounts, total value, % of portfolio, performance vs. a benchmark line shown as a delta, e.g. "+3.2% vs. FTSE All-World"). Each row expandable to show which account(s) it's held in.

**States**
- *Default*: as above.
- *Loading*: skeleton.
- *Empty* (no investment accounts yet): "Add an investment account to see your portfolio here" + CTA to Accounts.
- *Stale/offline*: last-synced badge; benchmark comparison specifically flagged as "may not reflect current market" when offline, since it depends on live-ish pricing.

**Key interactions**
- Tap a holding row → expand in place (accordion), not navigate away, to support quick scanning across many holdings.
- Benchmark selector (which index to compare against) — a simple dropdown, defaulting to a sensible choice (e.g. a global index) rather than forcing a choice before any data shows.

**Edge cases**
- Multi-currency holdings (the proposal notes US-stock holdings are a real use case): value shown in GBP with the original currency/price visible on expand, not hidden — this is exactly the GBX/GBP-adjacent correctness concern from the technical spec, and hiding currency would make errors invisible to the user too.

---

### Screen: Retirement Planner — Scenario Editor

**Layout & content**
This is the most information-dense P1 screen and needs restraint. Group assumptions into three visually distinct sections rather than one long form: **When** (retirement age per person, State Pension claiming age — defaulted from date of birth but overridable), **Spending** (annual spending in retirement, inflation assumption — sensible UK-calibrated defaults pre-filled, not blank fields demanding research), **Strategy** (PCLS timing, wrapper withdrawal order — this section can be visually de-emphasized/collapsed by default with "Advanced" labeling, since P1's engine treats withdrawal order as a simple assumption, not an optimizer, per the proposal's Phase 8 note — don't imply more sophistication than P1 actually has).

A persistent results-preview strip stays visible (collapsed, e.g. at the bottom) showing the *last computed* result and its state (current / stale), so editing assumptions never fully hides the prior answer.

**States**
- *Default*: pre-filled with UK-calibrated defaults on first scenario, or saved values on subsequent edits.
- *Dirty/stale*: any field change immediately marks the results-preview strip as "Assumptions changed — results below are from your last run" (not hidden, not silently kept looking current).
- *Validating*: inline per field (e.g. retirement age must be ≥ current age, ≤ 100).
- *Running* (after "Run simulation"): the whole editor becomes non-interactive (fields disabled, not hidden) with the results-preview strip switching to a computing state (see Results screen for the pattern, reused here) — user can navigate away (the run continues server-side) but can't edit further until it resolves or they explicitly cancel.

**Key interactions**
- "Run simulation" is the one primary action, always visible (not scrolled out of view) — sticky footer/header treatment on both device sizes.
- Reset-to-defaults action, secondary, with confirmation (destroys manual edits).

**Edge cases**
- Editing while a previous run is still computing: allowed, but "Run simulation" queues the *new* set of assumptions rather than the in-flight run's — the in-flight run still completes and briefly shows before being superseded, rather than being silently discarded (avoids "did my click even register" confusion).
- Two people in the household with very different retirement ages: the "When" section must clearly scope each age field to a named person, not a generic "retirement age" that's ambiguous in a two-person household.

---

### Screen: Retirement Planner — Results

**Layout & content**
Headline: success rate as a large percentage ("87% of simulated outcomes succeeded"), immediately followed by a **fan chart** — portfolio value over time, median line plus a shaded percentile band (e.g. 10th–90th) — rather than a bare bar/gauge, since a single number invites false precision for a probabilistic result. Below: a plain-language success-rate band indicator (e.g. "Strong" / "On track" / "At risk" mapped to rate ranges, per the proposal's 85–95% target-bar framing) so the percentage isn't the only interpretive cue. A compact assumptions summary (collapsed, expandable) so the user can see *what* produced this result without leaving the screen. "Adjust assumptions" and "Compare" actions.

**States**
- *Default (current)*: as above, "Computed ⟨relative time⟩" shown quietly near the headline.
- *Stale*: same layout, but with a persistent banner "These results are from before your last change — re-run to update" (not just a small badge — this is consequential enough to warrant a real banner, distinct from the softer "last synced" pattern used for passive viewing screens).
- *Computing*: replaces the headline/chart region with a computing state — an animated (not indeterminate-feeling) progress element plus reassuring copy ("Running 10,000 simulations — this usually takes a few seconds"), full editor access blocked per the Editor screen's Running state.
- *Blocked-offline* (user tries to re-run with no connectivity): explicit "Reconnect to run this" state replacing the "Run simulation" action — not a disabled button with no explanation, and not a spinner that never resolves.
- *No results yet* (brand new scenario, never run): empty-state framing — "Run your first simulation to see your results" with the editor's "Run simulation" action surfaced prominently here too, not just in the editor.

**Key interactions**
- "Compare" → scenario picker → Comparison screen.
- Tapping the fan chart at a point in time shows a tooltip with median/percentile values at that year — a real interaction, not decorative.

**Edge cases**
- A 0% or 100% success rate: both are legitimate outputs and shouldn't be styled as an "error" — 0% needs to read as "this plan needs adjustment," not as a broken feature.

---

### Screen: Retirement Planner — Scenario Comparison

**Layout & content**
Two (extendable to more) result summaries side by side (stacked on mobile, not squeezed), each with its own headline success rate and mini fan chart, plus a compact delta callout ("Scenario B: 12 percentage points higher success rate, retires 2 years later"). A shared assumptions-diff table below — only the fields that *differ* between scenarios, not a full duplicate list, so the comparison is legible.

**States**
- *Default*: both scenarios current.
- *One-stale*: if either scenario's results are stale relative to its own assumptions, that side shows the same stale banner pattern as the single Results screen — comparisons involving stale data must not silently look equally trustworthy as fresh ones.
- *Loading*: skeleton per side, independently (one might load faster than the other).

**Key interactions**
- Tap either side's headline → navigates into that scenario's full Results screen.
- "Add another scenario" (beyond 2) — P1 supports at least 2; whether 3+ is in scope is an open question below.

**Edge cases**
- Comparing a scenario against itself (user selects the same one twice) — prevented at the picker level, not allowed then confusingly shown as identical.

---

## Component Decisions

**Component: Connectivity Badge**
- Type: new
- Used on: every screen (global chrome)
- Behaviour: three states — Connected (subtle/near-invisible when everything's fine, doesn't demand attention), Offline (visible, non-alarming — this is expected/designed-for behavior per the proposal, not an error), Syncing (brief, transitional, shown while the write-queue flushes).
- Variants: compact (icon only, mobile) / labeled (icon + text, laptop).
- Notes: this is the single most-seen new component in the app and should be calibrated to *not* create anxiety on every offline use — the whole point of the tiered offline design is that offline is a normal, supported state, and the UI shouldn't contradict that by treating it as an alarm.

**Component: Stale/Last-Synced Indicator**
- Type: new
- Used on: Dashboard, Portfolio, Account Detail, Retirement Results (whenever showing cached/computed-in-the-past data)
- Behaviour: relative timestamp ("Synced 2 hours ago"), escalates visual weight the older it gets (quiet at <1hr, more visible past 24hr) — a week-old net worth figure shown with the same subtlety as a 5-minute-old one would be misleading.
- Variants: passive badge (viewing screens) vs. active banner (Retirement Results' stale-after-edit state, which is a stronger signal than mere staleness — it means the *inputs* changed, not just time passing).

**Component: Fan Chart**
- Type: new
- Used on: Retirement Results, Scenario Comparison
- Behaviour: median line + shaded percentile band over a time axis; tooltip on hover/tap.
- Variants: full-size (Results) / compact (Comparison, side-by-side).
- Notes: this is the single highest-value new component in the app — it's how a probabilistic engine avoids being misread as a deterministic prediction. Worth real design investment even before the Phase 7 visual pass; the interaction pattern matters more than the final colors.

**Component: Account Type Badge**
- Type: new
- Used on: Accounts List, Dashboard, Account Detail, Portfolio
- Behaviour: consistent small label/icon per type (Cash/GIA/Cash ISA/S&S ISA/LISA/SIPP/Property/Debt) — same visual vocabulary everywhere the type appears, so users build pattern recognition once.
- Variants: icon-only (dense lists) / icon+label (detail views).

**Component: Computing/Progress Indicator**
- Type: new
- Used on: Retirement Results (Computing state), reusable for any future async compute (P2's Cash Allocation Advisor will need the same pattern)
- Behaviour: animated, with elapsed-time-aware copy rather than a bare spinner — since compute genuinely takes a few seconds, a spinner with no context reads as broken past ~2 seconds.

---

## Copy Decisions

| Location | Copy | Notes |
|---|---|---|
| Empty state: Net Worth Dashboard (edge case) | "No accounts yet" / "Add your first account to see your net worth" | CTA: "Add account" |
| Empty state: Accounts List | "No accounts yet — add your first one to get started" | CTA: "+ Add account" |
| Empty state: Portfolio | "Add an investment account to see your portfolio here" | CTA: "Go to Accounts" |
| Empty state: Retirement Results (never run) | "Run your first simulation to see your results" | CTA: "Run simulation" |
| Error: generic load failure | "Couldn't load this right now" | CTA: "Try again"; avoid technical error text |
| Offline blocked action | "Reconnect to run this" | Sub-line: "This needs a live connection to your home network" |
| Stale results banner | "These results are from before your last change" | CTA: "Re-run to update" |
| Computing state | "Running 10,000 simulations — this usually takes a few seconds" | Update if the actual iteration count differs |
| Confirmation: archive account | "Archive this account?" / "It'll be hidden from your current totals but its history is kept." | Actions: "Archive" (not destructive-red, since it's reversible) / "Cancel" |
| Confirmation: discard unsaved changes | "Discard unsaved changes?" | Actions: "Discard" (destructive-red) / "Keep editing" |
| Validation: negative balance (non-debt account) | "Balance can't be negative for this account type" | Inline, on-blur |
| Validation: retirement age | "Retirement age must be between your current age and 100" | Inline, on-blur |

---

## Accessibility Requirements

- **Keyboard navigation**: full tab order through all forms (Add/Edit Account, Scenario Editor); the segmented breakdown control on the Dashboard must be operable via arrow keys once focused, not mouse/touch-only. Modals/drawers (Manual balance update) trap focus and return it to the triggering element on close.
- **Screen reader**: the fan chart needs a text-equivalent summary alongside the visual (e.g. "Median outcome: £420,000 at age 90; 10th percentile: £80,000; 90th percentile: £890,000") — a chart-only probabilistic result is inaccessible by nature, and this is also useful for anyone who wants the numbers without reading a chart. Live regions for the Computing → Complete transition on Retirement Results, so a screen reader user isn't left waiting with no announcement.
- **Colour contrast**: the negative-net-worth and debt-progress framing (Dashboard, Account Detail edge cases) must not rely on colour alone (red/green) to convey meaning — pair with icons/text, both for contrast-accessibility and because financial "good/bad" framing is genuinely ambiguous (debt paydown is progress, not a warning).
- **Touch targets**: minimum 44×44pt for all interactive elements on mobile layouts, especially the Accounts List row overflow menus and the Dashboard's breakdown segmented control.

---

## Open Questions

| Question | Why it matters | Suggested default |
|---|---|---|
| Does Scenario Comparison need to support 3+ scenarios in P1, or is 2 sufficient? | Affects the Comparison screen's layout (fixed two-column vs. a scrollable/carousel N-up layout) | Ship with 2 for P1; the layout chosen (side-by-side, not overlaid) extends to N without a redesign, so this is low-risk either way — default to 2, revisit if it's genuinely wanted before Phase 4.6's broader Scenario Planning feature ships |
| Should the "Update balance" quick-entry ("+") support logging a full transaction (not just a balance snapshot) in P1, given the proposal's data model already anticipates transactions as append-only? | Transactions are explicitly noted as reducing conflict-resolution risk in the technical spec; balance-only entry is simpler UX but loses that benefit early | Default to balance-only for P1 (matches the stated P1 feature scope); revisit if manual entry turns out to be the primary usage mode rather than a stopgap before Phase 5's sync spike |
| Is a single "household" ever going to need more than the two-tier (person / joint) ownership model — e.g. a dependent tracked but not a full user? | The proposal's earlier Open Questions resolution said no cap on household size, but didn't address non-full-user dependents | Default to full-user-only per-person records for P1; a "tracked, not logged-in" dependent type is a plausible P2+ addition, not needed now |

---

## Handoff Note

This spec is ready for the tech architect / implementation phase. The three most consequential decisions to carry forward:

1. **The fan chart is the single highest-design-value component in P1** — worth getting the interaction (tooltip, percentile band, text-equivalent for accessibility) right before the visual pass, since it's what keeps the Monte Carlo engine's probabilistic output from being misread as a single prediction.
2. **The stale/computing/offline state machine on the Retirement Planner is a first-class design surface, not an edge case** — the Editor, Results, and Comparison screens all need to agree on what "stale" vs. "computing" vs. "offline-blocked" look like, since a user moving between them should never be confused about which state they're in.
3. **Manual entry is optimistic and queue-aware by default** — every write shows immediately with a pending-sync indicator rather than waiting for server confirmation, which is what makes the offline tier (Section 5 of the proposal) actually usable rather than theoretical.
