CREATE TYPE "public"."acquisition_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."campaign_state" AS ENUM('proposed', 'approved', 'active', 'completed', 'learning_reviewed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."citation_level" AS ENUM('statistical', 'paraphrased', 'verbatim');--> statement-breakpoint
CREATE TYPE "public"."intelligence_kind" AS ENUM('observation', 'signal', 'fact', 'hypothesis', 'insight', 'recommendation', 'decision', 'learning', 'knowledge_gap');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_state" AS ENUM('candidate', 'live', 'quarantined', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('pending', 'accepted', 'rejected', 'revision_requested');--> statement-breakpoint
CREATE TYPE "public"."source_health" AS ENUM('configured', 'verified', 'degraded', 'unavailable', 'producing_evidence');--> statement-breakpoint
CREATE TYPE "public"."study_classification" AS ENUM('diagnostic', 'directional', 'causal', 'inconclusive');--> statement-breakpoint
CREATE TABLE "ability_manifest" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"ability_key" text NOT NULL,
	"version" text NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ability_manifest_scope_version_unique" UNIQUE("client_id","ability_key","version")
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"state" "campaign_state" DEFAULT 'proposed' NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_revision" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"brief_json" jsonb NOT NULL,
	"approved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_revision_unique" UNIQUE("campaign_id","revision")
);
--> statement-breakpoint
CREATE TABLE "canonical_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"collection_id" integer NOT NULL,
	"source_connection_id" integer NOT NULL,
	"external_reference" text NOT NULL,
	"safe_source_url" text,
	"source_content" text NOT NULL,
	"synthesis" text,
	"content_hash" text NOT NULL,
	"citation_level" "citation_level" NOT NULL,
	"lifecycle" "lifecycle_state" DEFAULT 'candidate' NOT NULL,
	"grade" text DEFAULT 'ungraded' NOT NULL,
	"confidence" real NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"identity_risk" boolean DEFAULT false NOT NULL,
	"redactions" text[] DEFAULT '{}'::text[] NOT NULL,
	"method_json" jsonb NOT NULL,
	"rights_json" jsonb NOT NULL,
	"applicability_json" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "canonical_evidence_client_hash_unique" UNIQUE("client_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "citation" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"evidence_id" integer NOT NULL,
	"level" "citation_level" NOT NULL,
	"safe_reference" text NOT NULL,
	"excerpt" text,
	"review_reason" text,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "client_membership" (
	"client_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_membership_client_id_user_id_pk" PRIMARY KEY("client_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_collection" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"source_connection_id" integer NOT NULL,
	"acquisition_job_id" integer NOT NULL,
	"title" text NOT NULL,
	"method_json" jsonb NOT NULL,
	"rights_json" jsonb NOT NULL,
	"applicability_json" jsonb NOT NULL,
	"lifecycle" "lifecycle_state" DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"actor_user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"redacted_before_json" jsonb,
	"redacted_after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"kind" "intelligence_kind" NOT NULL,
	"title" text NOT NULL,
	"statement" text NOT NULL,
	"lifecycle" "lifecycle_state" DEFAULT 'candidate' NOT NULL,
	"review_state" "review_state" DEFAULT 'pending' NOT NULL,
	"evidence_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"contradiction_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"dependency_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"applicability_json" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"uncertainty" text[] DEFAULT '{}'::text[] NOT NULL,
	"synthesis_by" text NOT NULL,
	"reviewed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"supersedes_id" integer,
	"decay_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intelligence_relationship" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"from_id" integer NOT NULL,
	"to_id" integer NOT NULL,
	"type" text NOT NULL,
	"rationale" text NOT NULL,
	CONSTRAINT "intelligence_relationship_unique" UNIQUE("from_id","to_id","type")
);
--> statement-breakpoint
CREATE TABLE "measurement_plan" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"version" integer NOT NULL,
	"plan_json" jsonb NOT NULL,
	"review_state" "review_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_plan_campaign_version_unique" UNIQUE("campaign_id","version")
);
--> statement-breakpoint
CREATE TABLE "monitoring_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"sensing_profile_id" integer NOT NULL,
	"status" "acquisition_status" DEFAULT 'queued' NOT NULL,
	"outcome" text,
	"qualified_signal_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "qualitative_theme" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"label" text NOT NULL,
	"paraphrase" text NOT NULL,
	"evidence_ids" integer[] NOT NULL,
	"occurrence_count" integer NOT NULL,
	"source_diversity" integer NOT NULL,
	"method" text NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quantitative_observation" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"evidence_id" integer NOT NULL,
	"metric_key" text NOT NULL,
	"value" real NOT NULL,
	"unit" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"dimensions_json" jsonb NOT NULL,
	"cohort_size" integer,
	"suppressed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_artifact" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"artifact_type" text NOT NULL,
	"ability_key" text,
	"ability_version" text,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"payload_json" jsonb NOT NULL,
	"evidence_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_artifact_client_type_version_unique" UNIQUE("client_id","artifact_type","version")
);
--> statement-breakpoint
CREATE TABLE "sensing_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"version" integer NOT NULL,
	"profile_json" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sensing_profile_client_version_unique" UNIQUE("client_id","version")
);
--> statement-breakpoint
CREATE TABLE "solution_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"profile_json" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solution_profile_client_version_unique" UNIQUE("client_id","version")
);
--> statement-breakpoint
CREATE TABLE "source_acquisition_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"source_connection_id" integer NOT NULL,
	"status" "acquisition_status" DEFAULT 'queued' NOT NULL,
	"operation" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "source_acquisition_job_client_idempotency_unique" UNIQUE("client_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "source_acquisition_receipt" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"status" "acquisition_status" NOT NULL,
	"acquired_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"next_cursor" text,
	"safe_artifact_refs" text[] DEFAULT '{}'::text[] NOT NULL,
	"error_code" text,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_acquisition_receipt_job_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "source_connection" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"connector_id" text NOT NULL,
	"connector_version" text NOT NULL,
	"source_class" text NOT NULL,
	"credential_ref" text,
	"health" "source_health" DEFAULT 'configured' NOT NULL,
	"configuration_json" jsonb NOT NULL,
	"rights_json" jsonb NOT NULL,
	"retention_days" integer NOT NULL,
	"raw_retention_hours" integer NOT NULL,
	"last_successful_receipt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_connection_client_connector_unique" UNIQUE("client_id","connector_id")
);
--> statement-breakpoint
CREATE TABLE "study" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"measurement_plan_id" integer NOT NULL,
	"classification" "study_classification" NOT NULL,
	"design_json" jsonb NOT NULL,
	"result_json" jsonb,
	"integrity_state" text DEFAULT 'unverified' NOT NULL,
	"review_state" "review_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand" ADD COLUMN "client_id" integer;--> statement-breakpoint
