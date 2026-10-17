import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { Campaign, CampaignScope, MeasurementPlan, StudyDesign } from "@/src/core/contracts";
import { campaignScopeKey, parseCampaignScopes, resolveCampaignScope, sameCampaignScopes } from "@/src/campaigns/scope";
import type { ContextualPreflight } from "@/src/campaigns/preflight";
import { measurementConfiguration } from "@/src/campaigns/measurementScope";
import { parseMeasurementConfiguration } from "@/src/campaigns/measurementInput";
import type { CampaignAssessment } from "@/src/campaigns/analysis";
import { assertCampaignTransition } from "@/src/core/transitions";
import { validateCampaign, validateMeasurementPlan, validateStudyDesign } from "@/src/core/validation";
import { db } from "@/src/db/client";
import { campaign, campaignRevision, canonicalEvidence, governanceAudit, intelligenceRecord, measurementPlan, researchArtifact, study } from "@/src/db/schema";
import { classifyStudy } from "@/src/measurement/studies";
import { assertCurrentPreflight, createContextualPreflight, lockedContext } from "./campaign_preflight";
import { prepareResearchContext } from "@/src/abilities/context";
import type { Applicability } from "@/src/core/contracts";
import { createCampaignResultAssessment, projectAvailableCampaignResults } from "./campaign_results";

export type CampaignRevisionPayload = {
  campaign: Campaign;
  strategicEvidenceIds: readonly number[];
  brandConstraints: readonly string[];
  approvedPreflightId?: number;
  approvedPreflights?: readonly (CampaignScope & { artifactId: number })[];
  reviewedLearningId?: number;
};

export type CampaignWorkspaceRow = {
  id: number;
  state: Campaign["state"];
  currentRevision: number;
  payload: CampaignRevisionPayload;
  measurementPlan: MeasurementPlan | null;
  measurementPlanDbId: number | null;
  measurementPlanVersion: number | null;
  measurementPlanReviewState: "pending" | "accepted" | "rejected" | "revision_requested" | null;
  latestAssessments: Partial<Record<CampaignAssessment["stage"], CampaignAssessmentArtifact>>;
  scopedPreflights: CampaignAssessmentArtifact[];
  createdAt: Date;
};

export type CampaignAssessmentArtifact = {
  id: number;
  campaignId: number;
  version: number;
  assessment: CampaignAssessment;
  evidenceIds: readonly number[];
  createdAt: Date;
};

async function latestCampaignAssessments(clientId: number, campaignId: number): Promise<CampaignWorkspaceRow["latestAssessments"]> {
  const rows = await db.select().from(researchArtifact).where(and(
    eq(researchArtifact.clientId, clientId),
    eq(researchArtifact.artifactType, "campaign_assessment"),
  )).orderBy(desc(researchArtifact.id));
  const result: CampaignWorkspaceRow["latestAssessments"] = {};
  for (const row of rows) {
    const payload = row.payloadJson as { campaignId?: number; assessment?: CampaignAssessment };
    if (payload.campaignId !== campaignId || !payload.assessment || result[payload.assessment.stage]) continue;
    result[payload.assessment.stage] = {
      id: row.id,
      campaignId,
      version: row.version,
      assessment: await projectAvailableCampaignResults(clientId, payload.assessment),
      evidenceIds: row.evidenceIds,
      createdAt: row.createdAt,
    };
  }
  return result;
}

async function latestMeasurementPlan(clientId: number, campaignId: number) {
  const [row] = await db
    .select()
    .from(measurementPlan)
    .where(and(eq(measurementPlan.clientId, clientId), eq(measurementPlan.campaignId, campaignId)))
    .orderBy(desc(measurementPlan.version))
    .limit(1);
  return row ?? null;
}

