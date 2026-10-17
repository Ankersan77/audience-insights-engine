/**
 * pg-boss wrapper for the `research-run` queue (T20). Two call sites:
 *  - `enqueueRunJob` from the trigger API (`app/api/runs/trigger/route.ts`),
 *    inside the Next.js server process.
 *  - `startRunWorker` from the standalone worker process (`src/workers/index.ts`).
 *
 * Each process gets its own lazily-started `PgBoss` instance pointed at the
 * same Postgres database; pg-boss itself owns the queue tables there (no new
 * infrastructure — Decisions table, "Background jobs").
 *
 * The queue is created with `retryLimit: 0` (pg-boss's own default is 2):
 * tech review required finding 9 says a Run job is never auto-retried. In
 * practice the job handler below never throws for a business-level failure
 * either (it always resolves, recording success/failure on the `research_run`
 * row itself), so this is belt-and-suspenders against an unexpected bug.
 */

import { type PgBoss, type Job } from "pg-boss";
import { runLast30Days, type RunLast30DaysInstruction } from "./runLast30Days";
import { draftInsightsForRun } from "./draftInsights";
import { parseCompactReport, storeEvidenceForRun } from "@/src/db/queries/evidence";
import { markRunFailed, markRunRunning, markRunSucceeded } from "@/src/db/queries/research_runs";
import { checkRunSlo, logEvent } from "@/src/lib/metrics";
import { legacyLast30DaysEnabled } from "@/src/lib/featureFlags";
import { getWorkerRuntime } from "./pgBossRuntime";

/** Groups parsed report items by source, for the per-Run Evidence-count log
 * line (T29) — reuses `parseCompactReport` (already exported by
 * src/db/queries/evidence.ts) rather than re-deriving counts from the
 * inserted-row count, which `storeEvidenceForRun` only returns as a single
 * total and which also excludes rows skipped as duplicates. */
function countBySource(items: { source: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.source] = (counts[item.source] ?? 0) + 1;
  }
  return counts;
}

export const RUN_QUEUE_NAME = "research-run";

/** The exact fields `runLast30Days` needs, resolved once at trigger time
 * (T14's inheritance rule already applied) so an in-flight Run is immune to a
 * later edit of the same brand/market's research instructions. */
export type RunJobInstructionFields = {
  subreddits: string[];
  dedicatedSubreddits: string[];
  xHandle: string | null;
  xRelated: string[];
  tiktokHashtags: string[];
  topic: string;
};

export type RunJobPayload = {
  runId: number;
  clientId: number;
  brandId: number;
  marketId: number;
  researchInstructionVersion: number;
  instruction: RunJobInstructionFields;
};

/** Called by the trigger API after it has already inserted the `queued`
 * `research_run` row (T20) — the row, not this call, is what the database's
 * partial unique index guards against duplicates. */
export async function enqueueRunJob(payload: RunJobPayload): Promise<void> {
  const boss = await getWorkerRuntime();
  await ensureRunQueue(boss);
  await boss.send(RUN_QUEUE_NAME, payload);
}

async function ensureRunQueue(boss: Pick<PgBoss, "createQueue">): Promise<void> {
  // 11 minutes: a safety margin over the legacy subprocess's 10-minute ceiling.
  await boss.createQueue(RUN_QUEUE_NAME, { retryLimit: 0, expireInSeconds: 11 * 60 });
}

async function processRunJob(payload: RunJobPayload): Promise<void> {
  if (!legacyLast30DaysEnabled()) {
    await markRunFailed(payload.runId, "Legacy Last30Days ingestion is disabled by the people-blind migration gate.");
    logEvent("run-failed", {
      runId: payload.runId,
      brandId: payload.brandId,
      marketId: payload.marketId,
      errorMessage: "legacy-ingestion-disabled",
    });
    return;
  }

  await markRunRunning(payload.runId);

  const instruction: RunLast30DaysInstruction = {
    subreddits: payload.instruction.subreddits,
    dedicatedSubreddits: payload.instruction.dedicatedSubreddits,
    xHandle: payload.instruction.xHandle,
    xRelated: payload.instruction.xRelated,
    tiktokHashtags: payload.instruction.tiktokHashtags,
    topic: payload.instruction.topic,
  };

  const result = await runLast30Days(instruction);
  const runSloFields = {
    runId: payload.runId,
    brandId: payload.brandId,
    marketId: payload.marketId,
    durationMs: result.durationMs,
  };

  if (result.status === "completed" && result.exitCode === 0) {
    const insertedCount = await storeEvidenceForRun(payload.runId, result.stdout);
    logEvent("run-evidence-counts", {
      runId: payload.runId,
      brandId: payload.brandId,
      marketId: payload.marketId,
      insertedCount,
      perSource: countBySource(parseCompactReport(result.stdout)),
    });
    await markRunSucceeded(payload.runId);
    logEvent("run-succeeded", runSloFields);
    checkRunSlo(runSloFields);
    // T22: draft Insights from this Run's Evidence. Never lets a drafting
    // failure undo the Run's own success — the Run already succeeded; a
    // problem here is logged, not propagated into the Run's status.
    try {
      await draftInsightsForRun(payload.runId);
    } catch (error) {
      console.error(`[worker] insight drafting failed for run ${payload.runId}`, error);
    }
    return;
  }

  let errorMessage: string;
  if (result.status === "timeout") {
    errorMessage = "last30days subprocess timed out";
  } else if (result.status === "spawn-error") {
    errorMessage = "last30days subprocess failed to start";
  } else {
    errorMessage = `last30days exited with code ${result.exitCode}`;
  }
  await markRunFailed(payload.runId, errorMessage, { timedOut: result.status === "timeout" });
  logEvent("run-failed", { ...runSloFields, errorMessage, timedOut: result.status === "timeout" });
  checkRunSlo(runSloFields);
}

/** Subscribes the calling process to the queue. Never auto-retries (queue
 * created with `retryLimit: 0`); a thrown error here is caught and recorded
 * as a `failed` Run instead of propagating into pg-boss's own retry path. */
export async function startRunWorker(boss: PgBoss): Promise<void> {
  await ensureRunQueue(boss);
  await boss.work<RunJobPayload>(RUN_QUEUE_NAME, async (jobs: Job<RunJobPayload>[]) => {
    for (const job of jobs) {
      try {
        await processRunJob(job.data);
      } catch (error) {
        console.error(`[worker] run ${job.data.runId} failed unexpectedly`, error);
        try {
          await markRunFailed(
            job.data.runId,
            error instanceof Error ? error.message : "Unexpected worker error.",
          );
        } catch (innerError) {
          console.error(`[worker] could not record failure for run ${job.data.runId}`, innerError);
        }
      }
    }
  });
}
