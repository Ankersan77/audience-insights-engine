import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { SensingProfile } from "@/src/core/contracts";
import { db } from "@/src/db/client";
import { monitoringRun, sensingProfile, sourceAcquisitionJob, sourceConnection } from "@/src/db/schema";
import { monitoringScheduleKey, planMonitoringAcquisitions } from "@/src/monitoring/scheduler";
import { validateSensingProfile } from "@/src/core/validation";

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

export type SensingProfileRow = { databaseId: number; status: string; profile: SensingProfile; createdAt: Date };

export async function listSensingProfiles(clientId: number): Promise<SensingProfileRow[]> {
  const rows = await db.select().from(sensingProfile).where(eq(sensingProfile.clientId, clientId)).orderBy(desc(sensingProfile.version));
  return rows.map((row) => ({ databaseId: row.id, status: row.status, profile: canonicalProfile(row), createdAt: row.createdAt }));
}

export async function createActiveSensingProfile(input: Omit<SensingProfile, "id" | "version">): Promise<SensingProfileRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73002, ${Number(input.clientId)})`);
    const [versionRow] = await tx.select({ value: max(sensingProfile.version) }).from(sensingProfile).where(eq(sensingProfile.clientId, Number(input.clientId)));
    const version = Number(versionRow?.value ?? 0) + 1;
    const profile: SensingProfile = { ...input, id: "pending", version };
    const validation = validateSensingProfile(profile);
    if (!validation.valid) throw new Error(`invalid-sensing-profile:${validation.errors.join(";")}`);
    await tx.update(sensingProfile).set({ status: "superseded" }).where(and(eq(sensingProfile.clientId, Number(input.clientId)), eq(sensingProfile.status, "active")));
    const [created] = await tx.insert(sensingProfile).values({ clientId: Number(input.clientId), version, profileJson: profile, status: "active" }).returning();
    const storedProfile = { ...profile, id: String(created.id) };
    await tx.update(sensingProfile).set({ profileJson: storedProfile }).where(eq(sensingProfile.id, created.id));
    return { databaseId: created.id, status: created.status, profile: storedProfile, createdAt: created.createdAt };
  });
}

export type MonitoringRunRow = typeof monitoringRun.$inferSelect;

export async function listMonitoringRuns(clientId: number, limit = 50): Promise<MonitoringRunRow[]> {
  return db.select().from(monitoringRun).where(eq(monitoringRun.clientId, clientId)).orderBy(desc(monitoringRun.id)).limit(Math.min(Math.max(limit, 1), 200));
}

/** Emits durable, idempotent acquisition jobs for each due active profile. */
export async function enqueueDueMonitoringRuns(now = new Date(), clientId?: number): Promise<MonitoringScheduleSummary> {
  const profiles = await db.select().from(sensingProfile).where(
    clientId
      ? and(eq(sensingProfile.status, "active"), eq(sensingProfile.clientId, clientId))
      : eq(sensingProfile.status, "active"),
  );
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
export async function reconcileMonitoringRuns(now = new Date(), clientId?: number): Promise<number> {
  const runs = await db
    .select()
    .from(monitoringRun)
    .where(clientId
      ? and(inArray(monitoringRun.status, ["queued", "running"]), eq(monitoringRun.clientId, clientId))
      : inArray(monitoringRun.status, ["queued", "running"]));
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

