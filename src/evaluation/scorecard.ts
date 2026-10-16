import type { EvaluationArtifactType, EvaluationCaseClass, ExternalValidationGate, ExternalValidationGateKey, QualityDimension, QualityScorecard } from "../core/contracts.ts";

export const QUALITY_RUBRIC_VERSION = "1.0.0";
export const QUALITY_MEAN_THRESHOLD = 4;

export const QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  "evidence_accuracy", "citation_validity", "type_causality_separation", "client_relevance",
  "contradiction_uncertainty", "source_quality", "strategic_value", "executive_usability",
  "method_validity", "privacy_tenancy", "alert_quality", "recoverability", "operational_integrity",
];

export const REQUIRED_DIMENSIONS: Readonly<Record<EvaluationArtifactType, readonly QualityDimension[]>> = {
  decision_brief: ["evidence_accuracy", "citation_validity", "type_causality_separation", "client_relevance", "contradiction_uncertainty", "strategic_value", "executive_usability", "privacy_tenancy"],
  monitoring_signal: ["evidence_accuracy", "source_quality", "client_relevance", "contradiction_uncertainty", "privacy_tenancy", "alert_quality"],
  campaign_assessment: ["evidence_accuracy", "type_causality_separation", "client_relevance", "strategic_value", "executive_usability", "method_validity", "privacy_tenancy"],
  study_report: ["evidence_accuracy", "citation_validity", "type_causality_separation", "method_validity", "privacy_tenancy"],
  recovery_exercise: ["privacy_tenancy", "recoverability", "operational_integrity"],
};

export type ScorecardAssessment = {
  outcome: QualityScorecard["outcome"];
  meanScore: number;
  missingDimensions: readonly QualityDimension[];
  belowThreshold: readonly QualityDimension[];
};

export const REQUIRED_GATE_SCORECARD: Partial<Record<ExternalValidationGateKey, EvaluationArtifactType>> = {
  research_quality: "decision_brief",
  brand_lift: "study_report",
  monitoring: "monitoring_signal",
  production_operations: "recovery_exercise",
};

export function defaultQualityThresholds(artifactType: EvaluationArtifactType): Partial<Record<QualityDimension, number>> {
  return Object.fromEntries(REQUIRED_DIMENSIONS[artifactType].map((dimension) => [dimension, 3]));
}

export function assertEvaluationPair(caseClass: EvaluationCaseClass, artifactType: EvaluationArtifactType): void {
  if ((caseClass === "recovery") !== (artifactType === "recovery_exercise")) throw new Error("recovery case and recovery exercise must be evaluated together");
  if (caseClass === "manipulated_signal" && artifactType !== "monitoring_signal") throw new Error("manipulated signal cases require a monitoring signal artifact");
  if (caseClass === "small_sample" && artifactType !== "study_report") throw new Error("small sample cases require a study report artifact");
}

export function effectiveGateStatus(gate: Pick<ExternalValidationGate, "status" | "expiresAt">, now: Date): ExternalValidationGate["status"] {
  if (gate.status === "verified" && gate.expiresAt && Date.parse(gate.expiresAt) <= now.getTime()) return "needs_context";
  return gate.status;
}

export function assessQualityScores(input: {
  artifactType: EvaluationArtifactType;
  scores: Partial<Record<QualityDimension, number>>;
  thresholds: Partial<Record<QualityDimension, number>>;
  meanThreshold: number;
}): ScorecardAssessment {
  const required = REQUIRED_DIMENSIONS[input.artifactType];
  const missingDimensions = required.filter((dimension) => !Number.isFinite(input.scores[dimension]));
  const invalid = Object.entries(input.scores).filter(([, score]) => !Number.isInteger(score) || Number(score) < 1 || Number(score) > 5);
  if (invalid.length > 0) throw new Error("quality scores must be whole numbers from 1 to 5");
  if (!Number.isFinite(input.meanThreshold) || input.meanThreshold < 1 || input.meanThreshold > 5) throw new Error("mean threshold must be between 1 and 5");
  const belowThreshold = required.filter((dimension) => {
    const score = input.scores[dimension];
    const threshold = input.thresholds[dimension] ?? 3;
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 5) throw new Error("dimension thresholds must be between 1 and 5");
    return score !== undefined && score < threshold;
  });
  const values = required.flatMap((dimension) => input.scores[dimension] === undefined ? [] : [input.scores[dimension]!]);
  const meanScore = values.length ? values.reduce((sum, score) => sum + score, 0) / values.length : 0;
  return {
    outcome: missingDimensions.length === 0 && belowThreshold.length === 0 && meanScore >= input.meanThreshold ? "passed" : "needs_remediation",
    meanScore,
    missingDimensions,
    belowThreshold,
  };
}
