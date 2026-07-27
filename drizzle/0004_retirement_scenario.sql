CREATE TYPE "public"."simulation_run_status" AS ENUM('running', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retirement_scenario" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"assumptions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "simulation_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"retirement_scenario_id" integer NOT NULL,
	"status" "simulation_run_status" DEFAULT 'running' NOT NULL,
	"seed" integer NOT NULL,
	"iteration_count" integer NOT NULL,
	"result" jsonb,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retirement_scenario" ADD CONSTRAINT "retirement_scenario_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "simulation_run" ADD CONSTRAINT "simulation_run_retirement_scenario_id_retirement_scenario_id_fk" FOREIGN KEY ("retirement_scenario_id") REFERENCES "public"."retirement_scenario"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retirement_scenario_household_idx" ON "retirement_scenario" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simulation_run_scenario_created_at_idx" ON "simulation_run" USING btree ("retirement_scenario_id","created_at" DESC NULLS LAST);