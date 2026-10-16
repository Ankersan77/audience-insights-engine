ALTER TABLE "monitoring_run" ADD COLUMN "schedule_key" text;--> statement-breakpoint
UPDATE "monitoring_run" SET "schedule_key" = 'legacy:' || "id"::text WHERE "schedule_key" IS NULL;--> statement-breakpoint
ALTER TABLE "monitoring_run" ALTER COLUMN "schedule_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_acquisition_job" ADD COLUMN "monitoring_run_id" integer;--> statement-breakpoint
ALTER TABLE "source_acquisition_job" ADD CONSTRAINT "source_acquisition_job_monitoring_run_id_monitoring_run_id_fk" FOREIGN KEY ("monitoring_run_id") REFERENCES "public"."monitoring_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_run" ADD CONSTRAINT "monitoring_run_profile_schedule_unique" UNIQUE("client_id","sensing_profile_id","schedule_key");
