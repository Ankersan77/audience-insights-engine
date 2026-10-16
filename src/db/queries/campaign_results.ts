import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { MeasurementPlan, QuantitativeObservation, RightsDeclaration, SourceClass } from "@/src/core/contracts";
import { evaluateCampaignResults, parseMetricSelections, type CampaignResultAssessment } from "@/src/campaigns/results";
import type { CampaignAssessment } from "@/src/campaigns/analysis";
import { db } from "@/src/db/client";
import { campaign, campaignRevision, canonicalEvidence, governanceAudit, measurementPlan, quantitativeObservation, researchArtifact, sourceConnection } from "@/src/db/schema";
import { lockedContext } from "./campaign_preflight";
import type { CampaignAssessmentArtifact, CampaignRevisionPayload } from "./campaign_workspace";
import { CONTEXT_EVIDENCE_REQUIREMENTS } from "@/src/abilities/context";
import { resolveEvidence } from "@/src/market-twin/resolver";
import { canonicalEvidenceItem } from "./canonical_evidence";
import { readSourceConnectionPolicy, sourceClassification, sourcePolicyFailure } from "@/src/connectors/sourcePolicy";
import { redactExpiredCitationCopies } from "@/src/operations/retention";

/** Read-time suppression also covers the interval before the retention worker tombstones copies. */
export async function projectAvailableCampaignResults(clientId: number, assessment: CampaignAssessment): Promise<CampaignAssessment> {
  const result = assessment as CampaignResultAssessment;
  if (result.method !== "source-backed-readback@1") return assessment;
  const ids = [...new Set(result.comparisons.flatMap((item) => [item.baselineEvidenceId, item.resultEvidenceId]))];
  if (!ids.length) return assessment;
  const rows = await db.select({ evidence: canonicalEvidence, source: sourceConnection }).from(canonicalEvidence).innerJoin(sourceConnection,
    and(eq(sourceConnection.id, canonicalEvidence.sourceConnectionId), eq(sourceConnection.clientId, canonicalEvidence.clientId)))
    .where(and(eq(canonicalEvidence.clientId, clientId), inArray(canonicalEvidence.id, ids.map(Number))));
  const now = new Date().toISOString(), market = result.contextBasis?.market, language = result.contextBasis?.language;
  const permitted = rows.filter(({ source }) => !sourcePolicyFailure({ health: source.health, rights: source.rightsJson as RightsDeclaration,
    policy: readSourceConnectionPolicy(source.configurationJson), dataClassification: sourceClassification(source.sourceClass as SourceClass),
    request: { operation: "research", filters: { ...(market ? { markets: [market] } : {}), ...(language ? { languages: [language] } : {}) } }, now }));
  const eligible = resolveEvidence({ clientId: String(clientId), now, market, language, requirements: CONTEXT_EVIDENCE_REQUIREMENTS,
    evidence: permitted.map(({ evidence, source }) => canonicalEvidenceItem({ evidence, sourceClass: source.sourceClass })) }).selected;
  const available = new Set(eligible.map((item) => item.id));
  return redactExpiredCitationCopies(assessment, new Set(ids.filter((id) => !available.has(id)))) as CampaignAssessment;
}

function observationDomain(row: typeof quantitativeObservation.$inferSelect): QuantitativeObservation {
  return { id: String(row.id), clientId: String(row.clientId), evidenceId: String(row.evidenceId), metricKey: row.metricKey,
    value: row.value, unit: row.unit, observedAt: row.observedAt.toISOString(), dimensions: row.dimensionsJson as Record<string, string>, cohortSize: row.cohortSize ?? undefined, suppressed: row.suppressed };
}

export type CampaignObservationChoice = Pick<QuantitativeObservation, "id" | "evidenceId" | "metricKey" | "unit" | "observedAt">;
export async function listCampaignObservationChoices(clientId: number): Promise<CampaignObservationChoice[]> {
  return db.transaction(async (tx) => {
    const sources = (await lockedContext(tx, clientId))();
    const allowed = new Set(Object.values(sources.solution?.providerBindings ?? {}).map((alias) => sources.sourceBindings[alias]).filter(Boolean));
    const permitted = resolveEvidence({ clientId: String(clientId), now: new Date().toISOString(), requirements: CONTEXT_EVIDENCE_REQUIREMENTS,
      evidence: sources.evidence.filter((item) => allowed.has(item.sourceConnectionId)) }).selected.map((item) => Number(item.id));
    if (!permitted.length) return [];
    const rows = await tx.select().from(quantitativeObservation).where(and(eq(quantitativeObservation.clientId, clientId), eq(quantitativeObservation.suppressed, false), inArray(quantitativeObservation.evidenceId, permitted)))
      .orderBy(desc(quantitativeObservation.observedAt), desc(quantitativeObservation.id)).limit(1000);
    // No free-form dimensions or numeric values leak through the selection surface.
    return rows.map((row) => ({ id: String(row.id), evidenceId: String(row.evidenceId), metricKey: row.metricKey, unit: row.unit, observedAt: row.observedAt.toISOString() }));
  });
}

