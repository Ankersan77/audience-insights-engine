import {
  pgEnum,
  pgTable,
  serial,
  text,
  integer,
  boolean,
  real,
  timestamp,
  jsonb,
  primaryKey,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- Enums -----------------------------------------------------------------

// Phase 0 legacy compatibility only. These types/tables remain in the Drizzle
// model so existing databases are not destructively rewritten. New features
// must use the provider-neutral connector contracts.
export const channelTypeEnum = pgEnum("channel_type", [
  "slack_channel",
  "drive_folder",
]);

export const researchRunStatusEnum = pgEnum("research_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const insightDeliveryStatusEnum = pgEnum("insight_delivery_status", [
  "not_attempted",
  "delivered",
  "failed",
]);

export const lifecycleStateEnum = pgEnum("lifecycle_state", [
  "candidate",
  "live",
  "quarantined",
  "expired",
  "superseded",
]);

export const sourceHealthEnum = pgEnum("source_health", [
  "configured",
  "verified",
  "degraded",
  "unavailable",
  "producing_evidence",
]);

export const acquisitionStatusEnum = pgEnum("acquisition_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const reviewStateEnum = pgEnum("review_state", [
  "pending",
  "accepted",
  "rejected",
  "revision_requested",
]);

export const citationLevelEnum = pgEnum("citation_level", [
  "statistical",
  "paraphrased",
  "verbatim",
]);

export const intelligenceKindEnum = pgEnum("intelligence_kind", [
  "observation",
  "signal",
  "fact",
  "hypothesis",
  "insight",
  "recommendation",
  "decision",
  "learning",
  "knowledge_gap",
]);

export const campaignStateEnum = pgEnum("campaign_state", [
  "proposed",
  "approved",
  "active",
  "completed",
  "learning_reviewed",
  "archived",
]);

export const studyClassificationEnum = pgEnum("study_classification", [
  "diagnostic",
  "directional",
  "causal",
  "inconclusive",
]);

// --- Reference / account tables ---------------------------------------------

export const client = pgTable("client", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("client_slug_unique").on(table.slug)]);

export const appUser = pgTable("app_user", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  ssoSubjectId: text("sso_subject_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const clientMembership = pgTable("client_membership", {
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => appUser.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.clientId, table.userId] })]);

export const solutionProfile = pgTable("solution_profile", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  profileJson: jsonb("profile_json").notNull(),
  createdBy: integer("created_by").references(() => appUser.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("solution_profile_client_version_unique").on(table.clientId, table.version)]);

export const market = pgTable("market", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  // Compliance review blocking finding (spec §16): a market can be gated off
  // from actually running research until Legal signs off (Greece, at launch).
  // Defaults true so every other market keeps working with no extra step.
  processingEnabled: boolean("processing_enabled").notNull().default(true),
});

// --- Brand tables ------------------------------------------------------------

export const brand = pgTable("brand", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => appUser.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by")
    .notNull()
    .references(() => appUser.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  unique("brand_slug_unique").on(table.slug),
]);

export const brandMarket = pgTable("brand_market", {
  brandId: integer("brand_id")
    .notNull()
    .references(() => brand.id, { onDelete: "cascade" }),
  marketId: integer("market_id")
    .notNull()
    .references(() => market.id, { onDelete: "cascade" }),
  ga4PropertyId: text("ga4_property_id"),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.marketId] }),
]);

export const researchInstruction = pgTable("research_instruction", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id")
    .notNull()
    .references(() => brand.id, { onDelete: "restrict" }),
  marketId: integer("market_id").references(() => market.id, {
    onDelete: "restrict",
  }),
  version: integer("version").notNull(),
  subreddits: text("subreddits").array().notNull().default(sql`'{}'::text[]`),
  dedicatedSubreddits: text("dedicated_subreddits")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  xHandle: text("x_handle"),
  xRelated: text("x_related").array().notNull().default(sql`'{}'::text[]`),
  tiktokHashtags: text("tiktok_hashtags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  competitors: text("competitors").array().notNull().default(sql`'{}'::text[]`),
  focusText: text("focus_text"),
  updatedBy: integer("updated_by")
    .notNull()
    .references(() => appUser.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  unique("research_instruction_brand_market_version_unique").on(
    table.brandId,
    table.marketId,
    table.version,
  ),
]);

// --- Legacy channels and routing (inactive; migration compatibility) --------

export const channel = pgTable("channel", {
  id: serial("id").primaryKey(),
  type: channelTypeEnum("type").notNull(),
  externalRef: text("external_ref").notNull(),
  displayName: text("display_name").notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => appUser.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  unique("channel_type_external_ref_unique").on(table.type, table.externalRef),
]);

export const insightRoute = pgTable("insight_route", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id").references(() => brand.id, {
    onDelete: "restrict",
  }),
  insightType: text("insight_type").notNull(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "restrict" }),
});

