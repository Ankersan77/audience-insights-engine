CREATE TABLE "canonical_retention_work" (
	"evidence_id" integer PRIMARY KEY NOT NULL,
	"phase" text DEFAULT 'observations' NOT NULL,
	"cursor_id" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_retention_work_phase_check" CHECK ("canonical_retention_work"."phase" in ('observations', 'themes', 'citations', 'artifacts', 'finalize')),
	CONSTRAINT "canonical_retention_work_cursor_check" CHECK ("canonical_retention_work"."cursor_id" >= 0)
);
--> statement-breakpoint
ALTER TABLE "source_connection" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_acquisition_job" ADD COLUMN "dispatch_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "canonical_retention_work" ADD CONSTRAINT "canonical_retention_work_evidence_id_canonical_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."canonical_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canonical_retention_work_fairness_idx" ON "canonical_retention_work" USING btree ("updated_at","evidence_id");--> statement-breakpoint
CREATE INDEX "auth_session_expiry_token_idx" ON "auth_session" USING btree ("expires_at","token_hash");--> statement-breakpoint
CREATE INDEX "auth_session_revoked_token_idx" ON "auth_session" USING btree ("revoked_at","token_hash") WHERE "auth_session"."revoked_at" is not null;--> statement-breakpoint
CREATE INDEX "canonical_evidence_retention_due_idx" ON "canonical_evidence" USING btree ("expires_at","id") WHERE "canonical_evidence"."lifecycle" in ('candidate', 'live', 'quarantined');--> statement-breakpoint
CREATE INDEX "canonical_evidence_revoked_source_cleanup_idx" ON "canonical_evidence" USING btree ("client_id","source_connection_id","id") WHERE "canonical_evidence"."lifecycle" in ('candidate', 'live', 'quarantined');--> statement-breakpoint
CREATE INDEX "citation_evidence_id_idx" ON "citation" USING btree ("evidence_id","id");--> statement-breakpoint
CREATE INDEX "evidence_collection_retention_due_idx" ON "evidence_collection" USING btree ("expires_at","id") WHERE "evidence_collection"."lifecycle" in ('candidate', 'live', 'quarantined');--> statement-breakpoint
CREATE INDEX "evidence_collection_revoked_source_cleanup_idx" ON "evidence_collection" USING btree ("client_id","source_connection_id","id") WHERE "evidence_collection"."lifecycle" in ('candidate', 'live', 'quarantined');--> statement-breakpoint
CREATE INDEX "intelligence_record_decay_due_idx" ON "intelligence_record" USING btree ("decay_at","id") WHERE "intelligence_record"."decay_at" is not null and "intelligence_record"."lifecycle" in ('candidate', 'live');--> statement-breakpoint
CREATE INDEX "qualitative_theme_evidence_ids_gin_idx" ON "qualitative_theme" USING gin ("evidence_ids");--> statement-breakpoint
CREATE INDEX "quantitative_observation_evidence_id_idx" ON "quantitative_observation" USING btree ("evidence_id","id");--> statement-breakpoint
CREATE INDEX "research_artifact_evidence_ids_gin_idx" ON "research_artifact" USING gin ("evidence_ids");--> statement-breakpoint
CREATE INDEX "source_acquisition_job_queued_idx" ON "source_acquisition_job" USING btree ("requested_at","id") WHERE "source_acquisition_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "source_acquisition_job_running_started_idx" ON "source_acquisition_job" USING btree ("started_at","id") WHERE "source_acquisition_job"."status" = 'running' and "source_acquisition_job"."started_at" is not null;--> statement-breakpoint
CREATE INDEX "source_acquisition_job_revoked_source_cleanup_idx" ON "source_acquisition_job" USING btree ("client_id","source_connection_id","requested_at","id") WHERE "source_acquisition_job"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "source_connection_revoked_idx" ON "source_connection" USING btree ("revoked_at","id") WHERE "source_connection"."revoked_at" is not null;
