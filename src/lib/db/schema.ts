import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Schema. Phase 0 added `backup_run`; Phase 1 adds the household/people/accounts model.
 *
 * Still absent, and deliberately so: any `user` or `session` table. Auth is a single
 * shared household passphrase (PROPOSAL.md Security notes) whose argon2id hash lives in
 * APP_PASSPHRASE_HASH, sessions are stateless signed cookies (src/lib/auth/session.ts),
 * and brute-force counters are in-memory (src/lib/auth/lockout.ts). There are no
 * per-user accounts, so there is nothing to store. `person` below is a *household
 * member* — a subject of financial planning, not a login.
 *
 * Two conventions hold throughout, both load-bearing:
 *  - **All money is `NUMERIC(14,2)`, never float.** PROPOSAL.md is explicit about this:
 *    "a Monte Carlo engine quietly built on IEEE 754 for GBP amounts is exactly the kind
 *    of error the reference-calculator tolerance test won't catch". node-postgres returns
 *    NUMERIC as a *string*, and the app keeps it that way — see src/lib/money.ts, which
 *    does all arithmetic in integer pence.
 *  - **Deletes do not cascade through anything that represents financial history.**
 *    `ON DELETE RESTRICT` from person to account is called out by name in the proposal
 *    ("deleting a person with accounts should be an explicit ownership migration, not a
 *    cascade that silently vaporizes financial history"); the same posture is extended
 *    upward to household → person and household → account.
 */

export const backupOutcome = pgEnum('backup_outcome', ['success', 'failure']);

export const backupRuns = pgTable(
  'backup_run',
  {
    id: serial('id').primaryKey(),

    /** When the backup script started. Set by scripts/backup.sh. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),

    /** When it finished, successfully or not. */
    finishedAt: timestamp('finished_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    outcome: backupOutcome('outcome').notNull(),

    /**
     * Path of the encrypted dump on the backup host. Nullable because a failed run
     * often has no artefact to point at.
     */
    artefactPath: text('artefact_path'),

    /**
     * Size of the encrypted dump. bigint because a household's dump will outgrow
     * int4 bytes eventually, and this column is trivially cheap to get right now.
     * Nullable for the same reason as artefactPath.
     */
    artefactBytes: bigint('artefact_bytes', { mode: 'number' }),

    /** SHA-256 of the encrypted dump, so a restore test can prove integrity. */
    artefactSha256: text('artefact_sha256'),

    /**
     * Whether the artefact was encrypted before leaving the machine. Recorded rather
     * than assumed: an unencrypted dump copied off-machine is a reportable problem,
     * and the app should be able to show it.
     */
    encryptionMethod: text('encryption_method'),

    /** Failure detail, or any note the script wants to surface in the UI. */
    detail: text('detail'),
  },
  (table) => ({
    /**
     * The app's only read pattern is "most recent successful run", which this index
     * serves directly: filter on outcome, take the newest finished_at.
     */
    outcomeFinishedAtIdx: index('backup_run_outcome_finished_at_idx').on(
      table.outcome,
      table.finishedAt.desc(),
    ),
  }),
);

export type BackupRun = typeof backupRuns.$inferSelect;
export type NewBackupRun = typeof backupRuns.$inferInsert;

/* ------------------------------------------------------------------------------------
 * Phase 1 — household, people, accounts
 * ---------------------------------------------------------------------------------- */

/**
 * Money columns are all NUMERIC(14,2). 14 digits with 2 decimals tops out just under
 * a trillion pounds, which is comfortably beyond a household's needs and still narrow
 * enough that an absurd value looks like the input error it is.
 */
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/**
 * Percentages (interest rates, overpayment allowances, ERC rates) are NUMERIC(6,3) —
 * enough for 4.125% or 0.001%, and not money, so they deliberately don't use the money
 * helper above. Storing them as percent (4.125 meaning 4.125%) rather than as a fraction
 * matches how mortgage paperwork states them, which is where the numbers get typed from.
 */
const percent = (name: string) => numeric(name, { precision: 6, scale: 3 });

/** `createdAt`/`updatedAt` on every Phase 1 table, so a bad edit can be dated. */
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
};

/**
 * The household.
 *
 * There is exactly one row in practice — the app is single-passphrase and
 * single-household by design (PROPOSAL.md Security notes), and Guided Setup creates the
 * row. Queries nonetheless take a household id and don't assume `id = 1`: the FK columns
 * below have to exist either way, so nothing is saved by hardcoding the assumption, and
 * a hardcoded `1` would be a genuinely nasty thing to unpick if this ever grew a second
 * household or was restored from a dump with different sequence values.
 */
export const households = pgTable(
  'household',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),

    /**
     * Phase 4.5's Cash Allocation Advisor, waterfall step 1: a direct target balance,
     * not a derived "N months of expenses" formula — no monthly-essential-spending
     * concept exists anywhere in this schema, and inventing one just to derive this
     * would be a bigger, unrequested feature. Nullable: an unset target means "not
     * entered yet," not zero — same reasoning as `person.annual_gross_income`.
     */
    emergencyFundTarget: money('emergency_fund_target'),
    ...timestamps,
  },
  (table) => ({
    // `createHousehold`'s "refuse to create a second one" check is app-level
    // check-then-insert, which two concurrent first-time-setup submissions can both pass.
    // This index is the database backstop: a unique index on a constant expression allows
    // at most one row in the whole table, so the second concurrent insert fails loudly
    // (caught and treated as "already done") instead of silently creating a second
    // household that later queries could nondeterministically pick.
    singleton: uniqueIndex('household_singleton').on(sql`(true)`),
  }),
);

