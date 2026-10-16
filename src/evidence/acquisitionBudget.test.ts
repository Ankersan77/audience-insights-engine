import assert from "node:assert/strict";
import test from "node:test";
import { createAcquisitionRequestGate, validateAcquisitionPlan, validateBudgetPolicy, validatePlanAgainstSource } from "./acquisitionBudget.ts";
import { classifyAcquisitionError } from "./executionPolicy.ts";
import type { SourceConnectionPolicy } from "../core/contracts.ts";

const plan = { currency: "DKK", maxCostMicros: 100, maxRecords: 10, maxRequests: 2 };

test("budget plans require explicit currency and safe nonnegative integer bounds", () => {
  for (const value of [-1, 0.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ["maxCostMicros", "maxRecords", "maxRequests"]) assert.throws(() => validateAcquisitionPlan({ ...plan, [field]: value }), /budget-invalid-plan/);
  }
  assert.throws(() => validateAcquisitionPlan({ ...plan, maxRequests: 0 }), /budget-invalid-plan/);
  assert.throws(() => validateAcquisitionPlan({ ...plan, currency: "dkk" }), /budget-invalid-plan/);
  validateAcquisitionPlan({ ...plan, maxCostMicros: 0, maxRecords: 0 });
  assert.throws(() => validateBudgetPolicy({ currency: "DKK", dailyCostMicros: 0, dailyRecords: 1, dailyRequests: 1, enabled: "true" as unknown as boolean }), /budget-invalid-policy/);
  assert.equal(classifyAcquisitionError(new Error("budget-daily-limit")), "budget-rejected");
});

test("request gates enforce pagination, records, cost, credentials and closure without refunds", () => {
  const gate = createAcquisitionRequestGate(plan, "attempt-1", new AbortController().signal);
  assert.throws(() => gate.assertCredentialAccess(), /budget-request-not-authorized/);
  assert.throws(() => gate.assertResult(0), /budget-result-outside/);
  gate.authorizeRequest({ costMicros: 40, maxRecords: 4 });
  gate.assertCredentialAccess();
  assert.throws(() => gate.authorizeRequest({ costMicros: 61, maxRecords: 1 }), /budget-request-limit/);
  assert.throws(() => gate.authorizeRequest({ costMicros: 1, maxRecords: 7 }), /budget-request-limit/);
  gate.authorizeRequest({ costMicros: 60, maxRecords: 6 });
  gate.assertResult(10);
  assert.throws(() => gate.assertResult(11), /budget-result-outside/);
  assert.throws(() => gate.authorizeRequest({ costMicros: 0, maxRecords: 0 }), /budget-request-limit/);
  gate.close();
  assert.throws(() => gate.assertCredentialAccess(), /budget-attempt-closed/);
  assert.throws(() => gate.authorizeRequest({ costMicros: 0, maxRecords: 0 }), /budget-attempt-closed/);
});

test("gates snapshot bounds, stop on cancellation and reject ambiguous source cost units", () => {
  const mutable = { ...plan };
  const abort = new AbortController();
  const gate = createAcquisitionRequestGate(mutable, "attempt-2", abort.signal);
  mutable.maxRecords = 99;
  assert.throws(() => gate.authorizeRequest({ costMicros: 0, maxRecords: 11 }), /budget-request-limit/);
  abort.abort();
  assert.throws(() => gate.authorizeRequest({ costMicros: 0, maxRecords: 1 }), /cancelled/);
  const source = { quota: 5 } as SourceConnectionPolicy;
  assert.throws(() => validatePlanAgainstSource(plan, source), /budget-source-quota/);
  assert.throws(() => validatePlanAgainstSource(plan, { ...source, quota: 10, costLimit: 500 }), /budget-source-cost-unit-ambiguous/);
  validatePlanAgainstSource({ ...plan, maxCostMicros: 0 }, { ...source, quota: 10, costLimit: 0 });
});
