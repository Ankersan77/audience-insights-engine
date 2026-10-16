import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import type { RightsDeclaration, SolutionProfile, SourceClass } from "@/src/core/contracts";
import type { ResearchContextSources } from "@/src/abilities/context";
import { evaluateContextualPreflight, parsePreflightReview, preflightBasisDigest, type ContextualPreflight } from "@/src/campaigns/preflight";
import { readSourceConnectionPolicy, sourceClassification, sourcePolicyFailure } from "@/src/connectors/sourcePolicy";
import { db } from "@/src/db/client";
import { campaign, campaignRevision, canonicalEvidence, governanceAudit, intelligenceRecord, measurementPlan, researchArtifact, sensingProfile, solutionProfile, sourceConnection } from "@/src/db/schema";
import { canonicalEvidenceItem } from "./canonical_evidence";
import { canonicalProfile } from "./monitoring";
import { toIntelligence } from "./workspace_intelligence";
import type { CampaignAssessmentArtifact, CampaignRevisionPayload } from "./campaign_workspace";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Caller holds campaign → measurement advisory locks. Configuration follows sensing → solution. */
export async function lockedContext(tx: Transaction, clientId: number, market?: string, language?: string): Promise<(now?: string) => ResearchContextSources> {
  const [candidate] = await tx.select().from(solutionProfile).where(and(eq(solutionProfile.clientId, clientId), eq(solutionProfile.status, "active"))).orderBy(desc(solutionProfile.version)).limit(1);
  const sensingId = (candidate?.profileJson as SolutionProfile | undefined)?.sensingProfileId;
  const [sensing] = sensingId ? await tx.select().from(sensingProfile).where(and(eq(sensingProfile.clientId, clientId), eq(sensingProfile.id, Number(sensingId)))).for("share") : [];
  const [solution] = candidate ? await tx.select().from(solutionProfile).where(and(eq(solutionProfile.clientId, clientId), eq(solutionProfile.id, candidate.id), eq(solutionProfile.status, "active"))).for("share") : [];
  const sources = await tx.select().from(sourceConnection).where(eq(sourceConnection.clientId, clientId)).orderBy(asc(sourceConnection.id)).for("share");
  const evidence = await tx.select().from(canonicalEvidence).where(eq(canonicalEvidence.clientId, clientId)).orderBy(asc(canonicalEvidence.id)).for("share");
  const intelligence = await tx.select().from(intelligenceRecord).where(eq(intelligenceRecord.clientId, clientId)).orderBy(asc(intelligenceRecord.id)).for("share");
  const sourceMap = new Map(sources.map((item) => [item.id, item]));
  const profile = solution ? { ...solution.profileJson as SolutionProfile, id: String(solution.id), clientId: String(clientId), version: solution.version, status: "active" as const } : null;
  const scopedMarket = market?.trim() || (profile?.markets.length === 1 ? profile.markets[0] : undefined);
  const scopedLanguage = language?.trim() || (profile?.languages.length === 1 ? profile.languages[0] : undefined);
  return (now = new Date().toISOString()) => {
  const permitted = sources.filter((source) => !sourcePolicyFailure({ health: source.health, rights: source.rightsJson as RightsDeclaration,
    policy: readSourceConnectionPolicy(source.configurationJson), dataClassification: sourceClassification(source.sourceClass as SourceClass), request: { operation: "research", filters: {
      ...(scopedMarket ? { markets: [scopedMarket] } : {}), ...(scopedLanguage ? { languages: [scopedLanguage] } : {}),
    } }, now }));
  return {
    solution: profile,
    sensing: sensing ? canonicalProfile(sensing) : null, intelligence: intelligence.map(toIntelligence),
    evidence: evidence.filter((item) => sourceMap.has(item.sourceConnectionId)).map((item) => {
      const source = sourceMap.get(item.sourceConnectionId)!;
      const canonical = canonicalEvidenceItem({ evidence: item, sourceClass: source.sourceClass });
      const currentRightsExpiry = (source.rightsJson as RightsDeclaration).expiresAt;
      // A shortened source licence also shortens the usable campaign snapshot and any derived learning.
      if (currentRightsExpiry && Number.isFinite(Date.parse(currentRightsExpiry)) && Date.parse(currentRightsExpiry) < Date.parse(canonical.expiresAt)) return { ...canonical, expiresAt: currentRightsExpiry };
      return canonical;
    }),
    sourceBindings: Object.fromEntries(permitted.map((item) => [item.connectorId, String(item.id)])),
  };
  };
}