export const pensionContributionMethod = pgEnum('pension_contribution_method', [
  'relief_at_source',
  'net_pay',
  'salary_sacrifice',
]);

/**
 * A household member.
 *
 * `dateOfBirth` is NOT NULL on purpose. PROPOSAL.md: "required — not just a nicety:
 * drives State Pension age, LISA open/contribute age gates (18-39 to open,
 * contribute-to-50), and the Cash ISA £12,000 cap's under-65 condition from April 2027".
 * An earlier draft of that document parameterised State Pension age per person with no
 * birth date to derive it from; making the column nullable would reintroduce exactly
 * that gap for every later phase.
 *
 * `annualGrossIncome` is nullable, and that is also deliberate but for the opposite
 * reason: it is an *editable planning assumption* (defined as pre-sacrifice contractual
 * salary), not a fact needed to create a person. Someone setting up the app to see their
 * net worth should not be blocked at step one by a salary field, and a `0` default would
 * be worse than null — it would silently claim an income of zero to the tax-band
 * derivation in Phase 4.5, rather than saying "not entered yet".
 */
export const people = pgTable(
  'person',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),

    /**
     * Stored as a plain `date` in string mode. Not a timestamp: a birth date has no
     * time or zone, and reading it back as a JS Date would shift it across midnight for
     * anyone west of UTC — a silently-off-by-one-day birth date would then quietly move
     * a State Pension age by a year at a boundary.
     */
    dateOfBirth: date('date_of_birth', { mode: 'string' }).notNull(),

    /** Pre-sacrifice contractual salary. Nullable — see the note above. */
    annualGrossIncome: money('annual_gross_income'),

    /**
     * Whether this person has already flexibly accessed a pension (drawn from a DC
     * pot beyond the tax-free lump sum), which triggers the £10,000 Money Purchase
     * Annual Allowance — `src/lib/advisor/taxStatus.ts`'s `computeAnnualAllowanceStatus`
     * takes this as an explicit parameter. Defaults false, not nullable: unlike
     * income, "not yet accessed" is the correct default for everyone who hasn't
     * retired, not an unentered-planning-assumption gap.
     */
    hasFlexiblyAccessedPension: boolean('has_flexibly_accessed_pension').notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    householdIdx: index('person_household_idx').on(table.householdId),
  }),
);

/**
 * A pension contribution, per person.
 *
 * `method` and `employerAmount` are both stored rather than just a total, because
 * PROPOSAL.md needs them separately: adjusted net income and threshold/adjusted income
 * treat relief-at-source, net-pay and salary-sacrifice contributions differently, so a
 * single "total contributions" number cannot derive a tax band or a taper position. This
 * table is written by Phase 1's UI and read by nothing yet — Phase 4.5's Cash Allocation
 * Advisor is the consumer. It exists now because the schema is the expensive part to get
 * wrong later, not the form.
 *
 * `amount` and `employerAmount` are **annual** amounts, in line with
 * `person.annual_gross_income` being annual; the proposal says "per contribution:
 * amount" without naming a period, and picking the same period as the income it is
 * assessed against is the only choice that lets the two be compared without a
 * conversion factor stored nowhere. There is deliberately no `frequency` column — an
 * unused one would be a guess, and Phase 4.5 can add it with a migration if monthly
 * entry turns out to be what people actually want to type.
 */
export const pensionContributions = pgTable(
  'pension_contribution',
  {
    id: serial('id').primaryKey(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),

    /** The member's own annual contribution. */
    amount: money('amount').notNull(),

    method: pensionContributionMethod('method').notNull(),

    /**
     * The employer's annual contribution. NOT NULL with no default: "required input,
     * not just the total" per the proposal. A household with no employer contribution
     * records an explicit `0`, which is a different (and checkable) statement from a
     * NULL meaning "nobody filled this in".
     */
    employerAmount: money('employer_amount').notNull(),
    ...timestamps,
  },
  (table) => ({
    personIdx: index('pension_contribution_person_idx').on(table.personId),
  }),
);

