-- Partial indexes keep recovery scans independent of completed ledger history.
CREATE INDEX "synthesis_reserved_deadline_idx" ON "synthesis_authorization" USING btree ("dispatch_by","client_id") WHERE "synthesis_authorization"."status" = 'reserved';--> statement-breakpoint
CREATE INDEX "synthesis_dispatched_deadline_idx" ON "synthesis_authorization" USING btree ("execution_deadline","client_id") WHERE "synthesis_authorization"."status" = 'dispatched';
