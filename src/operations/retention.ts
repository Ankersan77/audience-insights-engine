import { createHash } from "node:crypto";

export type EvidenceRetentionMaterial = {
  id: number;
  externalReference: string;
  sourceContent: string;
  synthesis: string | null;
  contentHash: string;
  redactions: readonly string[];
};

export function tombstoneEvidence(item: EvidenceRetentionMaterial) {
  return {
    externalReference: `expired:${item.id}`,
    safeSourceUrl: null,
    sourceContent: "[expired: retained evidence content removed]",
    synthesis: null,
    contentHash: createHash("sha256").update(`expired-evidence:${item.id}`).digest("hex"),
    lifecycle: "expired" as const,
    sensitive: false,
    identityRisk: false,
    redactions: [...new Set([...item.redactions, "retention-expired"])],
  };
}

type JsonObject = Record<string, unknown>;

/** Removes copied citation wording and source references for expired evidence. */
export function redactExpiredCitationCopies(value: unknown, expiredEvidenceIds: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactExpiredCitationCopies(item, expiredEvidenceIds));
  if (!value || typeof value !== "object") return value;
  const object = value as JsonObject;
  if (object.kind === "campaign-metric-comparison@1" && [object.baselineEvidenceId, object.resultEvidenceId].some((id) => typeof id === "string" && expiredEvidenceIds.has(id))) {
    return { kind: object.kind, metricKey: object.metricKey, baselineEvidenceId: object.baselineEvidenceId, resultEvidenceId: object.resultEvidenceId, expired: true };
  }
  const expiredCitation = typeof object.evidenceId === "string" && expiredEvidenceIds.has(object.evidenceId);
  const redacted: JsonObject = {};
  for (const [key, nested] of Object.entries(object)) {
    if (expiredCitation && key === "excerpt") continue;
    if (expiredCitation && key === "safeReference") {
      redacted[key] = "[expired evidence]";
      continue;
    }
    redacted[key] = redactExpiredCitationCopies(nested, expiredEvidenceIds);
  }
  return redacted;
}
