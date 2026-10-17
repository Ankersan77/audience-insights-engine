import assert from "node:assert/strict";
import test from "node:test";
import type { MeasurementConfiguration, MeasurementPlan } from "../core/contracts.ts";
import { validateMeasurementPlan } from "../core/validation.ts";
import { measurementForScope } from "./measurementScope.ts";
import { parseMeasurementInput } from "./measurementInput.ts";

const dk = { market: "DK", language: "da" }, se = { market: "SE", language: "sv" };
const config: MeasurementConfiguration = { population: "Adults in Denmark", metrics: [{ key: "consideration", label: "Consideration", unit: "rate", aggregation: "rate", direction: "increase", population: "Adults in Denmark" }], baseline: { consideration: 0.2 }, targets: { consideration: 0.25 }, materialityThresholds: { consideration: 0.02 }, checkpoints: ["2026-11-01"], attributionAssumptions: ["Descriptive only"], decisionRules: ["Review before acting"] };
const swedish: MeasurementConfiguration = { ...config, population: "Adults in Sweden", metrics: [{ ...config.metrics[0], population: "Adults in Sweden" }], baseline: { consideration: 0.5 }, targets: { consideration: 0.6 } };
const plan: MeasurementPlan = { ...config, id: "1", clientId: "client", campaignId: "campaign", objective: "Consideration", hypothesis: "Consideration changes", targetScopes: [dk, se], scopeMeasurements: [{ scope: dk, measurement: config }, { scope: se, measurement: swedish }] };
const request = { objective: plan.objective, hypothesis: plan.hypothesis, scopeMeasurements: plan.scopeMeasurements, expectedRevision: 1, expectedPlanVersion: null };

test("measurement selection requires complete pair coverage and preserves plan identity", () => {
  assert.equal(validateMeasurementPlan(plan).valid, true);
  assert.equal(measurementForScope(plan, se).baseline.consideration, 0.5);
  assert.equal(measurementForScope(plan, se).metrics[0].population, "Adults in Sweden");
  assert.equal(measurementForScope(plan, dk).baseline.consideration, 0.2);
  assert.throws(() => measurementForScope(plan, { market: "DK", language: "sv" }));
  assert.throws(() => measurementForScope({ ...plan, scopeMeasurements: undefined }, se), /explicit-per-scope/);
  assert.throws(() => measurementForScope({ ...plan, scopeMeasurements: [plan.scopeMeasurements![0]] }, se), /coverage-mismatch/);
  assert.equal(validateMeasurementPlan({ ...plan, scopeMeasurements: [plan.scopeMeasurements![0]] }).valid, false);
  assert.equal(validateMeasurementPlan({ ...plan, scopeMeasurements: [plan.scopeMeasurements![0], plan.scopeMeasurements![0]] }).valid, false);
  const single = { ...plan, targetScopes: [dk], scopeMeasurements: undefined };
  assert.equal(measurementForScope(single, dk), single);
  const injected = { ...plan, scopeMeasurements: [{ scope: dk, measurement: { ...config, clientId: "foreign", id: "foreign" } }, { scope: se, measurement: swedish }] };
  assert.equal(measurementForScope(injected, dk).clientId, plan.clientId);
  assert.equal(measurementForScope(injected, dk).id, plan.id);
});

test("measurement API input is bounded, explicit and never coerces blanks into zero", () => {
  assert.equal(parseMeasurementInput(request).plan.scopeMeasurements?.length, 2);
  for (const invalid of [null, false, "", "0.2", Infinity]) {
    assert.throws(() => parseMeasurementInput({ ...request, scopeMeasurements: [{ scope: dk, measurement: { ...config, baseline: { consideration: invalid } } }] }));
  }
  for (const invalid of [{ ...request, clientId: "foreign" }, { ...request, expectedRevision: 0 }, { ...request, expectedPlanVersion: undefined }, { ...request, scopeMeasurements: [] },
    { ...request, scopeMeasurements: [{ scope: dk, measurement: { ...config, targetScopes: [se] } }] },
    { ...request, scopeMeasurements: [{ scope: dk, measurement: { ...config, metrics: [{ ...config.metrics[0], direction: "guess" }] } }] },
    { ...request, scopeMeasurements: [{ scope: dk, measurement: { ...config, checkpoints: [] } }] },
    { ...request, scopeMeasurements: [{ scope: dk, measurement: { ...config, materialityThresholds: { consideration: -1 } } }] },
    { ...request, scopeMeasurements: Array(2).fill({ scope: dk, measurement: config }) }]) assert.throws(() => parseMeasurementInput(invalid));
  assert.equal(parseMeasurementInput({ ...request, scopeMeasurements: [{ scope: dk, measurement: { ...config, baseline: { consideration: 0 } } }] }).plan.baseline.consideration, 0);
});
