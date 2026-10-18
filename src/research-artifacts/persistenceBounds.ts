export const MAX_RESEARCH_ARTIFACT_PAYLOAD_BYTES = 256 * 1024;
export const MAX_RESEARCH_ARTIFACT_EVIDENCE_REFERENCES = 100;

export function researchArtifactPayloadBytes(payload: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error("research-artifact-payload-invalid");
  }
  if (serialized === undefined) throw new Error("research-artifact-payload-invalid");
  return new TextEncoder().encode(serialized).byteLength;
}

/** Enforces the canonical limits immediately before a research-artifact write. */
export function assertResearchArtifactBounds(payload: unknown, evidenceIds: readonly unknown[]): void {
  if (evidenceIds.length > MAX_RESEARCH_ARTIFACT_EVIDENCE_REFERENCES) {
    throw new Error("research-artifact-evidence-limit-exceeded");
  }
  if (researchArtifactPayloadBytes(payload) > MAX_RESEARCH_ARTIFACT_PAYLOAD_BYTES) {
    throw new Error("research-artifact-payload-too-large");
  }
}

/** The single value-construction boundary for every durable research-artifact insert. */
export function boundedResearchArtifactValues<T extends { payloadJson: unknown; evidenceIds: readonly unknown[] }>(values: T): T {
  assertResearchArtifactBounds(values.payloadJson, values.evidenceIds);
  return values;
}
