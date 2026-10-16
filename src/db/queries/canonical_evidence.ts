import { and, desc, eq, inArray } from "drizzle-orm";
import type { Applicability, EvidenceItem, MethodDeclaration, RightsDeclaration, SourceClass } from "@/src/core/contracts";
import { validateEvidenceItem } from "@/src/core/validation";
import { db } from "@/src/db/client";
import {
  canonicalEvidence,
  evidenceCollection,
  sourceAcquisitionJob,
  sourceAcquisitionReceipt,
  sourceConnection,
} from "@/src/db/schema";
import type { AdapterRunResult } from "@/src/evidence/sdk";

export type CanonicalEvidenceListRow = {
  id: number;
  sourceConnectionId: number;
  connectorId: string;
  sourceClass: SourceClass;
  externalReference: string;
  sourceContent: string;
  synthesis: string | null;
  citationLevel: "statistical" | "paraphrased" | "verbatim";
  lifecycle: "candidate" | "live" | "quarantined" | "expired" | "superseded";
  grade: string;
  confidence: number;
  sensitive: boolean;
  identityRisk: boolean;
  redactions: string[];
  ingestedAt: Date;
  expiresAt: Date;
};

export async function listCanonicalEvidence(clientId: number, limit = 50): Promise<CanonicalEvidenceListRow[]> {
  return db
    .select({
      id: canonicalEvidence.id,
      sourceConnectionId: canonicalEvidence.sourceConnectionId,
      connectorId: sourceConnection.connectorId,
      sourceClass: sourceConnection.sourceClass,
      externalReference: canonicalEvidence.externalReference,
      sourceContent: canonicalEvidence.sourceContent,
      synthesis: canonicalEvidence.synthesis,
      citationLevel: canonicalEvidence.citationLevel,
      lifecycle: canonicalEvidence.lifecycle,
      grade: canonicalEvidence.grade,
      confidence: canonicalEvidence.confidence,
      sensitive: canonicalEvidence.sensitive,
      identityRisk: canonicalEvidence.identityRisk,
      redactions: canonicalEvidence.redactions,
      ingestedAt: canonicalEvidence.ingestedAt,
      expiresAt: canonicalEvidence.expiresAt,
    })
    .from(canonicalEvidence)
    .innerJoin(
      sourceConnection,
      and(
        eq(sourceConnection.id, canonicalEvidence.sourceConnectionId),
        eq(sourceConnection.clientId, canonicalEvidence.clientId),
      ),
    )
    .where(eq(canonicalEvidence.clientId, clientId))
    .orderBy(desc(canonicalEvidence.id))
    .limit(Math.min(Math.max(limit, 1), 200)) as Promise<CanonicalEvidenceListRow[]>;
}

export async function loadEvidenceItems(clientId: number, evidenceIds?: readonly number[]): Promise<EvidenceItem[]> {
  const conditions = [eq(canonicalEvidence.clientId, clientId)];
  if (evidenceIds) {
    if (evidenceIds.length === 0) return [];
    conditions.push(inArray(canonicalEvidence.id, [...evidenceIds]));
  }
  const rows = await db
    .select({ evidence: canonicalEvidence, sourceClass: sourceConnection.sourceClass })
    .from(canonicalEvidence)
    .innerJoin(
      sourceConnection,
      and(
        eq(sourceConnection.id, canonicalEvidence.sourceConnectionId),
        eq(sourceConnection.clientId, canonicalEvidence.clientId),
      ),
    )
    .where(and(...conditions));
  return rows.map(({ evidence: row, sourceClass }) => ({
    id: String(row.id),
    clientId: String(row.clientId),
    collectionId: String(row.collectionId),
    sourceConnectionId: String(row.sourceConnectionId),
    sourceClass: sourceClass as SourceClass,
    externalReference: row.externalReference,
    sourceUrl: row.safeSourceUrl ?? undefined,
    sourceContent: row.sourceContent,
    synthesis: row.synthesis ?? undefined,
    publishedAt: row.publishedAt?.toISOString(),
    observedAt: row.observedAt?.toISOString(),
    ingestedAt: row.ingestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lifecycle: row.lifecycle,
    citationLevel: row.citationLevel,
    rights: row.rightsJson as RightsDeclaration,
    method: row.methodJson as MethodDeclaration,
    applicability: row.applicabilityJson as Applicability,
    confidence: row.confidence,
    grade: row.grade as EvidenceItem["grade"],
    sensitive: row.sensitive,
    identityRisk: row.identityRisk,
    redactions: row.redactions,
    contentHash: row.contentHash,
  }));
}

export type PersistAcquisitionInput = {
  clientId: number;
  sourceConnectionId: number;
  operation: string;
  request: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
  title: string;
  method: MethodDeclaration;
  rights: RightsDeclaration;
  applicability: Applicability;
  collectionExpiresAt: string;
  result: AdapterRunResult;
};

export type PersistAcquisitionResult = {
  jobId: number;
  collectionId: number | null;
  evidenceIds: readonly number[];
  replayed: boolean;
};