/**
 * Account types.
 *
 * ISA is split into `cash_isa`, `ss_isa` and `lisa` rather than one generic `isa`, per
 * PROPOSAL.md §11: the April 2027 £12,000 cash-ISA cap, the S&S-to-cash transfer bar,
 * and the new 22% charge on uninvested cash inside an S&S ISA all require knowing which
 * sub-type an account is, and a single label cannot represent that. Recombining these
 * later would mean re-deriving sub-types from account *names*, which is not recoverable.
 */
export const accountType = pgEnum('account_type', [
  'cash',
  'gia',
  'cash_isa',
  'ss_isa',
  'lisa',
  'sipp_pension',
  'property',
  'debt',
]);

/** Drives tax treatment in reporting (PROPOSAL.md data model). */
export const taxWrapper = pgEnum('tax_wrapper', ['isa', 'pension', 'gia', 'none']);

/**
 * An account.
 *
 * **`personId` is nullable, with `householdId` as the fallback owner.** This is the
 * single most important nullability decision in the schema and it is not an edge case:
 * UK households commonly hold a joint current account, a jointly-held property and a
 * joint mortgage, none of which a single-owner FK can express. NULL `person_id` means
 * "owned jointly, at the household level" — the dashboard and accounts list render those
 * rows in a "Joint" group. `householdId` is NOT NULL precisely so that every account
 * always has an owner even when no individual does.
 *
 * Both FKs are `ON DELETE RESTRICT`. The person → account case is quoted verbatim in the
 * proposal; household → account follows the same reasoning.
 */
export const accounts = pgTable(
  'account',
  {
    id: serial('id').primaryKey(),

    householdId: integer('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),

    /** NULL = jointly owned by the household. See the note above. */
    personId: integer('person_id').references(() => people.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    type: accountType('type').notNull(),
    taxWrapper: taxWrapper('tax_wrapper').notNull(),

    /**
     * Carried explicitly rather than assumed, per the proposal: the GBX-vs-GBP
     * pence/pounds distinction (Phase 2) needs somewhere to live, and US-denominated
     * holdings are a stated use case. ISO 4217, defaulted to GBP because every Phase 1
     * account will be GBP and making the user pick would be noise.
     */
    currency: text('currency').notNull().default('GBP'),

    /**
     * Archived, not deleted. DESIGN_SPEC.md's Accounts List decision: "an account that's
     * closed (e.g. an old ISA transferred elsewhere) shouldn't be hard-deleted, since its
     * balance history is part of the household's net worth trend. Decision: accounts get
     * an 'Archived' state (excluded from current totals, filterable back in), never a
     * destructive delete from this screen."
     */
    archived: boolean('archived').notNull().default(false),

    /**
     * Phase 4.5's Cash Allocation Advisor, waterfall step 1: which cash sits earmarked
     * as the household's emergency fund vs. general spare cash. Only meaningful for
     * `type: 'cash'` — enforced at the action layer (reject/ignore otherwise), the
     * same posture `regular_contribution`'s own account-type restrictions already
     * take, not a DB constraint.
     */
    isEmergencyFund: boolean('is_emergency_fund').notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    /** The accounts list and dashboard both read "this household's live accounts". */
    householdArchivedIdx: index('account_household_archived_idx').on(
      table.householdId,
      table.archived,
    ),
    /** Grouping by owner, and the RESTRICT check when a person is deleted. */
    personIdx: index('account_person_idx').on(table.personId),
  }),
);

/**
 * A holding inside an investment account (GIA / S&S ISA / LISA / SIPP).
 *
 * Phase 1 is manual entry, display-only: there is no price column and no
 * last-fetched-at, because live pricing is Phase 2 and inventing the cache shape now
 * would be guessing ahead of the provider decision (which is itself gated on a blocking
 * GBX-vs-GBP verification task). Current value and gain/loss are therefore not
 * computable in Phase 1; the UI shows quantity and cost basis and says so.
 *
 * `ON DELETE CASCADE` here, unlike the account-ownership FKs above: a holding has no
 * meaning without its account, and it is not history — it is current composition. The
 * app never hard-deletes an account anyway (archive, per the design spec), so this
 * cascade only fires for a deliberate manual delete, where leaving orphans behind would
 * be the worse outcome.
 */
export const holdings = pgTable(
  'holding',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),

    /** As the user types it, e.g. `VWRL`. Normalised to upper case by the app layer. */
    ticker: text('ticker').notNull(),

    /**
     * NUMERIC(18,6), not the money helper: this is a share count, not an amount of
     * money, and fractional-share dealing (common on Freetrade/InvestEngine) needs more
     * than two decimal places. Rounding a holding to 2dp would silently lose units.
     */
    quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),

    /** Total amount paid for the position, in the account's currency. */
    costBasis: money('cost_basis').notNull(),
    ...timestamps,
  },
  (table) => ({
    accountIdx: index('holding_account_idx').on(table.accountId),
  }),
);

