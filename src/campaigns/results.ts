import type { Campaign, CampaignScope, EvidenceItem, MeasurementPlan, QuantitativeObservation, ResearchContextBasis } from "../core/contracts.ts";
import { prepareResearchContext, CONTEXT_EVIDENCE_REQUIREMENTS, type ResearchContextSources } from "../abilities/context.ts";
import { getAbility } from "../abilities/catalog.ts";
import { researchSnapshotDigest } from "../abilities/snapshot.ts";
import { resolveEvidence } from "../market-twin/resolver.ts";
import { validateMeasurementPlan } from "../core/validation.ts";
import type { CampaignAssessment } from "./analysis.ts";
import { interpretationGaps, type CampaignInterpretation } from "./interpretation.ts";
import { resolveCampaignScope, sameCampaignScopes } from "./scope.ts";
import { measurementForScope } from "./measurementScope.ts";

export type MetricSelection = { metricKey: string; baselineObservationId: string; resultObservationId: string };
export type MetricComparison = {
  kind: "campaign-metric-comparison@1"; metricKey: string;
  baselineEvidenceId: string; resultEvidenceId: string;
  baselineObservationId?: string; resultObservationId?: string;
  baselineDigest?: string; resultDigest?: string;
  baseline?: number; result?: number; delta?: number; target?: number; targetMet?: boolean;
  materialChange?: boolean; unit?: string; population?: string; aggregation?: string;
  baselineWindow?: readonly string[]; resultWindow?: readonly string[]; limitations?: readonly string[];
  expired?: true;
};
export type CampaignResultAssessment = CampaignAssessment & {
  method: "source-backed-readback@1"; comparisons: MetricComparison[];
  contextBasis?: ResearchContextBasis;
  targetScope?: CampaignScope;
  interpretation?: CampaignInterpretation;
  campaignSnapshot: { revision: number; contentDigest: string };
  measurementSnapshot: { id: number; version: number; contentDigest: string };
};

export function parseMetricSelections(value: unknown): MetricSelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("invalid-metric-selections");
  const selections = value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("invalid-metric-selections");
    const row = item as Record<string, unknown>;
    if (typeof row.metricKey !== "string" || !row.metricKey.trim() || row.metricKey.length > 100
      || typeof row.baselineObservationId !== "string" || !/^[1-9]\d{0,14}$/.test(row.baselineObservationId)
      || typeof row.resultObservationId !== "string" || !/^[1-9]\d{0,14}$/.test(row.resultObservationId)) throw new Error("invalid-metric-selections");
    return { metricKey: row.metricKey, baselineObservationId: row.baselineObservationId, resultObservationId: row.resultObservationId };
  });
  if (new Set(selections.map((item) => item.metricKey)).size !== selections.length) throw new Error("duplicate-metric-selection");
  return selections;
}