async function scopedPreflights(clientId: number, campaignId: number): Promise<CampaignAssessmentArtifact[]> {
  const rows = await db.select().from(researchArtifact).where(and(eq(researchArtifact.clientId, clientId),
    eq(researchArtifact.artifactType, "campaign_assessment"), eq(researchArtifact.artifactKey, `campaign:${campaignId}:preflight`))).orderBy(desc(researchArtifact.version), desc(researchArtifact.id));
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const assessment = (row.payloadJson as { assessment?: ContextualPreflight }).assessment;
    if (!assessment?.targetScope) return [];
    const key = campaignScopeKey(assessment.targetScope);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: row.id, campaignId, version: row.version, assessment, evidenceIds: row.evidenceIds, createdAt: row.createdAt }];
  });
}

export async function listCampaignWorkspace(clientId: number): Promise<CampaignWorkspaceRow[]> {
  const campaigns = await db.select().from(campaign).where(eq(campaign.clientId, clientId)).orderBy(desc(campaign.id));
  return Promise.all(campaigns.map(async (row) => {
    const [revision] = await db
      .select()
      .from(campaignRevision)
      .where(and(
        eq(campaignRevision.clientId, clientId),
        eq(campaignRevision.campaignId, row.id),
        eq(campaignRevision.revision, row.currentRevision),
      ))
      .limit(1);
    if (!revision) throw new Error(`campaign-revision-missing:${row.id}`);
    const plan = await latestMeasurementPlan(clientId, row.id);
    const payload = revision.briefJson as CampaignRevisionPayload;
    const latestAssessments = await latestCampaignAssessments(clientId, row.id);
    return {
      id: row.id,
      state: row.state,
      currentRevision: row.currentRevision,
      payload: {
        ...payload,
        campaign: { ...payload.campaign, state: row.state, revision: row.currentRevision, measurementPlanId: plan ? String(plan.id) : undefined },
      },
      measurementPlan: plan ? plan.planJson as MeasurementPlan : null,
      measurementPlanDbId: plan?.id ?? null,
      measurementPlanVersion: plan?.version ?? null,
      measurementPlanReviewState: plan?.reviewState ?? null,
      latestAssessments,
      scopedPreflights: await scopedPreflights(clientId, row.id),
      createdAt: row.createdAt,
    };
  }));
}

export async function createCampaignRecord(input: {
  clientId: number;
  name: string;
  objective: string;
  audience: string;
  proposition: string;
  creativeRoutes: readonly string[];
  channels: readonly string[];
  budgetAssumptions: readonly string[];
  strategicEvidenceIds: readonly number[];
  brandConstraints: readonly string[];
  targetScopes: unknown;
}): Promise<CampaignWorkspaceRow> {
  const targetScopes = parseCampaignScopes(input.targetScopes);
  if (input.strategicEvidenceIds.length > 0) {
    const owned = await db.select({ id: canonicalEvidence.id }).from(canonicalEvidence).where(and(
      eq(canonicalEvidence.clientId, input.clientId),
      inArray(canonicalEvidence.id, [...input.strategicEvidenceIds]),
    ));
    if (new Set(owned.map((item) => item.id)).size !== new Set(input.strategicEvidenceIds).size) {
      throw new Error("campaign-evidence-scope-mismatch");
    }
  }
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(campaign).values({ clientId: input.clientId, name: input.name, state: "proposed", currentRevision: 1 }).returning();
    const domain: Campaign = {
      id: String(created.id), clientId: String(input.clientId), name: input.name, state: "proposed", revision: 1,
      objective: input.objective, audience: input.audience, proposition: input.proposition, targetScopes,
      creativeRoutes: input.creativeRoutes, channels: input.channels, budgetAssumptions: input.budgetAssumptions,
    };
    const validation = validateCampaign(domain);
    if (!validation.valid) throw new Error(`invalid-campaign:${validation.errors.join(";")}`);
    const payload: CampaignRevisionPayload = { campaign: domain, strategicEvidenceIds: input.strategicEvidenceIds, brandConstraints: input.brandConstraints };
    await tx.insert(campaignRevision).values({ clientId: input.clientId, campaignId: created.id, revision: 1, briefJson: payload });
    return { id: created.id, state: created.state, currentRevision: 1, payload, measurementPlan: null, measurementPlanDbId: null, measurementPlanVersion: null, measurementPlanReviewState: null, latestAssessments: {}, scopedPreflights: [], createdAt: created.createdAt };
  });
}