/**
 * A regular (annual) contribution into a non-pension account — Phase 4.4's follow-up.
 * `pension_contribution` above stays pension-only (it needs `method`/`employerAmount`
 * for tax treatment that doesn't generalise); this is the equivalent for everywhere
 * else money regularly goes: a Cash ISA standing order, a GIA/S&S ISA/LISA regular
 * purchase.
 *
 * `ticker` is nullable and deliberately not a foreign key to `holding`: null means a
 * plain cash contribution to the account's own balance (the only sensible meaning for
 * a `cash`/`cash_isa` account, which never holds a `holding` row at all); a ticker
 * means a recurring purchase of that security, which can be recorded before the first
 * purchase has actually landed as a `holding` row.
 *
 * `amount` is annual, no `frequency` column — the same reasoning
 * `pension_contribution`'s own doc comment already gives (an unused column would be a
 * guess; add one later if monthly entry turns out to be what's wanted).
 *
 * Not valid for `debt`/`property` accounts (not drawdown wrappers at all) or
 * `sipp_pension` (already has `pension_contribution` — one mechanism per wrapper, not
 * two competing ones). Enforced at the action layer, not a DB constraint, matching
 * `addHolding`'s own posture toward its account-type assumptions.
 */
export const regularContributions = pgTable(
  'regular_contribution',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    ticker: text('ticker'),
    amount: money('amount').notNull(),
    ...timestamps,
  },
  (table) => ({
    accountIdx: index('regular_contribution_account_idx').on(table.accountId),
  }),
);

/**
 * Cached market-data quotes (Phase 2).
 *
 * Deliberately the opposite shape from `balance_snapshot` above: this is a **mutable,
 * single-row-per-symbol cache**, not append-only history. `balance_snapshot` protects
 * irreplaceable household-entered data, which is why it never gets overwritten — a quote
 * is re-fetchable market data with no household-authored history to lose, so keeping only
 * the latest value and overwriting it on refresh is correct, not a shortcut.
 *
 * Keyed by provider `symbol` (e.g. `VUAG.LON`), not by `holding_id` or `account_id`: the
 * same ticker held in two accounts shares one row and one API call, which matters given
 * Alpha Vantage's free-tier rate limit. `resolveProviderSymbol` in
 * src/lib/portfolio/quotes.ts derives the symbol from a holding's ticker and its account's
 * currency, so a symbol implies a currency — no separate FX handling is needed.
 *
 * `price` is `NUMERIC(14,4)`, not the `money()` helper's 2dp: it is multiplied against
 * `holding.quantity`'s `NUMERIC(18,6)` in src/lib/portfolio/valuation.ts, and rounding a
 * price to the penny before that multiplication would compound error on fractional-share
 * holdings — the same reasoning already applied to why quantity itself isn't 2dp.
 *
 * No FK to `holding` or `account`: this cache belongs to no household and no account, only
 * to a symbol, so there is nothing to cascade or restrict.
 */
export const quoteCache = pgTable(
  'quote_cache',
  {
    id: serial('id').primaryKey(),

    /** Provider symbol, e.g. `VUAG.LON` or a bare US ticker. Not the household's ticker
     * string directly — see `resolveProviderSymbol`. */
    symbol: text('symbol').notNull(),

    /** ISO 4217. Implied by the symbol's exchange suffix at fetch time, stored explicitly
     * so a reader doesn't have to re-derive it from the symbol string. */
    currency: text('currency').notNull(),

    /**
     * Nullable, and that's a real state, not an oversight: `null` means "checked as of
     * `fetchedAt` and the provider had no quote for this symbol" (the household's OEIC
     * holding, priced by NAV with no exchange ticker, is exactly this case) — distinct
     * from no row existing at all, which means "never checked." Recording the negative
     * result with its own timestamp lets `ensureFreshQuotes` respect the same staleness
     * threshold before re-checking, instead of re-spending API budget on a symbol that
     * will never resolve every single page load.
     */
    price: numeric('price', { precision: 14, scale: 4 }),

    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    symbolUnique: uniqueIndex('quote_cache_symbol_unique').on(table.symbol),
  }),
);

