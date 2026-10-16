import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { Campaign, MeasurementPlan, StudyDesign } from "@/src/core/contracts";
import { assertCampaignTransition } from "@/src/core/transitions";
import { validateCampaign, validateMeasurementPlan, validateStudyDesign } from "@/src/core/validation";
import { db } from "@/src/db/client";
import { campaign, campaignRevision, canonicalEvidence, intelligenceRecord, measurementPlan, study } from "@/src/db/schema";
import { classifyStudy } from "@/src/measurement/studies";

export type CampaignRevisionPayload = {
  campaign: Campaign;
  strategicEvidenceIds: readonly number[];
  brandConstraints: readonly string[];
};

export type CampaignWorkspaceRow = {
  id: number;
  state: Campaign["state"];
  currentRevision: number;
  payload: CampaignRevisionPayload;
  measurementPlan: MeasurementPlan | null;
  measurementPlanDbId: number | null;
  measurementPlanReviewState: "pending" | "accepted" | "rejected" | "revision_requested" | null;
  createdAt: Date;
};

async function latestMeasurementPlan(clientId: number, campaignId: number) {
  const [row] = await db
    .select()
    .from(measurementPlan)
    .where(and(eq(measurementPlan.clientId, clientId), eq(measurementPlan.campaignId, campaignId)))
    .orderBy(desc(measurementPlan.version))
    .limit(1);
  return row ?? null;
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
      measurementPlanReviewState: plan?.reviewState ?? null,
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
}): Promise<CampaignWorkspaceRow> {
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
      objective: input.objective, audience: input.audience, proposition: input.proposition,
      creativeRoutes: input.creativeRoutes, channels: input.channels, budgetAssumptions: input.budgetAssumptions,
    };
    const validation = validateCampaign(domain);
    if (!validation.valid) throw new Error(`invalid-campaign:${validation.errors.join(";")}`);
    const payload: CampaignRevisionPayload = { campaign: domain, strategicEvidenceIds: input.strategicEvidenceIds, brandConstraints: input.brandConstraints };
    await tx.insert(campaignRevision).values({ clientId: input.clientId, campaignId: created.id, revision: 1, briefJson: payload });
    return { id: created.id, state: created.state, currentRevision: 1, payload, measurementPlan: null, measurementPlanDbId: null, measurementPlanReviewState: null, createdAt: created.createdAt };
  });
}

export async function createMeasurementPlanRecord(input: {
  clientId: number;
  campaignId: number;
  plan: Omit<MeasurementPlan, "id" | "clientId" | "campaignId">;
}): Promise<{ id: number; plan: MeasurementPlan; version: number }> {
  const [ownedCampaign] = await db.select({ id: campaign.id }).from(campaign).where(and(eq(campaign.id, input.campaignId), eq(campaign.clientId, input.clientId))).limit(1);
  if (!ownedCampaign) throw new Error("campaign-not-found");
  const [versionRow] = await db.select({ value: max(measurementPlan.version) }).from(measurementPlan).where(and(eq(measurementPlan.clientId, input.clientId), eq(measurementPlan.campaignId, input.campaignId)));
  const version = Number(versionRow?.value ?? 0) + 1;
  const domain: MeasurementPlan = { ...input.plan, id: `campaign:${input.campaignId}:measurement:${version}`, clientId: String(input.clientId), campaignId: String(input.campaignId) };
  const validation = validateMeasurementPlan(domain);
  if (!validation.valid) throw new Error(`invalid-measurement-plan:${validation.errors.join(";")}`);
  const [created] = await db.insert(measurementPlan).values({ clientId: input.clientId, campaignId: input.campaignId, version, planJson: domain, reviewState: "pending" }).returning();
  return { id: created.id, plan: domain, version };
}

export async function transitionCampaignRecord(input: {
  clientId: number;
  campaignId: number;
  nextState: Campaign["state"];
  actorUserId: number;
  learningRecordId?: number;
}): Promise<CampaignWorkspaceRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(campaign).where(and(eq(campaign.id, input.campaignId), eq(campaign.clientId, input.clientId))).limit(1);
    if (!row) throw new Error("campaign-not-found");
    assertCampaignTransition(row.state, input.nextState);
    const [current] = await tx.select().from(campaignRevision).where(and(eq(campaignRevision.clientId, input.clientId), eq(campaignRevision.campaignId, row.id), eq(campaignRevision.revision, row.currentRevision))).limit(1);
    if (!current) throw new Error("campaign-revision-missing");
    const [plan] = await tx.select().from(measurementPlan).where(and(eq(measurementPlan.clientId, input.clientId), eq(measurementPlan.campaignId, row.id))).orderBy(desc(measurementPlan.version)).limit(1);
    if (["approved", "active", "completed", "learning_reviewed"].includes(input.nextState) && !plan) throw new Error("measurement-plan-required");
    if (input.nextState === "approved" && plan?.reviewState !== "accepted") throw new Error("accepted-measurement-plan-required");
    if (input.nextState === "learning_reviewed") {
      if (!input.learningRecordId) throw new Error("accepted-learning-required");
      const [learning] = await tx.select({ id: intelligenceRecord.id }).from(intelligenceRecord).where(and(
        eq(intelligenceRecord.id, input.learningRecordId), eq(intelligenceRecord.clientId, input.clientId),
        eq(intelligenceRecord.kind, "learning"), eq(intelligenceRecord.reviewState, "accepted"),
      )).limit(1);
      if (!learning) throw new Error("accepted-learning-required");
    }
    const nextRevision = row.currentRevision + 1;
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
      briefJson: { ...currentPayload, campaign: domain }, approvedBy: input.nextState === "approved" ? input.actorUserId : null,
    });
    const [updated] = await tx.update(campaign).set({ state: input.nextState, currentRevision: nextRevision, archivedAt: input.nextState === "archived" ? new Date() : null }).where(and(eq(campaign.id, row.id), eq(campaign.clientId, input.clientId))).returning();
    return { id: updated.id, state: updated.state, currentRevision: nextRevision, payload: { ...currentPayload, campaign: domain }, measurementPlan: plan ? plan.planJson as MeasurementPlan : null, measurementPlanDbId: plan?.id ?? null, measurementPlanReviewState: plan?.reviewState ?? null, createdAt: updated.createdAt };
  });
}

export async function reviewMeasurementPlan(input: {
  clientId: number;
  campaignId: number;
  reviewerUserId: number;
  decision: "accepted" | "rejected" | "revision_requested";
}): Promise<{ id: number; reviewState: string } | null> {
  const plan = await latestMeasurementPlan(input.clientId, input.campaignId);
  if (!plan) return null;
  const [updated] = await db.update(measurementPlan).set({
    reviewState: input.decision,
    reviewedBy: input.reviewerUserId,
    reviewedAt: new Date(),
  }).where(and(
    eq(measurementPlan.id, plan.id),
    eq(measurementPlan.clientId, input.clientId),
    eq(measurementPlan.reviewState, "pending"),
  )).returning({ id: measurementPlan.id, reviewState: measurementPlan.reviewState });
  return updated ?? null;
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

