import assert from "node:assert/strict";
import test from "node:test";
import type { Campaign, Citation, EvidenceItem, IntelligenceRecord, MeasurementPlan, ResearchProject, SensingProfile, SolutionProfile, SourceConnection, StudyDesign } from "./contracts.ts";
import { TenantAccessError, assertTenantReview, assertTenantScope, tenantFilter } from "./tenancy.ts";
import { TransitionError, assertCampaignTransition, promoteIntelligence } from "./transitions.ts";
import { validateCampaign, validateCitation, validateEvidenceItem, validateIntelligenceRecord, validateMeasurementPlan, validateResearchProject, validateSensingProfile, validateSolutionProfile, validateSourceConnection, validateStudyDesign } from "./validation.ts";

const applicability = { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] };

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: "ev-1",
    clientId: "client-a",
    collectionId: "collection-1",
    sourceConnectionId: "source-1",
    sourceClass: "official_or_public",
    externalReference: "document:1",
    sourceContent: "Category demand increased in the observed period.",
    ingestedAt: "2026-10-16T08:00:00.000Z",
    expiresAt: "2027-01-16T08:00:00.000Z",
    lifecycle: "candidate",
    citationLevel: "paraphrased",
    rights: {
      basis: "public_permitted",
      commercialUse: true,
      quotationAllowed: false,
      restrictions: [],
    },
    method: { method: "official publication review", limitations: [] },
    applicability,
    confidence: 0.8,
    grade: "A",
    sensitive: false,
    identityRisk: false,
    redactions: [],
    contentHash: "hash",
    ...overrides,
  };
}

function observation(overrides: Partial<IntelligenceRecord> = {}): IntelligenceRecord {
  return {
    id: "record-1",
    clientId: "client-a",
    kind: "observation",
    title: "Observed category movement",
    statement: "The source reports a change.",
    lifecycle: "candidate",
    reviewState: "pending",
    evidenceIds: ["ev-1"],
    contradictionIds: [],
    dependencyIds: [],
    applicability,
    confidence: 0.6,
    uncertainty: [],
    synthesisBy: "human",
    createdAt: "2026-10-16T08:00:00.000Z",
    ...overrides,
  };
}

test("tenant isolation fails closed and filters every record by client", () => {
  const context = { userId: "user-1", clientId: "client-a", role: "reviewer" as const };
  assert.doesNotThrow(() => assertTenantScope(context, "client-a"));
  assert.throws(() => assertTenantScope(context, "client-b"), TenantAccessError);
  assert.deepEqual(
    tenantFilter(context, [
      { id: "a", clientId: "client-a" },
      { id: "b", clientId: "client-b" },
    ]).map((item) => item.id),
    ["a"],
  );
  assert.doesNotThrow(() => assertTenantReview(context));
  assert.throws(
    () => assertTenantReview({ ...context, role: "viewer" }),
    /tenant-review-denied/,
  );
});

test("source connections require an explicit usable policy envelope", () => {
  const source: SourceConnection = {
    id: "source-1", clientId: "client-a", connectorId: "official-statistics", connectorVersion: "1.0.0",
    sourceClass: "official_or_public", health: "configured", permissions: ["read:statistics"], dataClassifications: ["public"],
    permittedPurposes: ["market-research"], markets: ["DK"], languages: ["da"], cadence: "monthly", lookbackDays: 90,
    quota: 1000, costLimit: 0, retentionDays: 365, rawRetentionHours: 0,
  };
  assert.equal(validateSourceConnection(source).valid, true);
  assert.equal(validateSourceConnection({ ...source, permittedPurposes: [] }).valid, false);
  assert.equal(validateSourceConnection({ ...source, markets: [], languages: [] }).valid, false);
  assert.equal(validateSourceConnection({ ...source, lookbackDays: 0 }).valid, false);
  assert.equal(validateSourceConnection({ ...source, quota: -1 }).valid, false);
});