/**
 * A dated balance observation — the app's core time series, and an append-only one.
 *
 * PROPOSAL.md §12 prefers append-only modelling over conflict resolution: "balance
 * updates can be modeled as dated snapshots ('balance as of <date>') where the latest
 * as-of-date wins and history is retained rather than overwritten — this eliminates most
 * of the conflict surface rather than just handling it well". So net worth is always
 * derived from the latest snapshot per account, never from a mutable `balance` column on
 * `account`. There deliberately isn't one.
 *
 * Two constraints, both named in the proposal and both doing two jobs:
 *  - composite index `(account_id, captured_at DESC)` — serves the trend chart's range
 *    query and the "latest balance per account" query the dashboard hits constantly.
 *  - unique `(account_id, snapshot_date)` — daily granularity. Beyond keeping the series
 *    sane, this is what makes Phase 6's queued-write idempotency enforceable *at the
 *    database layer* rather than only via client-generated idempotency keys: a retried
 *    write for the same account and date cannot become a duplicate row, so the offline
 *    queue's retry-after-ambiguous-failure case is safe by construction. Phase 1's
 *    manual update therefore upserts on this pair rather than blind-inserting.
 */
export const balanceSnapshots = pgTable(
  'balance_snapshot',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),

    /**
     * The balance. Signed: debt accounts store a negative amount so that net worth is a
     * plain sum over accounts rather than a sum with a per-type sign rule that some
     * future query would inevitably forget to apply. src/lib/money.ts owns the
     * conversion from what the user types ("amount outstanding", positive) to what is
     * stored.
     */
    amount: money('amount').notNull(),

    /**
     * The date the balance is *true for* — "balance as of". Distinct from capturedAt:
     * a user catching up on Sunday can enter Friday's closing figure, and the trend
     * chart must plot it on Friday.
     */
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),

    /**
     * When the row was written. Kept alongside snapshotDate because the dashboard's
     * freshness indicator is about when the household last *told* the app something,
     * which is a different question from which date the figure refers to.
     */
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Denormalised from the account, per the proposal's "currency on accounts/snapshots". */
    currency: text('currency').notNull().default('GBP'),
  },
  (table) => ({
    accountCapturedAtIdx: index('balance_snapshot_account_captured_at_idx').on(
      table.accountId,
      table.capturedAt.desc(),
    ),
    accountSnapshotDateUnique: unique('balance_snapshot_account_date_unique').on(
      table.accountId,
      table.snapshotDate,
    ),
  }),
);

/**
 * What an overpayment allowance is a percentage *of*.
 *
 * The proposal names the column (`overpayment_allowance_balance_basis`) without
 * enumerating its values. These three are what UK mortgage terms actually say — "10% of
 * the original loan amount", "10% of the balance outstanding", "10% of the balance at
 * the start of each calendar year" — and an enum is worth the small risk of needing a
 * fourth value later, because Phase 4.5 has to branch on this to compute a penalty-free
 * overpayment headroom and cannot branch on free text.
 */
export const overpaymentAllowanceBasis = pgEnum('overpayment_allowance_basis', [
  'original_balance',
  'current_balance',
  'annual_opening_balance',
]);

/**
 * Terms for a `debt`-type account. One row per debt account, enforced by a unique index
 * on `account_id` — this is a one-to-one extension of `account`, kept in its own table
 * rather than as seven mostly-NULL columns on every cash ISA.
 *
 * Every value column is nullable, which is a UX decision as much as a data one.
 * DESIGN_SPEC.md marks overpayment allowance % and ERC rate as "optional, add later"
 * because "these matter for the P2 Cash Allocation Advisor, not P1 — don't force the
 * user through fields with no P1 payoff", and the same argument makes a partially-filled
 * terms row the normal case rather than a defect.
 *
 * `overpaymentAllowancePct` and `ercRatePct` are separate fields and must stay separate:
 * PROPOSAL.md records that they were conflated as a single "erc_limit" in an earlier
 * draft and were split after review. The first is the penalty-free limit (how much you
 * may overpay), the second is the charge rate applied to overpayments above it. One
 * number cannot answer both questions, and merging them would silently produce wrong
 * advice in Phase 4.5 rather than an obvious error.
 */
export const debtTerms = pgTable(
  'debt_terms',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),

    /** Annual rate, as a percentage: 4.125 means 4.125%. */
    interestRate: percent('interest_rate'),

    /**
     * The outstanding balance as a positive amount, mirroring how a lender states it.
     * Written by the same action that writes a debt account's balance snapshot, so it
     * cannot drift from the (negative) snapshot series — see src/lib/household/actions.ts.
     */
    currentBalance: money('current_balance'),

    /** Contractual minimum monthly payment. */
    minimumPayment: money('minimum_payment'),

    /** The penalty-free overpayment limit, e.g. 10.000 for "10% a year". */
    overpaymentAllowancePct: percent('overpayment_allowance_pct'),

    /** What that percentage is of. See the enum's note. */
    overpaymentAllowanceBalanceBasis: overpaymentAllowanceBasis(
      'overpayment_allowance_balance_basis',
    ),

    /** Early repayment charge rate on overpayments above the allowance. Not the same field. */
    ercRatePct: percent('erc_rate_pct'),

    /** When the early-repayment-charge period ends; after this the ERC no longer applies. */
    ercPeriodEnd: date('erc_period_end', { mode: 'string' }),
    ...timestamps,
  },
  (table) => ({
    accountUnique: uniqueIndex('debt_terms_account_unique').on(table.accountId),
  }),
);

