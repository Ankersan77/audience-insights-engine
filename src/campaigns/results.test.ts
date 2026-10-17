import assert from "node:assert/strict";
import test from "node:test";
import type { Campaign, EvidenceItem, MeasurementPlan, QuantitativeObservation } from "../core/contracts.ts";
import type { ResearchContextSources } from "../abilities/context.ts";
import { evaluateCampaignResults, parseMetricSelections } from "./results.ts";
import { redactExpiredCitationCopies } from "../operations/retention.ts";
import { parseManualAggregate } from "../evidence/manualAggregate.ts";
import { parseCampaignInterpretation } from "./interpretation.ts";
import { measurementConfiguration } from "./measurementScope.ts";

const now = "2026-10-16T00:00:00.000Z";
function fixture() {
  const campaign: Campaign = { id: "7", clientId: "1", name: "Synthetic", state: "active", revision: 3, objective: "Consideration", audience: "Adults", proposition: "Quality", creativeRoutes: [], channels: [], budgetAssumptions: [] };
  const plan: MeasurementPlan = { id: "4", clientId: "1", campaignId: "7", objective: "Consideration", hypothesis: "Consideration changes", population: "Adults", metrics: [{ key: "consideration", label: "Consideration", unit: "rate", aggregation: "rate", population: "Adults", direction: "increase" }], baseline: { consideration: 0.2 }, targets: { consideration: 0.25 }, checkpoints: [now], attributionAssumptions: ["Descriptive only"], materialityThresholds: { consideration: 0.02 }, decisionRules: ["Review context"] };
  campaign.targetScopes = [{ market: "DK", language: "da" }]; plan.targetScopes = campaign.targetScopes;
  const evidence: EvidenceItem = { id: "10", clientId: "1", collectionId: "collection", sourceConnectionId: "source", sourceClass: "first_party_aggregate", externalReference: "synthetic report", sourceContent: "Synthetic aggregate", observedAt: "2026-10-01T00:00:00.000Z", ingestedAt: now, expiresAt: "2027-01-01T00:00:00.000Z", lifecycle: "live", citationLevel: "statistical", rights: { basis: "client_owned", commercialUse: true, quotationAllowed: false, restrictions: [] }, method: { method: "Survey", universe: "Adults", limitations: ["Noncausal"] }, applicability: { markets: ["DK"], languages: ["da"], campaigns: ["7"], categories: [], audiences: [] }, confidence: 0.8, grade: "A", sensitive: false, identityRisk: false, redactions: [], contentHash: "fixture" };
  const sources: ResearchContextSources = { sourceBindings: { metrics: "source" }, evidence: [evidence, { ...evidence, id: "11", observedAt: "2026-10-15T00:00:00.000Z" }], solution: { id: "solution", clientId: "1", version: 1, status: "active", enabledAbilities: [{ id: "live-campaign-intelligence", version: "1.0.0" }, { id: "post-campaign-learning", version: "1.0.0" }], providerBindings: { metrics: "metrics" }, markets: ["DK"], languages: ["da"], reviewRoles: {}, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 }, createdAt: now }, intelligence: [{ id: "strategy", clientId: "1", kind: "fact", title: "Reviewed strategy", statement: "Consideration is a strategic measure.", lifecycle: "live", reviewState: "accepted", evidenceIds: ["11"], contradictionIds: [], dependencyIds: [], applicability: evidence.applicability, confidence: 0.8, uncertainty: [], synthesisBy: "human", createdAt: now, reviewedAt: now }] };
  const observations: QuantitativeObservation[] = [
    { id: "1", clientId: "1", evidenceId: "10", metricKey: "consideration", value: 0.2, unit: "rate", observedAt: "2026-10-01T00:00:00.000Z", dimensions: { population: "Adults", aggregation: "rate", campaignId: "7", periodStart: "2026-09-01", periodEnd: "2026-10-01" }, cohortSize: 100, suppressed: false },
    { id: "2", clientId: "1", evidenceId: "11", metricKey: "consideration", value: 0.3, unit: "rate", observedAt: "2026-10-15T00:00:00.000Z", dimensions: { population: "Adults", aggregation: "rate", campaignId: "7", periodStart: "2026-10-01", periodEnd: "2026-10-15" }, cohortSize: 100, suppressed: false },
  ];
  return { campaign, stage: "live" as "live" | "post", plan: { id: 4, version: 1, reviewState: "accepted", plan }, sources, observations, selections: [{ metricKey: "consideration", baselineObservationId: "1", resultObservationId: "2" }], now };
}