test("research projects require bounded decision context and client scope", () => {
  const project: ResearchProject = {
    id: "project-1", clientId: "client-a", name: "Category entry", decision: "Decide whether to enter the premium segment.",
    markets: ["DK"], languages: ["da"], status: "active", createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z",
  };
  assert.equal(validateResearchProject(project).valid, true);
  assert.equal(validateResearchProject({ ...project, decision: "" }).valid, false);
  assert.equal(validateResearchProject({ ...project, markets: [] }).valid, false);
  assert.equal(validateResearchProject({ ...project, status: "unknown" as ResearchProject["status"] }).valid, false);
});

test("identity-risk verbatim evidence is quarantined and unlicensed evidence cannot go live", () => {
  assert.equal(validateEvidenceItem(evidence()).valid, true);
  const identityRisk = validateEvidenceItem(
    evidence({ citationLevel: "verbatim", identityRisk: true, lifecycle: "candidate" }),
  );
  assert.deepEqual(identityRisk, {
    valid: false,
    errors: ["identity-risk verbatim evidence must be quarantined"],
  });
  const unlicensed = validateEvidenceItem(
    evidence({ lifecycle: "live", rights: { basis: "licensed", commercialUse: false, quotationAllowed: false, restrictions: [] } }),
  );
  assert.equal(unlicensed.valid, false);
});

test("a signal cannot jump directly to learning and learning requires accepted review", () => {
  const signal = observation({ kind: "signal" });
  assert.throws(
    () => promoteIntelligence(signal, "learning", { id: "learning-1", evidenceIds: ["ev-1"], reviewState: "accepted", now: "2026-10-16T09:00:00.000Z" }),
    TransitionError,
  );

  const decision = observation({ kind: "decision" });
  assert.throws(
    () => promoteIntelligence(decision, "learning", { id: "learning-1", evidenceIds: ["ev-1"], reviewState: "pending", now: "2026-10-16T09:00:00.000Z" }),
    /accepted human review/,
  );
  const learning = promoteIntelligence(decision, "learning", {
    id: "learning-1",
    evidenceIds: ["ev-1"],
    reviewState: "accepted",
    now: "2026-10-16T09:00:00.000Z",
  });
  assert.equal(learning.lifecycle, "live");
  assert.equal(validateIntelligenceRecord(learning).valid, true);
});

test("campaign lifecycle rejects skipped states", () => {
  assert.doesNotThrow(() => assertCampaignTransition("proposed", "approved"));
  assert.throws(() => assertCampaignTransition("proposed", "active"), TransitionError);
  assert.throws(() => assertCampaignTransition("archived", "active"), TransitionError);
});

test("solution profiles are versioned and require retention and abilities", () => {
  const profile: SolutionProfile = {
    id: "profile-1",
    clientId: "client-a",
    version: 1,
    status: "active",
    enabledAbilities: [{ id: "market-diagnosis", version: "1.0.0" }],
    providerBindings: {},
    markets: ["DK"],
    languages: ["da"],
    reviewRoles: { learning: ["reviewer"] },
    retention: { evidenceDays: 180, rawHours: 24, auditDays: 365 },
    createdAt: "2026-10-16T08:00:00.000Z",
  };
  assert.equal(validateSolutionProfile(profile).valid, true);
  assert.equal(validateSolutionProfile({ ...profile, enabledAbilities: [] }).valid, false);
  assert.equal(validateSolutionProfile({ ...profile, markets: [] }).valid, false);
});

test("verbatim citations require bounded review metadata", () => {
  const citation: Citation = {
    id: "citation-1",
    clientId: "client-a",
    evidenceId: "ev-1",
    level: "verbatim",
    safeReference: "collection:1",
    excerpt: "A minimal reviewed excerpt.",
    reviewReason: "The wording is material.",
    expiresAt: "2026-11-16T08:00:00.000Z",
  };
  assert.equal(validateCitation(citation).valid, true);
  assert.equal(validateCitation({ ...citation, reviewReason: undefined }).valid, false);
  assert.equal(validateCitation({ ...citation, level: "paraphrased" }).valid, false);
});

