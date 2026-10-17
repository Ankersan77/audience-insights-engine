CREATE TABLE "company_context_revision" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"version" integer NOT NULL,
	"content_json" jsonb NOT NULL,
	"declared_by" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_after" timestamp with time zone NOT NULL,
	"change_reason" text NOT NULL,
	CONSTRAINT "company_context_client_version_unique" UNIQUE("client_id","version")
);
--> statement-breakpoint
ALTER TABLE "company_context_revision" ADD CONSTRAINT "company_context_revision_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_context_revision" ADD CONSTRAINT "company_context_revision_declared_by_app_user_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;