ALTER TABLE "insight" ADD COLUMN "client_id" integer;--> statement-breakpoint
ALTER TABLE "research_run" ADD COLUMN "client_id" integer;--> statement-breakpoint
INSERT INTO "client" ("slug", "name", "status")
VALUES ('default-client', 'Default Client', 'active')
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
UPDATE "brand"
SET "client_id" = (SELECT "id" FROM "client" WHERE "slug" = 'default-client')
WHERE "client_id" IS NULL;--> statement-breakpoint
UPDATE "research_run" r
SET "client_id" = b."client_id"
FROM "brand" b
WHERE r."brand_id" = b."id" AND r."client_id" IS NULL;--> statement-breakpoint
UPDATE "insight" i
SET "client_id" = b."client_id"
FROM "brand" b
WHERE i."brand_id" = b."id" AND i."client_id" IS NULL;--> statement-breakpoint
INSERT INTO "client_membership" ("client_id", "user_id", "role")
SELECT c."id", u."id", CASE WHEN u."role" = 'admin' THEN 'admin' ELSE 'viewer' END
FROM "client" c CROSS JOIN "app_user" u
WHERE c."slug" = 'default-client'
ON CONFLICT ("client_id", "user_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "brand" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "insight" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "research_run" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ability_manifest" ADD CONSTRAINT "ability_manifest_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_revision" ADD CONSTRAINT "campaign_revision_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_revision" ADD CONSTRAINT "campaign_revision_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_revision" ADD CONSTRAINT "campaign_revision_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_evidence" ADD CONSTRAINT "canonical_evidence_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_evidence" ADD CONSTRAINT "canonical_evidence_collection_id_evidence_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."evidence_collection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_evidence" ADD CONSTRAINT "canonical_evidence_source_connection_id_source_connection_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_evidence_id_canonical_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."canonical_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_membership" ADD CONSTRAINT "client_membership_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_membership" ADD CONSTRAINT "client_membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_collection" ADD CONSTRAINT "evidence_collection_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_collection" ADD CONSTRAINT "evidence_collection_source_connection_id_source_connection_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_collection" ADD CONSTRAINT "evidence_collection_acquisition_job_id_source_acquisition_job_id_fk" FOREIGN KEY ("acquisition_job_id") REFERENCES "public"."source_acquisition_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_audit" ADD CONSTRAINT "governance_audit_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_audit" ADD CONSTRAINT "governance_audit_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_record" ADD CONSTRAINT "intelligence_record_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_record" ADD CONSTRAINT "intelligence_record_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_relationship" ADD CONSTRAINT "intelligence_relationship_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_relationship" ADD CONSTRAINT "intelligence_relationship_from_id_intelligence_record_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."intelligence_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_relationship" ADD CONSTRAINT "intelligence_relationship_to_id_intelligence_record_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."intelligence_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_plan" ADD CONSTRAINT "measurement_plan_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_plan" ADD CONSTRAINT "measurement_plan_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_run" ADD CONSTRAINT "monitoring_run_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_run" ADD CONSTRAINT "monitoring_run_sensing_profile_id_sensing_profile_id_fk" FOREIGN KEY ("sensing_profile_id") REFERENCES "public"."sensing_profile"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualitative_theme" ADD CONSTRAINT "qualitative_theme_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quantitative_observation" ADD CONSTRAINT "quantitative_observation_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quantitative_observation" ADD CONSTRAINT "quantitative_observation_evidence_id_canonical_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."canonical_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_artifact" ADD CONSTRAINT "research_artifact_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_artifact" ADD CONSTRAINT "research_artifact_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensing_profile" ADD CONSTRAINT "sensing_profile_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_profile" ADD CONSTRAINT "solution_profile_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_profile" ADD CONSTRAINT "solution_profile_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_acquisition_job" ADD CONSTRAINT "source_acquisition_job_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_acquisition_job" ADD CONSTRAINT "source_acquisition_job_source_connection_id_source_connection_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_acquisition_receipt" ADD CONSTRAINT "source_acquisition_receipt_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_acquisition_receipt" ADD CONSTRAINT "source_acquisition_receipt_job_id_source_acquisition_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."source_acquisition_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_connection" ADD CONSTRAINT "source_connection_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study" ADD CONSTRAINT "study_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study" ADD CONSTRAINT "study_measurement_plan_id_measurement_plan_id_fk" FOREIGN KEY ("measurement_plan_id") REFERENCES "public"."measurement_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight" ADD CONSTRAINT "insight_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;
