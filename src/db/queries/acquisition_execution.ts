import { and, asc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { DataClassification, SourceAcquisitionJob as DomainAcquisitionJob, SourceAcquisitionRequest } from "@/src/connectors/contracts";
import type { RightsDeclaration, SourceClass } from "@/src/core/contracts";
import { db } from "@/src/db/client";
import { sourceAcquisitionJob, sourceAcquisitionReceipt, sourceConnection } from "@/src/db/schema";

function classification(sourceClass: SourceClass): DataClassification {
  if (sourceClass === "official_or_public" || sourceClass === "public_conversation") return "public";
  if (sourceClass === "commissioned_or_licensed") return "licensed";
  return "client-confidential";
}

export type ClaimedAcquisition = {
  databaseJobId: number;
  sourceConnectionId: number;
  connectorId: string;
  connectorVersion: string;
  sourceClass: SourceClass;
  configuration: Readonly<Record<string, unknown>>;
  rights: RightsDeclaration;
  retentionDays: number;
  rawRetentionHours: number;
  job: DomainAcquisitionJob;
};

export async function listQueuedAcquisitionJobIds(limit = 100): Promise<number[]> {
  const rows = await db.select({ id: sourceAcquisitionJob.id }).from(sourceAcquisitionJob).where(eq(sourceAcquisitionJob.status, "queued")).orderBy(asc(sourceAcquisitionJob.id)).limit(Math.min(Math.max(limit, 1), 500));
  return rows.map((row) => row.id);
}

export async function listStaleRunningAcquisitions(before: Date, limit = 100): Promise<{ id: number; clientId: number; sourceConnectionId: number }[]> {
  return db.select({ id: sourceAcquisitionJob.id, clientId: sourceAcquisitionJob.clientId, sourceConnectionId: sourceAcquisitionJob.sourceConnectionId })
    .from(sourceAcquisitionJob)
    .where(and(eq(sourceAcquisitionJob.status, "running"), isNotNull(sourceAcquisitionJob.startedAt), lt(sourceAcquisitionJob.startedAt, before)))
    .orderBy(asc(sourceAcquisitionJob.id)).limit(Math.min(Math.max(limit, 1), 500));
}

export async function claimAcquisitionJob(id: number, now = new Date()): Promise<ClaimedAcquisition | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx.update(sourceAcquisitionJob).set({ status: "running", startedAt: now }).where(and(eq(sourceAcquisitionJob.id, id), eq(sourceAcquisitionJob.status, "queued"))).returning();
    if (!job) return null;
    const [source] = await tx.select().from(sourceConnection).where(and(eq(sourceConnection.id, job.sourceConnectionId), eq(sourceConnection.clientId, job.clientId))).limit(1);
    if (!source) throw new Error("source-connection-not-found");
    const sourceClass = source.sourceClass as SourceClass;
    return {
      databaseJobId: job.id,
      sourceConnectionId: source.id,
      connectorId: source.connectorId,
      connectorVersion: source.connectorVersion,
      sourceClass,
      configuration: source.configurationJson as Readonly<Record<string, unknown>>,
      rights: source.rightsJson as RightsDeclaration,
      retentionDays: source.retentionDays,
      rawRetentionHours: source.rawRetentionHours,
      job: {
        id: String(job.id), clientId: String(job.clientId), sourceId: String(source.id), adapterId: source.connectorId,
        credentialRef: source.credentialRef ? { provider: "secret-store", key: source.credentialRef } : undefined,
        dataClassification: classification(sourceClass), request: job.requestJson as SourceAcquisitionRequest,
        idempotencyKey: job.idempotencyKey, requestedAt: job.requestedAt.toISOString(),
      },
    };
  });
}

export async function isAcquisitionCancelled(id: number): Promise<boolean> {
  const [row] = await db.select({ status: sourceAcquisitionJob.status }).from(sourceAcquisitionJob).where(eq(sourceAcquisitionJob.id, id)).limit(1);
  return row?.status === "cancelled";
}

export async function cancelAcquisitionJob(input: { clientId: number; id: number; now: Date }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(sourceAcquisitionJob).set({ status: "cancelled", cancelledAt: input.now, finishedAt: input.now }).where(and(
      eq(sourceAcquisitionJob.id, input.id), eq(sourceAcquisitionJob.clientId, input.clientId),
      inArray(sourceAcquisitionJob.status, ["queued", "running"]),
    )).returning({ id: sourceAcquisitionJob.id, previousStartedAt: sourceAcquisitionJob.startedAt });
    if (!updated) return false;
    const [receipt] = await tx.select({ id: sourceAcquisitionReceipt.id }).from(sourceAcquisitionReceipt).where(eq(sourceAcquisitionReceipt.jobId, input.id)).limit(1);
    if (receipt) return false;
    await tx.insert(sourceAcquisitionReceipt).values({ clientId: input.clientId, jobId: input.id, status: "cancelled", acquiredCount: 0, rejectedCount: 0, safeArtifactRefs: [], errorCode: "cancelled-by-user", completedAt: input.now });
    return true;
  });
}