test("campaign readback derives values, materiality and targets from compatible source observations", () => {
  const input = fixture();
  const result = evaluateCampaignResults(input);
  assert.equal(result.assessment.status, "ready");
  const metric = result.assessment.comparisons[0];
  assert.equal(metric.result, 0.3);
  assert.ok(Math.abs(metric.delta! - 0.1) < 1e-8);
  assert.equal(metric.targetMet, true); assert.equal(metric.materialChange, true);
  assert.ok(metric.resultDigest); assert.ok(result.assessment.contextBasis?.intelligence.length);
  input.stage = "post"; input.campaign.state = "completed";
  assert.equal(evaluateCampaignResults(input).assessment.candidateLearning, undefined, "a numerical join is not substantive learning");
  assert.equal(evaluateCampaignResults({ ...input, selections: [] }).assessment.status, "needs_context");
});

test("campaign reconciliation refuses incompatible, unavailable and falsely scoped inputs", () => {
  for (const variant of ["unit", "population", "aggregation", "campaign", "foreign", "suppressed", "future", "overlap", "source", "method", "baseline", "expired", "disabled", "unreviewed", "stale"] as const) {
    const input = fixture(), result = input.observations[1];
    if (variant === "unit") result.unit = "percent";
    if (variant === "population") result.dimensions = { ...result.dimensions, population: "Other" };
    if (variant === "aggregation") result.dimensions = { ...result.dimensions, aggregation: "count" };
    if (variant === "campaign") result.dimensions = { ...result.dimensions, campaignId: "8" };
    if (variant === "foreign") result.clientId = "2";
    if (variant === "suppressed") result.suppressed = true;
    if (variant === "future") result.observedAt = "2027-01-01";
    if (variant === "overlap") result.dimensions = { ...result.dimensions, periodStart: "2026-09-15" };
    if (variant === "source") input.sources.evidence = input.sources.evidence.map((item, index) => index ? { ...item, sourceConnectionId: "other" } : item);
    if (variant === "method") input.sources.evidence = input.sources.evidence.map((item, index) => index ? { ...item, method: { ...item.method, weighting: "Changed weights" } } : item);
    if (variant === "baseline") input.observations[0].value = 0.1;
    if (variant === "expired") input.sources.evidence = input.sources.evidence.map((item) => ({ ...item, expiresAt: "2020-01-01" }));
    if (variant === "disabled") input.sources.solution = { ...input.sources.solution!, enabledAbilities: [] };
    if (variant === "unreviewed") input.sources.intelligence = [];
    if (variant === "stale") { result.observedAt = "2026-10-01"; result.dimensions = { ...result.dimensions, periodStart: "2026-09-01", periodEnd: "2026-10-01" }; }
    assert.equal(evaluateCampaignResults(input).assessment.status, "needs_context", variant);
  }
});

test("readbacks cannot silently borrow solution scope or approve a mismatched measurement scope", () => {
  const input = fixture();
  assert.throws(() => evaluateCampaignResults({ ...input, market: "SE", language: "sv" }), /declared campaign/);
  assert.throws(() => evaluateCampaignResults({ ...input, campaign: { ...input.campaign, targetScopes: undefined } }), /target-scopes-required/);
  input.campaign.targetScopes = [...input.campaign.targetScopes!, { market: "SE", language: "sv" }];
  assert.throws(() => evaluateCampaignResults(input), /declared campaign/);
  assert.equal(evaluateCampaignResults({ ...input, market: "DK", language: "da" }).assessment.status, "needs_context");
});

