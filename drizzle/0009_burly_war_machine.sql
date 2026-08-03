CREATE TABLE IF NOT EXISTS "regular_contribution" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"ticker" text,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regular_contribution" ADD CONSTRAINT "regular_contribution_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regular_contribution_account_idx" ON "regular_contribution" USING btree ("account_id");