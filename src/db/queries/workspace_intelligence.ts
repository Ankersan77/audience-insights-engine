import { and, desc, eq, inArray } from "drizzle-orm";
import type { Applicability, DecisionBrief, IntelligenceKind, IntelligenceRecord, ReviewState } from "@/src/core/contracts";
import { validateDecisionBrief, validateIntelligenceRecord } from "@/src/core/validation";
import { db } from "@/src/db/client";
import { canonicalEvidence, campaign, citation, intelligenceRecord, intelligenceRelationship, researchArtifact } from "@/src/db/schema";
import { promoteIntelligence } from "@/src/core/transitions";
import type { CampaignAssessment } from "@/src/campaigns/analysis";

export type IntelligenceListRow = IntelligenceRecord & { reviewerUserId?: string };

function toIntelligence(row: typeof intelligenceRecord.$inferSelect): IntelligenceListRow {
  return {
    id: String(row.id),
    clientId: String(row.clientId),
    kind: row.kind,
    title: row.title,
    statement: row.statement,
    lifecycle: row.lifecycle,
    reviewState: row.reviewState,
    evidenceIds: row.evidenceIds.map(String),
    contradictionIds: row.contradictionIds.map(String),
    dependencyIds: row.dependencyIds.map(String),
    applicability: row.applicabilityJson as Applicability,
    confidence: row.confidence,
    uncertainty: row.uncertainty,
    synthesisBy: row.synthesisBy as IntelligenceRecord["synthesisBy"],
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString(),
    reviewerUserId: row.reviewedBy ? String(row.reviewedBy) : undefined,
    supersedesId: row.supersedesId ? String(row.supersedesId) : undefined,
    decayAt: row.decayAt?.toISOString(),
  };
}

export async function listIntelligenceRecords(clientId: number): Promise<IntelligenceListRow[]> {
  const rows = await db
    .select()
    .from(intelligenceRecord)
    .where(eq(intelligenceRecord.clientId, clientId))
    .orderBy(desc(intelligenceRecord.id));
  return rows.map(toIntelligence);
}

async function assertOwnedEvidence(clientId: number, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: canonicalEvidence.id })
    .from(canonicalEvidence)
    .where(and(eq(canonicalEvidence.clientId, clientId), inArray(canonicalEvidence.id, [...ids])));
  if (new Set(rows.map((row) => row.id)).size !== new Set(ids).size) throw new Error("evidence-scope-mismatch");
}

async function assertOwnedIntelligence(clientId: number, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: intelligenceRecord.id })
    .from(intelligenceRecord)
    .where(and(eq(intelligenceRecord.clientId, clientId), inArray(intelligenceRecord.id, [...ids])));
  if (new Set(rows.map((row) => row.id)).size !== new Set(ids).size) throw new Error("intelligence-scope-mismatch");
}

export async function createIntelligenceCandidate(input: {
  clientId: number;
  kind: Extract<IntelligenceKind, "observation" | "fact" | "hypothesis" | "knowledge_gap">;
  title: string;
  statement: string;
  evidenceIds: readonly number[];
  contradictionIds: readonly number[];
  dependencyIds: readonly number[];
  applicability: Applicability;
  confidence: number;
  uncertainty: readonly string[];
  now: Date;
}): Promise<IntelligenceListRow> {
  await Promise.all([
    assertOwnedEvidence(input.clientId, input.evidenceIds),
    assertOwnedIntelligence(input.clientId, [...input.contradictionIds, ...input.dependencyIds]),
  ]);
  const candidate: IntelligenceRecord = {
    id: "pending",
    clientId: String(input.clientId),
    kind: input.kind,
    title: input.title,
    statement: input.statement,
    lifecycle: "candidate",
    reviewState: "pending",
    evidenceIds: input.evidenceIds.map(String),
    contradictionIds: input.contradictionIds.map(String),
    dependencyIds: input.dependencyIds.map(String),
    applicability: input.applicability,
    confidence: input.confidence,
    uncertainty: input.uncertainty,
    synthesisBy: "human",
    createdAt: input.now.toISOString(),
  };
  const validation = validateIntelligenceRecord(candidate);
  if (!validation.valid) throw new Error(`invalid-intelligence:${validation.errors.join(";")}`);
  const [created] = await db.insert(intelligenceRecord).values({
    clientId: input.clientId,
    kind: input.kind,
    title: input.title,
    statement: input.statement,
    lifecycle: "candidate",
    reviewState: "pending",
    evidenceIds: [...input.evidenceIds],
    contradictionIds: [...input.contradictionIds],
    dependencyIds: [...input.dependencyIds],
    applicabilityJson: input.applicability,
    confidence: input.confidence,
    uncertainty: [...input.uncertainty],
    synthesisBy: "human",
    createdAt: input.now,
  }).returning();
  return toIntelligence(created);
}

