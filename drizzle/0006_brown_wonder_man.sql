ALTER TABLE "research_artifact" DROP CONSTRAINT "research_artifact_client_type_version_unique";--> statement-breakpoint
ALTER TABLE "research_artifact" ADD COLUMN "artifact_key" text;--> statement-breakpoint
UPDATE "research_artifact" SET "artifact_key" = 'legacy:' || "artifact_type" || ':' || "id"::text WHERE "artifact_key" IS NULL;--> statement-breakpoint
ALTER TABLE "research_artifact" ALTER COLUMN "artifact_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "research_artifact" ADD CONSTRAINT "research_artifact_client_key_version_unique" UNIQUE("client_id","artifact_key","version");
