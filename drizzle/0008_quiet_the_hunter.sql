CREATE TABLE "external_validation_gate" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"gate_key" text NOT NULL,
	"status" text DEFAULT 'needs_context' NOT NULL,
	"owner" text NOT NULL,
	"scope" text NOT NULL,
	"evidence_reference" text,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_validation_gate_client_key_unique" UNIQUE("client_id","gate_key")
);
--> statement-breakpoint
CREATE TABLE "quality_evaluation" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"case_class" text NOT NULL,
	"artifact_type" text NOT NULL,
	"artifact_id" text NOT NULL,
	"rubric_version" text NOT NULL,
	"scores_json" jsonb NOT NULL,
	"thresholds_json" jsonb NOT NULL,
	"mean_threshold" real NOT NULL,
	"mean_score" real NOT NULL,
	"outcome" text NOT NULL,
	"notes" text NOT NULL,
	"limitations" text[] DEFAULT '{}'::text[] NOT NULL,
	"evidence_reference" text NOT NULL,
	"remediation_of" integer,
	"reviewer_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_validation_gate" ADD CONSTRAINT "external_validation_gate_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_validation_gate" ADD CONSTRAINT "external_validation_gate_verified_by_app_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluation" ADD CONSTRAINT "quality_evaluation_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluation" ADD CONSTRAINT "quality_evaluation_reviewer_user_id_app_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;