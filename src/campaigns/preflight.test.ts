import assert from "node:assert/strict";
import test from "node:test";
import type { Campaign, EvidenceItem, MeasurementPlan } from "../core/contracts.ts";
import type { ResearchContextSources } from "../abilities/context.ts";
import { evaluateContextualPreflight, parsePreflightReview, preflightBasisDigest, type PreflightReview } from "./preflight.ts";
import { PREFLIGHT_DIMENSIONS } from "./preflightFields.ts";

const now = "2026-10-16T00:00:00.000Z";
const campaign: Campaign = { id: "campaign", clientId: "client", name: "Category launch", state: "proposed", revision: 1,
  objective: "Increase consideration", audience: "Declared segment", proposition: "Accessible quality", creativeRoutes: ["Product demonstration"], channels: ["owned"], budgetAssumptions: ["Within approved resources"] };
const plan: MeasurementPlan = { id: "plan", clientId: "client", campaignId: "campaign", objective: campaign.objective, hypothesis: "Consideration changes during the campaign.", population: "Eligible Danish adults",
  metrics: [{ key: "consideration", label: "Consideration", unit: "rate", direction: "increase", aggregation: "rate", population: "Eligible Danish adults" }], baseline: { consideration: 0.2 }, targets: { consideration: 0.25 }, checkpoints: ["2026-11-01T00:00:00.000Z"], attributionAssumptions: ["Descriptive only"], materialityThresholds: { consideration: 0.02 }, decisionRules: ["Review directional change, not causal effect"] };
const evidence: EvidenceItem = { id: "evidence", clientId: "client", collectionId: "collection", sourceConnectionId: "source", sourceClass: "client_owned", externalReference: "approved-brand-guide", sourceContent: "The approved brand promise is accessible quality.",
  ingestedAt: now, expiresAt: "2027-01-01T00:00:00.000Z", lifecycle: "live", citationLevel: "paraphrased", rights: { basis: "client_owned", commercialUse: true, quotationAllowed: false, restrictions: [] },
  method: { method: "Approved strategy", limitations: [] }, applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] }, confidence: 0.8, grade: "A", sensitive: false, identityRisk: false, redactions: [], contentHash: "fixture" };

function fixture() {
  const sources: ResearchContextSources = {
    solution: { id: "solution", clientId: "client", version: 1, status: "active", enabledAbilities: [{ id: "campaign-preflight", version: "1.0.0" }], providerBindings: { brand: "brand" }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 90, rawHours: 0, auditDays: 365 }, createdAt: now },
    sourceBindings: { brand: "source" }, evidence: [structuredClone(evidence)],
    intelligence: [{ id: "strategy", clientId: "client", kind: "fact", title: "Approved brand law", statement: "The brand promises accessible quality.", lifecycle: "live", reviewState: "accepted", evidenceIds: ["evidence"], contradictionIds: [], dependencyIds: [], applicability: evidence.applicability, confidence: 0.8, uncertainty: ["Validate in each campaign"], synthesisBy: "human", createdAt: now, reviewedAt: now }],
  };
  const review: PreflightReview = { pointOfView: "The proposed demonstration supports the approved accessible-quality promise.", recommendation: "Submit this bounded campaign for reviewer approval.", alternative: "Test a proof-led route before scaling.", wouldChangeConclusion: "Audience research contradicting the assumed purchase barrier would require revision.",
    findings: PREFLIGHT_DIMENSIONS.map((dimension) => ({ dimension, verdict: "aligned", rationale: `The ${dimension} decision follows the linked reviewed strategy; validate the assumption in the pilot.`, evidenceIds: ["evidence"], intelligenceIds: ["strategy"] })) };
  return { campaign, strategicEvidenceIds: ["evidence"], brandConstraints: ["Do not imply causal results"], plan: { id: 1, version: 1, reviewState: "accepted", plan }, sources, review, now };
}

