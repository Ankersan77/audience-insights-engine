CREATE TABLE "synthesis_authorization" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"attempt_key" text NOT NULL,
	"ability_id" text NOT NULL,
	"input_digest" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_version" text NOT NULL,
	"model" text NOT NULL,
	"approval_reference" text NOT NULL,
	"currency" text NOT NULL,
	"max_cost_micros" bigint NOT NULL,
	"max_input_bytes" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"max_duration_ms" integer NOT NULL,
	"budget_version" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_by" timestamp with time zone NOT NULL,
	"binding_expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"execution_deadline" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "synthesis_authorization_client_attempt_unique" UNIQUE("client_id","attempt_key")
);
--> statement-breakpoint
CREATE TABLE "synthesis_budget" (
	"client_id" integer PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"daily_cost_micros" bigint NOT NULL,
	"daily_requests" bigint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synthesis_authorization" ADD CONSTRAINT "synthesis_authorization_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthesis_budget" ADD CONSTRAINT "synthesis_budget_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "synthesis_authorization_client_time_idx" ON "synthesis_authorization" USING btree ("client_id","authorized_at");