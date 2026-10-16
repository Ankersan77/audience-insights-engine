import type { Campaign, DecisionBrief, EvidenceItem, MeasurementPlan } from "../core/contracts.ts";
import { assertCampaignTransition } from "../core/transitions.ts";

export type CampaignAssessment = {
  stage: "preflight" | "live" | "post";
  status: "ready" | "needs_context" | "blocked";
  pointOfView: string;
  watchouts: readonly string[];
  requiredDecisions: readonly string[];
  researchGaps: readonly string[];
  candidateLearning?: { statement: string; conditions: readonly string[]; requiresReview: true };
};

export function transitionCampaign(campaign: Campaign, nextState: Campaign["state"]): Campaign {
  assertCampaignTransition(campaign.state, nextState);
  return { ...campaign, state: nextState, revision: campaign.revision + 1 };
}

export function assessPreflight(input: {
  campaign: Campaign;
  measurementPlan?: MeasurementPlan;
  strategicEvidence: readonly EvidenceItem[];
  brandConstraints: readonly string[];
}): CampaignAssessment {
  const gaps: string[] = [];
  if (!input.campaign.objective.trim()) gaps.push("Campaign objective is missing.");
  if (!input.campaign.audience.trim()) gaps.push("Audience logic is missing.");
  if (!input.campaign.proposition.trim()) gaps.push("Proposition is missing.");
  if (input.strategicEvidence.length === 0) gaps.push("No applicable strategic evidence is linked.");
  if (!input.measurementPlan) gaps.push("A credible measurement plan is required before approval.");
  const status = gaps.length > 0 ? "needs_context" : "ready";
  return {
    stage: "preflight",
    status,
    pointOfView: status === "ready"
      ? "The campaign is structurally ready for human strategic review; evidence and measurement are linked."
      : "The campaign should not be approved until the listed evidence and measurement gaps are resolved.",
    watchouts: input.brandConstraints,
    requiredDecisions: status === "ready" ? ["Approve, revise, or reject the proposed campaign."] : ["Assign owners to the missing inputs."],
    researchGaps: gaps,
  };
}

export function assessLiveCampaign(input: {
  campaign: Campaign;
  baseline: Readonly<Record<string, number>>;
  current: Readonly<Record<string, number>>;
  anomalies: readonly string[];
  contextualChanges: readonly string[];
}): CampaignAssessment {
  if (input.campaign.state !== "active") throw new Error("live assessment requires an active campaign");
  const comparable = Object.keys(input.current).filter((key) => key in input.baseline);
  const gaps = comparable.length === 0 ? ["No current metric has a compatible baseline."] : [];
  return {
    stage: "live",
    status: gaps.length ? "needs_context" : "ready",
    pointOfView: gaps.length
      ? "Interim performance cannot be interpreted against a compatible baseline."
      : "Interim differences are descriptive signals only; they are not causal campaign effects.",
    watchouts: [...input.anomalies, ...input.contextualChanges],
    requiredDecisions: ["Decide whether any bounded optimization hypothesis warrants a controlled test."],
    researchGaps: gaps,
  };
}

export function assessPostCampaign(input: {
  campaign: Campaign;
  plan: MeasurementPlan;
  observedResults: Readonly<Record<string, number>>;
  dataQualityIssues: readonly string[];
  alternativeExplanations: readonly string[];
}): CampaignAssessment {
  if (input.campaign.state !== "completed") throw new Error("post assessment requires a completed campaign");
  const missingMetrics = input.plan.metrics
    .map((metric) => metric.key)
    .filter((key) => !(key in input.observedResults));
  const gaps = [
    ...missingMetrics.map((key) => `Missing planned metric: ${key}`),
    ...input.dataQualityIssues,
  ];
  return {
    stage: "post",
    status: gaps.length ? "needs_context" : "ready",
    pointOfView: "Observed results are reported against the approved plan; attribution remains bounded by the study design.",
    watchouts: input.alternativeExplanations,
    requiredDecisions: ["Accept, reject, revise, or time-bound the candidate learning."],
    researchGaps: gaps,
    candidateLearning: gaps.length === 0 ? {
      statement: "The observed campaign result is a conditional candidate learning, not standing client truth.",
      conditions: [...input.plan.attributionAssumptions, ...input.alternativeExplanations],
      requiresReview: true,
    } : undefined,
  };
}

export function campaignAssessmentBrief(
  assessment: CampaignAssessment,
  input: { id: string; clientId: string; campaignId: string; now: string; evidenceIds: readonly string[] },
): DecisionBrief {
  return {
    id: input.id,
    clientId: input.clientId,
    abilityId: `campaign-${assessment.stage}`,
    abilityVersion: "1.0.0",
    question: `What should happen at the ${assessment.stage} stage of campaign ${input.campaignId}?`,
    pointOfView: assessment.pointOfView,
    clientRelevance: "Assessment is scoped to the approved campaign revision and evidence available at this stage.",
    evidenceIds: input.evidenceIds,
    citations: [],
    contradictions: assessment.watchouts,
    uncertainty: assessment.researchGaps,
    recommendation: assessment.requiredDecisions.join(" "),
    researchGaps: assessment.researchGaps,
    nextDecision: assessment.requiredDecisions[0] ?? "No decision defined.",
    status: assessment.status,
    createdAt: input.now,
  };
}
