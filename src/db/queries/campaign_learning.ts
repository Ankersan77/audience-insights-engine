import { and, eq, sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { governanceAudit, intelligenceRecord, intelligenceRelationship, researchArtifact } from "@/src/db/schema";
import { campaignResultBasisDigest } from "@/src/campaigns/results";
import { researchSnapshotDigest } from "@/src/abilities/snapshot";
import { assertResearchArtifactBounds, boundedResearchArtifactValues } from "@/src/research-artifacts/persistenceBounds";
import { assertCurrentCampaignResult, type CampaignTransaction } from "./campaign_results";
import { toIntelligence } from "./workspace_intelligence";

function candidateDigest(row: typeof intelligenceRecord.$inferSelect) {
  return researchSnapshotDigest({ title: row.title, statement: row.statement, evidenceIds: row.evidenceIds, contradictionIds: row.contradictionIds,
    dependencyIds: row.dependencyIds, applicability: row.applicabilityJson, confidence: row.confidence, uncertainty: row.uncertainty, synthesisBy: row.synthesisBy });
}
async function lockCampaign(tx: CampaignTransaction, campaignId: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(73004, ${campaignId})`);
  await tx.execute(sql`select pg_advisory_xact_lock(73003, ${campaignId})`);
}

export async function createInterpretedLearning(input: { clientId: number; campaignId: number; assessmentId: number; actorUserId: number; now: Date }) {
  return db.transaction(async (tx) => {
    await lockCampaign(tx, input.campaignId);
    const key = `campaign:${input.campaignId}:learning-candidate:${input.assessmentId}`;
    const [existing] = await tx.select().from(researchArtifact).where(and(eq(researchArtifact.clientId, input.clientId), eq(researchArtifact.artifactKey, key)));
    if (existing) {
      assertResearchArtifactBounds(existing.payloadJson, existing.evidenceIds);
      const payload = existing.payloadJson as { method?: string; intelligenceRecordId?: number };
      if (payload.method !== "interpreted-learning@1") throw new Error("legacy-learning-requires-reassessment");
      const [record] = await tx.select().from(intelligenceRecord).where(and(eq(intelligenceRecord.clientId, input.clientId), eq(intelligenceRecord.id, Number(payload.intelligenceRecordId))));
      if (record) return toIntelligence(record);
    }
    const checked = await assertCurrentCampaignResult(tx, input);
    const review = checked.assessment.interpretation!;
    const basis = checked.assessment.contextBasis!;
    const ownIds = new Set(checked.contextSources.intelligence.map((record) => record.id));
    const contradictions = [...new Set(checked.contextSources.intelligence.filter((record) => review.intelligenceIds.includes(record.id)).flatMap((record) => [...record.contradictionIds]))].filter((id) => ownIds.has(id));
    const [created] = await tx.insert(intelligenceRecord).values({ clientId: input.clientId, kind: "decision", title: `Campaign ${checked.campaign.name}: candidate learning`,
      statement: checked.assessment.candidateLearning!.statement, lifecycle: "candidate", reviewState: "pending", evidenceIds: checked.artifact.evidenceIds,
      contradictionIds: contradictions.map(Number), dependencyIds: review.intelligenceIds.map(Number), applicabilityJson: { markets: [basis.market!], languages: [basis.language!], categories: [], audiences: [], campaigns: [String(input.campaignId)] },
      confidence: review.confidence, uncertainty: [...checked.assessment.candidateLearning!.conditions, ...checked.assessment.watchouts], synthesisBy: "human", createdAt: new Date() }).returning();
    const payload = { method: "interpreted-learning@1", campaignId: input.campaignId, assessmentId: input.assessmentId, intelligenceRecordId: created.id,
      assessmentBasisDigest: campaignResultBasisDigest(checked.assessment), candidateDigest: candidateDigest(created) };
    await tx.insert(researchArtifact).values(boundedResearchArtifactValues({ clientId: input.clientId, artifactKey: key, artifactType: "candidate_learning", abilityKey: "post-campaign-learning", abilityVersion: "1.0.0", status: "pending", version: 1,
      payloadJson: payload, evidenceIds: checked.artifact.evidenceIds, createdBy: input.actorUserId }));
    await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.actorUserId, action: "create", entityType: "candidate_learning", entityId: String(created.id), redactedAfterJson: { campaignId: input.campaignId, assessmentId: input.assessmentId } });
    checked.recheck();
    return toIntelligence(created);
  });
}

export async function promoteInterpretedLearning(input: { clientId: number; sourceId: number; reviewerUserId: number; now: Date; decayAt?: Date }) {
  return db.transaction(async (tx) => {
    const [lineage] = await tx.select().from(researchArtifact).where(and(eq(researchArtifact.clientId, input.clientId), eq(researchArtifact.artifactType, "candidate_learning"),
      sql`${researchArtifact.payloadJson}->>'intelligenceRecordId' = ${String(input.sourceId)}`));
    if (lineage) assertResearchArtifactBounds(lineage.payloadJson, lineage.evidenceIds);
    const link = lineage?.payloadJson as { method?: string; campaignId?: number; assessmentId?: number; candidateDigest?: string; assessmentBasisDigest?: string } | undefined;
    if (link?.method !== "interpreted-learning@1" || !Number.isInteger(link.campaignId) || !Number.isInteger(link.assessmentId)) throw new Error("interpreted-learning-provenance-required");
    await lockCampaign(tx, link.campaignId!);
    const [previous] = await tx.select({ record: intelligenceRecord }).from(intelligenceRelationship).innerJoin(intelligenceRecord,
      and(eq(intelligenceRecord.id, intelligenceRelationship.fromId), eq(intelligenceRecord.clientId, input.clientId), eq(intelligenceRecord.kind, "learning")))
      .where(and(eq(intelligenceRelationship.clientId, input.clientId), eq(intelligenceRelationship.toId, input.sourceId), eq(intelligenceRelationship.type, "derived_from")));
    if (previous) return toIntelligence(previous.record);
    const checked = await assertCurrentCampaignResult(tx, { clientId: input.clientId, campaignId: link.campaignId!, assessmentId: link.assessmentId!, actorUserId: input.reviewerUserId });
    if (link.assessmentBasisDigest !== campaignResultBasisDigest(checked.assessment)) throw new Error("learning-assessment-basis-changed");
    const [source] = await tx.select().from(intelligenceRecord).where(and(eq(intelligenceRecord.clientId, input.clientId), eq(intelligenceRecord.id, input.sourceId))).for("update");
    if (!source || source.kind !== "decision" || source.lifecycle !== "candidate" || !["pending", "revision_requested"].includes(source.reviewState) || candidateDigest(source) !== link.candidateDigest) throw new Error("learning-candidate-changed-or-unavailable");
    const now = new Date();
    const expiry = checked.earliestEvidenceExpiry;
    const decayAt = input.decayAt ?? new Date(expiry);
    if (!Number.isFinite(decayAt.getTime()) || decayAt <= now || decayAt.getTime() > expiry) throw new Error("learning-decay-must-be-future-and-within-evidence-validity");
    await tx.update(intelligenceRecord).set({ reviewState: "accepted", lifecycle: "superseded", reviewedBy: input.reviewerUserId, reviewedAt: now, decayAt }).where(eq(intelligenceRecord.id, source.id));
    const [learning] = await tx.insert(intelligenceRecord).values({ clientId: input.clientId, kind: "learning", title: source.title.replace("candidate learning", "reviewed learning"), statement: source.statement,
      lifecycle: "live", reviewState: "accepted", evidenceIds: source.evidenceIds, contradictionIds: source.contradictionIds, dependencyIds: [...source.dependencyIds, source.id], applicabilityJson: source.applicabilityJson,
      confidence: source.confidence, uncertainty: source.uncertainty, synthesisBy: source.synthesisBy, reviewedBy: input.reviewerUserId, reviewedAt: now, decayAt, createdAt: now }).returning();
    await tx.insert(intelligenceRelationship).values({ clientId: input.clientId, fromId: learning.id, toId: source.id, type: "derived_from", rationale: "Named human review of a current evidence-linked campaign interpretation, bounded by source validity." });
    await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.reviewerUserId, action: "promote", entityType: "intelligence_record", entityId: String(learning.id), redactedBeforeJson: { sourceId: source.id }, redactedAfterJson: { campaignId: link.campaignId, assessmentId: link.assessmentId, decayAt: decayAt.toISOString() } });
    checked.recheck();
    return toIntelligence(learning);
  });
}