test("a preflight needs actual analyst findings, reviewed context and accepted measurement", () => {
  const input = fixture();
  assert.equal(evaluateContextualPreflight({ ...input, review: undefined }).assessment.status, "needs_context");
  assert.equal(evaluateContextualPreflight({ ...input, plan: { ...input.plan, reviewState: "pending" } }).assessment.status, "needs_context");
  assert.equal(evaluateContextualPreflight({ ...input, sources: { ...input.sources, intelligence: [] } }).assessment.status, "needs_context");
  const result = evaluateContextualPreflight(input);
  assert.equal(result.assessment.status, "ready");
  assert.equal(result.assessment.pointOfView, input.review.pointOfView);
  assert.equal(result.assessment.method, "analyst-preflight@1");
  assert.deepEqual(result.evidenceIds, ["evidence"]);
  assert.equal(result.assessment.contextBasis?.intelligence[0].id, "strategy");
  assert.ok(!JSON.stringify(result.assessment.contextBasis).includes("accessible quality"));
  assert.equal(evaluateContextualPreflight({ ...input, review: { ...input.review, pointOfView: "This proposed campaign caused incremental lift." } }).assessment.status, "needs_context");
});

test("wrong-campaign, stale, unreviewed and invented references cannot establish campaign fit", () => {
  for (const variant of ["foreign-campaign", "expired", "unreviewed", "invented-evidence", "invented-strategy", "disabled-ability"] as const) {
    const input = fixture();
    if (variant === "foreign-campaign") input.sources.evidence = [{ ...evidence, applicability: { ...evidence.applicability, campaigns: ["other"] } }];
    if (variant === "expired") input.sources.evidence = [{ ...evidence, expiresAt: "2020-01-01T00:00:00Z" }];
    if (variant === "unreviewed") input.sources.intelligence = input.sources.intelligence.map((item) => ({ ...item, reviewState: "pending" }));
    if (variant === "invented-evidence") input.review.findings = input.review.findings.map((item) => ({ ...item, evidenceIds: ["foreign"] }));
    if (variant === "invented-strategy") input.review.findings = input.review.findings.map((item) => ({ ...item, intelligenceIds: ["foreign"] }));
    if (variant === "disabled-ability") input.sources.solution = { ...input.sources.solution!, enabledAbilities: [] };
    assert.equal(evaluateContextualPreflight(input).assessment.status, "needs_context", variant);
  }
});

test("tensions block approval and contradictions require a visible decision rationale", () => {
  const input = fixture();
  input.review.findings = input.review.findings.map((item, index) => index ? item : { ...item, verdict: "tension" });
  assert.equal(evaluateContextualPreflight(input).assessment.status, "blocked");
  const contradictory = fixture();
  contradictory.sources.intelligence = contradictory.sources.intelligence.map((item) => ({ ...item, contradictionIds: ["alternative"] }));
  assert.equal(evaluateContextualPreflight(contradictory).assessment.status, "needs_context");
  contradictory.review.contradictionResponse = "Limit this proposal to the declared occasion; do not replace the alternative strategy.";
  const result = evaluateContextualPreflight(contradictory);
  assert.equal(result.assessment.status, "ready");
  assert.ok(result.assessment.watchouts.some((item) => item.includes("contradicts")));
});

test("preflight reviews validate all dimensions and preserve an immutable decision basis", () => {
  const input = fixture();
  assert.deepEqual(parsePreflightReview(input.review), input.review);
  assert.throws(() => parsePreflightReview({ ...input.review, findings: [input.review.findings[0]] }), /invalid-preflight-review/);
  assert.throws(() => parsePreflightReview({ ...input.review, findings: Array(7).fill(input.review.findings[0]) }), /invalid-preflight-review/);
  const saved = evaluateContextualPreflight(input).assessment;
  input.sources.intelligence = input.sources.intelligence.map((item) => ({ ...item, statement: "The reviewed promise changed." }));
  assert.notEqual(preflightBasisDigest(saved), preflightBasisDigest(evaluateContextualPreflight(input).assessment));
});
