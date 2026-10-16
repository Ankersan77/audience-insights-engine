import { PgBoss } from "pg-boss";
import { enqueueDueMonitoringRuns, qualifyPendingMonitoringRuns, reconcileMonitoringRuns } from "@/src/db/queries/monitoring";
import { logEvent } from "@/src/lib/metrics";
import { dispatchQueuedAcquisitions, reconcileStaleAcquisitions } from "@/src/workers/acquisitionQueue";
import { enforceCanonicalRetention } from "@/src/db/queries/retention";
import { generateDueBriefings } from "@/src/db/queries/briefings";

export const MONITORING_SCHEDULER_QUEUE = "market-research-monitoring-scheduler";

export async function startCanonicalScheduler(boss: PgBoss): Promise<void> {
  await boss.createQueue(MONITORING_SCHEDULER_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 5 * 60,
  });
  await boss.schedule(MONITORING_SCHEDULER_QUEUE, "*/15 * * * *", null, { tz: "UTC" });
  await boss.work(MONITORING_SCHEDULER_QUEUE, async () => {
    const retention = await enforceCanonicalRetention();
    const schedule = await enqueueDueMonitoringRuns();
    const reconciled = await reconcileMonitoringRuns();
    const qualified = await qualifyPendingMonitoringRuns();
    const briefings = await generateDueBriefings();
    const staleAcquisitions = await reconcileStaleAcquisitions();
    const dispatched = await dispatchQueuedAcquisitions(boss);
    logEvent("canonical-monitoring-scheduler", { retention, ...schedule, reconciled, qualified, briefings, staleAcquisitions, dispatched });
  });
}