export async function reviseCampaignScopes(input: { clientId: number; campaignId: number; expectedRevision: number; targetScopes: unknown; actorUserId: number }) {
  const targetScopes = parseCampaignScopes(input.targetScopes);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error("invalid-campaign-revision");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73004, ${input.campaignId})`);
    await tx.execute(sql`select pg_advisory_xact_lock(73003, ${input.campaignId})`);
    const [row] = await tx.select().from(campaign).where(and(eq(campaign.clientId, input.clientId), eq(campaign.id, input.campaignId)));
    if (!row) throw new Error("campaign-not-found");
    if (row.state !== "proposed") throw new Error("campaign-scope-frozen-after-approval");
    if (row.currentRevision !== input.expectedRevision) throw new Error("campaign-revision-conflict");
    const [revision] = await tx.select().from(campaignRevision).where(and(eq(campaignRevision.clientId, input.clientId), eq(campaignRevision.campaignId, row.id), eq(campaignRevision.revision, row.currentRevision)));
    if (!revision) throw new Error("campaign-revision-missing");
    const payload = revision.briefJson as CampaignRevisionPayload;
    if (sameCampaignScopes(payload.campaign.targetScopes, targetScopes)) return { revision: row.currentRevision };
    const nextRevision = row.currentRevision + 1;
    await tx.insert(campaignRevision).values({ clientId: input.clientId, campaignId: row.id, revision: nextRevision,
      briefJson: { ...payload, campaign: { ...payload.campaign, targetScopes, revision: nextRevision } } });
    await tx.update(campaign).set({ currentRevision: nextRevision }).where(and(eq(campaign.clientId, input.clientId), eq(campaign.id, row.id)));
    await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.actorUserId, action: "update", entityType: "campaign", entityId: String(row.id),
      redactedBeforeJson: { revision: row.currentRevision, targetScopes: payload.campaign.targetScopes }, redactedAfterJson: { revision: nextRevision, targetScopes, requiresReassessment: true, measurementScopeMustMatch: true } });
    return { revision: nextRevision };
  });
}

export async function createMeasurementPlanRecord(input: {
  clientId: number;
  campaignId: number;
  plan: Omit<MeasurementPlan, "id" | "clientId" | "campaignId">;
  expectedRevision?: number;
  expectedPlanVersion?: number | null;
  actorUserId?: number;
}): Promise<{ id: number; plan: MeasurementPlan; version: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73003, ${input.campaignId})`);
    const [ownedCampaign] = await tx.select().from(campaign).where(and(eq(campaign.id, input.campaignId), eq(campaign.clientId, input.clientId))).limit(1);
    if (!ownedCampaign) throw new Error("campaign-not-found");
    if (ownedCampaign.state !== "proposed") throw new Error("measurement-plan-frozen-after-approval");
    if (input.expectedRevision !== undefined && input.expectedRevision !== ownedCampaign.currentRevision) throw new Error("campaign-revision-conflict");
    const [versionRow] = await tx.select({ value: max(measurementPlan.version) }).from(measurementPlan).where(and(eq(measurementPlan.clientId, input.clientId), eq(measurementPlan.campaignId, input.campaignId)));
    const version = Number(versionRow?.value ?? 0) + 1;
    if (input.expectedPlanVersion !== undefined && input.expectedPlanVersion !== (version === 1 ? null : version - 1)) throw new Error("measurement-plan-version-conflict");
    const [revision] = await tx.select().from(campaignRevision).where(and(eq(campaignRevision.clientId, input.clientId), eq(campaignRevision.campaignId, input.campaignId), eq(campaignRevision.revision, ownedCampaign.currentRevision)));
    const targetScopes = parseCampaignScopes((revision?.briefJson as CampaignRevisionPayload | undefined)?.campaign.targetScopes);
    if (!input.plan.scopeMeasurements && targetScopes.length !== 1) throw new Error("explicit-per-scope-measurement-required");
    const scopeMeasurements = input.plan.scopeMeasurements?.map((item) => ({ scope: parseCampaignScopes([item.scope])[0], measurement: parseMeasurementConfiguration(item.measurement) }))
      ?? [{ scope: targetScopes[0], measurement: parseMeasurementConfiguration(measurementConfiguration(input.plan)) }];
    if (!sameCampaignScopes(targetScopes, scopeMeasurements.map((item) => item.scope))) throw new Error("measurement-scope-coverage-mismatch");
    const domain: MeasurementPlan = { ...input.plan, ...scopeMeasurements[0].measurement, scopeMeasurements, targetScopes, id: `campaign:${input.campaignId}:measurement:${version}`, clientId: String(input.clientId), campaignId: String(input.campaignId) };
    const validation = validateMeasurementPlan(domain);
    if (!validation.valid) throw new Error(`invalid-measurement-plan:${validation.errors.join(";")}`);
    const [created] = await tx.insert(measurementPlan).values({ clientId: input.clientId, campaignId: input.campaignId, version, planJson: domain, reviewState: "pending" }).returning();
    if (input.actorUserId !== undefined) await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.actorUserId, action: "create", entityType: "measurement_plan", entityId: String(created.id), redactedAfterJson: { campaignId: input.campaignId, campaignRevision: ownedCampaign.currentRevision, version, targetScopes } });
    return { id: created.id, plan: domain, version };
  });
}