// --- Runs and evidence ---------------------------------------------------------

export const researchRun = pgTable("research_run", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  brandId: integer("brand_id")
    .notNull()
    .references(() => brand.id, { onDelete: "restrict" }),
  marketId: integer("market_id").references(() => market.id, {
    onDelete: "restrict",
  }),
  researchInstructionVersion: integer("research_instruction_version").notNull(),
  triggeredBy: integer("triggered_by")
    .notNull()
    .references(() => appUser.id, { onDelete: "restrict" }),
  status: researchRunStatusEnum("status").notNull().default("queued"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  timedOutAt: timestamp("timed_out_at", { withTimezone: true }),
  errorMessage: text("error_message"),
}, (table) => [
  uniqueIndex("research_run_active_brand_market_unique")
    .on(table.brandId, table.marketId)
    .where(sql`${table.status} in ('queued', 'running')`),
]);

export const evidence = pgTable("evidence", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => researchRun.id, { onDelete: "restrict" }),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url"),
  // Legacy identity-bearing field. Phase 2 must migrate or purge it before
  // production ingestion; new connector contracts do not expose this field.
  authorHandle: text("author_handle"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  textSnippet: text("text_snippet"),
  engagementJson: jsonb("engagement_json"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  sensitivityFlag: boolean("sensitivity_flag"),
}, (table) => [
  unique("evidence_run_source_external_id_unique").on(
    table.runId,
    table.source,
    table.externalId,
  ),
]);

// --- Insights -------------------------------------------------------------------

export const insight = pgTable("insight", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  brandId: integer("brand_id")
    .notNull()
    .references(() => brand.id, { onDelete: "restrict" }),
  marketId: integer("market_id").references(() => market.id, {
    onDelete: "restrict",
  }),
  runId: integer("run_id")
    .notNull()
    .references(() => researchRun.id, { onDelete: "restrict" }),
  insightType: text("insight_type").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  shiftOrBlip: text("shift_or_blip").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by").references(() => appUser.id, {
    onDelete: "restrict",
  }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // Legacy external-delivery fields, retained until an additive migration can
  // safely remove them from existing deployments.
  routedAt: timestamp("routed_at", { withTimezone: true }),
  deliveryStatus: insightDeliveryStatusEnum("delivery_status")
    .notNull()
    .default("not_attempted"),
});

export const insightEvidence = pgTable("insight_evidence", {
  insightId: integer("insight_id")
    .notNull()
    .references(() => insight.id, { onDelete: "cascade" }),
  evidenceId: integer("evidence_id")
    .notNull()
    .references(() => evidence.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.insightId, table.evidenceId] }),
]);

// --- Audit -------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => appUser.id, {
    onDelete: "restrict",
  }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Canonical Market Research foundation -----------------------------------

export const sourceConnection = pgTable("source_connection", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  connectorId: text("connector_id").notNull(),
  connectorVersion: text("connector_version").notNull(),
  sourceClass: text("source_class").notNull(),
  credentialRef: text("credential_ref"),
  health: sourceHealthEnum("health").notNull().default("configured"),
  configurationJson: jsonb("configuration_json").notNull(),
  rightsJson: jsonb("rights_json").notNull(),
  retentionDays: integer("retention_days").notNull(),
  rawRetentionHours: integer("raw_retention_hours").notNull(),
  lastSuccessfulReceiptAt: timestamp("last_successful_receipt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("source_connection_client_connector_unique").on(table.clientId, table.connectorId),
]);

