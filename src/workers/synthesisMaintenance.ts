import type { PgBoss } from "pg-boss";
import { logEvent } from "../lib/metrics.ts";

export const SYNTHESIS_MAINTENANCE_QUEUE = "market-research-synthesis-maintenance";
type MaintenanceResult = { examinedClients: number; reconciledAttempts: number; busyClients: number; failedClients: number; batchFull: boolean };
type MaintenanceDependencies = {
  reconcile: () => Promise<MaintenanceResult>;
  log: (event: string, fields: Record<string, unknown>) => void;
};

/** Metadata-only recovery. Does not load bindings, credentials, adapters or prompts. */
export async function startSynthesisMaintenance(boss: Pick<PgBoss, "createQueue" | "schedule" | "work">, dependencies: MaintenanceDependencies = {
  async reconcile() { return (await import("../db/queries/synthesis_budget")).reconcileDueSynthesisAttempts(); },
  log: logEvent,
}): Promise<void> {
  await boss.createQueue(SYNTHESIS_MAINTENANCE_QUEUE, { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 5 * 60 });
  await boss.schedule(SYNTHESIS_MAINTENANCE_QUEUE, "*/5 * * * *", null, { tz: "UTC" });
  await boss.work(SYNTHESIS_MAINTENANCE_QUEUE, async () => {
    let result: MaintenanceResult;
    try { result = await dependencies.reconcile(); }
    catch {
      dependencies.log("synthesis-maintenance-failed", { errorCode: "reconciliation-unavailable" });
      // pg-boss persists thrown errors; never pass raw SQL/connection details to it.
      throw new Error("synthesis-maintenance-unavailable");
    }
    dependencies.log("synthesis-maintenance", { ...result });
    if (result.failedClients) throw new Error("synthesis-maintenance-incomplete");
    return result;
  });
}
