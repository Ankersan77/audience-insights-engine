ALTER TABLE "measurement_plan" ADD COLUMN "reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "measurement_plan" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study" ADD COLUMN "reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "study" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "measurement_plan" ADD CONSTRAINT "measurement_plan_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study" ADD CONSTRAINT "study_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;