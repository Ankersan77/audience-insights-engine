import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/src/db/client";
import { canonicalEvidence, evidenceCollection, sourceAcquisitionJob, sourceAcquisitionReceipt, sourceConnection } from "@/src/db/schema";
import type { RightsDeclaration, SourceClass, SourceConnectionPolicy } from "@/src/core/contracts";
import { readSourceConnectionPolicy } from "@/src/connectors/sourcePolicy";

export type SourceConnectionListRow = {
  id: number;
  connectorId: string;
  connectorVersion: string;
  sourceClass: SourceClass;
  health: "configured" | "verified" | "degraded" | "unavailable" | "producing_evidence";
  hasCredentialReference: boolean;
  rights: RightsDeclaration;
  policy: SourceConnectionPolicy;
  retentionDays: number;
  rawRetentionHours: number;
  lastSuccessfulReceiptAt: Date | null;
};

export async function listSourceConnections(clientId: number): Promise<SourceConnectionListRow[]> {
  const rows = await db
    .select({
      id: sourceConnection.id,
      connectorId: sourceConnection.connectorId,
      connectorVersion: sourceConnection.connectorVersion,
      sourceClass: sourceConnection.sourceClass,
      health: sourceConnection.health,
      credentialRef: sourceConnection.credentialRef,
      rights: sourceConnection.rightsJson,
      configuration: sourceConnection.configurationJson,
      retentionDays: sourceConnection.retentionDays,
      rawRetentionHours: sourceConnection.rawRetentionHours,
      lastSuccessfulReceiptAt: sourceConnection.lastSuccessfulReceiptAt,
    })
    .from(sourceConnection)
    .where(eq(sourceConnection.clientId, clientId))
    .orderBy(asc(sourceConnection.connectorId));

  return rows.map(({ credentialRef, configuration, ...row }) => ({
    ...row,
    sourceClass: row.sourceClass as SourceClass,
    hasCredentialReference: Boolean(credentialRef),
    rights: row.rights as RightsDeclaration,
    policy: readSourceConnectionPolicy(configuration),
  }));
}

export async function getSourceConnection(clientId: number, id: number) {
  const [row] = await db
    .select()
    .from(sourceConnection)
    .where(and(eq(sourceConnection.clientId, clientId), eq(sourceConnection.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createSourceConnection(input: {
  clientId: number;
  connectorId: string;
  connectorVersion: string;
  sourceClass: SourceClass;
  credentialRef?: string;
  rights: RightsDeclaration;
  policy: SourceConnectionPolicy;
  retentionDays: number;
  rawRetentionHours: number;
}) {
  const [created] = await db
    .insert(sourceConnection)
    .values({
      clientId: input.clientId,
      connectorId: input.connectorId,
      connectorVersion: input.connectorVersion,
      sourceClass: input.sourceClass,
      credentialRef: input.credentialRef || null,
      configurationJson: input.policy,
      rightsJson: input.rights,
      retentionDays: input.retentionDays,
      rawRetentionHours: input.rawRetentionHours,
      health: "configured",
    })
    .returning();
  return created;
}

/** Revokes future collection immediately and makes retained source material due for tombstoning. */
export async function revokeSourceConnection(input: { clientId: number; id: number; now: Date }) {
  return db.transaction(async (tx) => {
    const [source] = await tx.update(sourceConnection).set({ health: "unavailable" }).where(and(
      eq(sourceConnection.id, input.id), eq(sourceConnection.clientId, input.clientId),
    )).returning({ id: sourceConnection.id });
    if (!source) return null;
    const cancelledJobs = await tx.update(sourceAcquisitionJob).set({ status: "cancelled", cancelledAt: input.now, finishedAt: input.now }).where(and(
      eq(sourceAcquisitionJob.clientId, input.clientId), eq(sourceAcquisitionJob.sourceConnectionId, input.id),
      inArray(sourceAcquisitionJob.status, ["queued", "running"]),
    )).returning({ id: sourceAcquisitionJob.id });
    if (cancelledJobs.length > 0) {
      await tx.insert(sourceAcquisitionReceipt).values(cancelledJobs.map((job) => ({
        clientId: input.clientId, jobId: job.id, status: "cancelled" as const, acquiredCount: 0, rejectedCount: 0,
        safeArtifactRefs: [], errorCode: "source-revoked", completedAt: input.now,
      }))).onConflictDoNothing({ target: sourceAcquisitionReceipt.jobId });
    }
    const expiringEvidence = await tx.update(canonicalEvidence).set({ expiresAt: input.now }).where(and(
      eq(canonicalEvidence.clientId, input.clientId), eq(canonicalEvidence.sourceConnectionId, input.id),
      inArray(canonicalEvidence.lifecycle, ["candidate", "live", "quarantined"]),
    )).returning({ id: canonicalEvidence.id });
    const expiringCollections = await tx.update(evidenceCollection).set({ expiresAt: input.now }).where(and(
      eq(evidenceCollection.clientId, input.clientId), eq(evidenceCollection.sourceConnectionId, input.id),
      inArray(evidenceCollection.lifecycle, ["candidate", "live", "quarantined"]),
    )).returning({ id: evidenceCollection.id });
    return { cancelledJobs: cancelledJobs.length, evidenceDueForExpiry: expiringEvidence.length, collectionsDueForExpiry: expiringCollections.length };
  });
}

