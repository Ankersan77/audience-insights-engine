import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const modulePromise = tsImport("./readProjection.ts", import.meta.url) as Promise<typeof import("./readProjection.ts")>;

test("research-artifact read projection quarantines the whole payload when one citation is unavailable", async () => {
  const { projectResearchArtifactPayload } = await modulePromise;
  const stored = {
    citations: [
      { evidenceId: "1", safeReference: "https://example.invalid/one", excerpt: "Copied evidence one" },
      { evidenceId: "2", safeReference: "https://example.invalid/two", excerpt: "Copied evidence two" },
    ],
  };

  const projected = projectResearchArtifactPayload(stored, [1]);

  assert.deepEqual(projected, {
    contract: "retention-redacted-artifact@1",
    status: "needs_context",
    message: "Artifact content is unavailable under the current retention and resource policy.",
  });
  assert.ok(!JSON.stringify(projected).includes("Copied evidence"));
  assert.equal(stored.citations[0].excerpt, "Copied evidence one");
});

test("research-artifact read projection returns no substantive campaign fields when evidence is unavailable", async () => {
  const { projectResearchArtifactPayload } = await modulePromise;
  const stored = {
    method: "source-backed-readback@1",
    pointOfView: "A source-backed interpretation.",
    interpretation: { recommendation: "Act on the observed change." },
    candidateLearning: { statement: "Retain this as a learning." },
    contextBasis: { evidence: [{ id: "7" }] },
  };

  const projected = projectResearchArtifactPayload(stored, [7]);

  assert.ok(!JSON.stringify(projected).includes("Act on the observed change"));
  assert.ok(!JSON.stringify(projected).includes("Retain this as a learning"));
  assert.deepEqual(projected, {
    contract: "retention-redacted-artifact@1",
    status: "needs_context",
    message: "Artifact content is unavailable under the current retention and resource policy.",
  });
  assert.notEqual(projected, stored);
});

test("tenant projection quarantines invalid legacy payloads instead of returning content", async () => {
  const { projectTenantResearchArtifacts } = await modulePromise;
  const [projection] = await projectTenantResearchArtifacts(4, [{ clientId: 4, payloadJson: {
    kind: "retention-redacted-artifact@1",
    expiredEvidenceIds: [1],
    copiedContent: "must not be returned",
  }, evidenceIds: [] }]);

  assert.equal(projection.basisStatus, "stale");
  assert.equal(projection.quarantined, true);
  assert.deepEqual(projection.unavailableEvidenceIds, []);
  assert.deepEqual(projection.payload, {
    contract: "retention-redacted-artifact@1",
    status: "needs_context",
    message: "Artifact content is unavailable under the current retention and resource policy.",
  });
});
