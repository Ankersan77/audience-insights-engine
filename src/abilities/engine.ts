import { createHash } from "node:crypto";
import type { Citation, DecisionBrief, EvidenceItem } from "../core/contracts.ts";
import { getAbility } from "./catalog.ts";
import { resolveEvidence } from "../market-twin/resolver.ts";

export type ClaimMode = "attitude" | "behavior" | "demand_proxy" | "causal" | "descriptive";

export type ProposedAnalysis = {
  pointOfView: string;
  clientRelevance: string;
  recommendation: string;
  nextDecision: string;
  claimMode: ClaimMode;
  evidenceIds: readonly string[];
  contradictions: readonly string[];
  uncertainty: readonly string[];
  causalBasis?: { studyId: string; classification: "causal"; reviewed: true };
};

const CAUSAL_LANGUAGE = /\b(caused?|drove|led to|resulted in|incremental lift|because of)\b/i;

function citation(item: EvidenceItem): Citation {
  return {
    id: `citation:${item.id}`,
    clientId: item.clientId,
    evidenceId: item.id,
    level: item.citationLevel,
    safeReference: item.externalReference,
    excerpt: item.citationLevel === "verbatim" ? item.sourceContent : undefined,
    reviewReason: item.citationLevel === "verbatim" ? "Verbatim wording is material and requires review." : undefined,
    expiresAt: item.citationLevel === "verbatim" ? item.expiresAt : undefined,
  };
}

export function runAbility(input: {
  clientId: string;
  abilityId: string;
  question: string;
  analysis?: ProposedAnalysis;
  evidence: readonly EvidenceItem[];
  market?: string;
  language?: string;
  now: string;
}): DecisionBrief {
  const ability = getAbility(input.abilityId);
  if (!ability) throw new Error(`unknown-ability:${input.abilityId}`);
  const resolution = resolveEvidence({
    clientId: input.clientId,
    now: input.now,
    requirements: ability.evidenceRequirements,
    evidence: input.evidence,
    market: input.market,
    language: input.language,
  });
  const selectedIds = new Set(resolution.selected.map((item) => item.id));
  const analysisEvidenceMissing = input.analysis?.evidenceIds.some((id) => !selectedIds.has(id)) ?? false;
  const analysisIncomplete = Boolean(input.analysis) && [
    input.analysis!.pointOfView,
    input.analysis!.clientRelevance,
    input.analysis!.recommendation,
    input.analysis!.nextDecision,
  ].some((value) => !value.trim());
  const unsupportedCausalMode = input.analysis?.claimMode === "causal" &&
    input.analysis.causalBasis?.classification !== "causal";
  const causalViolation = input.analysis?.claimMode !== "causal" && CAUSAL_LANGUAGE.test(input.analysis?.pointOfView ?? "");
  const status = !resolution.sufficient || !input.analysis || analysisEvidenceMissing || analysisIncomplete || unsupportedCausalMode || causalViolation
    ? "needs_context"
    : "ready";
  const gaps = [
    ...resolution.gaps,
    ...(!input.analysis ? ["No evidence-backed analysis has been supplied."] : []),
    ...(analysisEvidenceMissing ? ["The proposed analysis cites evidence that did not pass selection."] : []),
    ...(analysisIncomplete ? ["Point of view, client relevance, recommendation, and next decision are all required."] : []),
    ...(unsupportedCausalMode ? ["Causal mode requires a reviewed causal study classification."] : []),
    ...(causalViolation ? ["Causal language is not supported by the declared claim mode."] : []),
  ];
  const id = createHash("sha256")
    .update(`${input.clientId}\u0000${ability.id}\u0000${ability.version}\u0000${input.question}\u0000${input.now}`)
    .digest("hex")
    .slice(0, 24);

  return {
    id,
    clientId: input.clientId,
    abilityId: ability.id,
    abilityVersion: ability.version,
    question: input.question,
    pointOfView: status === "ready" ? input.analysis!.pointOfView : "Evidence is not yet sufficient for a responsible point of view.",
    clientRelevance: input.analysis?.clientRelevance ?? "Relevance cannot be resolved until the evidence gap is closed.",
    evidenceIds: resolution.selected.map((item) => item.id),
    citations: resolution.selected.map(citation),
    contradictions: input.analysis?.contradictions ?? [],
    uncertainty: [...(input.analysis?.uncertainty ?? []), ...resolution.gaps],
    recommendation: status === "ready" ? input.analysis!.recommendation : "Collect or approve the missing evidence before acting.",
    researchGaps: gaps,
    nextDecision: input.analysis?.nextDecision ?? "Decide whether the evidence gap warrants additional research.",
    status,
    createdAt: input.now,
  };
}
