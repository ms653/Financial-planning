import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
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
