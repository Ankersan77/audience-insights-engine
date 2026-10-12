/**
 * Retention/purge job for `evidence` (T27, compliance review required
 * finding: the mechanism is built now; the ceiling is pending Legal — spec
 * §10/§16). Shipped disabled: there is no default retention period, and
 * guessing one would be worse than doing nothing, so this reads the ceiling
 * from `EVIDENCE_RETENTION_DAYS` every time it runs rather than baking one
 * in. Until that environment variable is set, calling this function is a
 * documented no-op.
 *
 * Deletes, never anonymizes, `evidence` rows whose `retrieved_at` is older
 * than the ceiling. Deleting is simplest and matches "purge" (spec's own
 * word); it is also what makes the data-subject-rights procedure
 * (docs/dsr-procedure.md) literally true — an erasure request means the
 * rows stop existing, not that they are scrubbed of identifying fields and
 * kept around. `insight_evidence` rows referencing a purged `evidence` row
 * cascade-delete per that foreign key's `ON DELETE CASCADE` (src/db/schema.ts);
 * the `insight` row itself is untouched (restrict), so a delivered Insight's
 * own record and history survive even once its supporting Evidence is gone —
 * consistent with docs/dsr-procedure.md's residual-risk note that an
 * already-delivered Insight cannot be retracted by this job.
 *
 * Wiring (this task's call, since "pg-boss job or a plain exported function"
 * was left open): a plain exported function, not registered on any pg-boss
 * schedule. There is nothing to schedule on a cadence until Legal names a
 * ceiling (open item, spec §16) — scheduling one today would mean picking a
 * run frequency for a job that is supposed to do nothing. Once a ceiling
 * exists, whoever wires the cadence should call `purgeEvidenceForRetention()`
 * from a `pg-boss` recurring schedule registered in `src/workers/index.ts`,
 * the same process that already starts `startRunWorker()` there — not a new
 * worker process.
 */

import { lt } from "drizzle-orm";
import { db } from "@/src/db/client";
import { evidence } from "@/src/db/schema";
import { logEvent } from "@/src/lib/metrics";

export type PurgeEvidenceResult =
  | { ranPurge: false; reason: string }
  | { ranPurge: true; ceilingDays: number; cutoff: Date; deletedCount: number };

/** Reads `EVIDENCE_RETENTION_DAYS` fresh on every call — never a module-level
 * constant — so flipping the environment variable is enough to turn this on
 * once Legal decides, with no code change and no restart-order dependency. */
function readCeilingDays(): number | null {
  const raw = process.env.EVIDENCE_RETENTION_DAYS;
  if (!raw || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function purgeEvidenceForRetention(): Promise<PurgeEvidenceResult> {
  const ceilingDays = readCeilingDays();

  if (ceilingDays === null) {
    const reason = "retention ceiling not configured, skipping";
    logEvent("evidence-purge-skipped", { reason });
    return { ranPurge: false, reason };
  }

  const cutoff = new Date(Date.now() - ceilingDays * 24 * 60 * 60 * 1000);

  const deletedRows = await db
    .delete(evidence)
    .where(lt(evidence.retrievedAt, cutoff))
    .returning({ id: evidence.id });

  logEvent("evidence-purge-completed", {
    ceilingDays,
    cutoff: cutoff.toISOString(),
    deletedCount: deletedRows.length,
  });

  return { ranPurge: true, ceilingDays, cutoff, deletedCount: deletedRows.length };
}

// Manual invocation for an operator once Legal has set a ceiling (or for this
// task's own live verification): `EVIDENCE_RETENTION_DAYS=30 pnpm tsx
// src/workers/purgeEvidence.ts`. Loads `.env.local` the same way
// `src/workers/index.ts` does, for local-dev DATABASE_URL — a no-op in the
// deployed container where `.env.local` does not exist. Not wired to any
// schedule; see the module doc above.
if (process.argv[1]?.endsWith("purgeEvidence.ts")) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local present — expected in the deployed container.
  }
  purgeEvidenceForRetention()
    .then((result) => {
      console.log(result);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