export async function transitionCampaignRecord(input: {
  clientId: number;
  campaignId: number;
  nextState: Campaign["state"];
  actorUserId: number;
  learningRecordId?: number;
}): Promise<CampaignWorkspaceRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73004, ${input.campaignId})`);
    await tx.execute(sql`select pg_advisory_xact_lock(73003, ${input.campaignId})`);
    const [row] = await tx.select().from(campaign).where(and(eq(campaign.id, input.campaignId), eq(campaign.clientId, input.clientId))).limit(1);
    if (!row) throw new Error("campaign-not-found");
    assertCampaignTransition(row.state, input.nextState);
    const [current] = await tx.select().from(campaignRevision).where(and(eq(campaignRevision.clientId, input.clientId), eq(campaignRevision.campaignId, row.id), eq(campaignRevision.revision, row.currentRevision))).limit(1);
    if (!current) throw new Error("campaign-revision-missing");
    const [plan] = await tx.select().from(measurementPlan).where(and(eq(measurementPlan.clientId, input.clientId), eq(measurementPlan.campaignId, row.id))).orderBy(desc(measurementPlan.version)).limit(1);
    if (["approved", "active", "completed", "learning_reviewed"].includes(input.nextState) && !plan) throw new Error("measurement-plan-required");
    if (input.nextState === "approved" && plan?.reviewState !== "accepted") throw new Error("accepted-measurement-plan-required");
    const preflight = input.nextState === "approved" ? await assertCurrentPreflight(tx, input) : undefined;
    let recheckLearning: (() => void) | undefined;
    if (input.nextState === "learning_reviewed") {
      if (parseCampaignScopes((current.briefJson as CampaignRevisionPayload).campaign.targetScopes).length !== 1) throw new Error("multi-scope-learning-review-not-yet-supported");
      if (!input.learningRecordId) throw new Error("accepted-learning-required");
      const [learning] = await tx.select().from(intelligenceRecord).where(and(
        eq(intelligenceRecord.id, input.learningRecordId), eq(intelligenceRecord.clientId, input.clientId),
        eq(intelligenceRecord.kind, "learning"), eq(intelligenceRecord.reviewState, "accepted"),
      )).limit(1);
      const scope = learning?.applicabilityJson as Applicability | undefined;
      const campaigns = scope?.campaigns;
      if (!learning || !Array.isArray(campaigns) || !campaigns.includes(String(row.id))) throw new Error("accepted-campaign-learning-required");
      if (scope?.markets.length !== 1 || scope.languages.length !== 1) throw new Error("scoped-campaign-learning-required");
      resolveCampaignScope((current.briefJson as CampaignRevisionPayload).campaign.targetScopes, scope.markets[0], scope.languages[0]);
      const sources = await lockedContext(tx, input.clientId, scope.markets[0], scope.languages[0]);
      recheckLearning = () => {
        const current = prepareResearchContext({ clientId: String(input.clientId), campaignId: String(row.id), abilityId: "post-campaign-learning", market: scope.markets[0], language: scope.languages[0], sources: sources(), now: new Date().toISOString() });
        if (current.gaps.length || !current.context?.marketTwin.some((record) => record.id === String(learning.id) && record.kind === "learning")) throw new Error("current-campaign-learning-evidence-required");
      };
      recheckLearning();
    }
    const nextRevision = row.currentRevision + 1;
    const reviewedLearningId = input.nextState === "learning_reviewed" ? input.learningRecordId : undefined;
    const currentPayload = current.briefJson as CampaignRevisionPayload;
    const domain: Campaign = {
      ...currentPayload.campaign,
      state: input.nextState,
      revision: nextRevision,
      measurementPlanId: plan ? String(plan.id) : undefined,
      approvedAt: input.nextState === "approved" ? new Date().toISOString() : currentPayload.campaign.approvedAt,
    };
    await tx.insert(campaignRevision).values({
      clientId: input.clientId, campaignId: row.id, revision: nextRevision,
      briefJson: { ...currentPayload, campaign: domain, ...(preflight ? { approvedPreflightId: preflight.id, approvedPreflights: preflight.approved } : {}), ...(reviewedLearningId ? { reviewedLearningId } : {}) }, approvedBy: input.nextState === "approved" ? input.actorUserId : null,
    });
    const [updated] = await tx.update(campaign).set({ state: input.nextState, currentRevision: nextRevision, archivedAt: input.nextState === "archived" ? new Date() : null }).where(and(eq(campaign.id, row.id), eq(campaign.clientId, input.clientId))).returning();
    await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.actorUserId, action: "transition", entityType: "campaign", entityId: String(row.id),
      redactedBeforeJson: { state: row.state, revision: row.currentRevision }, redactedAfterJson: { state: updated.state, revision: nextRevision, approvedPreflightId: preflight?.id, approvedPreflights: preflight?.approved, reviewedLearningId } });
    preflight?.recheck();
    recheckLearning?.();
    return { id: updated.id, state: updated.state, currentRevision: nextRevision, payload: { ...currentPayload, campaign: domain, ...(preflight ? { approvedPreflightId: preflight.id, approvedPreflights: preflight.approved } : {}), ...(reviewedLearningId ? { reviewedLearningId } : {}) }, measurementPlan: plan ? plan.planJson as MeasurementPlan : null, measurementPlanDbId: plan?.id ?? null, measurementPlanVersion: plan?.version ?? null, measurementPlanReviewState: plan?.reviewState ?? null, latestAssessments: await latestCampaignAssessments(input.clientId, row.id), scopedPreflights: await scopedPreflights(input.clientId, row.id), createdAt: updated.createdAt };
  });
}

export async function reviewMeasurementPlan(input: {
  clientId: number;
  campaignId: number;
  reviewerUserId: number;
  decision: "accepted" | "rejected" | "revision_requested";
  expectedPlanVersion?: number;
}): Promise<{ id: number; reviewState: string } | null> {
  return db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(73003, ${input.campaignId})`);
  const [plan] = await tx.select().from(measurementPlan).where(and(eq(measurementPlan.clientId, input.clientId), eq(measurementPlan.campaignId, input.campaignId))).orderBy(desc(measurementPlan.version)).limit(1);
  if (!plan) return null;
  if (input.expectedPlanVersion !== undefined && input.expectedPlanVersion !== plan.version) throw new Error("measurement-plan-version-conflict");
  const [updated] = await tx.update(measurementPlan).set({
    reviewState: input.decision,
    reviewedBy: input.reviewerUserId,
    reviewedAt: new Date(),
  }).where(and(
    eq(measurementPlan.id, plan.id),
    eq(measurementPlan.clientId, input.clientId),
    eq(measurementPlan.reviewState, "pending"),
  )).returning({ id: measurementPlan.id, reviewState: measurementPlan.reviewState });
  if (updated) await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.reviewerUserId, action: "review", entityType: "measurement_plan", entityId: String(updated.id), redactedAfterJson: { campaignId: input.campaignId, version: plan.version, reviewState: updated.reviewState } });
  return updated ?? null;
  });
}

