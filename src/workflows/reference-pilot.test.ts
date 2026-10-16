import assert from "node:assert/strict";
import test from "node:test";
import { ABILITY_CATALOG, DECISION_BRIEF_ABILITIES } from "../abilities/catalog.ts";
import { runAbility } from "../abilities/engine.ts";
import { assessPreflight } from "../campaigns/analysis.ts";
import type { Campaign, MeasurementPlan, SolutionProfile } from "../core/contracts.ts";
import {
  AggregateMetricEvidenceAdapter,
  DocumentEvidenceAdapter,
  PublicConversationThemeAdapter,
  PublicWebEvidenceAdapter,
} from "../evidence/adapters.ts";
import type { EvidencePolicy } from "../evidence/policy.ts";
import { extractOnboardingCandidates, MarketTwinStore } from "../market-twin/onboarding.ts";
import { resolveEvidence } from "../market-twin/resolver.ts";
import { classifyStudy } from "../measurement/studies.ts";
import { qualifySignals } from "../monitoring/engine.ts";
import { exportSolutionProfile, importSolutionProfile } from "../packaging/solution.ts";

const now = "2026-10-16T10:00:00.000Z";
const clientId = "reference-food-client";
const applicability = { markets: ["DK"], languages: ["da"], categories: ["food"], audiences: ["category-buyers"], campaigns: ["launch"] };
const rights = { basis: "licensed" as const, commercialUse: true, quotationAllowed: false, restrictions: [] };
const method = { method: "representative fixture", universe: "Adults in Denmark", sampleSize: 1200, weighting: "Age, gender, region", limitations: ["Deterministic non-production fixture"] };
const policy: EvidencePolicy = { minimumCohortSize: 10, retainedEvidenceDays: 180, allowVerbatim: false, sensitiveTerms: [] };
const context = { now, async resolveCredential() { return "runtime-only"; } };

function job(id: string, sourceId: string) {
  return { id, clientId, sourceId, adapterId: sourceId, dataClassification: "licensed" as const, request: { operation: "reference-fixture" }, idempotencyKey: id, requestedAt: now };
}