test("different markets reconcile their own populations, multiple metrics, baselines and thresholds", () => {
  const input = fixture(), dk = { market: "DK", language: "da" }, se = { market: "SE", language: "sv" };
  input.campaign.targetScopes = [dk, se]; input.plan.plan.targetScopes = [dk, se];
  const local = measurementConfiguration(input.plan.plan);
  const swedish = { ...local, population: "Swedish adults", metrics: [{ ...local.metrics[0], population: "Swedish adults" }, { ...local.metrics[0], key: "awareness", label: "Awareness", population: "Swedish adults" }], baseline: { consideration: 0.5, awareness: 0.4 }, targets: { consideration: 0.65, awareness: 0.5 }, materialityThresholds: { consideration: 0.2, awareness: 0.02 }, attributionAssumptions: ["Swedish method limits"] };
  input.plan.plan.scopeMeasurements = [{ scope: dk, measurement: local }, { scope: se, measurement: swedish }];
  input.sources.solution = { ...input.sources.solution!, markets: ["DK", "SE"], languages: ["da", "sv"], providerBindings: { metrics: "metrics", swedish: "swedish" } };
  input.sources.sourceBindings = { metrics: "source", swedish: "source-se" };
  const seEvidence = input.sources.evidence.map((item, index) => ({ ...item, id: String(20 + index), sourceConnectionId: "source-se", applicability: { ...item.applicability, markets: ["SE"], languages: ["sv"] }, method: { ...item.method, universe: "Swedish adults" } }));
  input.sources.evidence = [...input.sources.evidence, ...seEvidence];
  input.sources.intelligence = [...input.sources.intelligence, { ...input.sources.intelligence[0], id: "strategy-se", evidenceIds: ["21"], applicability: seEvidence[1].applicability }];
  const seObservations = input.observations.map((item, index) => ({ ...item, id: String(3 + index), evidenceId: String(20 + index), value: index ? 0.6 : 0.5, dimensions: { ...item.dimensions, population: "Swedish adults" } }));
  input.observations = [...input.observations, ...seObservations, ...seObservations.map((item, index) => ({ ...item, id: String(5 + index), metricKey: "awareness", value: index ? 0.45 : 0.4 }))];
  const selected = [{ metricKey: "consideration", baselineObservationId: "3", resultObservationId: "4" }, { metricKey: "awareness", baselineObservationId: "5", resultObservationId: "6" }];
  const danish = evaluateCampaignResults({ ...input, ...dk }).assessment;
  assert.equal(danish.status, "ready"); assert.equal(danish.comparisons[0].targetMet, true);
  const sw = evaluateCampaignResults({ ...input, ...se, selections: selected }).assessment;
  assert.equal(sw.status, "ready", sw.researchGaps.join(";"));
  assert.equal(sw.comparisons.length, 2); assert.equal(sw.comparisons[0].baseline, 0.5);
  assert.equal(sw.comparisons[0].targetMet, false); assert.equal(sw.comparisons[0].materialChange, false);
  assert.equal(sw.comparisons[1].materialChange, true); assert.deepEqual(sw.targetScope, se);
  assert.ok(sw.watchouts.includes("Swedish method limits"));
  assert.equal(evaluateCampaignResults({ ...input, ...se }).assessment.status, "needs_context", "Danish observations cannot stand in for Swedish results");
  assert.equal(evaluateCampaignResults({ ...input, ...se, selections: selected.slice(0, 1) }).assessment.status, "needs_context", "all scoped metrics are required");
  input.sources.evidence = input.sources.evidence.map((item) => item.id === "21" ? { ...item, applicability: { ...item.applicability, markets: ["DK", "SE"] } } : item);
  assert.equal(evaluateCampaignResults({ ...input, ...se, selections: selected }).assessment.status, "needs_context", "pooled evidence is not a Swedish result");
});

