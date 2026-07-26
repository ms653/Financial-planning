CREATE TYPE "public"."account_type" AS ENUM('cash', 'gia', 'cash_isa', 'ss_isa', 'lisa', 'sipp_pension', 'property', 'debt');--> statement-breakpoint
CREATE TYPE "public"."overpayment_allowance_basis" AS ENUM('original_balance', 'current_balance', 'annual_opening_balance');--> statement-breakpoint
CREATE TYPE "public"."pension_contribution_method" AS ENUM('relief_at_source', 'net_pay', 'salary_sacrifice');--> statement-breakpoint
CREATE TYPE "public"."tax_wrapper" AS ENUM('isa', 'pension', 'gia', 'none');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"person_id" integer,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"tax_wrapper" "tax_wrapper" NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"snapshot_date" date NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	CONSTRAINT "balance_snapshot_account_date_unique" UNIQUE("account_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "debt_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"interest_rate" numeric(6, 3),
	"current_balance" numeric(14, 2),
	"minimum_payment" numeric(14, 2),
	"overpayment_allowance_pct" numeric(6, 3),
	"overpayment_allowance_balance_basis" "overpayment_allowance_basis",
	"erc_rate_pct" numeric(6, 3),
	"erc_period_end" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holding" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"cost_basis" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "household" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pension_contribution" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" "pension_contribution_method" NOT NULL,
	"employer_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"annual_gross_income" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "debt_terms" ADD CONSTRAINT "debt_terms_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holding" ADD CONSTRAINT "holding_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pension_contribution" ADD CONSTRAINT "pension_contribution_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person" ADD CONSTRAINT "person_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_household_archived_idx" ON "account" USING btree ("household_id","archived");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_person_idx" ON "account" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "balance_snapshot_account_captured_at_idx" ON "balance_snapshot" USING btree ("account_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "debt_terms_account_unique" ON "debt_terms" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holding_account_idx" ON "holding" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pension_contribution_person_idx" ON "pension_contribution" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_household_idx" ON "person" USING btree ("household_id");