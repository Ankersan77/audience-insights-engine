import assert from "node:assert/strict";
import test from "node:test";
import { parseSynthesisConfiguration, synthesisBindingDigest, type SynthesisDeploymentBinding } from "./synthesisConfiguration.ts";

function binding(): SynthesisDeploymentBinding {
  return { clientId: "1", adapterId: "openai-responses", model: "explicit-test-model", abilityIds: ["market-category-diagnosis"],
    markets: ["DK"], languages: ["da"], allowedSourceClasses: ["official_or_public"], approvalReference: "acceptance:processing",
    qualityApprovalReference: "acceptance:quality", expiresAt: "2099-01-01T00:00:00Z", retention: "standard_api_store_false",
    maxInputBytes: 100_000, maxOutputTokens: 2000, maxResponseBytes: 100_000, timeoutMs: 10_000,
    credentialEnv: "MARKET_RESEARCH_MODEL_KEY_CLIENT_1_SYNTHETIC", sourceConnectionIds: ["1", "2"], currency: "DKK", maxCostMicros: 100 };
}
const config = (bindings: unknown[]) => JSON.stringify({ schemaVersion: 1, bindings });

test("deployment synthesis configuration is absent by default and exact-client only", () => {
  assert.equal(parseSynthesisConfiguration(undefined, "1"), undefined);
  assert.equal(parseSynthesisConfiguration("", "1"), undefined);
  assert.equal(parseSynthesisConfiguration(config([binding()]), "2"), undefined);
  assert.deepEqual(parseSynthesisConfiguration(config([binding()]), "1"), binding());
});

test("configuration rejects implicit vendors/models, arbitrary secrets, duplicate scopes and extra fields", () => {
  const patches: Record<string, unknown>[] = [
    { adapterId: "unknown" }, { model: "" }, { credentialEnv: "OPENAI_API_KEY" }, { credentialEnv: "DATABASE_URL" },
    { credentialEnv: "MARKET_RESEARCH_MODEL_KEY_" }, { credentialEnv: "MARKET_RESEARCH_MODEL_KEY_CLIENT_2_SYNTHETIC" },
    { sourceConnectionIds: [] }, { sourceConnectionIds: ["1", "1"] },
    { sourceConnectionIds: [1] }, { sourceConnectionIds: ["0"] }, { maxCostMicros: -1 }, { currency: "DKK/USD" },
    { qualityApprovalReference: "" }, { approvalReference: "" }, { apiKey: "never-print-this-secret" },
    { endpoint: "https://unapproved.invalid" }, { clientId: "01" }, { enabled: true },
  ];
  for (const patch of patches) assert.throws(() => parseSynthesisConfiguration(config([{ ...binding(), ...patch }]), "1"), /^Error: synthesis-deployment-configuration-invalid$/);
  for (const raw of ["not json", config([binding(), binding()]), config([binding(), { ...binding(), clientId: "2", credentialEnv: "MARKET_RESEARCH_MODEL_KEY_CLIENT_2_SYNTHETIC" }]), JSON.stringify({ schemaVersion: 2, bindings: [] }), "x".repeat(64_001)])
    assert.throws(() => parseSynthesisConfiguration(raw, "1"), /^Error: synthesis-deployment-configuration-invalid$/);
});

test("approval scope changes with model, source rights boundary, retention, key reference or cost ceiling", () => {
  const original = binding(); const digest = synthesisBindingDigest(original);
  for (const patch of [{ model: "changed" }, { sourceConnectionIds: ["3"] }, { retention: "zero_data_retention" as const },
    { credentialEnv: "MARKET_RESEARCH_MODEL_KEY_CLIENT_1_ROTATED" }, { maxCostMicros: 101 }, { approvalReference: "acceptance:new" }])
    assert.notEqual(synthesisBindingDigest({ ...original, ...patch }), digest);
  assert.equal(synthesisBindingDigest({ ...original }), digest);
});
