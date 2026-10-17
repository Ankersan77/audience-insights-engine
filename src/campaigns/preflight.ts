import type { Campaign, CampaignScope, MeasurementPlan, ResearchContextBasis } from "../core/contracts.ts";
import { prepareResearchContext, type ResearchContextSources } from "../abilities/context.ts";
import { researchSnapshotDigest } from "../abilities/snapshot.ts";
import { getAbility } from "../abilities/catalog.ts";
import { resolveEvidence } from "../market-twin/resolver.ts";
import { assertPeopleBlind, hasPromptInjection, redactIdentifiers } from "../evidence/policy.ts";
import { assessPreflight, type CampaignAssessment } from "./analysis.ts";
import { validateMeasurementPlan } from "../core/validation.ts";
import { PREFLIGHT_DIMENSIONS, type PreflightDimension } from "./preflightFields.ts";
import { resolveCampaignScope, sameCampaignScopes } from "./scope.ts";
import { measurementForScope } from "./measurementScope.ts";

export type PreflightReview = {
  pointOfView: string;
  recommendation: string;
  alternative: string;
  wouldChangeConclusion: string;
  contradictionResponse?: string;
  findings: readonly { dimension: PreflightDimension; verdict: "aligned" | "tension" | "unresolved"; rationale: string; evidenceIds: readonly string[]; intelligenceIds: readonly string[] }[];
};
export type ContextualPreflight = CampaignAssessment & {
  method: "analyst-preflight@1";
  targetScope?: CampaignScope;
  review?: PreflightReview;
  contextBasis?: ResearchContextBasis;
  campaignSnapshot: { revision: number; contentDigest: string };
  measurementSnapshot?: { id: number; version: number; contentDigest: string };
};

export function parsePreflightReview(value: unknown): PreflightReview | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object") throw new Error("invalid-preflight-review");
  const data = value as Record<string, unknown>;
  const text = (item: unknown) => {
    if (typeof item !== "string" || !item.trim() || item.length > 4000 || hasPromptInjection(item)) throw new Error("invalid-preflight-review");
    return redactIdentifiers(item.trim()).content;
  };
  const ids = (item: unknown) => {
    if (!Array.isArray(item) || item.length > 50 || item.some((id) => typeof id !== "string" || !id.trim() || id.length > 100)) throw new Error("invalid-preflight-review");
    return [...new Set(item as string[])];
  };
  if (!Array.isArray(data.findings) || data.findings.length !== PREFLIGHT_DIMENSIONS.length) throw new Error("invalid-preflight-review");
  const findings: PreflightReview["findings"] = data.findings.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("invalid-preflight-review");
    const finding = value as Record<string, unknown>;
    if (!PREFLIGHT_DIMENSIONS.includes(finding.dimension as PreflightDimension) || !["aligned", "tension", "unresolved"].includes(String(finding.verdict))) throw new Error("invalid-preflight-review");
    return { dimension: finding.dimension as PreflightDimension, verdict: finding.verdict as "aligned" | "tension" | "unresolved", rationale: text(finding.rationale), evidenceIds: ids(finding.evidenceIds), intelligenceIds: ids(finding.intelligenceIds) };
  });
  if (new Set(findings.map((item) => item.dimension)).size !== PREFLIGHT_DIMENSIONS.length) throw new Error("invalid-preflight-review");
  const review = { pointOfView: text(data.pointOfView), recommendation: text(data.recommendation), alternative: text(data.alternative), wouldChangeConclusion: text(data.wouldChangeConclusion),
    ...(data.contradictionResponse ? { contradictionResponse: text(data.contradictionResponse) } : {}), findings };
  assertPeopleBlind(review);
  return review;
}

