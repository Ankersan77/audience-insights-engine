ALTER TABLE "market" ADD COLUMN "processing_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Compliance review blocking finding / spec §16: Greek-market processing is
-- gated off until Legal signs off. Applies to any database where the Greece
-- market row already exists at migration time; `src/db/queries/brands.ts`'s
-- SEED_MARKETS also sets this explicitly for a brand-new database where the
-- row does not exist yet, so a fresh install and an already-seeded one both
-- land with Greece disabled.
UPDATE "market" SET "processing_enabled" = false WHERE "code" = 'GR';