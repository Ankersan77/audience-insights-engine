import type { EvidenceItem, RightsDeclaration, SourceClass, SourceConnectionPolicy } from "../core/contracts.ts";
import { readSourceConnectionPolicy, sourceClassification, sourcePolicyFailure } from "../connectors/sourcePolicy.ts";
import { resolveEvidence } from "../market-twin/resolver.ts";

const CURRENT_USE_REQUIREMENTS = [{
  sourceClasses: ["client_owned", "first_party_aggregate", "commissioned_or_licensed", "official_or_public", "public_conversation", "primary_research"] as const,
  minimumItems: 0,
  minimumSourceDiversity: 0,
  minimumGrade: "ungraded" as const,
  requiredDimensions: [],
}];

export type CurrentEvidenceSource = {
  sourceClass: string;
  health: string;
  revokedAt?: Date | null;
  rightsJson: unknown;
  configurationJson: unknown;
};

export function currentEvidenceUseFailure(input: {
  clientId: number;
  evidence: EvidenceItem;
  source: CurrentEvidenceSource;
  now: Date;
}): string | null {
  if (!Number.isFinite(input.now.getTime())) return "evidence-use-time-invalid";
  if (input.source.revokedAt) return "source-revoked";
  const sourceFailure = sourcePolicyFailure({
    health: input.source.health,
    rights: input.source.rightsJson as RightsDeclaration,
    policy: readSourceConnectionPolicy(input.source.configurationJson) as SourceConnectionPolicy,
    dataClassification: sourceClassification(input.source.sourceClass as SourceClass),
    request: {
      operation: "research",
      filters: {
        markets: input.evidence.applicability.markets,
        languages: input.evidence.applicability.languages,
        purpose: "market-research",
      },
    },
    now: input.now.toISOString(),
  });
  if (sourceFailure) return sourceFailure;
  const resolution = resolveEvidence({
    clientId: String(input.clientId),
    now: input.now.toISOString(),
    requirements: CURRENT_USE_REQUIREMENTS,
    evidence: [input.evidence],
  });
  return resolution.basis[0]?.included ? null : resolution.basis[0]?.reasons.join(",") || "evidence-use-denied";
}
