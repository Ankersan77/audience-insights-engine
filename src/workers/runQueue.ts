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

import { PgBoss, type Job } from "pg-boss";
import { runLast30Days, type RunLast30DaysInstruction } from "./runLast30Days";
import { draftInsightsForRun } from "./draftInsights";
import { storeEvidenceForRun } from "@/src/db/queries/evidence";
import { markRunFailed, markRunRunning, markRunSucceeded } from "@/src/db/queries/research_runs";

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
  brandId: number;
  marketId: number;
  researchInstructionVersion: number;
  instruction: RunJobInstructionFields;
};

let bossPromise: Promise<PgBoss> | null = null;

function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
      boss.on("error", (err: Error) => console.error("[pg-boss] error", err));
      await boss.start();
      // 11 minutes: a safety margin over runLast30Days' own 10-minute hard
      // timeout, so pg-boss never considers the job "stuck" and reclaims it
      // while the subprocess is still legitimately running.
      await boss.createQueue(RUN_QUEUE_NAME, { retryLimit: 0, expireInSeconds: 11 * 60 });
      return boss;
    })();
  }
  return bossPromise;
}

/** Called by the trigger API after it has already inserted the `queued`
 * `research_run` row (T20) — the row, not this call, is what the database's
 * partial unique index guards against duplicates. */
export async function enqueueRunJob(payload: RunJobPayload): Promise<void> {
  const boss = await getBoss();
  await boss.send(RUN_QUEUE_NAME, payload);
}

async function processRunJob(payload: RunJobPayload): Promise<void> {
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

  if (result.status === "completed" && result.exitCode === 0) {
    await storeEvidenceForRun(payload.runId, result.stdout);
    await markRunSucceeded(payload.runId);
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
}

/** Subscribes the calling process to the queue. Never auto-retries (queue
 * created with `retryLimit: 0`); a thrown error here is caught and recorded
 * as a `failed` Run instead of propagating into pg-boss's own retry path. */
export async function startRunWorker(): Promise<PgBoss> {
  const boss = await getBoss();
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
  return boss;
}
