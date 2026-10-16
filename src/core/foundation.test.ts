import assert from "node:assert/strict";
import test from "node:test";
import type { Campaign, Citation, EvidenceItem, IntelligenceRecord, SensingProfile, SolutionProfile } from "./contracts.ts";
import { TenantAccessError, assertTenantReview, assertTenantScope, tenantFilter } from "./tenancy.ts";
import { TransitionError, assertCampaignTransition, promoteIntelligence } from "./transitions.ts";
import { validateCampaign, validateCitation, validateEvidenceItem, validateIntelligenceRecord, validateSensingProfile, validateSolutionProfile } from "./validation.ts";

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
    sourceConnectionIds: ["source-1"],
    cadence: "weekly",
    materialityThreshold: 0.2,
    confidenceThreshold: 0.7,
    freshnessDays: 14,
    minimumCorroboration: 2,
    quietPeriods: [],
  };
  assert.equal(validateSensingProfile(sensing).valid, true);
  assert.equal(validateSensingProfile({ ...sensing, minimumCorroboration: 0 }).valid, false);
});