export async function reviewIntelligenceRecord(input: {
  clientId: number;
  id: number;
  reviewerUserId: number;
  decision: Extract<ReviewState, "accepted" | "rejected" | "revision_requested">;
  now: Date;
}): Promise<IntelligenceListRow | null> {
  const [updated] = await db
    .update(intelligenceRecord)
    .set({
      reviewState: input.decision,
      lifecycle: input.decision === "accepted" ? "live" : input.decision === "rejected" ? "superseded" : "candidate",
      reviewedBy: input.reviewerUserId,
      reviewedAt: input.now,
    })
    .where(and(
      eq(intelligenceRecord.id, input.id),
      eq(intelligenceRecord.clientId, input.clientId),
      inArray(intelligenceRecord.reviewState, ["pending", "revision_requested"]),
    ))
    .returning();
  return updated ? toIntelligence(updated) : null;
}

export async function createCampaignLearningCandidate(input: {
  clientId: number;
  campaignId: number;
  assessmentId: number;
  actorUserId: number;
  now: Date;
}): Promise<IntelligenceListRow> {
  const key = `campaign:${input.campaignId}:learning-candidate:${input.assessmentId}`;
  const [existingArtifact] = await db.select().from(researchArtifact).where(and(
    eq(researchArtifact.clientId, input.clientId), eq(researchArtifact.artifactKey, key),
  )).limit(1);
  if (existingArtifact) {
    const existingId = Number((existingArtifact.payloadJson as { intelligenceRecordId?: number }).intelligenceRecordId);
    const [existing] = await db.select().from(intelligenceRecord).where(and(eq(intelligenceRecord.clientId, input.clientId), eq(intelligenceRecord.id, existingId))).limit(1);
    if (existing) return toIntelligence(existing);
  }
  const [ownedCampaign] = await db.select().from(campaign).where(and(eq(campaign.id, input.campaignId), eq(campaign.clientId, input.clientId))).limit(1);
  if (!ownedCampaign || ownedCampaign.state !== "completed") throw new Error("completed-campaign-required");
  const [artifact] = await db.select().from(researchArtifact).where(and(
    eq(researchArtifact.id, input.assessmentId),
    eq(researchArtifact.clientId, input.clientId),
    eq(researchArtifact.artifactType, "campaign_assessment"),
  )).limit(1);
  const payload = artifact?.payloadJson as { campaignId?: number; assessment?: CampaignAssessment } | undefined;
  if (!artifact || payload?.campaignId !== input.campaignId || payload.assessment?.stage !== "post" || payload.assessment.status !== "ready" || !payload.assessment.candidateLearning) {
    throw new Error("ready-post-assessment-required");
  }
  if (artifact.evidenceIds.length === 0) throw new Error("learning-evidence-required");
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(intelligenceRecord).values({
      clientId: input.clientId,
      kind: "decision",
      title: `Campaign ${ownedCampaign.name}: candidate learning`,
      statement: payload.assessment!.candidateLearning!.statement,
      lifecycle: "candidate",
      reviewState: "pending",
      evidenceIds: artifact.evidenceIds,
      contradictionIds: [],
      dependencyIds: [],
      applicabilityJson: { markets: [], languages: [], categories: [], audiences: [], campaigns: [String(input.campaignId)] },
      confidence: 0.7,
      uncertainty: [...payload.assessment!.candidateLearning!.conditions],
      synthesisBy: "hybrid",
      createdAt: input.now,
    }).returning();
    await tx.insert(researchArtifact).values({
      clientId: input.clientId,
      artifactKey: key,
      artifactType: "candidate_learning",
      abilityKey: "campaign-post",
      abilityVersion: "1.0.0",
      status: "pending",
      version: 1,
      payloadJson: { campaignId: input.campaignId, assessmentId: input.assessmentId, intelligenceRecordId: created.id },
      evidenceIds: artifact.evidenceIds,
      createdBy: input.actorUserId,
    });
    return toIntelligence(created);
  });
}