export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type PensionContribution = typeof pensionContributions.$inferSelect;
export type NewPensionContribution = typeof pensionContributions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type RegularContribution = typeof regularContributions.$inferSelect;
export type NewRegularContribution = typeof regularContributions.$inferInsert;
export type QuoteCache = typeof quoteCache.$inferSelect;
export type NewQuoteCache = typeof quoteCache.$inferInsert;
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;
export type NewBalanceSnapshot = typeof balanceSnapshots.$inferInsert;
export type DebtTerms = typeof debtTerms.$inferSelect;
export type NewDebtTerms = typeof debtTerms.$inferInsert;

export type AccountTypeValue = (typeof accountType.enumValues)[number];
export type TaxWrapperValue = (typeof taxWrapper.enumValues)[number];
export type PensionContributionMethodValue =
  (typeof pensionContributionMethod.enumValues)[number];
export type OverpaymentAllowanceBasisValue =
  (typeof overpaymentAllowanceBasis.enumValues)[number];

/* ------------------------------------------------------------------------------------
 * Phase 3 — retirement Monte Carlo engine
 * ---------------------------------------------------------------------------------- */

/**
 * A named retirement scenario ("Retire at 60", "Retire at 65 — baseline").
 *
 * `assumptions` is this schema's first JSONB column. A scenario is written atomically
 * from one form and read atomically into one engine call — never queried field-by-field
 * — so normalising it into columns would buy nothing and cost a migration every time the
 * engine grows an assumption. That convenience is exactly why JSONB's real failure mode
 * (silent shape drift between a scenario saved under one app version and read by a
 * later one) has to be guarded explicitly rather than trusted: see
 * `src/lib/retirement/scenarioAssumptions.ts`'s `schemaVersion`-checked parser, which is
 * the only code path that should ever read this column's contents as a typed shape.
 *
 * Per-person values inside the blob (retirement age, State Pension overrides) are keyed
 * by `person_id`, never duplicated from the `person` row — a birth date change or a
 * deleted person then can't leave stale data behind. The blob holds *assumptions* only;
 * the scenario's starting portfolio (ISA/SIPP/GIA/cash balances) is deliberately not
 * stored here at all — it's aggregated live from `account`/`balance_snapshot`/`holding`
 * at simulation-run time, the same "derive, don't duplicate" principle already applied
 * to State Pension age from date of birth.
 */
export const retirementScenarios = pgTable(
  'retirement_scenario',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),

    /** The scenario shown by default. Exactly one `true` row per household, enforced by
     * `baselineUnique` below — not just the application-level `unsetOtherBaselines` step
     * in `src/lib/retirement/actions.ts`. An earlier version of this comment judged a
     * unique-partial-index backstop unnecessary ("no `simulation_run` money is at stake
     * in a race here the way `household_singleton` guards against"); independent Fable
     * review of Milestone 8 proved that judgment wrong empirically, not just in theory:
     * two concurrent `createScenario`/`updateScenario` calls each setting
     * `isBaseline: true` can both commit successfully under Postgres's default READ
     * COMMITTED isolation, reproduced 3/3 runs against a real Postgres — a blocked
     * `UPDATE`'s `WHERE` clause only re-evaluates the specific row it conflicted on, never
     * a fresh scan for rows the other transaction inserted or changed after its own scan
     * began. Same race class `household_singleton` already guards against; same fix. */
    isBaseline: boolean('is_baseline').notNull().default(false),

    /** Validate through `parseScenarioAssumptions` on every read and write — this
     * column's Drizzle type is deliberately left untyped JSON, not `.$type<...>()`,
     * so nothing can be misled into trusting the column type over the real parser. */
    assumptions: jsonb('assumptions').notNull(),
    ...timestamps,
  },
  (table) => ({
    householdIdx: index('retirement_scenario_household_idx').on(table.householdId),
    // Database backstop for the isBaseline invariant — see that column's own doc
    // comment. A household can have any number of non-baseline scenarios, but this
    // allows at most one row with is_baseline = true per household_id: the second of
    // two concurrent writers trying to set isBaseline: true now fails loudly (a real
    // 23505 unique violation) instead of silently succeeding, the same backstop shape
    // household_singleton already uses for the equivalent single-row race.
    baselineUnique: uniqueIndex('retirement_scenario_one_baseline_per_household')
      .on(table.householdId)
      .where(sql`${table.isBaseline} = true`),
  }),
);

