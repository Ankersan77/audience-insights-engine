import assert from "node:assert/strict";
import test from "node:test";
import { assertEvaluationPair, assessQualityScores, defaultQualityThresholds, effectiveGateStatus, QUALITY_MEAN_THRESHOLD, REQUIRED_DIMENSIONS, REQUIRED_GATE_SCORECARD } from "./scorecard.ts";

test("quality scorecards fail closed when a required dimension is missing", () => {
  const scores = Object.fromEntries(REQUIRED_DIMENSIONS.decision_brief.slice(1).map((dimension) => [dimension, 5]));
  const result = assessQualityScores({ artifactType: "decision_brief", scores, thresholds: {}, meanThreshold: 4 });
  assert.equal(result.outcome, "needs_remediation");
  assert.deepEqual(result.missingDimensions, ["evidence_accuracy"]);
});

test("quality scorecards require both dimension and mean thresholds", () => {
  const scores = Object.fromEntries(REQUIRED_DIMENSIONS.monitoring_signal.map((dimension) => [dimension, 4]));
  assert.equal(assessQualityScores({ artifactType: "monitoring_signal", scores, thresholds: { alert_quality: 4 }, meanThreshold: 4 }).outcome, "passed");
  assert.equal(assessQualityScores({ artifactType: "monitoring_signal", scores: { ...scores, alert_quality: 3 }, thresholds: { alert_quality: 4 }, meanThreshold: 4 }).outcome, "needs_remediation");
});

test("quality scorecards reject out-of-range ratings", () => {
  assert.throws(() => assessQualityScores({ artifactType: "recovery_exercise", scores: { privacy_tenancy: 6 }, thresholds: {}, meanThreshold: 4 }), /1 to 5/);
});

test("method, monitoring and operations gates require the matching human evidence class", () => {
  assert.equal(REQUIRED_GATE_SCORECARD.brand_lift, "study_report");
  assert.equal(REQUIRED_GATE_SCORECARD.monitoring, "monitoring_signal");
  assert.equal(REQUIRED_GATE_SCORECARD.production_operations, "recovery_exercise");
});

test("expired validation evidence fails closed", () => {
  assert.equal(effectiveGateStatus({ status: "verified", expiresAt: "2026-10-01T00:00:00.000Z" }, new Date("2026-10-16T00:00:00.000Z")), "needs_context");
  assert.equal(effectiveGateStatus({ status: "verified", expiresAt: "2026-11-01T00:00:00.000Z" }, new Date("2026-10-16T00:00:00.000Z")), "verified");
});

test("rubric thresholds and adversarial case pairings are policy-owned", () => {
  assert.equal(QUALITY_MEAN_THRESHOLD, 4);
  assert.equal(defaultQualityThresholds("study_report").method_validity, 3);
  assert.doesNotThrow(() => assertEvaluationPair("small_sample", "study_report"));
  assert.throws(() => assertEvaluationPair("small_sample", "decision_brief"), /study report/);
  assert.throws(() => assertEvaluationPair("recovery", "monitoring_signal"), /recovery/);
});
