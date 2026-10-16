import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceItem } from "../core/contracts.ts";
import { runAbilityWithSynthesis, type ResearchSynthesisProvider } from "./synthesis.ts";

function evidence(id: string, sourceConnectionId: string): EvidenceItem {
  return {
    id, clientId: "client-a", collectionId: `collection-${id}`, sourceConnectionId, sourceClass: "official_or_public",
    externalReference: `source:${id}`, sourceContent: `Governed evidence ${id}`, synthesis: `Evidence ${id}`,
    ingestedAt: "2026-10-16T00:00:00.000Z", expiresAt: "2027-10-16T00:00:00.000Z", lifecycle: "live", citationLevel: "paraphrased",
    rights: { basis: "public_permitted", commercialUse: true, quotationAllowed: false, restrictions: [] },
    method: { method: "official publication", limitations: [] }, applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] },
    confidence: 0.8, grade: "A", sensitive: false, identityRisk: false, redactions: [], contentHash: `hash-${id}`,
  };
}

test("a synthesis provider proposes analysis only after deterministic evidence selection", async () => {
  let receivedIds: readonly string[] = [];
  const provider: ResearchSynthesisProvider = { id: "fixture", version: "1", async synthesize(input) {
    receivedIds = input.evidence.map((item) => item.id);
    return { pointOfView: "The governed sources indicate a material category change.", clientRelevance: "The decision concerns the Danish market.", recommendation: "Validate the response against the current brand law.", nextDecision: "Choose whether to commission the next bounded study.", claimMode: "descriptive", evidenceIds: receivedIds, contradictions: [], uncertainty: ["Descriptive evidence only."] };
  } };
  const result = await runAbilityWithSynthesis({ clientId: "client-a", abilityId: "market-category-diagnosis", question: "What changed?", evidence: [evidence("one", "source-1"), evidence("two", "source-2")], market: "DK", language: "da", now: "2026-10-16T00:00:00.000Z", provider });
  assert.equal(result.status, "ready");
  assert.deepEqual([...receivedIds].sort(), ["one", "two"]);
});

test("missing evidence bypasses synthesis and remains needs context", async () => {
  let called = false;
  const provider: ResearchSynthesisProvider = { id: "fixture", version: "1", async synthesize() { called = true; throw new Error("must-not-run"); } };
  const result = await runAbilityWithSynthesis({ clientId: "client-a", abilityId: "market-category-diagnosis", question: "What changed?", evidence: [], now: "2026-10-16T00:00:00.000Z", provider });
  assert.equal(result.status, "needs_context");
  assert.equal(called, false);
});
