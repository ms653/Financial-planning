ALTER TABLE "account" ADD COLUMN "is_emergency_fund" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "emergency_fund_target" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "has_flexibly_accessed_pension" boolean DEFAULT false NOT NULL;