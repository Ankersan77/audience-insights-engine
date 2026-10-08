CREATE TYPE "public"."channel_type" AS ENUM('slack_channel', 'drive_folder');--> statement-breakpoint
CREATE TYPE "public"."insight_delivery_status" AS ENUM('not_attempted', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."research_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"sso_subject_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "brand_market" (
	"brand_id" integer NOT NULL,
	"market_id" integer NOT NULL,
	"ga4_property_id" text,
	CONSTRAINT "brand_market_brand_id_market_id_pk" PRIMARY KEY("brand_id","market_id")
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "channel_type" NOT NULL,
	"external_ref" text NOT NULL,
	"display_name" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_type_external_ref_unique" UNIQUE("type","external_ref")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"author_handle" text,
	"published_at" timestamp with time zone,
	"text_snippet" text,
	"engagement_json" jsonb,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sensitivity_flag" boolean,
	CONSTRAINT "evidence_run_source_external_id_unique" UNIQUE("run_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "insight" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"market_id" integer,
	"run_id" integer NOT NULL,
	"insight_type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"shift_or_blip" text NOT NULL,
	"confidence" real NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"routed_at" timestamp with time zone,
	"delivery_status" "insight_delivery_status" DEFAULT 'not_attempted' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_evidence" (
	"insight_id" integer NOT NULL,
	"evidence_id" integer NOT NULL,
	CONSTRAINT "insight_evidence_insight_id_evidence_id_pk" PRIMARY KEY("insight_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "insight_route" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer,
	"insight_type" text NOT NULL,
	"channel_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_instruction" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"market_id" integer,
	"version" integer NOT NULL,
	"subreddits" text[] DEFAULT '{}'::text[] NOT NULL,
	"dedicated_subreddits" text[] DEFAULT '{}'::text[] NOT NULL,
	"x_handle" text,
	"x_related" text[] DEFAULT '{}'::text[] NOT NULL,
	"tiktok_hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"competitors" text[] DEFAULT '{}'::text[] NOT NULL,
	"focus_text" text,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_instruction_brand_market_version_unique" UNIQUE("brand_id","market_id","version")
);
--> statement-breakpoint
CREATE TABLE "research_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"market_id" integer,
	"research_instruction_version" integer NOT NULL,
	"triggered_by" integer NOT NULL,
	"status" "research_run_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"timed_out_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_market" ADD CONSTRAINT "brand_market_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_market" ADD CONSTRAINT "brand_market_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_run_id_research_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight" ADD CONSTRAINT "insight_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight" ADD CONSTRAINT "insight_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight" ADD CONSTRAINT "insight_run_id_research_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight" ADD CONSTRAINT "insight_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_insight_id_insight_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insight"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_route" ADD CONSTRAINT "insight_route_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_route" ADD CONSTRAINT "insight_route_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_instruction" ADD CONSTRAINT "research_instruction_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_instruction" ADD CONSTRAINT "research_instruction_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_instruction" ADD CONSTRAINT "research_instruction_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_triggered_by_app_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_run_active_brand_market_unique" ON "research_run" USING btree ("brand_id","market_id") WHERE "research_run"."status" in ('queued', 'running');