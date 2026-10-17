import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { lockCompanyContext } from "./company_context";
import { companyContextProblem } from "@/src/core/companyContext";
import type { Applicability, DecisionBrief, IntelligenceKind, IntelligenceRecord, ReviewState, RightsDeclaration, SolutionProfile, SourceClass } from "@/src/core/contracts";
import { validateDecisionBrief, validateIntelligenceRecord } from "@/src/core/validation";
import { db } from "@/src/db/client";
import { canonicalEvidence, citation, intelligenceRecord, researchArtifact, researchProject, sensingProfile, solutionProfile, sourceConnection } from "@/src/db/schema";
import { createInterpretedLearning, promoteInterpretedLearning } from "./campaign_learning";
import { researchSnapshotDigest } from "@/src/abilities/snapshot";
import { CONTEXT_EVIDENCE_REQUIREMENTS } from "@/src/abilities/context";
import { getDecisionBriefAbility } from "@/src/abilities/catalog";
import { resolveEvidence } from "@/src/market-twin/resolver";
import { canonicalEvidenceItem } from "./canonical_evidence";
import { researchProjectDomain } from "./projects";
import { canonicalProfile } from "./monitoring";
import { readSourceConnectionPolicy, sourceClassification, sourcePolicyFailure } from "@/src/connectors/sourcePolicy";

export type IntelligenceListRow = IntelligenceRecord & { reviewerUserId?: string };

export function toIntelligence(row: typeof intelligenceRecord.$inferSelect): IntelligenceListRow {
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
      input.decision === "accepted" ? ne(intelligenceRecord.kind, "decision") : undefined,
    ))
    .returning();
  return updated ? toIntelligence(updated) : null;
}

export const createCampaignLearningCandidate = createInterpretedLearning;
export const promoteCampaignLearning = promoteInterpretedLearning;

export type DecisionBriefArtifact = {
  id: number;
  artifactKey: string;
  version: number;
  status: string;
  brief: DecisionBrief;
  createdAt: Date;
  projectId: number | null;
};

export async function listDecisionBriefs(clientId: number, projectId?: number): Promise<DecisionBriefArtifact[]> {
  const rows = await db
    .select()
    .from(researchArtifact)
    .where(and(eq(researchArtifact.clientId, clientId), eq(researchArtifact.artifactType, "decision_brief"), projectId ? eq(researchArtifact.projectId, projectId) : undefined))
    .orderBy(desc(researchArtifact.id));
  return rows.map((row) => ({
    id: row.id,
    artifactKey: row.artifactKey,
    version: row.version,
    status: row.status,
    brief: row.payloadJson as DecisionBrief,
    createdAt: row.createdAt,
    projectId: row.projectId,
  }));
}

