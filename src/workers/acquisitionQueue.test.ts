import assert from "node:assert/strict";
import test from "node:test";
import { classifyAcquisitionError } from "../evidence/executionPolicy.ts";

test("acquisition failures are reduced to bounded, non-sensitive operational codes", () => {
  assert.equal(classifyAcquisitionError(new Error("HTTP 429 rate limit for secret token abc")), "rate-limit");
  assert.equal(classifyAcquisitionError(new Error("adapter-unavailable:provider-x")), "adapter-unavailable");
  assert.equal(classifyAcquisitionError(new Error("credential resolver failed for /secret/path")), "credential-unavailable");
  assert.equal(classifyAcquisitionError(new Error("acquisition-cancelled")), "cancelled");
  assert.equal(classifyAcquisitionError(new Error("source-quota-exceeded")), "policy-rejected");
  assert.equal(classifyAcquisitionError(new Error("source-cost-unreported")), "policy-rejected");
  assert.equal(classifyAcquisitionError(new Error("unexpected payload with private details")), "adapter-failed");
});
