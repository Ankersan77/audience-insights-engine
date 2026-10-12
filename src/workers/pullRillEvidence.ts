import { db } from "@/src/db/client";
import { evidence } from "@/src/db/schema";
import { queryRill, type RillRow } from "@/src/lib/rill";
import { ALLOWED_RILL_MEASURES, type RillView } from "@/src/lib/rillAllowlist";

/**
 * Pulls allowlisted Rill data into `evidence` rows (`source='rill'`) — the
 * function a future Run (T20's orchestration) would call alongside
 * `storeEvidenceForRun` (T21, `last30days`). Not integrated into
 * `src/workers/runQueue.ts` here: T26's file list is this file plus the CI
 * workflow and the allowlist's unit tests, not the Run orchestrator.
 *
 * NOT LIVE-VERIFIABLE in this environment: no `RILL_API_TOKEN` has ever been
 * provisioned here (T24 — no Rill administrator named yet, product-spec.md
 * section 16). Calling this today always throws `RillNotConfiguredError`
 * (via `queryRill`) on the first allowed view — the honest-degradation path,
 * not a fake row. End-to-end live verification is deferred to whoever picks
 * up T24 once a credential exists.
 */

export type PullRillEvidenceResult = {
  view: RillView;
  insertedCount: number;
};

/**
 * Deterministic (never random) external id, so a re-pull of the same Rill
 * result is idempotent against `evidence`'s `(run_id, source, external_id)`
 * uniqueness constraint (T4) — same convention as the `last30days` evidence
 * source (T21, `src/db/queries/evidence.ts`). Built from the row's allowed
 * dimension values, which identify the row within its view.
 */
function externalIdFor(view: RillView, row: RillRow): string {
  const dimensionFields = ALLOWED_RILL_MEASURES[view].dimensions;
  const keyParts = dimensionFields.map((field) => String(row[field] ?? ""));
  return `${view}:${keyParts.join("|")}`;
}

/**
 * Queries both allowlisted Rill views (every allowlisted measure and
 * dimension for each) and stores the results as `evidence` rows for `runId`.
 * Propagates `RillNotConfiguredError`/`RillAccessDeniedError` rather than
 * swallowing them — a Run that cannot reach Rill should fail visibly, not
 * silently record zero evidence.
 */
export async function pullRillEvidenceForRun(
  runId: number,
  context?: { userId?: number },
): Promise<PullRillEvidenceResult[]> {
  const results: PullRillEvidenceResult[] = [];

  for (const view of Object.keys(ALLOWED_RILL_MEASURES) as RillView[]) {
    const entry = ALLOWED_RILL_MEASURES[view];
    const fields = [...entry.measures, ...entry.dimensions];

    const rows = await queryRill(view, fields, { runId, userId: context?.userId });

    if (rows.length === 0) {
      results.push({ view, insertedCount: 0 });
      continue;
    }

    const inserted = await db
      .insert(evidence)
      .values(
        rows.map((row) => ({
          runId,
          source: "rill",
          externalId: externalIdFor(view, row),
          url: null,
          publishedAt: null,
          textSnippet: JSON.stringify(row),
          engagementJson: null,
        })),
      )
      .onConflictDoNothing({ target: [evidence.runId, evidence.source, evidence.externalId] })
      .returning({ id: evidence.id });

    results.push({ view, insertedCount: inserted.length });
  }

  return results;
}
