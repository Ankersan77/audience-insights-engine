import type { PgBoss } from "pg-boss";
import { enqueueDueMonitoringRuns, qualifyPendingMonitoringRuns, reconcileMonitoringRuns } from "@/src/db/queries/monitoring";
import { generateDueBriefings } from "@/src/db/queries/briefings";
import { logEvent } from "@/src/lib/metrics";

export const MONITORING_SCHEDULER_QUEUE = "market-research-monitoring-scheduler";

type MonitoringDependencies = {
  enqueueDueRuns: typeof enqueueDueMonitoringRuns;
  reconcileRuns: typeof reconcileMonitoringRuns;
  qualifyRuns: typeof qualifyPendingMonitoringRuns;
  generateBriefings: typeof generateDueBriefings;
  log: typeof logEvent;
};

const defaultDependencies: MonitoringDependencies = {
  enqueueDueRuns: enqueueDueMonitoringRuns,
  reconcileRuns: reconcileMonitoringRuns,
  qualifyRuns: qualifyPendingMonitoringRuns,
  generateBriefings: generateDueBriefings,
  log: logEvent,
};

/** Transitional monitoring-only scheduler. Canonical maintenance must not be registered here. */
export async function startMonitoringScheduler(
  boss: Pick<PgBoss, "createQueue" | "schedule" | "work">,
  dependencies: MonitoringDependencies = defaultDependencies,
): Promise<void> {
  await boss.createQueue(MONITORING_SCHEDULER_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 5 * 60,
  });
  await boss.schedule(MONITORING_SCHEDULER_QUEUE, "*/15 * * * *", null, { tz: "UTC" });
  await boss.work(MONITORING_SCHEDULER_QUEUE, async () => {
    try {
      const schedule = await dependencies.enqueueDueRuns();
      const reconciled = await dependencies.reconcileRuns();
      const qualified = await dependencies.qualifyRuns();
      const briefings = await dependencies.generateBriefings();
      const result = { ...schedule, reconciled, qualified, briefings };
      dependencies.log("monitoring-scheduler", result);
      return result;
    } catch {
      dependencies.log("monitoring-scheduler-failed", { errorCode: "monitoring-maintenance-unavailable" });
      throw new Error("monitoring-scheduler-unavailable");
    }
  });
}
