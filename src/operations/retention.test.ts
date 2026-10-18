import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_RETENTION_LIMITS, redactExpiredCitationCopies, tombstoneEvidence } from "./retention.ts";

test("canonical retention limits match the approved R1A1b resource envelope", () => {
  assert.deepEqual(CANONICAL_RETENTION_LIMITS, {
    discovery: 100,
    chunks: 20,
    dependentRows: 100,
    artifacts: 10,
    collections: 250,
    intelligence: 250,
    statementTimeoutMs: 10_000,
    lockTimeoutMs: 1_000,
    artifactJsonBytes: 256 * 1024,
    artifactEvidenceReferences: 100,
  });
});

test("expired evidence becomes a non-reversible lineage tombstone", () => {
  const result = tombstoneEvidence({
    id: 42,
    externalReference: "thread:person:123",
    sourceContent: "Searchable exact wording",
    synthesis: "A copied synthesis",
    contentHash: "known-content-hash",
    redactions: ["social-handle"],
  });
  assert.equal(result.externalReference, "expired:42");
  assert.equal(result.safeSourceUrl, null);
  assert.equal(result.sourceContent.includes("Searchable"), false);
  assert.equal(result.synthesis, null);
  assert.notEqual(result.contentHash, "known-content-hash");
  assert.deepEqual(result.redactions, ["social-handle", "retention-expired"]);
  assert.equal(result.lifecycle, "expired");
});

test("artifact retention removes only copied citations for expired evidence", () => {
  const result = redactExpiredCitationCopies({
    pointOfView: "Reviewed synthesis may remain governed separately.",
    citations: [
      { evidenceId: "42", safeReference: "thread:person:123", excerpt: "Exact wording" },
      { evidenceId: "43", safeReference: "report:43", excerpt: "Still governed" },
    ],
  }, new Set(["42"])) as { pointOfView: string; citations: Array<Record<string, unknown>> };
  assert.equal(result.pointOfView, "Reviewed synthesis may remain governed separately.");
  assert.deepEqual(result.citations[0], { evidenceId: "42", safeReference: "[expired evidence]" });
  assert.equal(result.citations[1].excerpt, "Still governed");
});
