export type ISODateTime = string;
export type ClientId = string;

export type ResearchProject = {
  id: string;
  clientId: ClientId;
  name: string;
  decision: string;
  markets: readonly string[];
  languages: readonly string[];
  status: "active" | "completed" | "archived";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type LifecycleState = "candidate" | "live" | "quarantined" | "expired" | "superseded";
export type ReviewState = "pending" | "accepted" | "rejected" | "revision_requested";
export type EvidenceGrade = "A" | "B" | "C" | "D" | "ungraded";
export type CitationLevel = "statistical" | "paraphrased" | "verbatim";
export type SourceClass =
  | "client_owned"
  | "first_party_aggregate"
  | "commissioned_or_licensed"
  | "official_or_public"
  | "public_conversation"
  | "primary_research";

export type Applicability = {
  markets: readonly string[];
  languages: readonly string[];
  categories: readonly string[];
  audiences: readonly string[];
  campaigns: readonly string[];
};

export type MethodDeclaration = {
  method: string;
  universe?: string;
  sampleSize?: number;
  weighting?: string;
  fieldworkStart?: ISODateTime;
  fieldworkEnd?: ISODateTime;
  limitations: readonly string[];
};

export type RightsDeclaration = {
  basis: "client_owned" | "licensed" | "public_permitted" | "consented";
  commercialUse: boolean;
  quotationAllowed: boolean;
  expiresAt?: ISODateTime;
  restrictions: readonly string[];
};

export type SourceConnectionPolicy = {
  permissions: readonly string[];
  dataClassifications: readonly ("public" | "licensed" | "client-confidential")[];
  permittedPurposes: readonly string[];
  markets: readonly string[];
  languages: readonly string[];
  cadence: "manual" | "hourly" | "daily" | "weekly" | "monthly" | "quarterly";
  lookbackDays: number;
  quota?: number;
  costLimit?: number;
};

export type SourceConnection = SourceConnectionPolicy & {
  id: string;
  clientId: ClientId;
  connectorId: string;
  connectorVersion: string;
  sourceClass: SourceClass;
  credentialRef?: { provider: string; key: string };
  health: "configured" | "verified" | "degraded" | "unavailable" | "producing_evidence";
  retentionDays: number;
  rawRetentionHours: number;
  lastSuccessfulReceiptAt?: ISODateTime;
};

export type EvidenceItem = {
  id: string;
  clientId: ClientId;
  collectionId: string;
  sourceConnectionId: string;
  sourceClass: SourceClass;
  externalReference: string;
  sourceUrl?: string;
  sourceContent: string;
  synthesis?: string;
  publishedAt?: ISODateTime;
  observedAt?: ISODateTime;
  ingestedAt: ISODateTime;
  expiresAt: ISODateTime;
  lifecycle: LifecycleState;
  citationLevel: CitationLevel;
  rights: RightsDeclaration;
  method: MethodDeclaration;
  applicability: Applicability;
  confidence: number;
  grade: EvidenceGrade;
  sensitive: boolean;
  identityRisk: boolean;
  redactions: readonly string[];
  contentHash: string;
};

export type QuantitativeObservation = {
  id: string;
  clientId: ClientId;
  evidenceId: string;
  metricKey: string;
  value: number;
  unit: string;
  observedAt: ISODateTime;
  dimensions: Readonly<Record<string, string>>;
  cohortSize?: number;
  suppressed: boolean;
};

export type QualitativeTheme = {
  id: string;
  clientId: ClientId;
  evidenceIds: readonly string[];
  label: string;
  paraphrase: string;
  occurrenceCount: number;
  sourceDiversity: number;
  method: string;
  suppressed: boolean;
};

export type Citation = {
  id: string;
  clientId: ClientId;
  evidenceId: string;
  level: CitationLevel;
  safeReference: string;
  excerpt?: string;
  reviewReason?: string;
  expiresAt?: ISODateTime;
};

export type IntelligenceKind =
  | "observation"
  | "signal"
  | "fact"
  | "hypothesis"
  | "insight"
  | "recommendation"
  | "decision"
  | "learning"
  | "knowledge_gap";

export type IntelligenceRecord<K extends IntelligenceKind = IntelligenceKind> = {
  id: string;
  clientId: ClientId;
  kind: K;
  title: string;
  statement: string;
  lifecycle: LifecycleState;
  reviewState: ReviewState;
  evidenceIds: readonly string[];
  contradictionIds: readonly string[];
  dependencyIds: readonly string[];
  applicability: Applicability;
  confidence: number;
  uncertainty: readonly string[];
  synthesisBy: "human" | "model" | "hybrid";
  createdAt: ISODateTime;
  reviewedAt?: ISODateTime;
  supersedesId?: string;
  decayAt?: ISODateTime;
};

export type IntelligenceRelationship = {
  id: string;
  clientId: ClientId;
  fromId: string;
  toId: string;
  type: "supports" | "contradicts" | "depends_on" | "supersedes" | "derived_from" | "applies_to";
  rationale: string;
};

export type EvidenceRequirement = {
  sourceClasses: readonly SourceClass[];
  minimumItems: number;
  minimumSourceDiversity: number;
  maximumAgeDays?: number;
  minimumGrade?: EvidenceGrade;
  requiredDimensions: readonly string[];
};

export type AbilityManifest = {
  id: string;
  version: string;
  intent: string;
  evidenceRequirements: readonly EvidenceRequirement[];
  method: string;
  outputContract: string;
  qualityRubric: readonly string[];
  humanGates: readonly string[];
  enabledByDefault: boolean;
};

export type DecisionBrief = {
  id: string;
  clientId: ClientId;
  abilityId: string;
  abilityVersion: string;
  question: string;
  pointOfView: string;
  clientRelevance: string;
  evidenceIds: readonly string[];
  citations: readonly Citation[];
  contradictions: readonly string[];
  uncertainty: readonly string[];
  recommendation: string;
  researchGaps: readonly string[];
  nextDecision: string;
  status: "ready" | "needs_context" | "blocked";
  createdAt: ISODateTime;
  contextBasis?: ResearchContextBasis;
  synthesisProvider?: { id: string; version: string };
};

export type ResearchContextBasis = {
  /** Optional only for reading historical artifacts; new ready briefs require version 1. */
  snapshotVersion?: 1;
  projectDigest?: string;
  solutionDigest?: string;
  sensingDigest?: string;
  companyContextVersion?: number;
  companyContextDigest?: string;
  evidence?: readonly { id: string; contentDigest: string }[];
  primaryEvidenceIds?: readonly string[];
  projectId?: string;
  projectUpdatedAt?: string;
  solutionProfileId: string;
  solutionVersion: number;
  sensingProfileId?: string;
  sensingVersion?: number;
  market: string;
  language: string;
  intelligence: readonly { id: string; reviewedAt?: string; evidenceIds: readonly string[]; contentDigest: string }[];
  excludedRecordCount: number;
};

export type CampaignState =
  | "proposed"
  | "approved"
  | "active"
  | "completed"
  | "learning_reviewed"
  | "archived";

export type CampaignScope = { market: string; language: string };

export type Campaign = {
  id: string;
  clientId: ClientId;
  name: string;
  state: CampaignState;
  revision: number;
  objective: string;
  audience: string;
  proposition: string;
  creativeRoutes: readonly string[];
  channels: readonly string[];
  budgetAssumptions: readonly string[];
  /** Absent only on legacy records; never infer campaign coverage from the client profile. */
  targetScopes?: readonly CampaignScope[];
  measurementPlanId?: string;
  approvedAt?: ISODateTime;
};

export type MetricDefinition = {
  key: string;
  label: string;
  unit: string;
  direction: "increase" | "decrease" | "target";
  aggregation: "count" | "sum" | "mean" | "rate" | "index";
  population: string;
};

export type MeasurementConfiguration = {
  population: string;
  metrics: readonly MetricDefinition[];
  baseline: Readonly<Record<string, number>>;
  targets: Readonly<Record<string, number>>;
  checkpoints: readonly ISODateTime[];
  exposureDefinition?: string;
  attributionAssumptions: readonly string[];
  incrementalityDesign?: string;
  materialityThresholds: Readonly<Record<string, number>>;
  decisionRules: readonly string[];
};

export type MeasurementPlan = MeasurementConfiguration & {
  id: string;
  clientId: ClientId;
  campaignId: string;
  objective: string;
  hypothesis: string;
  /** Frozen from the campaign revision when this plan is created. */
  targetScopes?: readonly CampaignScope[];
  /** Exact configurations, not overrides or pooled results. Top-level fields retain the legacy first-scope projection. */
  scopeMeasurements?: readonly { scope: CampaignScope; measurement: MeasurementConfiguration }[];
};

export type StudyDesign = {
  id: string;
  clientId: ClientId;
  measurementPlanId: string;
  requestedClaim: "diagnostic" | "directional" | "brand_lift";
  hasTreatmentGroup: boolean;
  hasControlGroup: boolean;
  assignment: "randomized" | "matched" | "observational" | "none";
  baselineMeasured: boolean;
  outcomeInstrument: string;
  sampleSizeTreatment?: number;
  sampleSizeControl?: number;
  weighting?: string;
  exclusions: readonly string[];
  fieldworkWindow?: { start: ISODateTime; end: ISODateTime };
  preregistered: boolean;
  contaminationRisk: "low" | "medium" | "high" | "unknown";
};

export type StudyClassification = {
  classification: "diagnostic" | "directional" | "causal" | "inconclusive";
  strongestAllowedClaim: string;
  missingRequirements: readonly string[];
  mayUseBrandLiftTerm: boolean;
};

export type SensingProfile = {
  id: string;
  clientId: ClientId;
  version: number;
  themes: readonly string[];
  markets: readonly string[];
  competitors: readonly string[];
  products: readonly string[];
  audiences: readonly string[];
  occasions: readonly string[];
  risks: readonly string[];
  sourceConnectionIds: readonly string[];
  cadence: string;
  lookbackDays: number;
  materialityThreshold: number;
  noveltyThreshold: number;
  confidenceThreshold: number;
  freshnessDays: number;
  expiryDays: number;
  minimumCorroboration: number;
  deduplicationWindowDays: number;
  seasonalExpectations: Readonly<Record<string, number>>;
  suppressionRules: readonly string[];
  downRankingRules: readonly string[];
  destinations: readonly string[];
  humanReviewRequired: boolean;
  decisionContexts: readonly string[];
  quietPeriods: readonly { start: ISODateTime; end: ISODateTime }[];
};

export type SolutionProfile = {
  id: string;
  clientId: ClientId;
  version: number;
  status: "draft" | "active" | "superseded";
  enabledAbilities: readonly { id: string; version: string }[];
  providerBindings: Readonly<Record<string, string>>;
  markets: readonly string[];
  languages: readonly string[];
  reviewRoles: Readonly<Record<string, readonly string[]>>;
  retention: { evidenceDays: number; rawHours: number; auditDays: number };
  sensingProfileId?: string;
  /** Opt-in owned-surface briefing rhythms; omitted means disabled. */
  briefingCadences?: readonly ("weekly" | "monthly" | "quarterly")[];
  createdAt: ISODateTime;
};

export type EvaluationCaseClass =
  | "representative"
  | "sparse_context"
  | "stale_data"
  | "conflicting_evidence"
  | "manipulated_signal"
  | "small_sample"
  | "regulated_category"
  | "multi_market"
  | "recovery";

export type EvaluationArtifactType = "decision_brief" | "monitoring_signal" | "campaign_assessment" | "study_report" | "recovery_exercise";

export type QualityDimension =
  | "evidence_accuracy"
  | "citation_validity"
  | "type_causality_separation"
  | "client_relevance"
  | "contradiction_uncertainty"
  | "source_quality"
  | "strategic_value"
  | "executive_usability"
  | "method_validity"
  | "privacy_tenancy"
  | "alert_quality"
  | "recoverability"
  | "operational_integrity";

export type QualityScorecard = {
  clientId: ClientId;
  caseClass: EvaluationCaseClass;
  artifactType: EvaluationArtifactType;
  artifactId: string;
  rubricVersion: string;
  scores: Partial<Record<QualityDimension, number>>;
  thresholds: Partial<Record<QualityDimension, number>>;
  meanThreshold: number;
  outcome: "passed" | "needs_remediation";
  notes: string;
  limitations: readonly string[];
  evidenceReference: string;
  remediationOf?: string;
  reviewedAt: ISODateTime;
};

export type ExternalValidationGateKey = "pilot_scope" | "source_rights" | "data_policy" | "live_connectors" | "research_quality" | "brand_lift" | "monitoring" | "production_operations";

export type ExternalValidationGate = {
  clientId: ClientId;
  key: ExternalValidationGateKey;
  status: "needs_context" | "verified" | "blocked";
  owner: string;
  scope: string;
  evidenceReference?: string;
  verifiedAt?: ISODateTime;
  expiresAt?: ISODateTime;
};
