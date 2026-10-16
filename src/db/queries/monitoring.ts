import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { Applicability, IntelligenceRecord, SensingProfile, SourceClass } from "@/src/core/contracts";
import { db } from "@/src/db/client";
import {
  canonicalEvidence,
  evidenceCollection,
  intelligenceRecord,
  monitoringRun,
  quantitativeObservation,
  researchArtifact,
  sensingProfile,
  sourceAcquisitionJob,
  sourceAcquisitionReceipt,
  sourceConnection,
} from "@/src/db/schema";
import { monitoringScheduleKey, planMonitoringAcquisitions } from "@/src/monitoring/scheduler";
import { validateIntelligenceRecord, validateSensingProfile } from "@/src/core/validation";
import { buildQuantitativeSignalCandidates, type MonitoringObservation } from "@/src/monitoring/candidates";
import { qualifySignals } from "@/src/monitoring/engine";

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
export type AcquisitionJobRow = typeof sourceAcquisitionJob.$inferSelect & { connectorId: string };

export async function listMonitoringRuns(clientId: number, limit = 50): Promise<MonitoringRunRow[]> {
  return db.select().from(monitoringRun).where(eq(monitoringRun.clientId, clientId)).orderBy(desc(monitoringRun.id)).limit(Math.min(Math.max(limit, 1), 200));
}

export async function listAcquisitionJobs(clientId: number, limit = 100): Promise<AcquisitionJobRow[]> {
  const rows = await db.select({ job: sourceAcquisitionJob, connectorId: sourceConnection.connectorId }).from(sourceAcquisitionJob).innerJoin(sourceConnection, and(eq(sourceConnection.id, sourceAcquisitionJob.sourceConnectionId), eq(sourceConnection.clientId, sourceAcquisitionJob.clientId))).where(eq(sourceAcquisitionJob.clientId, clientId)).orderBy(desc(sourceAcquisitionJob.id)).limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(({ job, connectorId }) => ({ ...job, connectorId }));
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
      .select({ id: sourceAcquisitionJob.id, status: sourceAcquisitionJob.status })
      .from(sourceAcquisitionJob)
      .where(and(
        eq(sourceAcquisitionJob.clientId, run.clientId),
        eq(sourceAcquisitionJob.monitoringRunId, run.id),
      ));
    const failed = jobs.some((job) => job.status === "failed" || job.status === "cancelled");
    const succeeded = jobs.length > 0 && jobs.every((job) => job.status === "succeeded");
    const running = jobs.some((job) => job.status === "running");
    if (!failed && !succeeded && !(running && run.status === "queued")) continue;
    const receipts = !succeeded ? [] : await db.select({ acquiredCount: sourceAcquisitionReceipt.acquiredCount }).from(sourceAcquisitionReceipt).where(and(
      eq(sourceAcquisitionReceipt.clientId, run.clientId), inArray(sourceAcquisitionReceipt.jobId, jobs.map((job) => job.id)),
    ));
    const noMaterialChange = succeeded && receipts.length === jobs.length && receipts.every((receipt) => receipt.acquiredCount === 0);
    await db
      .update(monitoringRun)
      .set(failed
        ? { status: "failed", outcome: "source_health_failure", finishedAt: now }
        : succeeded
          ? { status: "succeeded", outcome: noMaterialChange ? "no_material_change" : "acquisition_complete_pending_qualification", finishedAt: now }
          : { status: "running", startedAt: run.startedAt ?? now })
      .where(and(eq(monitoringRun.id, run.id), eq(monitoringRun.clientId, run.clientId)));
    changed += 1;
  }
  return changed;
}

function monitoringObservation(row: {
  observation: typeof quantitativeObservation.$inferSelect;
  evidence: typeof canonicalEvidence.$inferSelect;
  sourceClass: typeof sourceConnection.$inferSelect.sourceClass;
}): MonitoringObservation {
  return {
    evidenceId: String(row.evidence.id),
    clientId: String(row.observation.clientId),
    sourceConnectionId: String(row.evidence.sourceConnectionId),
    sourceClass: row.sourceClass as SourceClass,
    metricKey: row.observation.metricKey,
    value: row.observation.value,
    unit: row.observation.unit,
    observedAt: row.observation.observedAt.toISOString(),
    dimensions: row.observation.dimensionsJson as Readonly<Record<string, string>>,
    cohortSize: row.observation.cohortSize ?? undefined,
    confidence: row.evidence.confidence,
    applicability: row.evidence.applicabilityJson as Applicability,
    suppressed: row.observation.suppressed,
  };
}