test("campaign and sensing contracts enforce their release gates", () => {
  const campaign: Campaign = {
    id: "campaign-1",
    clientId: "client-a",
    name: "Launch",
    state: "approved",
    revision: 1,
    objective: "Increase consideration",
    audience: "Category buyers",
    proposition: "A clear reason to choose",
    creativeRoutes: ["Route A"],
    channels: ["video"],
    budgetAssumptions: [],
  };
  assert.equal(validateCampaign(campaign).valid, false);
  assert.equal(validateCampaign({ ...campaign, measurementPlanId: "plan-1" }).valid, true);

  const sensing: SensingProfile = {
    id: "sensing-1",
    clientId: "client-a",
    version: 1,
    themes: ["category"],
    markets: ["DK"],
    competitors: [],
    products: [],
    audiences: ["Audience A"], occasions: [], risks: [],
    sourceConnectionIds: ["source-1"],
    cadence: "weekly",
    lookbackDays: 30,
    materialityThreshold: 0.2,
    noveltyThreshold: 0.2,
    confidenceThreshold: 0.7,
    freshnessDays: 14,
    expiryDays: 30,
    minimumCorroboration: 2,
    deduplicationWindowDays: 30,
    seasonalExpectations: {}, suppressionRules: ["duplicate", "bot-heavy", "manipulation-risk", "low-sample", "stale"], downRankingRules: ["seasonal"],
    destinations: ["owned-product"], humanReviewRequired: true, decisionContexts: ["market-planning"],
    quietPeriods: [],
  };
  assert.equal(validateSensingProfile(sensing).valid, true);
  assert.equal(validateSensingProfile({ ...sensing, minimumCorroboration: 0 }).valid, false);
  assert.equal(validateSensingProfile({ ...sensing, cadence: "whenever" }).valid, false);
  assert.equal(validateSensingProfile({ ...sensing, humanReviewRequired: false }).valid, false);
  assert.equal(validateSensingProfile({ ...sensing, destinations: ["external-webhook"] }).valid, false);
  assert.equal(validateSensingProfile({ ...sensing, suppressionRules: ["duplicate"] }).valid, false);
  assert.equal(validateSensingProfile({ ...sensing, expiryDays: 7 }).valid, false);
});

test("measurement and study contracts reject mismatched metrics and invalid fieldwork", () => {
  const plan: MeasurementPlan = {
    id: "plan-1", clientId: "client-a", campaignId: "campaign-1", objective: "Measure consideration", hypothesis: "Exposure increases consideration", population: "Category buyers",
    metrics: [{ key: "consideration", label: "Consideration", unit: "%", direction: "increase", aggregation: "rate", population: "Category buyers" }],
    baseline: { consideration: 20 }, targets: { consideration: 24 }, checkpoints: ["2026-11-01T00:00:00.000Z"], attributionAssumptions: [], materialityThresholds: { consideration: 2 }, decisionRules: [],
  };
  assert.equal(validateMeasurementPlan(plan).valid, true);
  assert.equal(validateMeasurementPlan({ ...plan, targets: { awareness: 50 } }).valid, false);
  assert.equal(validateMeasurementPlan({ ...plan, checkpoints: ["not-a-date"] }).valid, false);

  const study: StudyDesign = {
    id: "study-1", clientId: "client-a", measurementPlanId: "plan-1", requestedClaim: "brand_lift", hasTreatmentGroup: true, hasControlGroup: true, assignment: "randomized", baselineMeasured: true, outcomeInstrument: "Survey", sampleSizeTreatment: 500, sampleSizeControl: 500, exclusions: [], preregistered: true, contaminationRisk: "low", fieldworkWindow: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-08T00:00:00.000Z" },
  };
  assert.equal(validateStudyDesign(study).valid, true);
  assert.equal(validateStudyDesign({ ...study, sampleSizeTreatment: 1.5 }).valid, false);
  assert.equal(validateStudyDesign({ ...study, fieldworkWindow: { start: study.fieldworkWindow!.end, end: study.fieldworkWindow!.start } }).valid, false);
});
