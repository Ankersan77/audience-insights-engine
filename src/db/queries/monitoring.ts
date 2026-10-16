import { and, eq, inArray } from "drizzle-orm";
import type { SensingProfile } from "@/src/core/contracts";
import { db } from "@/src/db/client";
import { monitoringRun, sensingProfile, sourceAcquisitionJob, sourceConnection } from "@/src/db/schema";
import { monitoringScheduleKey, planMonitoringAcquisitions } from "@/src/monitoring/scheduler";

export type MonitoringScheduleSummary = {
  scheduled: number;
  alreadyScheduled: number;
  failedConfiguration: number;
};

function canonicalProfile(row: typeof sensingProfile.$inferSelect): SensingProfile {
  const payload = row.profileJson as Partial<SensingProfile>;
  return {
    id: String(row.id),
    clientId: String(row.clientId),
    version: row.version,
    themes: payload.themes ?? [],
    markets: payload.markets ?? [],
    competitors: payload.competitors ?? [],
    products: payload.products ?? [],
    sourceConnectionIds: payload.sourceConnectionIds ?? [],
    cadence: payload.cadence ?? "weekly",
    materialityThreshold: payload.materialityThreshold ?? 0.2,
    confidenceThreshold: payload.confidenceThreshold ?? 0.7,
    freshnessDays: payload.freshnessDays ?? 14,
    minimumCorroboration: payload.minimumCorroboration ?? 2,
    quietPeriods: payload.quietPeriods ?? [],
  };
}

/** Emits durable, idempotent acquisition jobs for each due active profile. */
export async function enqueueDueMonitoringRuns(now = new Date()): Promise<MonitoringScheduleSummary> {
  const profiles = await db.select().from(sensingProfile).where(eq(sensingProfile.status, "active"));
  const summary: MonitoringScheduleSummary = { scheduled: 0, alreadyScheduled: 0, failedConfiguration: 0 };

  for (const row of profiles) {
    const profile = canonicalProfile(row);
    let scheduleKey: string;
    try {
      scheduleKey = monitoringScheduleKey(profile, now.toISOString());
    } catch {
      summary.failedConfiguration += 1;
      continue;
    }

    const outcome = await db.transaction(async (tx): Promise<"scheduled" | "exists" | "invalid"> => {
      const [createdRun] = await tx
        .insert(monitoringRun)
        .values({
          clientId: row.clientId,
          sensingProfileId: row.id,
          scheduleKey,
          status: "queued",
          outcome: "awaiting_acquisition",
        })
        .onConflictDoNothing({
          target: [monitoringRun.clientId, monitoringRun.sensingProfileId, monitoringRun.scheduleKey],
        })
        .returning();
      if (!createdRun) return "exists";

      const configuredSources = await tx
        .select({ id: sourceConnection.id, connectorId: sourceConnection.connectorId })
        .from(sourceConnection)
        .where(eq(sourceConnection.clientId, row.clientId));
      const byReference = new Map<string, number>();
      for (const source of configuredSources) {
        byReference.set(String(source.id), source.id);
        byReference.set(source.connectorId, source.id);
      }
      const plans = planMonitoringAcquisitions({
        profile,
        now: now.toISOString(),
        monitoringRunId: String(createdRun.id),
      });
      const unresolved = plans.filter((plan) => !byReference.has(plan.sourceId));
      if (unresolved.length > 0 || plans.length === 0) {
        await tx
          .update(monitoringRun)
          .set({
            status: "failed",
            outcome: `source_configuration_failure:${unresolved.map((plan) => plan.sourceId).join(",") || "no-sources"}`,
            finishedAt: now,
          })
          .where(and(eq(monitoringRun.id, createdRun.id), eq(monitoringRun.clientId, row.clientId)));
        return "invalid";
      }

      await tx.insert(sourceAcquisitionJob).values(plans.map((plan) => ({
        clientId: row.clientId,
        sourceConnectionId: byReference.get(plan.sourceId)!,
        monitoringRunId: createdRun.id,
        status: "queued" as const,
        operation: plan.request.operation,
        requestJson: plan.request,
        idempotencyKey: plan.idempotencyKey,
        requestedAt: now,
      }))).onConflictDoNothing({
        target: [sourceAcquisitionJob.clientId, sourceAcquisitionJob.idempotencyKey],
      });
      return "scheduled";
    });

    if (outcome === "scheduled") summary.scheduled += 1;
    else if (outcome === "exists") summary.alreadyScheduled += 1;
    else summary.failedConfiguration += 1;
  }
  return summary;
}

/** Reconciles acquisition completion without upgrading it to a qualified signal or learning. */
export async function reconcileMonitoringRuns(now = new Date()): Promise<number> {
  const runs = await db
    .select()
    .from(monitoringRun)
    .where(inArray(monitoringRun.status, ["queued", "running"]));
  let changed = 0;
  for (const run of runs) {
    const jobs = await db
      .select({ status: sourceAcquisitionJob.status })
      .from(sourceAcquisitionJob)
      .where(and(
        eq(sourceAcquisitionJob.clientId, run.clientId),
        eq(sourceAcquisitionJob.monitoringRunId, run.id),
      ));
    const failed = jobs.some((job) => job.status === "failed" || job.status === "cancelled");
    const succeeded = jobs.length > 0 && jobs.every((job) => job.status === "succeeded");
    const running = jobs.some((job) => job.status === "running");
    if (!failed && !succeeded && !(running && run.status === "queued")) continue;
    await db
      .update(monitoringRun)
      .set(failed
        ? { status: "failed", outcome: "source_health_failure", finishedAt: now }
        : succeeded
          ? { status: "succeeded", outcome: "acquisition_complete_pending_qualification", finishedAt: now }
          : { status: "running", startedAt: run.startedAt ?? now })
      .where(and(eq(monitoringRun.id, run.id), eq(monitoringRun.clientId, run.clientId)));
    changed += 1;
  }
  return changed;
}