/**
 * `cancelled` (M6) is set only by the caller that requested cancellation, never by the
 * worker terminating itself — `worker.terminate()` gives no reliable graceful cleanup,
 * so `workerHarness.ts`'s `cancelSimulationRun` writes this status itself, guarded by
 * `WHERE status = 'running'`, before calling `terminate()`. The worker's own
 * completion/failure writes use the same guard, so whichever write lands first wins and
 * the loser matches zero rows instead of overwriting a terminal status.
 */
export const simulationRunStatus = pgEnum('simulation_run_status', [
  'running',
  'complete',
  'failed',
  'cancelled',
]);

/**
 * One Monte Carlo run of a scenario. Append-only — like `balance_snapshot`, not
 * mutable-latest like `quote_cache` — so "the current result" is just
 * `ORDER BY created_at DESC LIMIT 1` per scenario, and a re-run never loses the
 * comparison history a household might want later.
 *
 * This is the persisted half of the compute→persist→poll pattern
 * (`docs/PROPOSAL.md`'s Compute execution model): a route handler inserts a `running`
 * row before spawning a `worker_thread`, the worker writes `result`/`status` on
 * completion, and the client polls this row rather than holding a request open across a
 * long-running simulation on a variable-latency mobile connection.
 *
 * `ON DELETE CASCADE` to its scenario, unlike the ownership-of-history FKs elsewhere in
 * this file: a run has no meaning without the scenario it simulated, and is not itself
 * irreplaceable household-authored data the way a balance snapshot is — it can always be
 * recomputed from the scenario's assumptions.
 */
export const simulationRuns = pgTable(
  'simulation_run',
  {
    id: serial('id').primaryKey(),
    retirementScenarioId: integer('retirement_scenario_id')
      .notNull()
      .references(() => retirementScenarios.id, { onDelete: 'cascade' }),

    status: simulationRunStatus('status').notNull().default('running'),

    /** The seeded RNG's seed for this run — recorded so a result is reproducible and
     * debuggable, per PROPOSAL.md's "makes 'why did this number change' debuggable". */
    seed: integer('seed').notNull(),
    iterationCount: integer('iteration_count').notNull(),

    /** Null until `status` is `complete`. Same "validate through a typed parser, don't
     * trust the column type" posture as `retirement_scenario.assumptions`. */
    result: jsonb('result'),

    /** Set on `status: 'failed'` — a worker-thread exception message, or the
     * staleness-reconciliation note for a run whose worker never reported back. */
    errorDetail: text('error_detail'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    /** The poll endpoint's read pattern: a scenario's most recent run(s), newest first. */
    scenarioCreatedAtIdx: index('simulation_run_scenario_created_at_idx').on(
      table.retirementScenarioId,
      table.createdAt.desc(),
    ),
  }),
);

export type RetirementScenario = typeof retirementScenarios.$inferSelect;
export type NewRetirementScenario = typeof retirementScenarios.$inferInsert;
export type SimulationRun = typeof simulationRuns.$inferSelect;
export type NewSimulationRun = typeof simulationRuns.$inferInsert;
export type SimulationRunStatusValue = (typeof simulationRunStatus.enumValues)[number];

/* ------------------------------------------------------------------------------------
 * Phase 4 — stock analysis workbench
 * ---------------------------------------------------------------------------------- */

/**
 * A ticker a household is interested in but doesn't necessarily hold — distinct from
 * `holding`, which represents an owned position inside a specific account.
 *
 * `(householdId, ticker)` is unique so adding an already-watched ticker is a no-op at
 * the database layer, not a duplicate row the app has to de-duplicate itself.
 */
export const watchlistItems = pgTable(
  'watchlist_item',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),

    /** As typed, uppercased at the app layer — same convention as `holding.ticker`. */
    ticker: text('ticker').notNull(),

    addedAt: timestamp('added_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    householdIdx: index('watchlist_item_household_idx').on(table.householdId),
    householdTickerUnique: uniqueIndex('watchlist_item_household_ticker_unique').on(
      table.householdId,
      table.ticker,
    ),
  }),
);