export const sourceAcquisitionJob = pgTable("source_acquisition_job", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  sourceConnectionId: integer("source_connection_id")
    .notNull()
    .references(() => sourceConnection.id, { onDelete: "restrict" }),
  monitoringRunId: integer("monitoring_run_id")
    .references(() => monitoringRun.id, { onDelete: "set null" }),
  status: acquisitionStatusEnum("status").notNull().default("queued"),
  operation: text("operation").notNull(),
  requestJson: jsonb("request_json").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (table) => [
  unique("source_acquisition_job_client_idempotency_unique").on(table.clientId, table.idempotencyKey),
]);

export const sourceAcquisitionReceipt = pgTable("source_acquisition_receipt", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => sourceAcquisitionJob.id, { onDelete: "restrict" }),
  status: acquisitionStatusEnum("status").notNull(),
  acquiredCount: integer("acquired_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  nextCursor: text("next_cursor"),
  safeArtifactRefs: text("safe_artifact_refs").array().notNull().default(sql`'{}'::text[]`),
  errorCode: text("error_code"),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("source_acquisition_receipt_job_unique").on(table.jobId)]);

export const evidenceCollection = pgTable("evidence_collection", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  sourceConnectionId: integer("source_connection_id")
    .notNull()
    .references(() => sourceConnection.id, { onDelete: "restrict" }),
  acquisitionJobId: integer("acquisition_job_id")
    .notNull()
    .references(() => sourceAcquisitionJob.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  methodJson: jsonb("method_json").notNull(),
  rightsJson: jsonb("rights_json").notNull(),
  applicabilityJson: jsonb("applicability_json").notNull(),
  lifecycle: lifecycleStateEnum("lifecycle").notNull().default("candidate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const canonicalEvidence = pgTable("canonical_evidence", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  collectionId: integer("collection_id")
    .notNull()
    .references(() => evidenceCollection.id, { onDelete: "restrict" }),
  sourceConnectionId: integer("source_connection_id")
    .notNull()
    .references(() => sourceConnection.id, { onDelete: "restrict" }),
  externalReference: text("external_reference").notNull(),
  safeSourceUrl: text("safe_source_url"),
  sourceContent: text("source_content").notNull(),
  synthesis: text("synthesis"),
  contentHash: text("content_hash").notNull(),
  citationLevel: citationLevelEnum("citation_level").notNull(),
  lifecycle: lifecycleStateEnum("lifecycle").notNull().default("candidate"),
  grade: text("grade").notNull().default("ungraded"),
  confidence: real("confidence").notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
  identityRisk: boolean("identity_risk").notNull().default(false),
  redactions: text("redactions").array().notNull().default(sql`'{}'::text[]`),
  methodJson: jsonb("method_json").notNull(),
  rightsJson: jsonb("rights_json").notNull(),
  applicabilityJson: jsonb("applicability_json").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("canonical_evidence_client_source_hash_unique").on(table.clientId, table.sourceConnectionId, table.contentHash),
]);

export const quantitativeObservation = pgTable("quantitative_observation", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  evidenceId: integer("evidence_id")
    .notNull()
    .references(() => canonicalEvidence.id, { onDelete: "cascade" }),
  metricKey: text("metric_key").notNull(),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  dimensionsJson: jsonb("dimensions_json").notNull(),
  cohortSize: integer("cohort_size"),
  suppressed: boolean("suppressed").notNull().default(false),
});

export const qualitativeTheme = pgTable("qualitative_theme", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  label: text("label").notNull(),
  paraphrase: text("paraphrase").notNull(),
  evidenceIds: integer("evidence_ids").array().notNull(),
  occurrenceCount: integer("occurrence_count").notNull(),
  sourceDiversity: integer("source_diversity").notNull(),
  method: text("method").notNull(),
  suppressed: boolean("suppressed").notNull().default(false),
});