test("reference pilot proves the repository-verifiable roadmap as one governed vertical slice", async () => {
  const common = { rights, method, applicability, confidence: 0.85 };
  const results = await Promise.all([
    new DocumentEvidenceAdapter([{ ...common, id: "brand-guide", title: "Brand guide", content: "The current brand promise is practical confidence." }]).run(job("j1", "client-documents"), context, policy),
    new PublicWebEvidenceAdapter([{ ...common, id: "official-1", url: "https://statistics.example/category", permitted: true, content: "Category value is growing while unit volume is stable." }]).run(job("j2", "official-statistics"), context, policy),
    new PublicWebEvidenceAdapter([{ ...common, id: "official-2", url: "https://trade.example/pricing", permitted: true, content: "Price dispersion increased across the category." }]).run(job("j3", "trade-publication"), context, policy),
    new AggregateMetricEvidenceAdapter([{ ...common, id: "metric-1", content: "Aggregate sales", metric: "repeat_purchase_rate", value: 34, unit: "%", cohortSize: 850 }]).run(job("j4", "commerce-metrics"), context, policy),
    new AggregateMetricEvidenceAdapter([{ ...common, id: "metric-2", content: "Aggregate search", metric: "category_search_index", value: 118, unit: "index", cohortSize: 4000 }]).run(job("j5", "search-trends"), context, policy),
    new PublicConversationThemeAdapter([{ ...common, id: "theme-1", content: "Convenience and price certainty recur as category tensions.", occurrenceCount: 48, sourceDiversity: 5 }]).run(job("j6", "permitted-listening"), context, policy),
  ]);
  const evidence = results.flatMap((result) => result.evidence);
  assert.equal(evidence.length, 6);
  assert.ok(results.every((result) => result.receipt.status === "succeeded"));
  assert.equal(JSON.stringify(results).includes("runtime-only"), false);

  const onboarding = extractOnboardingCandidates({
    clientId,
    sourceId: "audience-study",
    sourceVersion: "2026-q3",
    title: "Audience study",
    statements: [{
      kind: "fact",
      title: "Convenience segment",
      statement: "A weighted segment prioritises convenience and predictable price.",
      evidenceIds: [evidence[3].id],
      confidence: 0.8,
      applicability,
      method,
    }],
  }, now);
  const twin = new MarketTwinStore();
  assert.deepEqual(twin.importCandidates(onboarding.candidates), { inserted: 1, unchanged: 0 });
  twin.review(onboarding.candidates[0].id, "accepted", clientId, now);
  assert.equal(twin.list(clientId)[0].lifecycle, "live");
  assert.equal(onboarding.methodByCandidateId[onboarding.candidates[0].id].weighting, "Age, gender, region");

  for (const ability of DECISION_BRIEF_ABILITIES) {
    const selected = resolveEvidence({
      clientId,
      now,
      requirements: ability.evidenceRequirements,
      evidence,
      market: "DK",
      language: "da",
    }).selected;
    const brief = runAbility({
      clientId,
      abilityId: ability.id,
      question: `What should the client decide from ${ability.id}?`,
      evidence,
      market: "DK",
      language: "da",
      now,
      analysis: {
        pointOfView: "The triangulated evidence supports a bounded descriptive interpretation.",
        clientRelevance: "It changes the choice the client must make next.",
        recommendation: "Review the option with the named human gate.",
        nextDecision: "Approve a bounded test or collect the stated missing evidence.",
        claimMode: "descriptive",
        evidenceIds: selected.map((item) => item.id),
        contradictions: [],
        uncertainty: ["Fixture evidence is not a live market result."],
      },
    });
    assert.equal(brief.status, "ready", `${ability.id} should be evidence-sufficient in the reference fixture`);
  }

  const campaign: Campaign = {
    id: "launch",
    clientId,
    name: "Reference launch",
    state: "proposed",
    revision: 1,
    objective: "Increase consideration",
    audience: "Category buyers",
    proposition: "Practical confidence",
    creativeRoutes: ["Route A"],
    channels: ["video"],
    budgetAssumptions: ["Fixed test budget"],
    measurementPlanId: "plan-1",
  };
  const measurementPlan: MeasurementPlan = {
    id: "plan-1",
    clientId,
    campaignId: campaign.id,
    objective: campaign.objective,
    hypothesis: "The approved route changes consideration in the defined population.",
    population: "Category buyers in Denmark",
    metrics: [{ key: "consideration", label: "Consideration", unit: "%", direction: "increase", aggregation: "rate", population: "Category buyers" }],
    baseline: { consideration: 22 },
    targets: { consideration: 26 },
    checkpoints: ["2026-11-01T00:00:00.000Z"],
    exposureDefinition: "Random assignment to campaign exposure",
    attributionAssumptions: ["No material cross-group contamination"],
    incrementalityDesign: "Randomized holdout",
    materialityThresholds: { consideration: 3 },
    decisionRules: ["Review confidence interval and practical significance"],
  };
  assert.equal(assessPreflight({ campaign, measurementPlan, strategicEvidence: evidence, brandConstraints: [] }).status, "ready");
  assert.equal(classifyStudy({
    id: "study-1",
    clientId,
    measurementPlanId: measurementPlan.id,
    requestedClaim: "brand_lift",
    hasTreatmentGroup: true,
    hasControlGroup: true,
    assignment: "randomized",
    baselineMeasured: true,
    outcomeInstrument: "Preregistered consideration question",
    sampleSizeTreatment: 500,
    sampleSizeControl: 500,
    exclusions: [],
    fieldworkWindow: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-14T00:00:00.000Z" },
    preregistered: true,
    contaminationRisk: "low",
  }).mayUseBrandLiftTerm, true);

  const monitoring = qualifySignals({
    profile: {
      id: "sensing-1", clientId, version: 1, themes: ["category"], markets: ["DK"], competitors: [], products: [],
      sourceConnectionIds: ["official-statistics", "trade-publication"], cadence: "weekly", materialityThreshold: 0.2,
      confidenceThreshold: 0.7, freshnessDays: 14, minimumCorroboration: 2, quietPeriods: [],
    },
    candidates: [{ id: "signal-1", clientId, theme: "category", currentValue: 130, baselineValue: 100, confidence: 0.85, observedAt: now, sourceIds: ["official-statistics", "trade-publication"], botRisk: 0, manipulationRisk: 0, sampleSize: 100 }],
    now,
    sourceHealthOk: true,
  });
  assert.equal(monitoring.outcome, "signals_qualified");

  const profile: SolutionProfile = {
    id: "profile-1", clientId, version: 1, status: "active",
    enabledAbilities: ABILITY_CATALOG.map(({ id, version }) => ({ id, version })), providerBindings: {}, markets: ["DK"], languages: ["da"],
    reviewRoles: { learning: ["reviewer"], brand_lift: ["method-reviewer"] }, retention: { evidenceDays: 180, rawHours: 24, auditDays: 365 },
    sensingProfileId: "sensing-1", createdAt: now,
  };
  const exported = exportSolutionProfile(profile, now);
  assert.deepEqual(importSolutionProfile(exported), exported.profile);
});

