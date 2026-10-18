import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceItem } from "../core/contracts.ts";
import { currentEvidenceUseFailure, type CurrentEvidenceSource } from "./usePolicy.ts";

const now = new Date("2026-10-18T12:00:00.000Z");
const evidence: EvidenceItem = {
  id: "1", clientId: "4", collectionId: "2", sourceConnectionId: "3", sourceClass: "official_or_public",
  externalReference: "safe-reference", sourceContent: "Aggregate market evidence.", ingestedAt: "2026-10-18T00:00:00.000Z",
  expiresAt: "2026-11-18T00:00:00.000Z", lifecycle: "live", citationLevel: "paraphrased",
  rights: { basis: "public_permitted", commercialUse: true, quotationAllowed: false, restrictions: [] },
  method: { method: "official publication", limitations: [] }, applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] },
  confidence: 0.8, grade: "A", sensitive: false, identityRisk: false, redactions: [], contentHash: "hash",
};
const source: CurrentEvidenceSource = {
  sourceClass: "official_or_public", health: "producing_evidence", revokedAt: null,
  rightsJson: evidence.rights,
  configurationJson: { permissions: ["read"], dataClassifications: ["public"], permittedPurposes: ["market-research"], markets: ["DK"], languages: ["da"], cadence: "manual", lookbackDays: 30 },
};

test("current evidence-use policy accepts a permitted canonical item", () => {
  assert.equal(currentEvidenceUseFailure({ clientId: 4, evidence, source, now }), null);
});

test("current evidence-use policy rejects revoked, unsafe, quarantined and evidence-rights-denied items", () => {
  assert.equal(currentEvidenceUseFailure({ clientId: 4, evidence, source: { ...source, revokedAt: now }, now }), "source-revoked");
  assert.match(currentEvidenceUseFailure({ clientId: 4, evidence: { ...evidence, sensitive: true }, source, now }) ?? "", /sensitive-or-identity-risk/);
  assert.match(currentEvidenceUseFailure({ clientId: 4, evidence: { ...evidence, identityRisk: true }, source, now }) ?? "", /sensitive-or-identity-risk/);
  assert.match(currentEvidenceUseFailure({ clientId: 4, evidence: { ...evidence, lifecycle: "quarantined" }, source, now }) ?? "", /lifecycle-quarantined/);
  assert.match(currentEvidenceUseFailure({ clientId: 4, evidence: { ...evidence, lifecycle: "superseded" }, source, now }) ?? "", /lifecycle-superseded/);
  assert.match(currentEvidenceUseFailure({ clientId: 4, evidence: { ...evidence, rights: { ...evidence.rights, commercialUse: false } }, source, now }) ?? "", /rights-do-not-permit-use/);
});