export function evaluateContextualPreflight(input: {
  campaign: Campaign; strategicEvidenceIds: readonly string[]; brandConstraints: readonly string[];
  plan?: { id: number; version: number; reviewState: string; plan: MeasurementPlan };
  sources: ResearchContextSources; review?: PreflightReview; market?: string; language?: string; now: string;
}): { assessment: ContextualPreflight; evidenceIds: string[] } {
  let targetScope: CampaignScope | undefined;
  let scopeGap: string | undefined;
  try { targetScope = resolveCampaignScope(input.campaign.targetScopes, input.market, input.language); }
  catch (error) { scopeGap = error instanceof Error ? error.message : "campaign-target-scopes-required"; }
  const prepared = prepareResearchContext({ clientId: input.campaign.clientId, abilityId: "campaign-preflight", campaignId: input.campaign.id,
    market: targetScope?.market ?? input.market, language: targetScope?.language ?? input.language, now: input.now, sources: input.sources });
  const primary = resolveEvidence({ clientId: input.campaign.clientId, now: input.now, market: prepared.context?.market, language: prepared.context?.language,
    evidence: prepared.evidence.filter((item) => input.strategicEvidenceIds.includes(item.id)), requirements: getAbility("campaign-preflight")!.evidenceRequirements });
  const evidence = [...new Map([...primary.selected, ...prepared.contextEvidence].map((item) => [item.id, item])).values()];
  const allowedEvidence = new Set(evidence.map((item) => item.id));
  const allowedIntelligence = new Set(prepared.context?.marketTwin.map((item) => item.id));
  const structural = assessPreflight({ campaign: input.campaign, measurementPlan: input.plan?.plan, strategicEvidence: primary.selected, brandConstraints: input.brandConstraints });
  const gaps = [...prepared.gaps, ...primary.gaps, ...structural.researchGaps];
  if (scopeGap) gaps.push(scopeGap);
  if (input.plan && targetScope) {
    try { measurementForScope(input.plan.plan, targetScope); }
    catch { gaps.push("An explicit measurement configuration is required for every campaign market/language pair."); }
  }
  if (!sameCampaignScopes(input.campaign.targetScopes, input.plan?.plan.targetScopes)) gaps.push("The measurement plan must explicitly cover the current campaign scope; replace and review it after scope changes.");
  if (!input.plan || input.plan.reviewState !== "accepted") gaps.push("The measurement plan requires explicit acceptance before strategic approval.");
  if (input.plan && (!validateMeasurementPlan(input.plan.plan).valid || input.plan.plan.clientId !== input.campaign.clientId || input.plan.plan.campaignId !== input.campaign.id)) gaps.push("A valid, campaign-scoped measurement plan is required.");
  if (!input.review) gaps.push("An evidence-linked analyst review is required; filled fields alone do not establish strategic fit.");
  const proposedClaims = [input.review?.pointOfView, ...(input.review?.findings.map((item) => item.rationale) ?? [])].filter(Boolean).join(" ");
  if (/\b(caused|drove|resulted in|incremental lift|forårsagede|bevist effekt|dokumenteret brand lift)\b/i.test(proposedClaims)) {
    gaps.push("Pre-flight is a prospective fit assessment, not evidence of causal campaign effects. Remove effect claims or use the reviewed study workflow.");
  }
  const tensions: string[] = [];
  for (const finding of input.review?.findings ?? []) {
    if (finding.verdict === "unresolved") gaps.push(`Unresolved ${finding.dimension}: ${finding.rationale}`);
    if (!finding.evidenceIds.length || finding.evidenceIds.some((id) => !allowedEvidence.has(id))) gaps.push(`${finding.dimension} requires applicable, permitted evidence references.`);
    if (!finding.intelligenceIds.length || finding.intelligenceIds.some((id) => !allowedIntelligence.has(id))) gaps.push(`${finding.dimension} requires applicable, accepted Market Twin references.`);
    if (finding.verdict === "tension") tensions.push(`${finding.dimension}: ${finding.rationale}`);
  }
  const contradictions = prepared.context?.marketTwin.flatMap((item) => item.contradictionIds.map((id) => `Market Twin ${item.id} contradicts ${id}; explain the decision in the review.`)) ?? [];
  if (contradictions.length && !input.review?.contradictionResponse) gaps.push("Reviewed Market Twin contradictions require an explicit scoped decision rationale before campaign approval.");
  const status = gaps.length ? "needs_context" : tensions.length ? "blocked" : "ready";
  const basis = prepared.basis ? { ...prepared.basis, evidence: prepared.basis.evidence?.filter((item) => allowedEvidence.has(item.id)), primaryEvidenceIds: primary.selected.map((item) => item.id) } : undefined;
  const assessment: ContextualPreflight = {
    ...structural, method: "analyst-preflight@1", targetScope, status, review: input.review, contextBasis: basis,
    campaignSnapshot: { revision: input.campaign.revision, contentDigest: researchSnapshotDigest(input.campaign) },
    measurementSnapshot: input.plan ? { id: input.plan.id, version: input.plan.version, contentDigest: researchSnapshotDigest(input.plan) } : undefined,
    pointOfView: input.review?.pointOfView ?? "Strategic fit has not been assessed against the reviewed Market Twin.",
    watchouts: [...new Set([...input.brandConstraints, ...tensions, ...contradictions, ...(prepared.context?.marketTwin.flatMap((item) => item.uncertainty) ?? [])])], researchGaps: [...new Set(gaps)],
    requiredDecisions: [input.review?.recommendation ?? "Complete the evidence-linked review.", "A reviewer must approve the current campaign, plan and context; this is not an automated expert endorsement."],
  };
  return { assessment, evidenceIds: evidence.map((item) => item.id) };
}

export function preflightBasisDigest(assessment: ContextualPreflight): string {
  const basis = assessment.contextBasis;
  return researchSnapshotDigest({ scope: assessment.targetScope, campaign: assessment.campaignSnapshot, measurement: assessment.measurementSnapshot,
    context: basis ? { ...basis, excludedRecordCount: undefined } : undefined });
}