/**
 * A household's analysis of one ticker — DCF inputs, relative-valuation inputs, and
 * checklist state, as the phase's later milestones each add their own typed sub-shape
 * to `inputs`. Same JSONB-with-versioning posture as `retirement_scenario.assumptions`
 * (see that column's own doc comment): written and read atomically as one blob, never
 * queried field-by-field, so normalising into columns would cost a migration every time
 * the workbench grows an input and buy nothing in return. Validate through a typed
 * `schemaVersion`-checked parser at every read/write, once Milestone 2 defines one —
 * this column's Drizzle type is deliberately left untyped JSON, not `.$type<...>()`.
 *
 * Updated in place per `(householdId, ticker)`, unlike `simulation_run`'s append-only
 * history: a stock analysis has no "re-run history" concept to preserve in this
 * milestone — editing a DCF assumption replaces the previous one, it doesn't create a
 * comparable past run the way a Monte Carlo re-run does.
 */
export const stockAnalyses = pgTable(
  'stock_analysis',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),

    ticker: text('ticker').notNull(),

    inputs: jsonb('inputs').notNull(),
    ...timestamps,
  },
  (table) => ({
    householdIdx: index('stock_analysis_household_idx').on(table.householdId),
    householdTickerUnique: uniqueIndex('stock_analysis_household_ticker_unique').on(
      table.householdId,
      table.ticker,
    ),
  }),
);

/**
 * Cached fundamentals data (income statement, balance sheet, cash flow) from the FMP
 * provider boundary (`src/lib/stocks/fmp.ts`). Same mutable-single-row-per-key shape as
 * `quote_cache` (see that table's own doc comment for the append-only-vs-mutable
 * reasoning) — fundamentals are re-fetchable market data with no household-authored
 * history to protect.
 *
 * Deliberately **not** household-scoped, unlike every other Phase 4 table above:
 * a ticker's fundamentals are the same fact for every household, so keying by
 * `household_id` as well as `ticker` would fetch and store the same FMP response twice
 * for no reason — the opposite of `watchlist_item`/`stock_analysis`, which really are
 * per-household (two households can watch the same ticker with different notes, or
 * hold different DCF assumptions for it, but neither can have a different income
 * statement for it).
 */
export const fundamentalsCache = pgTable(
  'fundamentals_cache',
  {
    id: serial('id').primaryKey(),

    /** Bare ticker, e.g. `AAPL` — no exchange suffix. FMP's own free-tier coverage is
     * being verified against US-listed tickers first (see docs/STATUS.md); an
     * exchange-suffix convention can be added if/when LSE coverage is confirmed,
     * mirroring `resolveProviderSymbol`'s role for `quote_cache`. */
    ticker: text('ticker').notNull(),

    /** Raw fetched statements as FMP returns them, JSONB. `null` means "checked as of
     * `fetchedAt`, provider had nothing for this ticker" — distinct from no row at all
     * ("never checked"), the same `quote_cache.price` convention for the same reason:
     * it lets staleness-based refetch logic skip a ticker that will never resolve
     * without re-spending API budget on it every page load. */
    statements: jsonb('statements'),

    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    tickerUnique: uniqueIndex('fundamentals_cache_ticker_unique').on(table.ticker),
  }),
);

export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type NewWatchlistItem = typeof watchlistItems.$inferInsert;
export type StockAnalysis = typeof stockAnalyses.$inferSelect;
export type NewStockAnalysis = typeof stockAnalyses.$inferInsert;
export type FundamentalsCache = typeof fundamentalsCache.$inferSelect;
export type NewFundamentalsCache = typeof fundamentalsCache.$inferInsert;

/**
 * The household's custom priority order for `src/lib/roadmap/data.ts`'s
 * `ROADMAP_ITEMS` — a single row (`USING btree ((true))`, the same singleton
 * convention `household_singleton` established), holding an ordered array of item
 * ids rather than one row per item with its own `sort_order`: a drag-and-drop reorder
 * is naturally "here's the whole new order," not a series of per-row position edits.
 *
 * Not household-scoped (like `fundamentals_cache`) — this is a fact about the app's
 * own development priorities, not per-household data, even though today there is only
 * ever one household to have an opinion about it.
 */
export const roadmapOrder = pgTable(
  'roadmap_order',
  {
    id: serial('id').primaryKey(),

    /** Ordered array of `RoadmapItem.id` strings. An id from `ROADMAP_ITEMS` that's
     * missing here (added since the household last reordered) is appended at the end,
     * in `ROADMAP_ITEMS`'s own default order — see `resolveRoadmapOrder`
     * (`src/lib/roadmap/queries.ts`). Never contains a `done` item's id —
     * `saveRoadmapOrder` rejects those, since reordering something already shipped
     * doesn't mean anything. */
    itemIds: jsonb('item_ids').notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  () => ({
    singleton: uniqueIndex('roadmap_order_singleton').on(sql`(true)`),
  }),
);

export type RoadmapOrder = typeof roadmapOrder.$inferSelect;
export type NewRoadmapOrder = typeof roadmapOrder.$inferInsert;
