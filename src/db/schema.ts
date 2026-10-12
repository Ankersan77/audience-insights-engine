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

// --- Reference / account tables ---------------------------------------------

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

// --- Channels and routing ----------------------------------------------------

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
