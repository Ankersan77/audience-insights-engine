import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import type { DecisionBrief } from "../../core/contracts.ts";

const modulePromise = tsImport("./workspace_intelligence.ts", import.meta.url) as Promise<
  typeof import("./workspace_intelligence.ts")
>;

function brief(): DecisionBrief {
  return {
    id: "brief-1",
    clientId: "1",
    abilityId: "market-category-diagnosis",
    abilityVersion: "1.0.0",
    question: "What should be validated next?",
    pointOfView: "A bounded study is warranted.",
    clientRelevance: "It informs one decision.",
    evidenceIds: ["1", "2"],
    citations: [
      { id: "citation-1", clientId: "1", evidenceId: "1", level: "paraphrased", safeReference: "https://example.invalid/one", excerpt: "Copied evidence one" },
      { id: "citation-2", clientId: "1", evidenceId: "2", level: "paraphrased", safeReference: "https://example.invalid/two", excerpt: "Copied evidence two" },
    ],
    contradictions: [],
    uncertainty: [],
    recommendation: "Validate independently.",
    researchGaps: [],
    nextDecision: "Approve a study.",
    status: "ready",
    createdAt: "2026-10-18T00:00:00.000Z",
  };
}

test("artifact persistence accepts exact bounds and rejects one over", async () => {
  const {
    assertResearchArtifactBounds,
    MAX_RESEARCH_ARTIFACT_EVIDENCE_REFERENCES,
    MAX_RESEARCH_ARTIFACT_PAYLOAD_BYTES,
    researchArtifactPayloadBytes,
  } = await modulePromise;
  const references = Array.from({ length: MAX_RESEARCH_ARTIFACT_EVIDENCE_REFERENCES }, (_, index) => index + 1);
  assert.doesNotThrow(() => assertResearchArtifactBounds({}, references));
  assert.throws(() => assertResearchArtifactBounds({}, [...references, references.length + 1]), /research-artifact-evidence-limit-exceeded/);

  const shellBytes = researchArtifactPayloadBytes({ value: "" });
  const exact = { value: "a".repeat(MAX_RESEARCH_ARTIFACT_PAYLOAD_BYTES - shellBytes) };
  assert.equal(researchArtifactPayloadBytes(exact), MAX_RESEARCH_ARTIFACT_PAYLOAD_BYTES);
  assert.doesNotThrow(() => assertResearchArtifactBounds(exact, []));
  assert.throws(() => assertResearchArtifactBounds({ value: `${exact.value}a` }, []), /research-artifact-payload-too-large/);
});

test("artifact payload limit is measured in UTF-8 bytes", async () => {
  const { researchArtifactPayloadBytes } = await modulePromise;
  assert.equal(researchArtifactPayloadBytes({ value: "ø" }) - researchArtifactPayloadBytes({ value: "a" }), 1);
});

test("read projection fails closed for unavailable evidence without mutating the stored brief", async () => {
  const { projectDecisionBriefForRead } = await modulePromise;
  const stored = brief();
  const projected = projectDecisionBriefForRead(stored, new Set(["1"]));

  assert.equal(projected.status, "needs_context");
  assert.match(projected.researchGaps.at(-1) ?? "", /no longer usable/);
  assert.match(projected.uncertainty.at(-1) ?? "", /no longer usable/);
  assert.deepEqual(projected.citations, []);
  assert.deepEqual(projected.evidenceIds, []);
  assert.ok(!JSON.stringify(projected).includes("Copied evidence"));
  assert.equal(stored.citations[0].excerpt, "Copied evidence one");
  assert.equal(projectDecisionBriefForRead(stored, new Set()), stored);
});
