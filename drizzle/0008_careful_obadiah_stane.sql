CREATE TABLE IF NOT EXISTS "roadmap_order" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_ids" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roadmap_order_singleton" ON "roadmap_order" USING btree ((true));