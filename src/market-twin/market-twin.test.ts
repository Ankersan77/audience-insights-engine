import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceItem } from "../core/contracts.ts";
import { extractOnboardingCandidates, MarketTwinStore } from "./onboarding.ts";
import { resolveEvidence } from "./resolver.ts";

const applicability = { markets: ["DK"], languages: ["da"], categories: ["construction"], audiences: [], campaigns: [] };
const method = {
  method: "weighted audience survey",
  universe: "Adults responsible for home renovation decisions",
  sampleSize: 1200,
  weighting: "Age, region and household ownership",
  fieldworkStart: "2026-08-01T00:00:00.000Z",
  fieldworkEnd: "2026-08-14T00:00:00.000Z",
  limitations: ["Self-reported attitudes are not observed purchase behavior"],
};

test("structured research onboarding preserves population, weights, dates, thresholds, and limitations", () => {
  const source = {
    clientId: "client-a",
    sourceId: "audience-study-2026",
    sourceVersion: "1",
    title: "Audience study",
    statements: [
      {
        kind: "fact" as const,
        title: "Segment prioritizes durability",
        statement: "The weighted study reports durability as a top-three criterion for the defined segment.",
        evidenceIds: ["ev-survey-1"],
        confidence: 0.82,
        applicability,
        method,
      },
    ],
  };
  const result = extractOnboardingCandidates(source, "2026-10-16T10:00:00.000Z");
  const candidate = result.candidates[0];
  assert.equal(result.methodByCandidateId[candidate.id].universe, method.universe);
  assert.equal(result.methodByCandidateId[candidate.id].weighting, method.weighting);
  assert.deepEqual(result.methodByCandidateId[candidate.id].limitations, method.limitations);
});

test("re-running onboarding is idempotent and reviewed intelligence is not overwritten", () => {
  const result = extractOnboardingCandidates({
    clientId: "client-a",
    sourceId: "brand-guide",
    sourceVersion: "7",
    title: "Brand guide",
    statements: [{ kind: "fact", title: "Promise", statement: "Built to last.", evidenceIds: ["ev-1"], confidence: 0.9, applicability, method }],
  }, "2026-10-16T10:00:00.000Z");
  const store = new MarketTwinStore();
  assert.deepEqual(store.importCandidates(result.candidates), { inserted: 1, unchanged: 0 });
  const accepted = store.review(result.candidates[0].id, "accepted", "client-a", "2026-10-16T11:00:00.000Z");
  assert.equal(accepted.lifecycle, "live");
  assert.deepEqual(store.importCandidates(result.candidates), { inserted: 0, unchanged: 1 });
  assert.equal(store.list("client-a")[0].lifecycle, "live");
  assert.throws(() => store.review(result.candidates[0].id, "accepted", "client-b", "2026-10-16T11:00:00.000Z"));
});

function evidence(overrides: Partial<EvidenceItem>): EvidenceItem {
  return {
    id: "ev-1",
    clientId: "client-a",
    collectionId: "collection-1",
    sourceConnectionId: "source-1",
    sourceClass: "official_or_public",
    externalReference: "ref",
    sourceContent: "Market fact",
    ingestedAt: "2026-10-15T00:00:00.000Z",
    observedAt: "2026-10-15T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    lifecycle: "candidate",
    citationLevel: "paraphrased",
    rights: { basis: "public_permitted", commercialUse: true, quotationAllowed: false, restrictions: [] },
    method: { method: "official release", limitations: [] },
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

test("evidence resolution excludes cross-client, stale, unlicensed, and inapplicable evidence with reasons", () => {
  const resolution = resolveEvidence({
    clientId: "client-a",
    now: "2026-10-16T00:00:00.000Z",
    market: "DK",
    language: "da",
    requirements: [{ sourceClasses: ["official_or_public"], minimumItems: 1, minimumSourceDiversity: 1, maximumAgeDays: 30, minimumGrade: "B", requiredDimensions: [] }],
    evidence: [
      evidence({ id: "valid" }),
      evidence({ id: "other-client", clientId: "client-b" }),
      evidence({ id: "unlicensed", rights: { basis: "licensed", commercialUse: false, quotationAllowed: false, restrictions: [] } }),
      evidence({ id: "wrong-market", applicability: { ...applicability, markets: ["SE"] } }),
      evidence({ id: "stale", observedAt: "2020-01-01T00:00:00.000Z" }),
    ],
  });
  assert.deepEqual(resolution.selected.map((item) => item.id), ["valid"]);
  assert.equal(resolution.sufficient, true);
  assert.ok(resolution.basis.find((item) => item.evidenceId === "other-client")?.reasons.includes("different-client"));
});

test("declared evidence dimensions are enforced rather than treated as documentation", () => {
  const resolution = resolveEvidence({
    clientId: "client-a",
    now: "2026-10-16T00:00:00.000Z",
    requirements: [{ sourceClasses: ["official_or_public"], minimumItems: 1, minimumSourceDiversity: 1, requiredDimensions: ["audience"] }],
    evidence: [evidence({ id: "missing-audience", applicability: { ...applicability, audiences: [] } })],
  });
  assert.equal(resolution.sufficient, false);
  assert.deepEqual(resolution.selected, []);
  assert.ok(resolution.basis[0].reasons.includes("missing-required-applicability-dimension"));
});

test("contradictory candidates stay visible instead of being resolved by ingestion order", () => {
  const source = extractOnboardingCandidates({
    clientId: "client-a",
    sourceId: "market-material",
    sourceVersion: "1",
    title: "Market material",
    statements: [
      { kind: "hypothesis", title: "Price drives switching", statement: "Price is the main switching driver.", evidenceIds: ["a"], confidence: 0.5, applicability, method, contradictionKeys: ["service-driver"] },
      { kind: "hypothesis", title: "Service drives switching", statement: "Service is the main switching driver.", evidenceIds: ["b"], confidence: 0.5, applicability, method, contradictionKeys: ["price-driver"] },
    ],
  }, "2026-10-16T10:00:00.000Z");
  const store = new MarketTwinStore();
  store.importCandidates(source.candidates);
  assert.equal(store.list("client-a").length, 2);
  assert.ok(store.list("client-a").every((record) => record.contradictionIds.length === 1));
});
