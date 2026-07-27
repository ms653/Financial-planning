CREATE TABLE IF NOT EXISTS "quote_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"currency" text NOT NULL,
	"price" numeric(14, 4),
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_cache_symbol_unique" ON "quote_cache" USING btree ("symbol");