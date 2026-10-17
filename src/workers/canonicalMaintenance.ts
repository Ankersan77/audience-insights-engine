import type { PgBoss } from "pg-boss";
import { purgeAuthSessions } from "@/src/db/queries/auth_sessions";
import { enforceCanonicalRetention } from "@/src/db/queries/retention";
import { logEvent } from "@/src/lib/metrics";
import { dispatchQueuedAcquisitions, reconcileStaleAcquisitions } from "@/src/workers/acquisitionQueue";

export const CANONICAL_MAINTENANCE_QUEUE = "market-research-canonical-maintenance";

type MaintenanceBoss = Pick<PgBoss, "createQueue" | "schedule" | "unschedule" | "work" | "send">;
type MaintenanceDependencies = {
  purgeSessions: typeof purgeAuthSessions;
  enforceRetention: typeof enforceCanonicalRetention;
  reconcileAcquisitions: typeof reconcileStaleAcquisitions;
  dispatchAcquisitions: typeof dispatchQueuedAcquisitions;
  log: typeof logEvent;
  disabled?: boolean;
};

const defaultDependencies: MaintenanceDependencies = {
  purgeSessions: purgeAuthSessions,
  enforceRetention: enforceCanonicalRetention,
  reconcileAcquisitions: reconcileStaleAcquisitions,
  dispatchAcquisitions: dispatchQueuedAcquisitions,
  log: logEvent,
};

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
    const now = new Date();
    const failedStages: string[] = [];
    let expiredSessionsRemoved: number | null = null;
    let retention: Awaited<ReturnType<typeof enforceCanonicalRetention>> | null = null;
    let staleAcquisitions: number | null = null;
    let dispatched: number | null = null;

    try { expiredSessionsRemoved = await dependencies.purgeSessions(now); }
    catch { failedStages.push("session-cleanup-failed"); }
    try { retention = await dependencies.enforceRetention(now); }
    catch { failedStages.push("retention-failed"); }
    try { staleAcquisitions = await dependencies.reconcileAcquisitions(now); }
    catch { failedStages.push("acquisition-reconciliation-failed"); }
    try { dispatched = await dependencies.dispatchAcquisitions(boss); }
    catch { failedStages.push("acquisition-dispatch-failed"); }

    const result = { expiredSessionsRemoved, retention, staleAcquisitions, dispatched };
    dependencies.log("canonical-maintenance", result);
    if (failedStages.length > 0) {
      dependencies.log("canonical-maintenance-failed", { errorCodes: failedStages });
      throw new Error("canonical-maintenance-incomplete");
    }
    return result;
  });
}
