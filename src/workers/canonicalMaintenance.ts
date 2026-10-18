import type { PgBoss } from "pg-boss";
import { purgeAuthSessions, type AuthSessionPurgeProgress } from "@/src/db/queries/auth_sessions";
import { enforceCanonicalRetention, type CanonicalRetentionSummary } from "@/src/db/queries/retention";
import { logEvent } from "@/src/lib/metrics";
import {
  dispatchQueuedAcquisitions,
  reconcileStaleAcquisitions,
  type AcquisitionDispatchProgress,
  type AcquisitionReconciliationProgress,
} from "@/src/workers/acquisitionQueue";

export const CANONICAL_MAINTENANCE_QUEUE = "market-research-canonical-maintenance";
export const CANONICAL_MAINTENANCE_WALL_BUDGET_MS = 240_000;

const STAGES = [
  { key: "sessions", deadlineOffsetMs: 30_000 },
  { key: "retention", deadlineOffsetMs: 180_000 },
  { key: "acquisitionReconciliation", deadlineOffsetMs: 210_000 },
  { key: "acquisitionDispatch", deadlineOffsetMs: CANONICAL_MAINTENANCE_WALL_BUDGET_MS },
] as const;

type MaintenanceStageKey = (typeof STAGES)[number]["key"];
type StageOptions = { deadline: Date };

type MaintenanceBoss = Pick<PgBoss, "createQueue" | "schedule" | "unschedule" | "work" | "send">;
export type MaintenanceDependencies = {
  purgeSessions: (now: Date, options: StageOptions) => Promise<AuthSessionPurgeProgress>;
  enforceRetention: (now: Date, options: StageOptions) => Promise<CanonicalRetentionSummary>;
  reconcileAcquisitions: (now: Date, options: StageOptions) => Promise<AcquisitionReconciliationProgress>;
  dispatchAcquisitions: (boss: Pick<PgBoss, "send">, options: StageOptions) => Promise<AcquisitionDispatchProgress>;
  log: typeof logEvent;
  clock?: () => number;
  disabled?: boolean;
};

const defaultDependencies: MaintenanceDependencies = {
  purgeSessions: purgeAuthSessions,
  enforceRetention: (now, options) => enforceCanonicalRetention(now, undefined, options),
  reconcileAcquisitions: reconcileStaleAcquisitions,
  dispatchAcquisitions: dispatchQueuedAcquisitions,
  log: logEvent,
};

function isExpectedDeferral(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if (current instanceof Error && current.message === "maintenance-stage-deadline-exceeded") return true;
    if ("code" in current && (current.code === "57014" || current.code === "55P03")) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function settleBeforeDeadline<T>(run: () => Promise<T>, deadline: Date, clock: () => number): Promise<T> {
  const remainingMs = deadline.getTime() - clock();
  if (remainingMs <= 0) throw new Error("maintenance-stage-deadline-exceeded");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = Promise.resolve().then(run);
  // Promise.race installs handlers on `operation`, so a late rejection stays
  // observed even after the caller has moved on. Database operations still
  // require their own statement/lock timeouts; this is the outer wall guard.
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("maintenance-stage-deadline-exceeded")), remainingMs);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

/** Canonical data hygiene and acquisition recovery; independent of transitional monitoring. */
export async function startCanonicalMaintenance(
  boss: MaintenanceBoss,
  dependencies: MaintenanceDependencies = defaultDependencies,
): Promise<void> {
  const disabled = dependencies.disabled ?? process.env.CANONICAL_MAINTENANCE_DISABLED === "true";
  if (disabled) {
    await boss.unschedule(CANONICAL_MAINTENANCE_QUEUE);
    dependencies.log("canonical-maintenance-disabled", { scheduleRemoved: true });
    return;
  }
  await boss.createQueue(CANONICAL_MAINTENANCE_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 5 * 60,
  });
  await boss.schedule(CANONICAL_MAINTENANCE_QUEUE, "*/15 * * * *", null, { tz: "UTC", missed: "once" });
  await boss.work(CANONICAL_MAINTENANCE_QUEUE, async () => {
    const clock = dependencies.clock ?? Date.now;
    const startedAt = clock();
    const now = new Date(startedAt);
    const failedStages: string[] = [];
    const deferredStages: MaintenanceStageKey[] = [];

    const runStage = async <T>(stage: (typeof STAGES)[number], run: (options: StageOptions) => Promise<T>, failureCode: string): Promise<T | null> => {
      const deadline = new Date(startedAt + stage.deadlineOffsetMs);
      if (clock() >= deadline.getTime()) {
        deferredStages.push(stage.key);
        return null;
      }
      try {
        return await settleBeforeDeadline(() => run({ deadline }), deadline, clock);
      } catch (error) {
        if (isExpectedDeferral(error)) deferredStages.push(stage.key);
        else failedStages.push(failureCode);
        return null;
      }
    };

    const sessions = await runStage(STAGES[0], (options) => dependencies.purgeSessions(now, options), "session-cleanup-failed");
    const retention = await runStage(STAGES[1], (options) => dependencies.enforceRetention(now, options), "retention-failed");
    const acquisitionReconciliation = await runStage(STAGES[2], (options) => dependencies.reconcileAcquisitions(now, options), "acquisition-reconciliation-failed");
    const acquisitionDispatch = await runStage(STAGES[3], (options) => dependencies.dispatchAcquisitions(boss, options), "acquisition-dispatch-failed");

    const expiredSessionsRemoved = sessions?.removed ?? null;
    const staleAcquisitions = acquisitionReconciliation
      ? acquisitionReconciliation.staleProcessed ?? acquisitionReconciliation.processed
      : null;
    const dispatched = acquisitionDispatch?.dispatched ?? null;
    const batchFull = Boolean(
      sessions?.batchFull
      || retention?.batchFull
      || acquisitionReconciliation?.batchFull
      || acquisitionDispatch?.batchFull
      || deferredStages.length,
    );
    const result = {
      // Compatibility fields retained for existing operations consumers.
      expiredSessionsRemoved,
      retention,
      staleAcquisitions,
      dispatched,
      progress: {
        sessions,
        acquisitionReconciliation,
        acquisitionDispatch,
        batchFull,
        elapsedMs: Math.max(0, clock() - startedAt),
        deferredStages,
      },
    };
    dependencies.log("canonical-maintenance", result);
    if (failedStages.length > 0) {
      dependencies.log("canonical-maintenance-failed", { errorCodes: failedStages });
      throw new Error("canonical-maintenance-incomplete");
    }
    return result;
  });
}