export async function promoteCampaignLearning(input: {
  clientId: number;
  sourceId: number;
  reviewerUserId: number;
  now: Date;
  decayAt?: Date;
}): Promise<IntelligenceListRow> {
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(intelligenceRecord).where(and(
      eq(intelligenceRecord.id, input.sourceId),
      eq(intelligenceRecord.clientId, input.clientId),
      eq(intelligenceRecord.kind, "decision"),
      inArray(intelligenceRecord.reviewState, ["pending", "revision_requested"]),
    )).limit(1);
    if (!source) throw new Error("candidate-learning-not-found");
    const domainSource = toIntelligence(source);
    const promoted = promoteIntelligence(domainSource, "learning", {
      id: "pending",
      evidenceIds: domainSource.evidenceIds,
      reviewState: "accepted",
      now: input.now.toISOString(),
    });
    const validation = validateIntelligenceRecord(promoted);
    if (!validation.valid) throw new Error(`invalid-learning:${validation.errors.join(";")}`);
    await tx.update(intelligenceRecord).set({ reviewState: "accepted", lifecycle: "live", reviewedBy: input.reviewerUserId, reviewedAt: input.now }).where(eq(intelligenceRecord.id, source.id));
    const [learning] = await tx.insert(intelligenceRecord).values({
      clientId: input.clientId,
      kind: "learning",
      title: source.title.replace("candidate learning", "reviewed learning"),
      statement: promoted.statement,
      lifecycle: "live",
      reviewState: "accepted",
      evidenceIds: source.evidenceIds,
      contradictionIds: source.contradictionIds,
      dependencyIds: [...source.dependencyIds, source.id],
      applicabilityJson: source.applicabilityJson,
      confidence: source.confidence,
      uncertainty: source.uncertainty,
      synthesisBy: source.synthesisBy,
      reviewedBy: input.reviewerUserId,
      reviewedAt: input.now,
      decayAt: input.decayAt,
      createdAt: input.now,
    }).returning();
    await tx.insert(intelligenceRelationship).values({
      clientId: input.clientId,
      fromId: learning.id,
      toId: source.id,
      type: "derived_from",
      rationale: "Human-reviewed campaign outcome promoted from a conditional candidate learning.",
    });
    return toIntelligence(learning);
  });
}

export type DecisionBriefArtifact = {
  id: number;
  artifactKey: string;
  version: number;
  status: string;
  brief: DecisionBrief;
  createdAt: Date;
};

export async function listDecisionBriefs(clientId: number): Promise<DecisionBriefArtifact[]> {
  const rows = await db
    .select()
    .from(researchArtifact)
    .where(and(eq(researchArtifact.clientId, clientId), eq(researchArtifact.artifactType, "decision_brief")))
    .orderBy(desc(researchArtifact.id));
  return rows.map((row) => ({
    id: row.id,
    artifactKey: row.artifactKey,
    version: row.version,
    status: row.status,
    brief: row.payloadJson as DecisionBrief,
    createdAt: row.createdAt,
  }));
}

export async function saveDecisionBrief(input: {
  clientId: number;
  brief: DecisionBrief;
  createdBy: number;
}): Promise<DecisionBriefArtifact> {
  const validation = validateDecisionBrief(input.brief);
  if (!validation.valid) throw new Error(`invalid-decision-brief:${validation.errors.join(";")}`);
  if (input.brief.clientId !== String(input.clientId)) throw new Error("decision-brief-client-mismatch");
  const evidenceIds = input.brief.evidenceIds.map(Number);
  if (evidenceIds.some((id) => !Number.isInteger(id))) throw new Error("decision-brief-evidence-id-invalid");
  const evidenceIdSet = new Set(evidenceIds);
  if (input.brief.citations.some((item) => item.clientId !== String(input.clientId) || !evidenceIdSet.has(Number(item.evidenceId)))) {
    throw new Error("decision-brief-citation-scope-mismatch");
  }
  await assertOwnedEvidence(input.clientId, evidenceIds);
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(researchArtifact).values({
      clientId: input.clientId,
      artifactKey: input.brief.id,
      artifactType: "decision_brief",
      abilityKey: input.brief.abilityId,
      abilityVersion: input.brief.abilityVersion,
      status: input.brief.status,
      version: 1,
      payloadJson: input.brief,
      evidenceIds,
      createdBy: input.createdBy,
    }).onConflictDoNothing({
      target: [researchArtifact.clientId, researchArtifact.artifactKey, researchArtifact.version],
    }).returning();
    const row = created ?? (await tx
      .select()
      .from(researchArtifact)
      .where(and(
        eq(researchArtifact.clientId, input.clientId),
        eq(researchArtifact.artifactKey, input.brief.id),
        eq(researchArtifact.version, 1),
      ))
      .limit(1))[0];
    if (!row) throw new Error("decision-brief-persistence-failed");
    if (created && input.brief.citations.length > 0) {
      await tx.insert(citation).values(input.brief.citations.map((item) => ({
        clientId: input.clientId,
        evidenceId: Number(item.evidenceId),
        artifactId: row.id,
        level: item.level,
        safeReference: item.safeReference,
        excerpt: item.excerpt,
        reviewReason: item.reviewReason,
        expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
      })));
    }
    return { id: row.id, artifactKey: row.artifactKey, version: row.version, status: row.status, brief: row.payloadJson as DecisionBrief, createdAt: row.createdAt };
  });
}

