import assert from "node:assert/strict";
import test from "node:test";
import type { StudyDesign } from "../core/contracts.ts";
import { analyzeBinaryLift, classifyStudy } from "./studies.ts";

function design(overrides: Partial<StudyDesign> = {}): StudyDesign {
  return {
    id: "study-1",
    clientId: "client-a",
    measurementPlanId: "plan-1",
    requestedClaim: "brand_lift",
    hasTreatmentGroup: true,
    hasControlGroup: true,
    assignment: "randomized",
    baselineMeasured: true,
    outcomeInstrument: "Preregistered consideration question",
    sampleSizeTreatment: 500,
    sampleSizeControl: 500,
    exclusions: [],
    fieldworkWindow: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-14T00:00:00.000Z" },
    preregistered: true,
    contaminationRisk: "low",
    ...overrides,
  };
}

test("valid holdout design may use the Brand Lift term", () => {
  const result = classifyStudy(design());
  assert.equal(result.classification, "causal");
  assert.equal(result.mayUseBrandLiftTerm, true);
});

test("naive before/after and social sentiment cannot be called Brand Lift", () => {
  const result = classifyStudy(design({
    hasControlGroup: false,
    assignment: "observational",
    outcomeInstrument: "Social sentiment before and after",
    preregistered: false,
  }));
  assert.equal(result.mayUseBrandLiftTerm, false);
  assert.equal(result.classification, "inconclusive");
  assert.ok(result.missingRequirements.length >= 2);
});

test("holdout analysis is reproducible and reports uncertainty", () => {
  const result = analyzeBinaryLift({
    treatmentPositive: 180,
    treatmentTotal: 500,
    controlPositive: 130,
    controlTotal: 500,
    minimumPerGroup: 300,
  });
  assert.equal(result.status, "estimated");
  assert.ok(Math.abs(result.absoluteDifference - 0.1) < 1e-12);
  assert.ok(result.confidenceInterval95[0] > 0);
});

test("low-power or contaminated studies return inconclusive", () => {
  const lowPower = analyzeBinaryLift({
    treatmentPositive: 25,
    treatmentTotal: 60,
    controlPositive: 20,
    controlTotal: 60,
    minimumPerGroup: 300,
  });
  assert.equal(lowPower.status, "inconclusive");
  assert.match(lowPower.interpretation, /minimum sample/i);

  const contaminated = analyzeBinaryLift({
    treatmentPositive: 180,
    treatmentTotal: 500,
    controlPositive: 130,
    controlTotal: 500,
    minimumPerGroup: 300,
    contaminated: true,
  });
  assert.equal(contaminated.status, "inconclusive");
});
