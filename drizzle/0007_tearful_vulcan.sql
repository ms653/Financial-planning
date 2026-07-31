CREATE TABLE IF NOT EXISTS "fundamentals_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"statements" jsonb,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_analysis" ADD CONSTRAINT "stock_analysis_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "watchlist_item" ADD CONSTRAINT "watchlist_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fundamentals_cache_ticker_unique" ON "fundamentals_cache" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_analysis_household_idx" ON "stock_analysis" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_analysis_household_ticker_unique" ON "stock_analysis" USING btree ("household_id","ticker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watchlist_item_household_idx" ON "watchlist_item" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_item_household_ticker_unique" ON "watchlist_item" USING btree ("household_id","ticker");