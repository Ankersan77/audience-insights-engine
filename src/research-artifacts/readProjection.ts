import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { canonicalEvidence, sourceConnection } from "../db/schema";
import { canonicalEvidenceItem } from "../db/queries/canonical_evidence";
import { currentEvidenceUseFailure } from "../evidence/usePolicy";
import { redactExpiredCitationCopies } from "../operations/retention";
import { assertResearchArtifactBounds } from "./persistenceBounds";

export const MAX_RESEARCH_ARTIFACTS_PER_PROJECTION = 100;
export const ARTIFACT_BASIS_UNAVAILABLE_GAP = "Supporting evidence is no longer usable under the current source policy.";

export type ResearchArtifactReadRow<T> = {
  clientId: number;
  payloadJson: T;
  evidenceIds: readonly number[];
};

export type ResearchArtifactReadProjection<T> = {
  payload: T;
  basisStatus: "current" | "stale";
  unavailableEvidenceIds: readonly number[];
  quarantined: boolean;
};

const QUARANTINED_ARTIFACT_PAYLOAD = Object.freeze({
  contract: "retention-redacted-artifact@1",
  status: "needs_context",
  message: "Artifact content is unavailable under the current retention and resource policy.",
});

function isRetentionQuarantineEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const envelope = value as { contract?: unknown; kind?: unknown };
  return envelope.contract === QUARANTINED_ARTIFACT_PAYLOAD.contract
    || envelope.kind === QUARANTINED_ARTIFACT_PAYLOAD.contract;
}

export function projectResearchArtifactPayload<T>(payload: T, unavailableEvidenceIds: readonly number[]): T {
  if (unavailableEvidenceIds.length === 0) return payload;
  // Run the common redactor before replacing the payload so no future caller can
  // accidentally reintroduce copied content from a partially projected object.
  redactExpiredCitationCopies(payload, new Set(unavailableEvidenceIds.map(String)));
  return QUARANTINED_ARTIFACT_PAYLOAD as T;
}

/**
 * Applies one tenant-scoped, current-policy projection to a bounded artifact page.
 * Missing evidence fails closed alongside explicitly expired or revoked evidence.
 */
export async function projectTenantResearchArtifacts<T>(
  clientId: number,
  rows: readonly ResearchArtifactReadRow<T>[],
  now = new Date(),
): Promise<ResearchArtifactReadProjection<T>[]> {
  if (!Number.isSafeInteger(clientId) || clientId <= 0) throw new Error("invalid-artifact-client");
  if (!Number.isFinite(now.getTime())) throw new Error("invalid-artifact-read-time");
  if (rows.length > MAX_RESEARCH_ARTIFACTS_PER_PROJECTION) throw new Error("research-artifact-read-limit-exceeded");
  for (const row of rows) if (row.clientId !== clientId) throw new Error("research-artifact-client-mismatch");

  const readable = rows.map((row) => {
    try {
      if (isRetentionQuarantineEnvelope(row.payloadJson)) return false;
      assertResearchArtifactBounds(row.payloadJson, row.evidenceIds);
      return true;
    } catch {
      return false;
    }
  });

  const referencedEvidenceIds = [...new Set(rows.flatMap((row, index) => readable[index] ? [...row.evidenceIds] : []))];
  const availableEvidenceIds = new Set<number>();
  if (referencedEvidenceIds.length > 0) {
    const evidence = await db.select({ evidence: canonicalEvidence, source: sourceConnection }).from(canonicalEvidence)
      .innerJoin(sourceConnection, and(
        eq(sourceConnection.id, canonicalEvidence.sourceConnectionId),
        eq(sourceConnection.clientId, canonicalEvidence.clientId),
      ))
      .where(and(eq(canonicalEvidence.clientId, clientId), inArray(canonicalEvidence.id, referencedEvidenceIds)));

    for (const item of evidence) {
      const domain = canonicalEvidenceItem({ evidence: item.evidence, sourceClass: item.source.sourceClass });
      if (!currentEvidenceUseFailure({ clientId, evidence: domain, source: item.source, now })) {
        availableEvidenceIds.add(item.evidence.id);
      }
    }
  }

  return rows.map((row, index) => {
    if (!readable[index]) {
      return {
        payload: QUARANTINED_ARTIFACT_PAYLOAD as T,
        basisStatus: "stale" as const,
        unavailableEvidenceIds: [],
        quarantined: true,
      };
    }
    const unavailableEvidenceIds = [...new Set(row.evidenceIds.filter((id) => !availableEvidenceIds.has(id)))];
    if (unavailableEvidenceIds.length > 0) {
      return {
        payload: projectResearchArtifactPayload(row.payloadJson, unavailableEvidenceIds),
        basisStatus: "stale" as const,
        unavailableEvidenceIds,
        quarantined: true,
      };
    }
    return {
      payload: row.payloadJson,
      basisStatus: "current" as const,
      unavailableEvidenceIds,
      quarantined: false,
    };
  });
}