export async function evaluateLockedPreflight(tx: Transaction, input: { clientId: number; campaignId: number; market?: string; language?: string; review?: unknown }) {
  const [row] = await tx.select().from(campaign).where(and(eq(campaign.clientId, input.clientId), eq(campaign.id, input.campaignId))).for("share");
  if (!row || row.state !== "proposed") throw new Error("preflight-assessment-requires-proposed-campaign");
  const [revision] = await tx.select().from(campaignRevision).where(and(eq(campaignRevision.clientId, input.clientId), eq(campaignRevision.campaignId, row.id), eq(campaignRevision.revision, row.currentRevision))).for("share");
  if (!revision) throw new Error("campaign-revision-missing");
  const [plan] = await tx.select().from(measurementPlan).where(and(eq(measurementPlan.clientId, input.clientId), eq(measurementPlan.campaignId, row.id))).orderBy(desc(measurementPlan.version)).limit(1).for("share");
  const payload = revision.briefJson as CampaignRevisionPayload;
  const sources = await lockedContext(tx, input.clientId, input.market, input.language);
  const review = parsePreflightReview(input.review);
  const run = () => evaluateContextualPreflight({ campaign: { ...payload.campaign, state: row.state, revision: row.currentRevision, measurementPlanId: plan ? String(plan.id) : undefined },
    strategicEvidenceIds: payload.strategicEvidenceIds.map(String), brandConstraints: payload.brandConstraints,
    plan: plan ? { id: plan.id, version: plan.version, reviewState: plan.reviewState, plan: plan.planJson as NonNullable<Parameters<typeof evaluateContextualPreflight>[0]["plan"]>["plan"] } : undefined,
    sources: sources(), review, market: input.market, language: input.language, now: new Date().toISOString() });
  return { result: run(), recheck: run };
}

export async function createContextualPreflight(input: { clientId: number; campaignId: number; actorUserId: number; review?: unknown; market?: string; language?: string }): Promise<CampaignAssessmentArtifact> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73004, ${input.campaignId})`);
    await tx.execute(sql`select pg_advisory_xact_lock(73003, ${input.campaignId})`);
    const { result, recheck } = await evaluateLockedPreflight(tx, input);
    const key = `campaign:${input.campaignId}:preflight`;
    const [previous] = await tx.select({ version: max(researchArtifact.version) }).from(researchArtifact).where(and(eq(researchArtifact.clientId, input.clientId), eq(researchArtifact.artifactKey, key)));
    const version = Number(previous.version ?? 0) + 1;
    const [created] = await tx.insert(researchArtifact).values({ clientId: input.clientId, artifactKey: key, artifactType: "campaign_assessment", abilityKey: "campaign-preflight", abilityVersion: "1.0.0",
      status: result.assessment.status, version, payloadJson: { campaignId: input.campaignId, campaignRevision: result.assessment.campaignSnapshot.revision, assessment: result.assessment },
      evidenceIds: result.evidenceIds.map(Number), createdBy: input.actorUserId }).returning();
    await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.actorUserId, action: "assess", entityType: "campaign", entityId: String(input.campaignId),
      redactedAfterJson: { stage: "preflight", method: result.assessment.method, artifactId: created.id, version, status: result.assessment.status, evidenceIds: created.evidenceIds } });
    if (result.assessment.status === "ready" && recheck().assessment.status !== "ready") throw new Error("campaign-context-changed");
    return { id: created.id, campaignId: input.campaignId, version, assessment: result.assessment, evidenceIds: created.evidenceIds, createdAt: created.createdAt };
  });
}

export async function assertCurrentPreflight(tx: Transaction, input: { clientId: number; campaignId: number }): Promise<{ id: number; recheck(): void }> {
  const [artifact] = await tx.select().from(researchArtifact).where(and(eq(researchArtifact.clientId, input.clientId), eq(researchArtifact.artifactKey, `campaign:${input.campaignId}:preflight`), eq(researchArtifact.artifactType, "campaign_assessment"))).orderBy(desc(researchArtifact.version)).limit(1);
  const saved = (artifact?.payloadJson as { assessment?: ContextualPreflight } | undefined)?.assessment;
  if (!artifact || saved?.method !== "analyst-preflight@1" || saved.status !== "ready" || !saved.contextBasis) throw new Error("current-contextual-preflight-required");
  const fresh = await evaluateLockedPreflight(tx, { ...input, market: saved.contextBasis.market, language: saved.contextBasis.language, review: saved.review });
  const recheck = () => {
    const assessment = fresh.recheck().assessment;
    if (assessment.status !== "ready" || preflightBasisDigest(assessment) !== preflightBasisDigest(saved)) throw new Error("campaign-context-changed");
  };
  recheck();
  return { id: artifact.id, recheck };
}