export type StudyWorkspaceRow = {
  id: number;
  campaignId: number;
  classification: "diagnostic" | "directional" | "causal" | "inconclusive";
  design: StudyDesign;
  classificationResult: ReturnType<typeof classifyStudy>;
  integrityState: string;
  reviewState: string;
  createdAt: Date;
};

export async function createStudyRecord(input: { clientId: number; measurementPlanId: number; design: Omit<StudyDesign, "id" | "clientId" | "measurementPlanId"> }): Promise<StudyWorkspaceRow> {
  const [plan] = await db.select().from(measurementPlan).where(and(eq(measurementPlan.id, input.measurementPlanId), eq(measurementPlan.clientId, input.clientId))).limit(1);
  if (!plan) throw new Error("measurement-plan-not-found");
  const domain: StudyDesign = { ...input.design, id: `study:${input.measurementPlanId}:${Date.now()}`, clientId: String(input.clientId), measurementPlanId: String(input.measurementPlanId) };
  const validation = validateStudyDesign(domain);
  if (!validation.valid) throw new Error(`invalid-study-design:${validation.errors.join(";")}`);
  const classificationResult = classifyStudy(domain);
  const [created] = await db.insert(study).values({
    clientId: input.clientId, measurementPlanId: input.measurementPlanId,
    classification: classificationResult.classification, designJson: { ...domain, classificationResult },
    integrityState: "unverified", reviewState: "pending",
  }).returning();
  return { id: created.id, campaignId: plan.campaignId, classification: created.classification, design: domain, classificationResult, integrityState: created.integrityState, reviewState: created.reviewState, createdAt: created.createdAt };
}

