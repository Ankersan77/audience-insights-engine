import type {
  AbilityManifest,
  Campaign,
  Citation,
  DecisionBrief,
  EvidenceItem,
  IntelligenceRecord,
  MeasurementPlan,
  QualitativeTheme,
  QuantitativeObservation,
  SensingProfile,
  SolutionProfile,
  SourceConnection,
  StudyDesign,
} from "./contracts.ts";

export type ValidationResult = { valid: true } | { valid: false; errors: readonly string[] };

function result(errors: string[]): ValidationResult {
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function required(value: string | undefined, path: string, errors: string[]) {
  if (!value?.trim()) errors.push(`${path} is required`);
}

function confidence(value: number, path: string, errors: string[]) {
  if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${path} must be between 0 and 1`);
}

export function validateSourceConnection(value: SourceConnection): ValidationResult {
  const errors: string[] = [];
  required(value.id, "id", errors);
  required(value.clientId, "clientId", errors);
  required(value.connectorId, "connectorId", errors);
  if (value.retentionDays < 0) errors.push("retentionDays cannot be negative");
  if (value.rawRetentionHours < 0) errors.push("rawRetentionHours cannot be negative");
  if (value.credentialRef && (!value.credentialRef.provider || !value.credentialRef.key)) {
    errors.push("credentialRef must be opaque and complete");
  }
  return result(errors);
}

export function validateEvidenceItem(value: EvidenceItem): ValidationResult {
  const errors: string[] = [];
  required(value.id, "id", errors);
  required(value.clientId, "clientId", errors);
  required(value.collectionId, "collectionId", errors);
  required(value.sourceConnectionId, "sourceConnectionId", errors);
  required(value.externalReference, "externalReference", errors);
  required(value.sourceContent, "sourceContent", errors);
  required(value.rights.basis, "rights.basis", errors);
  required(value.method.method, "method.method", errors);
  required(value.expiresAt, "expiresAt", errors);
  confidence(value.confidence, "confidence", errors);
  if (value.citationLevel === "verbatim" && value.identityRisk && value.lifecycle !== "quarantined") {
    errors.push("identity-risk verbatim evidence must be quarantined");
  }
  if (!value.rights.commercialUse && value.lifecycle === "live") {
    errors.push("evidence without commercial-use rights cannot be live");
  }
  return result(errors);
}

export function validateIntelligenceRecord(value: IntelligenceRecord): ValidationResult {
  const errors: string[] = [];
  required(value.id, "id", errors);
  required(value.clientId, "clientId", errors);
  required(value.title, "title", errors);
  required(value.statement, "statement", errors);
  confidence(value.confidence, "confidence", errors);
  if (["fact", "insight", "recommendation", "learning"].includes(value.kind) && value.evidenceIds.length === 0) {
    errors.push(`${value.kind} requires evidence`);
  }
  if (value.kind === "learning" && value.reviewState !== "accepted") {
    errors.push("learning must be accepted before it is represented as a learning");
  }
  return result(errors);
}

export function validateAbilityManifest(value: AbilityManifest): ValidationResult {
  const errors: string[] = [];
  required(value.id, "id", errors);
  required(value.version, "version", errors);
  required(value.intent, "intent", errors);
  required(value.method, "method", errors);
  required(value.outputContract, "outputContract", errors);
  if (value.qualityRubric.length === 0) errors.push("qualityRubric cannot be empty");
  return result(errors);
}

export function validateDecisionBrief(value: DecisionBrief): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  required(value.question, "question", errors);
  if (value.status === "ready" && value.evidenceIds.length === 0) errors.push("ready brief requires evidence");
  if (value.status === "ready" && !value.pointOfView.trim()) errors.push("ready brief requires a point of view");
  if (value.status === "needs_context" && value.researchGaps.length === 0) {
    errors.push("needs_context brief must identify a research gap");
  }
  return result(errors);
}

export function validateMeasurementPlan(value: MeasurementPlan): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  required(value.objective, "objective", errors);
  required(value.hypothesis, "hypothesis", errors);
  required(value.population, "population", errors);
  if (value.metrics.length === 0) errors.push("at least one metric is required");
  const keys = value.metrics.map((metric) => metric.key);
  if (new Set(keys).size !== keys.length) errors.push("metric keys must be unique");
  return result(errors);
}

export function validateStudyDesign(value: StudyDesign): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  required(value.measurementPlanId, "measurementPlanId", errors);
  required(value.outcomeInstrument, "outcomeInstrument", errors);
  return result(errors);
}

export function validateSolutionProfile(value: SolutionProfile): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  if (value.version < 1) errors.push("version must be positive");
  if (value.retention.evidenceDays <= 0) errors.push("evidence retention must be positive");
  if (value.retention.rawHours < 0) errors.push("raw retention cannot be negative");
  if (value.enabledAbilities.length === 0) errors.push("at least one ability must be enabled");
  return result(errors);
}

export function validateCitation(value: Citation): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  required(value.evidenceId, "evidenceId", errors);
  required(value.safeReference, "safeReference", errors);
  if (value.level === "verbatim" && (!value.excerpt?.trim() || !value.reviewReason?.trim() || !value.expiresAt)) {
    errors.push("verbatim citation requires excerpt, review reason, and expiry");
  }
  if (value.level !== "verbatim" && value.excerpt) errors.push("non-verbatim citation cannot retain an excerpt");
  return result(errors);
}

export function validateQuantitativeObservation(value: QuantitativeObservation): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  required(value.evidenceId, "evidenceId", errors);
  required(value.metricKey, "metricKey", errors);
  required(value.unit, "unit", errors);
  if (!Number.isFinite(value.value)) errors.push("value must be finite");
  if (value.cohortSize !== undefined && (!Number.isInteger(value.cohortSize) || value.cohortSize < 0)) {
    errors.push("cohortSize must be a non-negative integer");
  }
  if (value.suppressed && value.value !== 0) errors.push("suppressed observations must not expose a value");
  return result(errors);
}

export function validateQualitativeTheme(value: QualitativeTheme): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  required(value.label, "label", errors);
  required(value.paraphrase, "paraphrase", errors);
  required(value.method, "method", errors);
  if (value.evidenceIds.length === 0) errors.push("qualitative theme requires evidence");
  if (value.occurrenceCount < 0 || value.sourceDiversity < 0) errors.push("theme counts cannot be negative");
  if (!value.suppressed && value.sourceDiversity < 2) errors.push("live qualitative theme requires source diversity");
  return result(errors);
}

export function validateCampaign(value: Campaign): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  required(value.name, "name", errors);
  required(value.objective, "objective", errors);
  if (value.revision < 1) errors.push("campaign revision must be positive");
  if (["approved", "active", "completed", "learning_reviewed"].includes(value.state) && !value.measurementPlanId) {
    errors.push(`${value.state} campaign requires a measurement plan`);
  }
  return result(errors);
}

export function validateSensingProfile(value: SensingProfile): ValidationResult {
  const errors: string[] = [];
  required(value.clientId, "clientId", errors);
  required(value.cadence, "cadence", errors);
  if (value.version < 1) errors.push("version must be positive");
  confidence(value.confidenceThreshold, "confidenceThreshold", errors);
  if (value.materialityThreshold < 0) errors.push("materialityThreshold cannot be negative");
  if (value.freshnessDays <= 0) errors.push("freshnessDays must be positive");
  if (value.minimumCorroboration < 1) errors.push("minimumCorroboration must be positive");
  return result(errors);
}