export function evaluateCampaignResults(input: {
  campaign: Campaign; stage: "live" | "post";
  plan: { id: number; version: number; reviewState: string; plan: MeasurementPlan };
  sources: ResearchContextSources; observations: readonly QuantitativeObservation[];
  selections: readonly MetricSelection[]; market?: string; language?: string; now: string;
  interpretation?: CampaignInterpretation;
}): { assessment: CampaignResultAssessment; evidenceIds: string[] } {
  if (input.campaign.state !== (input.stage === "live" ? "active" : "completed")) throw new Error("campaign-state-incompatible-with-assessment");
  const abilityId = input.stage === "live" ? "live-campaign-intelligence" : "post-campaign-learning";
  const scope = resolveCampaignScope(input.campaign.targetScopes, input.market, input.language);
  const scopedPlan = measurementForScope(input.plan.plan, scope);
  const prepared = prepareResearchContext({ ...input, ...scope, clientId: input.campaign.clientId, campaignId: input.campaign.id, abilityId });
  const resultEvidence = resolveEvidence({ clientId: input.campaign.clientId, now: input.now, market: prepared.context?.market, language: prepared.context?.language,
    requirements: getAbility(abilityId)!.evidenceRequirements, evidence: prepared.evidence.filter((item) => item.applicability.campaigns.includes(input.campaign.id)) });
  // Historical baselines are allowed; current live observations use the ability's freshness gate.
  const baselineEvidence = resolveEvidence({ clientId: input.campaign.clientId, now: input.now, market: prepared.context?.market, language: prepared.context?.language,
    requirements: CONTEXT_EVIDENCE_REQUIREMENTS, evidence: prepared.evidence });
  const baselines = new Map(baselineEvidence.selected.map((item) => [item.id, item]));
  const results = new Map(resultEvidence.selected.map((item) => [item.id, item]));
  const observations = new Map(input.observations.filter((item) => item.clientId === input.campaign.clientId).map((item) => [item.id, item]));
  const gaps = [...prepared.gaps, ...resultEvidence.gaps];
  if (!sameCampaignScopes(input.campaign.targetScopes, input.plan.plan.targetScopes)) gaps.push("The frozen measurement plan does not cover the declared campaign scope.");
  if (input.plan.reviewState !== "accepted" || !validateMeasurementPlan(input.plan.plan).valid
    || input.plan.plan.clientId !== input.campaign.clientId || input.plan.plan.campaignId !== input.campaign.id) gaps.push("A valid accepted campaign measurement plan is required.");
  if (input.selections.some((item) => !scopedPlan.metrics.some((metric) => metric.key === item.metricKey))) gaps.push("An observation selection uses an unplanned metric.");
  const comparisons: MetricComparison[] = [];
  const usedEvidence = new Set(prepared.contextEvidence.map((item) => item.id));
  const time = Date.parse(input.now);
  function window(observation: QuantitativeObservation): [string, string] | undefined {
    const { periodStart, periodEnd } = observation.dimensions;
    const start = Date.parse(periodStart), end = Date.parse(periodEnd), observed = Date.parse(observation.observedAt);
    return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(observed) && start < end && end <= observed && observed <= time ? [periodStart, periodEnd] : undefined;
  }
  function methodology(evidence: EvidenceItem) {
    return researchSnapshotDigest({ method: evidence.method.method, universe: evidence.method.universe, weighting: evidence.method.weighting });
  }
  for (const metric of scopedPlan.metrics) {
    const selection = input.selections.find((item) => item.metricKey === metric.key);
    const baseline = selection && observations.get(selection.baselineObservationId);
    const result = selection && observations.get(selection.resultObservationId);
    const baselineSource = baseline && baselines.get(baseline.evidenceId);
    const resultSource = result && results.get(result.evidenceId);
    const fail = (reason: string) => gaps.push(`${metric.key}: ${reason}`);
    if (!baseline || !result || !baselineSource || !resultSource) { fail("Select permitted, campaign-scoped baseline and result observations."); continue; }
    if ([baselineSource, resultSource].some((item) => item.applicability.markets.length !== 1 || item.applicability.markets[0] !== scope.market || item.applicability.languages.length !== 1 || item.applicability.languages[0] !== scope.language)) {
      fail("Aggregate evidence must identify exactly this market/language pair; broad or pooled applicability cannot authorize a scoped result."); continue;
    }
    if ([baseline, result].some((item) => item.suppressed || !Number.isFinite(item.value) || item.metricKey !== metric.key
      || item.unit !== metric.unit || item.dimensions.population !== metric.population || item.dimensions.aggregation !== metric.aggregation
      || item.dimensions.campaignId !== input.campaign.id)) { fail("Suppressed or incompatible metric, unit, population, aggregation or campaign scope."); continue; }
    const before = window(baseline), after = window(result);
    if (!before || !after || Date.parse(before[1]) > Date.parse(after[0])) { fail("Observation windows must be valid, non-overlapping and ordered baseline before result."); continue; }
    if (input.stage === "live" && time - Date.parse(after[1]) > 14 * 86400000) { fail("Live result window is stale."); continue; }
    if (baselineSource.sourceConnectionId !== resultSource.sourceConnectionId || methodology(baselineSource) !== methodology(resultSource)) { fail("Source or methodology changed; reconcile comparability before assessment."); continue; }
    if (["count", "sum"].includes(metric.aggregation) && Date.parse(before[1]) - Date.parse(before[0]) !== Date.parse(after[1]) - Date.parse(after[0])) { fail("Count/sum windows require equal duration; no silent rate conversion is allowed."); continue; }
    const plannedBaseline = scopedPlan.baseline[metric.key], target = scopedPlan.targets[metric.key], threshold = scopedPlan.materialityThresholds[metric.key];
    // PostgreSQL's existing REAL storage rounds to float32. Do not mistake that rounding for a plan change.
    if (!Number.isFinite(plannedBaseline) || Math.abs(baseline.value - plannedBaseline) > 1e-6 * Math.max(1, Math.abs(plannedBaseline))) { fail("Source baseline differs from the frozen approved plan."); continue; }
    const delta = result.value - baseline.value;
    if (!Number.isFinite(delta) || !Number.isFinite(target) || !Number.isFinite(threshold)) { fail("Finite target, materiality and difference are required."); continue; }
    usedEvidence.add(baseline.evidenceId); usedEvidence.add(result.evidenceId);
    comparisons.push({ kind: "campaign-metric-comparison@1", metricKey: metric.key, baselineEvidenceId: baseline.evidenceId, resultEvidenceId: result.evidenceId,
      baselineObservationId: baseline.id, resultObservationId: result.id, baselineDigest: researchSnapshotDigest(baseline), resultDigest: researchSnapshotDigest(result),
      baseline: baseline.value, result: result.value, delta, target, targetMet: metric.direction === "increase" ? result.value >= target : metric.direction === "decrease" ? result.value <= target : result.value === target,
      materialChange: Math.abs(delta) >= threshold, unit: metric.unit, population: metric.population, aggregation: metric.aggregation, baselineWindow: before, resultWindow: after,
      limitations: [...new Set([...baselineSource.method.limitations, ...resultSource.method.limitations])],
    });
  }
  const basis = prepared.basis ? { ...prepared.basis, evidence: prepared.basis.evidence?.filter((item) => usedEvidence.has(item.id)), primaryEvidenceIds: [...usedEvidence].filter((id) => results.has(id)) } : undefined;
  if (input.interpretation) gaps.push(...interpretationGaps(input.interpretation, { evidenceIds: usedEvidence,
    intelligenceIds: new Set(prepared.context?.marketTwin.map((item) => item.id)), metricKeys: new Set(comparisons.map((item) => item.metricKey)), stage: input.stage }));
  return { evidenceIds: [...usedEvidence], assessment: {
    stage: input.stage, method: "source-backed-readback@1", targetScope: scope, status: gaps.length ? "needs_context" : "ready", comparisons, contextBasis: basis, interpretation: input.interpretation,
    campaignSnapshot: { revision: input.campaign.revision, contentDigest: researchSnapshotDigest(input.campaign) },
    measurementSnapshot: { id: input.plan.id, version: input.plan.version, contentDigest: researchSnapshotDigest(input.plan) },
    pointOfView: gaps.length ? "The supplied observations or interpretation do not yet support a complete compatible readback." : input.interpretation?.insight ?? "The source-backed comparison is ready for analyst interpretation; observed differences are not causal campaign effects.",
    watchouts: ["No automated strategic interpretation or causal claim is made by this metric reconciliation.", ...scopedPlan.attributionAssumptions,
      ...(prepared.context?.marketTwin.flatMap((item) => [...item.uncertainty, ...item.contradictionIds.map((id) => `Market Twin ${item.id} contradicts ${id}.`)]) ?? [])],
    requiredDecisions: [input.interpretation?.recommendation ?? "Review the source windows, execution context, alternative explanations and current Market Twin before proposing optimization or learning."],
    researchGaps: [...new Set(gaps)],
    candidateLearning: input.stage === "post" && !gaps.length && input.interpretation?.learningStatement ? {
      statement: input.interpretation.learningStatement, conditions: [input.interpretation.conditions, input.interpretation.alternativeExplanations, input.interpretation.wouldChangeConclusion, ...scopedPlan.attributionAssumptions, "Descriptive, not a causal campaign effect."], requiresReview: true,
    } : undefined,
  } };
}

export function campaignResultBasisDigest(assessment: CampaignResultAssessment): string {
  return researchSnapshotDigest({ scope: assessment.targetScope, campaign: assessment.campaignSnapshot, measurement: assessment.measurementSnapshot, comparisons: assessment.comparisons,
    context: assessment.contextBasis ? { ...assessment.contextBasis, excludedRecordCount: undefined } : undefined, interpretation: assessment.interpretation });
}
