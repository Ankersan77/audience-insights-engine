import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnectionPolicy } from "../core/contracts.ts";
import { acquisitionLimitFailure, readSourceConnectionPolicy, sourcePolicyFailure } from "./sourcePolicy.ts";

const policy: SourceConnectionPolicy = {
  permissions: ["read:statistics"], dataClassifications: ["public"], permittedPurposes: ["market-research"],
  markets: ["DK"], languages: ["da"], cadence: "monthly", lookbackDays: 31, quota: 100, costLimit: 25,
};
const rights = { basis: "public_permitted" as const, commercialUse: true, quotationAllowed: false, restrictions: [] };

test("source policy fails closed for undeclared, revoked and out-of-scope acquisition", () => {
  const base = { health: "verified", rights, policy, dataClassification: "public" as const, request: { operation: "monitor", since: "2026-10-01T00:00:00.000Z", until: "2026-10-16T00:00:00.000Z", filters: { markets: ["DK"] } }, now: "2026-10-16T00:00:00.000Z" };
  assert.equal(sourcePolicyFailure(base), null);
  assert.equal(sourcePolicyFailure({ ...base, health: "unavailable" }), "source-unavailable");
  assert.equal(sourcePolicyFailure({ ...base, policy: readSourceConnectionPolicy({}) }), "source-policy-incomplete");
  assert.equal(sourcePolicyFailure({ ...base, request: { ...base.request, filters: { markets: ["SE"] } } }), "source-markets-outside-policy");
  assert.equal(sourcePolicyFailure({ ...base, dataClassification: "licensed" }), "source-classification-outside-policy");
  assert.equal(sourcePolicyFailure({ ...base, request: { ...base.request, since: "2026-01-01T00:00:00.000Z" } }), "source-lookback-exceeded");
  assert.equal(sourcePolicyFailure({ ...base, rights: { ...rights, expiresAt: "2026-10-15T00:00:00.000Z" } }), "source-rights-expired");
  assert.equal(sourcePolicyFailure({ ...base, rights: { ...rights, expiresAt: "invalid" } }), "source-rights-invalid");
  assert.equal(sourcePolicyFailure({ ...base, policy: { ...policy, permittedPurposes: ["other-purpose"] } }), "source-purpose-outside-policy");
});

test("quota and cost limits are enforced against adapter receipts", () => {
  const receipt = { jobId: "job-1", status: "succeeded" as const, acquiredCount: 10, rejectedCount: 0, estimatedCost: 4, safeArtifactRefs: [] };
  assert.equal(acquisitionLimitFailure(policy, receipt), null);
  assert.equal(acquisitionLimitFailure(policy, { ...receipt, acquiredCount: 101 }), "source-quota-exceeded");
  assert.equal(acquisitionLimitFailure(policy, { ...receipt, estimatedCost: 26 }), "source-cost-limit-exceeded");
  const withoutCost = { ...receipt, estimatedCost: undefined };
  assert.equal(acquisitionLimitFailure(policy, withoutCost), "source-cost-unreported");
  assert.equal(acquisitionLimitFailure(policy, { ...receipt, estimatedCost: Number.NaN }), "source-cost-invalid");
  assert.equal(acquisitionLimitFailure(policy, { ...receipt, acquiredCount: 90, rejectedCount: 11 }), "source-quota-exceeded");
  assert.equal(acquisitionLimitFailure(policy, { ...receipt, acquiredCount: -1 }), "source-receipt-invalid");
});