export async function saveDecisionBrief(input: {
  clientId: number;
  brief: DecisionBrief;
  createdBy: number;
  projectId?: number;
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
    let assertNotExpired = () => {};
    const basis = input.brief.contextBasis;
    if ((input.brief.status === "ready" || evidenceIds.length > 0) && basis?.snapshotVersion !== 1) throw new Error("research-context-changed");
    if (basis && basis.projectId !== (input.projectId ? String(input.projectId) : undefined)) throw new Error("research-context-changed");
    if (input.projectId) {
      const [ownedProject] = await tx.select().from(researchProject).where(and(
        eq(researchProject.id, input.projectId), eq(researchProject.clientId, input.clientId), eq(researchProject.status, "active"),
      )).limit(1).for("share");
      if (!ownedProject) throw new Error("active-project-scope-mismatch");
      if (basis && ownedProject.updatedAt.toISOString() !== basis.projectUpdatedAt) throw new Error("research-context-changed");
      if (basis?.snapshotVersion === 1 && researchSnapshotDigest(researchProjectDomain(ownedProject)) !== basis.projectDigest) throw new Error("research-context-changed");
    }
    if (basis) {
      const company = await lockCompanyContext(tx, input.clientId);
      if (company?.version !== basis.companyContextVersion || (company ? researchSnapshotDigest(company) : undefined) !== basis.companyContextDigest
        || (company && companyContextProblem(company, String(input.clientId), new Date().toISOString(), basis.market, basis.language))) throw new Error("research-context-changed");
      // Bundle imports lock sensing before solution; preserve that ordering here.
      if (basis.sensingProfileId) {
        const [sensing] = await tx.select().from(sensingProfile).where(and(eq(sensingProfile.clientId, input.clientId), eq(sensingProfile.id, Number(basis.sensingProfileId)), eq(sensingProfile.version, basis.sensingVersion!))).for("share");
        if (!sensing || researchSnapshotDigest(canonicalProfile(sensing)) !== basis.sensingDigest) throw new Error("research-context-changed");
      }
      const [activeSolution] = await tx.select().from(solutionProfile).where(and(
        eq(solutionProfile.id, Number(basis.solutionProfileId)), eq(solutionProfile.clientId, input.clientId),
        eq(solutionProfile.version, basis.solutionVersion), eq(solutionProfile.status, "active"),
      )).limit(1).for("share");
      if (!activeSolution) throw new Error("research-context-changed");
      const solution = { ...activeSolution.profileJson as SolutionProfile, id: String(activeSolution.id), clientId: String(input.clientId), version: activeSolution.version, status: "active" as const };
      if (basis.snapshotVersion === 1 && researchSnapshotDigest(solution) !== basis.solutionDigest) throw new Error("research-context-changed");

      const seed = evidenceIds.length ? await tx.select({ sourceId: canonicalEvidence.sourceConnectionId }).from(canonicalEvidence)
        .where(and(eq(canonicalEvidence.clientId, input.clientId), inArray(canonicalEvidence.id, evidenceIds))) : [];
      const sourceIds = [...new Set(seed.map((row) => row.sourceId))];
      // Sources → evidence → intelligence, ordered within each table. Revocation and retention
      // cannot invalidate these records between revalidation and the atomic artifact/citation insert.
      const sources = sourceIds.length ? await tx.select().from(sourceConnection).where(and(eq(sourceConnection.clientId, input.clientId), inArray(sourceConnection.id, sourceIds))).orderBy(asc(sourceConnection.id)).for("share") : [];
      const rows = evidenceIds.length ? await tx.select().from(canonicalEvidence).where(and(eq(canonicalEvidence.clientId, input.clientId), inArray(canonicalEvidence.id, evidenceIds))).orderBy(asc(canonicalEvidence.id)).for("share") : [];
      const recordIds = basis.intelligence.map((item) => Number(item.id));
      if (recordIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("research-context-changed");
      const records = recordIds.length ? await tx.select().from(intelligenceRecord).where(and(eq(intelligenceRecord.clientId, input.clientId), inArray(intelligenceRecord.id, recordIds))).orderBy(asc(intelligenceRecord.id)).for("share") : [];
      const now = new Date().toISOString();
      const sourceMap = new Map(sources.map((source) => [source.id, source]));
      const aliases = new Set(Object.values(solution.providerBindings));
      if (sources.some((source) => !aliases.has(source.connectorId) || sourcePolicyFailure({ health: source.health, rights: source.rightsJson as RightsDeclaration,
        policy: readSourceConnectionPolicy(source.configurationJson), dataClassification: sourceClassification(source.sourceClass as SourceClass),
        request: { operation: "research", filters: { markets: [basis.market], languages: [basis.language], purpose: "market-research" } }, now }))) throw new Error("research-context-changed");
      if (rows.length !== new Set(evidenceIds).size || records.length !== recordIds.length || rows.some((row) => !sourceMap.has(row.sourceConnectionId))) throw new Error("research-context-changed");
      const currentEvidence = rows.map((row) => canonicalEvidenceItem({ evidence: row, sourceClass: sourceMap.get(row.sourceConnectionId)!.sourceClass }));
      const snapshots = new Map(basis.evidence?.map((item) => [item.id, item.contentDigest]));
      if (snapshots.size !== evidenceIds.length || currentEvidence.some((item) => snapshots.get(item.id) !== researchSnapshotDigest(item))) throw new Error("research-context-changed");
      const eligibility = resolveEvidence({ clientId: String(input.clientId), evidence: currentEvidence, now, market: basis.market, language: basis.language, requirements: CONTEXT_EVIDENCE_REQUIREMENTS });
      if (eligibility.selected.length !== currentEvidence.length) throw new Error("research-context-changed");
      const recordSnapshots = new Map(basis.intelligence.map((item) => [item.id, item.contentDigest]));
      if (records.some((row) => row.reviewState !== "accepted" || row.lifecycle !== "live" || !row.reviewedAt || row.reviewedAt > new Date(now)
        || (row.decayAt && row.decayAt <= new Date(now)) || !row.evidenceIds.length || row.evidenceIds.some((id) => !evidenceIdSet.has(id))
        || researchSnapshotDigest(toIntelligence(row)) !== recordSnapshots.get(String(row.id)))) throw new Error("research-context-changed");
      if (input.brief.status === "ready") {
        const ability = getDecisionBriefAbility(input.brief.abilityId);
        if (!records.length || !ability || !solution.enabledAbilities.some((item) => item.id === ability.id && item.version === ability.version)
          || !resolveEvidence({ clientId: String(input.clientId), evidence: currentEvidence, now, market: basis.market, language: basis.language, requirements: ability.evidenceRequirements }).sufficient) throw new Error("research-context-changed");
      }
      const ability = getDecisionBriefAbility(input.brief.abilityId);
      const currentPrimary = new Set(ability ? resolveEvidence({ clientId: String(input.clientId), evidence: currentEvidence, now, market: basis.market, language: basis.language, requirements: ability.evidenceRequirements }).selected.map((item) => item.id) : []);
      if (basis.snapshotVersion === 1 && (!basis.primaryEvidenceIds || basis.primaryEvidenceIds.some((id) => !currentPrimary.has(id)))) throw new Error("research-context-changed");
      assertNotExpired = () => {
        const checkAt = new Date().toISOString();
        if (company && companyContextProblem(company, String(input.clientId), checkAt, basis.market, basis.language)) throw new Error("research-context-changed");
        const permitted = resolveEvidence({ clientId: String(input.clientId), evidence: currentEvidence, now: checkAt, market: basis.market, language: basis.language, requirements: CONTEXT_EVIDENCE_REQUIREMENTS });
        const primary = ability ? resolveEvidence({ clientId: String(input.clientId), evidence: currentEvidence, now: checkAt, market: basis.market, language: basis.language, requirements: ability.evidenceRequirements }) : undefined;
        if (permitted.selected.length !== currentEvidence.length || records.some((row) => row.decayAt && row.decayAt <= new Date(checkAt))
          || sources.some((source) => { const expiry = (source.rightsJson as RightsDeclaration).expiresAt; return expiry && Date.parse(expiry) <= Date.parse(checkAt); })
          || basis.primaryEvidenceIds?.some((id) => !primary?.selected.some((item) => item.id === id))
          || (input.brief.status === "ready" && !primary?.sufficient)) throw new Error("research-context-changed");
      };
    }
    const [created] = await tx.insert(researchArtifact).values({
      clientId: input.clientId,
      projectId: input.projectId,
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
    // Inserts may have waited on another transaction; expiry is a clock boundary, not a row lock.
    assertNotExpired();
    return { id: row.id, artifactKey: row.artifactKey, version: row.version, status: row.status, brief: row.payloadJson as DecisionBrief, createdAt: row.createdAt, projectId: row.projectId };
  });
}