/** Converts completed acquisitions into auditable, pending-review signals. */
export async function qualifyPendingMonitoringRuns(now = new Date(), clientId?: number): Promise<number> {
  const pending = await db.select({ id: monitoringRun.id, clientId: monitoringRun.clientId }).from(monitoringRun).where(
    clientId
      ? and(eq(monitoringRun.clientId, clientId), eq(monitoringRun.status, "succeeded"), eq(monitoringRun.outcome, "acquisition_complete_pending_qualification"))
      : and(eq(monitoringRun.status, "succeeded"), eq(monitoringRun.outcome, "acquisition_complete_pending_qualification")),
  );
  let qualifiedRuns = 0;

  for (const pendingRun of pending) {
    const changed = await db.transaction(async (tx): Promise<boolean> => {
      await tx.execute(sql`select pg_advisory_xact_lock(73004, ${pendingRun.id})`);
      const [run] = await tx.select().from(monitoringRun).where(and(
        eq(monitoringRun.id, pendingRun.id),
        eq(monitoringRun.clientId, pendingRun.clientId),
        eq(monitoringRun.status, "succeeded"),
        eq(monitoringRun.outcome, "acquisition_complete_pending_qualification"),
      )).limit(1);
      if (!run) return false;
      const [profileRow] = await tx.select().from(sensingProfile).where(and(
        eq(sensingProfile.id, run.sensingProfileId), eq(sensingProfile.clientId, run.clientId),
      )).limit(1);
      if (!profileRow) throw new Error("monitoring-profile-not-found");
      const profile = canonicalProfile(profileRow);
      const jobs = await tx.select({ id: sourceAcquisitionJob.id }).from(sourceAcquisitionJob).where(and(
        eq(sourceAcquisitionJob.clientId, run.clientId), eq(sourceAcquisitionJob.monitoringRunId, run.id),
      ));
      if (jobs.length === 0) throw new Error("monitoring-acquisition-jobs-not-found");

      const currentRows = await tx.select({
        observation: quantitativeObservation,
        evidence: canonicalEvidence,
        sourceClass: sourceConnection.sourceClass,
      }).from(quantitativeObservation)
        .innerJoin(canonicalEvidence, and(
          eq(canonicalEvidence.id, quantitativeObservation.evidenceId),
          eq(canonicalEvidence.clientId, quantitativeObservation.clientId),
        ))
        .innerJoin(evidenceCollection, and(
          eq(evidenceCollection.id, canonicalEvidence.collectionId),
          eq(evidenceCollection.clientId, canonicalEvidence.clientId),
        ))
        .innerJoin(sourceConnection, and(
          eq(sourceConnection.id, canonicalEvidence.sourceConnectionId),
          eq(sourceConnection.clientId, canonicalEvidence.clientId),
        ))
        .where(and(
          eq(quantitativeObservation.clientId, run.clientId),
          inArray(evidenceCollection.acquisitionJobId, jobs.map((job) => job.id)),
        ));
      const current = currentRows.map(monitoringObservation);
      const metricKeys = [...new Set(current.map((item) => item.metricKey))];
      const historyRows = metricKeys.length === 0 ? [] : await tx.select({
        observation: quantitativeObservation,
        evidence: canonicalEvidence,
        sourceClass: sourceConnection.sourceClass,
      }).from(quantitativeObservation)
        .innerJoin(canonicalEvidence, and(
          eq(canonicalEvidence.id, quantitativeObservation.evidenceId),
          eq(canonicalEvidence.clientId, quantitativeObservation.clientId),
        ))
        .innerJoin(sourceConnection, and(
          eq(sourceConnection.id, canonicalEvidence.sourceConnectionId),
          eq(sourceConnection.clientId, canonicalEvidence.clientId),
        ))
        .where(and(
          eq(quantitativeObservation.clientId, run.clientId),
          eq(quantitativeObservation.suppressed, false),
          inArray(quantitativeObservation.metricKey, metricKeys),
        ))
        .orderBy(desc(quantitativeObservation.observedAt))
        .limit(5000);
      const currentEvidenceIds = new Set(current.map((item) => item.evidenceId));
      const history = historyRows.map(monitoringObservation).filter((item) => !currentEvidenceIds.has(item.evidenceId));
      const candidates = buildQuantitativeSignalCandidates({ clientId: String(run.clientId), current, history });
      const result = qualifySignals({ profile, candidates, now: now.toISOString(), sourceHealthOk: true });
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const signalIds: number[] = [];

      for (const qualification of result.qualifications.filter((item) => item.qualified)) {
        const candidate = byId.get(qualification.signalId);
        if (!candidate || candidate.baselineValue === undefined) throw new Error("qualified-signal-candidate-missing");
        const statement = `${candidate.theme} changed from ${candidate.baselineValue.toFixed(2)} ${candidate.unit} to ${candidate.currentValue.toFixed(2)} ${candidate.unit}; relative materiality ${(qualification.materiality * 100).toFixed(1)}% across ${candidate.sourceIds.length} source(s).`;
        const contract: IntelligenceRecord<"signal"> = {
          id: "pending",
          clientId: String(run.clientId),
          kind: "signal",
          title: `Monitoring signal: ${candidate.theme}`,
          statement,
          lifecycle: "candidate",
          reviewState: "pending",
          evidenceIds: candidate.evidenceIds,
          contradictionIds: [],
          dependencyIds: [],
          applicability: candidate.applicability,
          confidence: candidate.confidence,
          uncertainty: ["Automatically qualified from aggregate observations; human review is required before use.", "The detected association is not a causal claim."],
          synthesisBy: "model",
          createdAt: now.toISOString(),
          decayAt: new Date(now.getTime() + profile.freshnessDays * 86_400_000).toISOString(),
        };
        const validation = validateIntelligenceRecord(contract);
        if (!validation.valid) throw new Error(`invalid-monitoring-signal:${validation.errors.join(";")}`);
        const [created] = await tx.insert(intelligenceRecord).values({
          clientId: run.clientId,
          kind: "signal",
          title: contract.title,
          statement: contract.statement,
          lifecycle: "candidate",
          reviewState: "pending",
          evidenceIds: candidate.evidenceIds.map(Number),
          contradictionIds: [],
          dependencyIds: [],
          applicabilityJson: candidate.applicability,
          confidence: candidate.confidence,
          uncertainty: [...contract.uncertainty],
          synthesisBy: "model",
          createdAt: now,
          decayAt: new Date(contract.decayAt!),
        }).returning({ id: intelligenceRecord.id });
        signalIds.push(created.id);
      }

      const evidenceIds = [...new Set(candidates.flatMap((candidate) => candidate.evidenceIds.map(Number)))];
      await tx.insert(researchArtifact).values({
        clientId: run.clientId,
        artifactKey: `monitoring-run:${run.id}:qualification`,
        artifactType: "monitoring_qualification",
        abilityKey: "continuous-sensing",
        abilityVersion: "1.0.0",
        status: result.outcome,
        version: 1,
        payloadJson: {
          monitoringRunId: run.id,
          profileId: run.sensingProfileId,
          evaluatedAt: now.toISOString(),
          outcome: result.outcome,
          message: result.message,
          briefingType: result.briefingType,
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            theme: candidate.theme,
            metricKey: candidate.metricKey,
            unit: candidate.unit,
            currentValue: candidate.currentValue,
            baselineValue: candidate.baselineValue,
            confidence: candidate.confidence,
            observedAt: candidate.observedAt,
            sourceIds: candidate.sourceIds,
            sampleSize: candidate.sampleSize,
            evidenceIds: candidate.evidenceIds,
          })),
          qualifications: result.qualifications,
        },
        evidenceIds,
      });
      await tx.update(monitoringRun).set({
        outcome: result.outcome,
        qualifiedSignalIds: signalIds,
        finishedAt: now,
      }).where(and(eq(monitoringRun.id, run.id), eq(monitoringRun.clientId, run.clientId)));
      return true;
    });
    if (changed) qualifiedRuns += 1;
  }
  return qualifiedRuns;
}

