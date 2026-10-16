CREATE TABLE "auth_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_client_id_user_id_client_membership_client_id_user_id_fk" FOREIGN KEY ("client_id","user_id") REFERENCES "public"."client_membership"("client_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_session_expiry_idx" ON "auth_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_session_membership_idx" ON "auth_session" USING btree ("client_id","user_id");