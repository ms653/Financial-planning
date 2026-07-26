CREATE TYPE "public"."backup_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "backup_outcome" NOT NULL,
	"artefact_path" text,
	"artefact_bytes" bigint,
	"artefact_sha256" text,
	"encryption_method" text,
	"detail" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_run_outcome_finished_at_idx" ON "backup_run" USING btree ("outcome","finished_at" DESC NULLS LAST);