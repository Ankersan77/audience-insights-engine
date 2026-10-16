import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceItem, SourceClass } from "../core/contracts.ts";
import { CORE_ABILITIES } from "./catalog.ts";
import { runAbility } from "./engine.ts";

const applicability = { markets: ["DK"], languages: ["da"], categories: ["category"], audiences: ["audience"], campaigns: [] };

function item(id: string, sourceClass: SourceClass, sourceConnectionId: string): EvidenceItem {
  return {
    id,
    clientId: "client-a",
    collectionId: `collection-${id}`,
    sourceConnectionId,
    sourceClass,
    externalReference: `safe:${id}`,
    sourceContent: `Evidence ${id}`,
    ingestedAt: "2026-10-15T00:00:00.000Z",
    observedAt: "2026-10-15T00:00:00.000Z",
    expiresAt: "2027-10-15T00:00:00.000Z",
    lifecycle: "live",
    citationLevel: "paraphrased",
    rights: { basis: "client_owned", commercialUse: true, quotationAllowed: false, restrictions: [] },
    method: { method: "fixture", limitations: [] },
    applicability,
    confidence: 0.8,
    grade: "A",
    sensitive: false,
    identityRisk: false,
    redactions: [],
    contentHash: id,
  };
}

const evidence = [
  item("public-1", "official_or_public", "public-source-1"),
  item("public-2", "official_or_public", "public-source-2"),
  item("licensed-1", "commissioned_or_licensed", "licensed-source-1"),
  item("licensed-2", "commissioned_or_licensed", "licensed-source-2"),
  item("aggregate-1", "first_party_aggregate", "aggregate-source-1"),
  item("primary-1", "primary_research", "primary-source-1"),
  item("conversation-1", "public_conversation", "conversation-source-1"),
  item("brand-1", "client_owned", "brand-source-1"),
];

test("all four core abilities expose versioned contracts and quality rubrics", () => {
  assert.equal(CORE_ABILITIES.length, 4);
  for (const ability of CORE_ABILITIES) {
    assert.match(ability.version, /^\d+\.\d+\.\d+$/);
    assert.equal(ability.outputContract, "decision-brief@1");
    assert.ok(ability.evidenceRequirements.length > 0);
    assert.ok(ability.qualityRubric.length >= 4);
  }
});

test("unsupported evidence returns needs_context instead of plausible filler", () => {
  const brief = runAbility({
    clientId: "client-a",
    abilityId: "market-category-diagnosis",
    question: "What changed?",
    evidence: [],
    now: "2026-10-16T00:00:00.000Z",
  });
  assert.equal(brief.status, "needs_context");
  assert.match(brief.pointOfView, /not yet sufficient/i);
  assert.ok(brief.researchGaps.length > 0);
});

test("an evidence-backed descriptive analysis produces a traceable decision brief", () => {
  const brief = runAbility({
    clientId: "client-a",
    abilityId: "market-category-diagnosis",
    question: "What changed in the category?",
    evidence,
    market: "DK",
    language: "da",
    now: "2026-10-16T00:00:00.000Z",
    analysis: {
      pointOfView: "Two independent sources show the same recent category pattern.",
      clientRelevance: "The change affects the client's priority market.",
      recommendation: "Test the implication in the next planning cycle.",
      nextDecision: "Decide whether to commission a demand study.",
      claimMode: "descriptive",
      evidenceIds: ["public-1", "public-2"],
      contradictions: ["One older source reports a flatter pattern."],
      uncertainty: ["The evidence does not measure causal demand."],
    },
  });
  assert.equal(brief.status, "ready");
  assert.ok(brief.citations.length >= 2);
  assert.ok(brief.contradictions.length > 0);
});

test("causal wording is blocked when the declared evidence is descriptive", () => {
  const brief = runAbility({
    clientId: "client-a",
    abilityId: "market-category-diagnosis",
    question: "Did the campaign change demand?",
    evidence,
    now: "2026-10-16T00:00:00.000Z",
    analysis: {
      pointOfView: "The campaign caused the market increase.",
      clientRelevance: "Material",
      recommendation: "Scale",
      nextDecision: "Budget",
      claimMode: "descriptive",
      evidenceIds: ["public-1", "public-2"],
      contradictions: [],
      uncertainty: [],
    },
  });
  assert.equal(brief.status, "needs_context");
  assert.ok(brief.researchGaps.some((gap) => /causal language/i.test(gap)));
});

test("declaring causal mode is insufficient without a reviewed causal study", () => {
  const items = [
    item("e1", "official_or_public", "source-a"),
    item("e2", "official_or_public", "source-b"),
  ];
  const brief = runAbility({
    clientId: "client-a",
    abilityId: "market-category-diagnosis",
    question: "Did the campaign cause the change?",
    evidence: items,
    now: "2026-10-16T10:00:00.000Z",
    analysis: {
      pointOfView: "The campaign caused the observed change.",
      clientRelevance: "This affects investment.",
      recommendation: "Scale only after review.",
      nextDecision: "Review the causal design.",
      claimMode: "causal",
      evidenceIds: items.map((item) => item.id),
      contradictions: [],
      uncertainty: [],
    },
  });
  assert.equal(brief.status, "needs_context");
  assert.ok(brief.researchGaps.some((gap) => gap.includes("reviewed causal study")));
});

test("an incomplete proposed analysis remains needs_context", () => {
  const items = [item("e1", "official_or_public", "source-a"), item("e2", "official_or_public", "source-b")];
  const brief = runAbility({
    clientId: "client-a", abilityId: "market-category-diagnosis", question: "What changed?", evidence: items, now: "2026-10-16T10:00:00.000Z",
    analysis: { pointOfView: "A change is visible.", clientRelevance: "", recommendation: "", nextDecision: "", claimMode: "descriptive", evidenceIds: items.map((item) => item.id), contradictions: [], uncertainty: [] },
  });
  assert.equal(brief.status, "needs_context");
});

test("audience output keeps attitudes distinct from observed behavior", () => {
  const brief = runAbility({
    clientId: "client-a",
    abilityId: "audience-purchase-behavior",
    question: "How do people choose?",
    evidence,
    now: "2026-10-16T00:00:00.000Z",
    analysis: {
      pointOfView: "Survey attitudes favor durability; aggregate browsing behavior shows comparison activity.",
      clientRelevance: "Both signals matter but measure different constructs.",
      recommendation: "Keep the claims separate in the brief.",
      nextDecision: "Choose whether observed purchase data is needed.",
      claimMode: "attitude",
      evidenceIds: ["licensed-1", "aggregate-1"],
      contradictions: [],
      uncertainty: ["Browsing is not purchase."],
    },
  });
  assert.equal(brief.status, "ready");
  assert.match(brief.pointOfView, /attitudes/i);
  assert.match(brief.pointOfView, /behavior/i);
});
