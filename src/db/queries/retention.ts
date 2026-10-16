import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/src/db/client";
import {
  canonicalEvidence,
  citation,
  evidenceCollection,
  governanceAudit,
  intelligenceRecord,
  qualitativeTheme,
  quantitativeObservation,
  researchArtifact,
} from "@/src/db/schema";
import { redactExpiredCitationCopies, tombstoneEvidence } from "@/src/operations/retention";

export type CanonicalRetentionSummary = {
  evidenceExpired: number;
  collectionsExpired: number;
  observationsRemoved: number;
  themesRemoved: number;
  artifactCitationsRedacted: number;
  intelligenceDecayed: number;
};

/**
 * Enforces canonical expiry without breaking historical lineage. Source
 * content and copied citations are removed; minimal tombstones and audit
 * records remain so past decisions do not become untraceable.
 */
export async function enforceCanonicalRetention(now = new Date(), clientId?: number): Promise<CanonicalRetentionSummary> {
  return db.transaction(async (tx) => {
    const expiredEvidence = await tx.select({
      id: canonicalEvidence.id,
      clientId: canonicalEvidence.clientId,
      externalReference: canonicalEvidence.externalReference,
      sourceContent: canonicalEvidence.sourceContent,
      synthesis: canonicalEvidence.synthesis,
      contentHash: canonicalEvidence.contentHash,
      redactions: canonicalEvidence.redactions,
    }).from(canonicalEvidence).where(
      clientId
        ? and(eq(canonicalEvidence.clientId, clientId), lte(canonicalEvidence.expiresAt, now), inArray(canonicalEvidence.lifecycle, ["candidate", "live", "quarantined"]))
        : and(lte(canonicalEvidence.expiresAt, now), inArray(canonicalEvidence.lifecycle, ["candidate", "live", "quarantined"])),
    ).limit(1000);
    const evidenceIds = expiredEvidence.map((item) => item.id);
    const affectedClientIds = [...new Set(expiredEvidence.map((item) => item.clientId))];
    let observationsRemoved = 0;
    let themesRemoved = 0;
    let artifactCitationsRedacted = 0;

    if (evidenceIds.length > 0) {
      const observations = await tx.delete(quantitativeObservation).where(and(
        inArray(quantitativeObservation.evidenceId, evidenceIds),
        clientId ? eq(quantitativeObservation.clientId, clientId) : undefined,
      )).returning({ id: quantitativeObservation.id });
      observationsRemoved = observations.length;

      const themes = await tx.select({ id: qualitativeTheme.id, evidenceIds: qualitativeTheme.evidenceIds }).from(qualitativeTheme).where(
        clientId ? eq(qualitativeTheme.clientId, clientId) : inArray(qualitativeTheme.clientId, affectedClientIds),
      );
      const expiredIdSet = new Set(evidenceIds);
      const themeIds = themes.filter((theme) => theme.evidenceIds.some((id) => expiredIdSet.has(id))).map((theme) => theme.id);
      if (themeIds.length > 0) {
        themesRemoved = (await tx.delete(qualitativeTheme).where(inArray(qualitativeTheme.id, themeIds)).returning({ id: qualitativeTheme.id })).length;
      }

      await tx.update(citation).set({
        safeReference: "[expired evidence]",
        excerpt: null,
        reviewReason: "Referenced evidence expired under its retention policy.",
        expiresAt: now,
      }).where(inArray(citation.evidenceId, evidenceIds));

      const artifacts = await tx.select({
        id: researchArtifact.id,
        payloadJson: researchArtifact.payloadJson,
        evidenceIds: researchArtifact.evidenceIds,
      }).from(researchArtifact).where(
        clientId ? eq(researchArtifact.clientId, clientId) : inArray(researchArtifact.clientId, affectedClientIds),
      );
      const expiredStringIds = new Set(evidenceIds.map(String));
      for (const artifact of artifacts) {
        if (!artifact.evidenceIds.some((id) => expiredIdSet.has(id))) continue;
        const redacted = redactExpiredCitationCopies(artifact.payloadJson, expiredStringIds);
        if (JSON.stringify(redacted) === JSON.stringify(artifact.payloadJson)) continue;
        await tx.update(researchArtifact).set({ payloadJson: redacted }).where(eq(researchArtifact.id, artifact.id));
        artifactCitationsRedacted += 1;
      }

      for (const item of expiredEvidence) {
        await tx.update(canonicalEvidence).set(tombstoneEvidence(item)).where(and(
          eq(canonicalEvidence.id, item.id), eq(canonicalEvidence.clientId, item.clientId),
        ));
      }
    }

    const expiredCollections = await tx.select({ id: evidenceCollection.id, clientId: evidenceCollection.clientId }).from(evidenceCollection).where(
      clientId
        ? and(eq(evidenceCollection.clientId, clientId), lte(evidenceCollection.expiresAt, now), inArray(evidenceCollection.lifecycle, ["candidate", "live", "quarantined"]))
        : and(lte(evidenceCollection.expiresAt, now), inArray(evidenceCollection.lifecycle, ["candidate", "live", "quarantined"])),
    ).limit(1000);
    for (const collection of expiredCollections) {
      await tx.update(evidenceCollection).set({
        lifecycle: "expired",
        title: `[expired collection ${collection.id}]`,
      }).where(and(eq(evidenceCollection.id, collection.id), eq(evidenceCollection.clientId, collection.clientId)));
    }

    const decayed = await tx.select({ id: intelligenceRecord.id, clientId: intelligenceRecord.clientId }).from(intelligenceRecord).where(
      clientId
        ? and(eq(intelligenceRecord.clientId, clientId), lte(intelligenceRecord.decayAt, now), inArray(intelligenceRecord.lifecycle, ["candidate", "live"]))
        : and(lte(intelligenceRecord.decayAt, now), inArray(intelligenceRecord.lifecycle, ["candidate", "live"])),
    ).limit(1000);
    if (decayed.length > 0) {
      await tx.update(intelligenceRecord).set({ lifecycle: "expired" }).where(inArray(intelligenceRecord.id, decayed.map((item) => item.id)));
    }

    const auditClientIds = [...new Set([
      ...affectedClientIds,
      ...expiredCollections.map((item) => item.clientId),
      ...decayed.map((item) => item.clientId),
    ])];
    for (const auditClientId of auditClientIds) {
      const clientEvidence = expiredEvidence.filter((item) => item.clientId === auditClientId).length;
      const clientCollections = expiredCollections.filter((item) => item.clientId === auditClientId).length;
      const clientIntelligence = decayed.filter((item) => item.clientId === auditClientId).length;
      await tx.insert(governanceAudit).values({
        clientId: auditClientId,
        action: "retention_enforced",
        entityType: "canonical_retention_batch",
        entityId: now.toISOString(),
        redactedAfterJson: {
          evidenceExpired: clientEvidence,
          collectionsExpired: clientCollections,
          intelligenceDecayed: clientIntelligence,
        },
        createdAt: now,
      });
    }

    return {
      evidenceExpired: expiredEvidence.length,
      collectionsExpired: expiredCollections.length,
      observationsRemoved,
      themesRemoved,
      artifactCitationsRedacted,
      intelligenceDecayed: decayed.length,
    };
  });
}
