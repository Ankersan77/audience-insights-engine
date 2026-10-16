import assert from "node:assert/strict";
import test from "node:test";
import type { AdapterRunResult } from "./sdk.ts";
import { AcquisitionAdapterRegistry, runRegisteredAdapter } from "./registry.ts";

const context = { connectorId: "fixture-source", connectorVersion: "1.0.0", sourceClass: "official_or_public", configuration: {} };

test("the acquisition registry fails closed for an unavailable or mismatched adapter", () => {
  const registry = new AcquisitionAdapterRegistry();
  assert.throws(() => registry.resolve(context), /adapter-unavailable/);
  registry.register("fixture-source", () => ({ id: "wrong-source", async run() { throw new Error("not-called"); } }));
  assert.throws(() => registry.resolve(context), /adapter-id-mismatch/);
});

test("a registered adapter runs behind the provider-neutral contract", async () => {
  const registry = new AcquisitionAdapterRegistry();
  const result: AdapterRunResult = { evidence: [], receipt: { jobId: "1", status: "succeeded", acquiredCount: 0, rejectedCount: 0, safeArtifactRefs: [], completedAt: "2026-10-16T00:00:00.000Z" } };
  registry.register("fixture-source", () => ({ id: "fixture-source", async run() { return result; } }));
  const actual = await runRegisteredAdapter({
    registry, factoryContext: context,
    job: { id: "1", clientId: "1", sourceId: "1", adapterId: "fixture-source", dataClassification: "public", request: { operation: "monitor" }, idempotencyKey: "key", requestedAt: "2026-10-16T00:00:00.000Z" },
    runtime: { now: "2026-10-16T00:00:00.000Z", async resolveCredential() { throw new Error("not-required"); } },
    policy: { minimumCohortSize: 10, retainedEvidenceDays: 30, allowVerbatim: false, sensitiveTerms: [] },
  });
  assert.equal(actual, result);
  assert.deepEqual(registry.list(), ["fixture-source"]);
});