export const citation = pgTable("citation", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  evidenceId: integer("evidence_id")
    .notNull()
    .references(() => canonicalEvidence.id, { onDelete: "cascade" }),
  level: citationLevelEnum("level").notNull(),
  safeReference: text("safe_reference").notNull(),
  excerpt: text("excerpt"),
  reviewReason: text("review_reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const intelligenceRecord = pgTable("intelligence_record", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  kind: intelligenceKindEnum("kind").notNull(),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  lifecycle: lifecycleStateEnum("lifecycle").notNull().default("candidate"),
  reviewState: reviewStateEnum("review_state").notNull().default("pending"),
  evidenceIds: integer("evidence_ids").array().notNull().default(sql`'{}'::integer[]`),
  contradictionIds: integer("contradiction_ids").array().notNull().default(sql`'{}'::integer[]`),
  dependencyIds: integer("dependency_ids").array().notNull().default(sql`'{}'::integer[]`),
  applicabilityJson: jsonb("applicability_json").notNull(),
  confidence: real("confidence").notNull(),
  uncertainty: text("uncertainty").array().notNull().default(sql`'{}'::text[]`),
  synthesisBy: text("synthesis_by").notNull(),
  reviewedBy: integer("reviewed_by").references(() => appUser.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  supersedesId: integer("supersedes_id"),
  decayAt: timestamp("decay_at", { withTimezone: true }),
});

export const intelligenceRelationship = pgTable("intelligence_relationship", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  fromId: integer("from_id")
    .notNull()
    .references(() => intelligenceRecord.id, { onDelete: "cascade" }),
  toId: integer("to_id")
    .notNull()
    .references(() => intelligenceRecord.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  rationale: text("rationale").notNull(),
}, (table) => [unique("intelligence_relationship_unique").on(table.fromId, table.toId, table.type)]);

export const abilityManifest = pgTable("ability_manifest", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => client.id, { onDelete: "restrict" }),
  abilityKey: text("ability_key").notNull(),
  version: text("version").notNull(),
  manifestJson: jsonb("manifest_json").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("ability_manifest_scope_version_unique").on(table.clientId, table.abilityKey, table.version)]);

export const researchArtifact = pgTable("research_artifact", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  artifactKey: text("artifact_key").notNull(),
  artifactType: text("artifact_type").notNull(),
  abilityKey: text("ability_key"),
  abilityVersion: text("ability_version"),
  status: text("status").notNull(),
  version: integer("version").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  evidenceIds: integer("evidence_ids").array().notNull().default(sql`'{}'::integer[]`),
  createdBy: integer("created_by").references(() => appUser.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("research_artifact_client_key_version_unique").on(table.clientId, table.artifactKey, table.version)]);

export const campaign = pgTable("campaign", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  state: campaignStateEnum("state").notNull().default("proposed"),
  currentRevision: integer("current_revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const campaignRevision = pgTable("campaign_revision", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaign.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  briefJson: jsonb("brief_json").notNull(),
  approvedBy: integer("approved_by").references(() => appUser.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("campaign_revision_unique").on(table.campaignId, table.revision)]);

export const measurementPlan = pgTable("measurement_plan", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaign.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  planJson: jsonb("plan_json").notNull(),
  reviewState: reviewStateEnum("review_state").notNull().default("pending"),
  reviewedBy: integer("reviewed_by").references(() => appUser.id, { onDelete: "restrict" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("measurement_plan_campaign_version_unique").on(table.campaignId, table.version)]);

export const study = pgTable("study", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  measurementPlanId: integer("measurement_plan_id")
    .notNull()
    .references(() => measurementPlan.id, { onDelete: "restrict" }),
  classification: studyClassificationEnum("classification").notNull(),
  designJson: jsonb("design_json").notNull(),
  resultJson: jsonb("result_json"),
  integrityState: text("integrity_state").notNull().default("unverified"),
  reviewState: reviewStateEnum("review_state").notNull().default("pending"),
  reviewedBy: integer("reviewed_by").references(() => appUser.id, { onDelete: "restrict" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sensingProfile = pgTable("sensing_profile", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  profileJson: jsonb("profile_json").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("sensing_profile_client_version_unique").on(table.clientId, table.version)]);

export const monitoringRun = pgTable("monitoring_run", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  sensingProfileId: integer("sensing_profile_id")
    .notNull()
    .references(() => sensingProfile.id, { onDelete: "restrict" }),
  scheduleKey: text("schedule_key").notNull(),
  status: acquisitionStatusEnum("status").notNull().default("queued"),
  outcome: text("outcome"),
  qualifiedSignalIds: integer("qualified_signal_ids").array().notNull().default(sql`'{}'::integer[]`),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  unique("monitoring_run_profile_schedule_unique").on(table.clientId, table.sensingProfileId, table.scheduleKey),
]);

export const governanceAudit = pgTable("governance_audit", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => client.id, { onDelete: "restrict" }),
  actorUserId: integer("actor_user_id").references(() => appUser.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  redactedBeforeJson: jsonb("redacted_before_json"),
  redactedAfterJson: jsonb("redacted_after_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