function assertEvidenceScope(item: EvidenceItem, input: PersistAcquisitionInput): void {
  if (item.clientId !== String(input.clientId)) throw new Error("cross-client-evidence-rejected");
  if (item.sourceConnectionId !== String(input.sourceConnectionId)) throw new Error("source-scope-mismatch");
  const validation = validateEvidenceItem(item);
  if (!validation.valid) throw new Error(`invalid-evidence:${validation.errors.join(";")}`);
}

/**
 * Persists one completed adapter run atomically. Raw provider payloads are not
 * accepted by this boundary; only canonical evidence and a redacted receipt
 * can enter the transaction.
 */
export async function persistAcquisition(input: PersistAcquisitionInput): Promise<PersistAcquisitionResult> {
  if (!input.idempotencyKey.trim()) throw new Error("idempotency-key-required");
  input.result.evidence.forEach((item) => assertEvidenceScope(item, input));

  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({ id: sourceConnection.id })
      .from(sourceConnection)
      .where(and(eq(sourceConnection.id, input.sourceConnectionId), eq(sourceConnection.clientId, input.clientId)))
      .limit(1);
    if (!source) throw new Error("source-connection-not-found");

    const [createdJob] = await tx
      .insert(sourceAcquisitionJob)
      .values({
        clientId: input.clientId,
        sourceConnectionId: input.sourceConnectionId,
        status: "running",
        operation: input.operation,
        requestJson: input.request,
        idempotencyKey: input.idempotencyKey,
        startedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [sourceAcquisitionJob.clientId, sourceAcquisitionJob.idempotencyKey],
      })
      .returning();

    if (!createdJob) {
      const [existingJob] = await tx
        .select({ id: sourceAcquisitionJob.id })
        .from(sourceAcquisitionJob)
        .where(and(
          eq(sourceAcquisitionJob.clientId, input.clientId),
          eq(sourceAcquisitionJob.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (!existingJob) throw new Error("idempotency-replay-not-found");
      return { jobId: existingJob.id, collectionId: null, evidenceIds: [], replayed: true };
    }

    const [collection] = await tx
      .insert(evidenceCollection)
      .values({
        clientId: input.clientId,
        sourceConnectionId: input.sourceConnectionId,
        acquisitionJobId: createdJob.id,
        title: input.title,
        methodJson: input.method,
        rightsJson: input.rights,
        applicabilityJson: input.applicability,
        lifecycle: input.result.evidence.some((item) => item.lifecycle === "candidate") ? "candidate" : "quarantined",
        expiresAt: new Date(input.collectionExpiresAt),
      })
      .returning();

    const inserted = input.result.evidence.length === 0
      ? []
      : await tx
        .insert(canonicalEvidence)
        .values(input.result.evidence.map((item) => ({
          clientId: input.clientId,
          collectionId: collection.id,
          sourceConnectionId: input.sourceConnectionId,
          externalReference: item.externalReference,
          safeSourceUrl: item.sourceUrl,
          sourceContent: item.sourceContent,
          synthesis: item.synthesis,
          contentHash: item.contentHash,
          citationLevel: item.citationLevel,
          lifecycle: item.lifecycle,
          grade: item.grade,
          confidence: item.confidence,
          sensitive: item.sensitive,
          identityRisk: item.identityRisk,
          redactions: [...item.redactions],
          methodJson: item.method,
          rightsJson: item.rights,
          applicabilityJson: item.applicability,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          observedAt: item.observedAt ? new Date(item.observedAt) : null,
          ingestedAt: new Date(item.ingestedAt),
          expiresAt: new Date(item.expiresAt),
        })))
        .onConflictDoNothing({
          target: [canonicalEvidence.clientId, canonicalEvidence.sourceConnectionId, canonicalEvidence.contentHash],
        })
        .returning({ id: canonicalEvidence.id });

    const finishedAt = new Date(input.result.receipt.completedAt ?? Date.now());
    await tx.insert(sourceAcquisitionReceipt).values({
      clientId: input.clientId,
      jobId: createdJob.id,
      status: input.result.receipt.status,
      acquiredCount: input.result.receipt.acquiredCount,
      rejectedCount: input.result.receipt.rejectedCount,
      nextCursor: input.result.receipt.nextCursor,
      safeArtifactRefs: inserted.map((item) => `evidence:${item.id}`),
      errorCode: input.result.receipt.errorCode,
      completedAt: finishedAt,
    });
    await tx
      .update(sourceAcquisitionJob)
      .set({ status: input.result.receipt.status, finishedAt })
      .where(and(eq(sourceAcquisitionJob.id, createdJob.id), eq(sourceAcquisitionJob.clientId, input.clientId)));
    await tx
      .update(sourceConnection)
      .set({
        health: inserted.length > 0 ? "producing_evidence" : "verified",
        lastSuccessfulReceiptAt: input.result.receipt.status === "succeeded" ? finishedAt : undefined,
      })
      .where(and(eq(sourceConnection.id, input.sourceConnectionId), eq(sourceConnection.clientId, input.clientId)));

    return {
      jobId: createdJob.id,
      collectionId: collection.id,
      evidenceIds: inserted.map((item) => item.id),
      replayed: false,
    };
  });
}