export async function listStudies(clientId: number): Promise<StudyWorkspaceRow[]> {
  const rows = await db.select({ study, campaignId: measurementPlan.campaignId }).from(study).innerJoin(measurementPlan, and(eq(measurementPlan.id, study.measurementPlanId), eq(measurementPlan.clientId, study.clientId))).where(eq(study.clientId, clientId)).orderBy(desc(study.id));
  return rows.map(({ study: row, campaignId }) => {
    const stored = row.designJson as StudyDesign & { classificationResult?: ReturnType<typeof classifyStudy> };
    const classificationResult = stored.classificationResult ?? classifyStudy(stored);
    return { id: row.id, campaignId, classification: row.classification, design: stored, classificationResult, integrityState: row.integrityState, reviewState: row.reviewState, createdAt: row.createdAt };
  });
}

export async function reviewStudyRecord(input: {
  clientId: number;
  studyId: number;
  reviewerUserId: number;
  decision: "accepted" | "rejected" | "revision_requested";
}): Promise<{ id: number; reviewState: string } | null> {
  const [updated] = await db.update(study).set({
    reviewState: input.decision,
    reviewedBy: input.reviewerUserId,
    reviewedAt: new Date(),
  }).where(and(
    eq(study.id, input.studyId),
    eq(study.clientId, input.clientId),
    eq(study.reviewState, "pending"),
  )).returning({ id: study.id, reviewState: study.reviewState });
  return updated ?? null;
}

export async function createCampaignAssessmentRecord(input: {
  clientId: number;
  campaignId: number;
  actorUserId: number;
  stage: CampaignAssessment["stage"];
  baseline?: Readonly<Record<string, number>>;
  current?: Readonly<Record<string, number>>;
  observedResults?: Readonly<Record<string, number>>;
  anomalies?: readonly string[];
  contextualChanges?: readonly string[];
  dataQualityIssues?: readonly string[];
  alternativeExplanations?: readonly string[];
  resultEvidenceIds?: readonly number[];
  preflightReview?: unknown;
  metricSelections?: unknown;
  interpretation?: unknown;
  market?: string;
  language?: string;
}): Promise<CampaignAssessmentArtifact> {
  if (input.stage === "preflight") return createContextualPreflight({ ...input, review: input.preflightReview });
  return createCampaignResultAssessment({ ...input, stage: input.stage });
}

