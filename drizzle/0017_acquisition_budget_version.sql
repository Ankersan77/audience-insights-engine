-- Optimistic editing version; does not reset usage or revoke existing acquisition grants.
ALTER TABLE "acquisition_budget" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