export async function createCampaignResultAssessment(input: {
  clientId: number; campaignId: number; actorUserId: number; stage: "live" | "post";
  metricSelections?: unknown; market?: string; language?: string;
}): Promise<CampaignAssessmentArtifact> {
  const selections = parseMetricSelections(input.metricSelections);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73004, ${input.campaignId})`);
    await tx.execute(sql`select pg_advisory_xact_lock(73003, ${input.campaignId})`);
    const [row] = await tx.select().from(campaign).where(and(eq(campaign.clientId, input.clientId), eq(campaign.id, input.campaignId))).for("share");
    if (!row) throw new Error("campaign-not-found");
    const [revision] = await tx.select().from(campaignRevision).where(and(eq(campaignRevision.clientId, input.clientId), eq(campaignRevision.campaignId, row.id), eq(campaignRevision.revision, row.currentRevision))).for("share");
    const [plan] = await tx.select().from(measurementPlan).where(and(eq(measurementPlan.clientId, input.clientId), eq(measurementPlan.campaignId, row.id))).orderBy(desc(measurementPlan.version)).limit(1).for("share");
    if (!revision || !plan) throw new Error("campaign-measurement-context-required");
    const payload = revision.briefJson as CampaignRevisionPayload;
    if (payload.campaign.measurementPlanId !== String(plan.id)) throw new Error("approved-measurement-plan-mismatch");
    const sources = await lockedContext(tx, input.clientId, input.market, input.language);
    const ids = [...new Set(selections.flatMap((item) => [Number(item.baselineObservationId), Number(item.resultObservationId)]))];
    const observations = ids.length ? (await tx.select().from(quantitativeObservation).where(and(eq(quantitativeObservation.clientId, input.clientId), inArray(quantitativeObservation.id, ids)))
      .orderBy(asc(quantitativeObservation.id)).for("share")).map(observationDomain) : [];
    const evaluate = () => evaluateCampaignResults({ ...input, campaign: { ...payload.campaign, state: row.state, revision: row.currentRevision }, selections, observations,
      plan: { id: plan.id, version: plan.version, reviewState: plan.reviewState, plan: plan.planJson as MeasurementPlan }, sources: sources(), now: new Date().toISOString() });
    const result = evaluate();
    const key = `campaign:${input.campaignId}:${input.stage}`;
    const [previous] = await tx.select({ version: max(researchArtifact.version) }).from(researchArtifact).where(and(eq(researchArtifact.clientId, input.clientId), eq(researchArtifact.artifactKey, key)));
    const version = Number(previous.version ?? 0) + 1;
    const [created] = await tx.insert(researchArtifact).values({ clientId: input.clientId, artifactKey: key, artifactType: "campaign_assessment",
      abilityKey: input.stage === "live" ? "live-campaign-intelligence" : "post-campaign-learning", abilityVersion: "1.0.0", status: result.assessment.status, version,
      payloadJson: { campaignId: row.id, campaignRevision: row.currentRevision, assessment: result.assessment }, evidenceIds: result.evidenceIds.map(Number), createdBy: input.actorUserId }).returning();
    await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.actorUserId, action: "assess", entityType: "campaign", entityId: String(row.id),
      redactedAfterJson: { stage: input.stage, method: result.assessment.method, artifactId: created.id, version, status: result.assessment.status } });
    const rechecked = evaluate().assessment;
    if (result.assessment.comparisons.length !== rechecked.comparisons.length || (result.assessment.status === "ready" && rechecked.status !== "ready")) throw new Error("campaign-context-changed");
    return { id: created.id, campaignId: row.id, version, assessment: result.assessment, evidenceIds: created.evidenceIds, createdAt: created.createdAt };
  });
}