test("retention removes copied metric values and differences without erasing lineage", () => {
  const assessment = evaluateCampaignResults(fixture()).assessment;
  const redacted = redactExpiredCitationCopies(assessment, new Set(["10"])) as typeof assessment;
  assert.deepEqual(redacted.comparisons[0], { kind: "campaign-metric-comparison@1", metricKey: "consideration", baselineEvidenceId: "10", resultEvidenceId: "11", expired: true });
  assert.equal(assessment.comparisons[0].result, 0.3);
});

test("manual aggregate transcription is bounded, explicit and distinct from arbitrary outcome entry", () => {
  const row = { metricKey: "consideration", value: 0.2, unit: "rate", aggregation: "rate", cohortSize: 100, periodStart: "2026-09-01", periodEnd: "2026-10-01" };
  const scope = { population: "Adults", campaigns: ["7"], now };
  assert.equal(parseManualAggregate(row, scope).dimensions.campaignId, "7");
  for (const invalid of [{ ...row, value: null }, { ...row, cohortSize: 1.5 }, { ...row, periodEnd: "2027-01-01" }, { ...row, metricKey: "person@example.com" }]) assert.throws(() => parseManualAggregate(invalid, scope));
  assert.throws(() => parseManualAggregate(row, { ...scope, campaigns: [] }));
  assert.throws(() => parseMetricSelections([{ metricKey: "m", baselineObservationId: -1, resultObservationId: "2" }]));
  assert.throws(() => parseMetricSelections(Array(2).fill({ metricKey: "m", baselineObservationId: "1", resultObservationId: "2" })));
});

test("interpreted post results preserve distinct claims, declared confidence and conditional learning", () => {
  const input = fixture(); input.stage = "post"; input.campaign.state = "completed";
  const interpretation = parseCampaignInterpretation({ observation: "Consideration changed in the declared windows.", hypothesis: "Seasonality may explain part of the difference.", insight: "The direction supports further examination of the quality positioning.", recommendation: "Test the hypothesis with a controlled follow-up.", clientRelevance: "The strategy prioritizes consideration.", alternativeExplanations: "Distribution and seasonality were not controlled.", wouldChangeConclusion: "A corrected baseline or conflicting independent evidence.", conditions: "Only this population, period and measurement method.", learningStatement: "The observed direction is consistent with the declared strategy, with unresolved attribution.", confidence: 0.55, evidenceIds: ["10", "11"], intelligenceIds: ["strategy"], metricKeys: ["consideration"] })!;
  const result = evaluateCampaignResults({ ...input, interpretation }).assessment;
  assert.equal(result.status, "ready"); assert.equal(result.pointOfView, interpretation.insight);
  assert.equal(result.candidateLearning?.statement, interpretation.learningStatement);
  assert.ok(result.candidateLearning?.conditions.includes(interpretation.wouldChangeConclusion));
  assert.equal(result.interpretation?.hypothesis, interpretation.hypothesis);
  const redacted = redactExpiredCitationCopies(result, new Set(["11"])) as typeof result;
  assert.equal(redacted.interpretation, undefined); assert.equal(redacted.candidateLearning, undefined);
  assert.match(redacted.pointOfView, /unavailable/);
  for (const changed of [{ ...interpretation, evidenceIds: ["foreign"] }, { ...interpretation, intelligenceIds: ["unreviewed"] }, { ...interpretation, metricKeys: ["unplanned"] }, { ...interpretation, learningStatement: "The campaign caused incremental lift." }]) {
    const invalid = evaluateCampaignResults({ ...input, interpretation: changed }).assessment;
    assert.equal(invalid.status, "needs_context"); assert.equal(invalid.candidateLearning, undefined);
  }
  input.stage = "live"; input.campaign.state = "active";
  assert.equal(evaluateCampaignResults({ ...input, interpretation }).assessment.status, "needs_context");
  assert.throws(() => parseCampaignInterpretation({ ...interpretation, confidence: 2 }));
  assert.throws(() => parseCampaignInterpretation({ ...interpretation, alternativeExplanations: "" }));
  assert.throws(() => parseCampaignInterpretation({ ...interpretation, intelligenceIds: [] }));
});
