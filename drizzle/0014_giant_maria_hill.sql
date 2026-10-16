CREATE TABLE "acquisition_authorization" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"attempt" integer NOT NULL,
	"currency" text NOT NULL,
	"max_cost_micros" bigint NOT NULL,
	"max_records" bigint NOT NULL,
	"max_requests" bigint NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acquisition_authorization_job_attempt_unique" UNIQUE("job_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "acquisition_budget" (
	"client_id" integer PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"daily_cost_micros" bigint NOT NULL,
	"daily_records" bigint NOT NULL,
	"daily_requests" bigint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_acquisition_job" ADD CONSTRAINT "source_acquisition_job_client_id_unique" UNIQUE("client_id","id");--> statement-breakpoint
ALTER TABLE "acquisition_authorization" ADD CONSTRAINT "acquisition_authorization_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_authorization" ADD CONSTRAINT "acquisition_authorization_client_id_job_id_source_acquisition_job_client_id_id_fk" FOREIGN KEY ("client_id","job_id") REFERENCES "public"."source_acquisition_job"("client_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_budget" ADD CONSTRAINT "acquisition_budget_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acquisition_authorization_client_time_idx" ON "acquisition_authorization" USING btree ("client_id","authorized_at");
