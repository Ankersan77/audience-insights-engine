import { PgBoss } from "pg-boss";
import { enqueueDueMonitoringRuns, reconcileMonitoringRuns } from "@/src/db/queries/monitoring";
import { logEvent } from "@/src/lib/metrics";

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
    const schedule = await enqueueDueMonitoringRuns();
    const reconciled = await reconcileMonitoringRuns();
    logEvent("canonical-monitoring-scheduler", { ...schedule, reconciled });
  });
}

