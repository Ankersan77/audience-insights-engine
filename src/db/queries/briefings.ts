import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Applicability, DecisionBrief, RightsDeclaration, SensingProfile, SolutionProfile, SourceClass } from "@/src/core/contracts";
import { validateSolutionProfile } from "@/src/core/validation";
import { db } from "@/src/db/client";
import { campaign, canonicalEvidence, governanceAudit, intelligenceRecord, monitoringRun, researchArtifact, sensingProfile, solutionProfile, sourceAcquisitionJob, sourceAcquisitionReceipt, sourceConnection } from "@/src/db/schema";
import { readSourceConnectionPolicy, sourceClassification, sourcePolicyFailure } from "@/src/connectors/sourcePolicy";
import { CONTEXT_EVIDENCE_REQUIREMENTS } from "@/src/abilities/context";
import { resolveEvidence } from "@/src/market-twin/resolver";
import { buildPeriodicBriefing, briefingKey, dueBriefingWindows, type PeriodicBriefing } from "@/src/monitoring/briefings";
import { assertResearchArtifactBounds, boundedResearchArtifactValues } from "@/src/research-artifacts/persistenceBounds";
import {
  ARTIFACT_BASIS_UNAVAILABLE_GAP,
  projectTenantResearchArtifacts,
} from "@/src/research-artifacts/readProjection";
import { canonicalEvidenceItem } from "./canonical_evidence";
import { assertCurrentEvidenceUse } from "./evidence_use";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PeriodicBriefingRow = {
  id: number;
  status: string;
  briefing: PeriodicBriefing;
  currentEvidenceAvailable: boolean;
  basisStatus: "current" | "stale";
  unavailableEvidenceIds: readonly number[];
  quarantined: boolean;
};

function quarantinedPeriodicBriefing(row: typeof researchArtifact.$inferSelect): PeriodicBriefing {
  const key = row.artifactKey.split(":");
  const cadence = (["weekly", "monthly", "quarterly"] as const).find((candidate) => candidate === key[2]) ?? "weekly";
  const timestamp = row.createdAt.toISOString();
  return {
    contract: "periodic-briefing@1",
    clientId: String(row.clientId),
    solutionProfileId: key[1] || "unavailable",
    solutionVersion: 0,
    cadence,
    window: { start: timestamp, end: timestamp },
    generatedAt: timestamp,
    scope: "unavailable",
    summary: "Historical briefing content is unavailable under the current retention and resource policy.",
    outcome: "needs_context",
    coverage: [],
    monitoring: [],
    references: [],
    contradictions: [],
    evidenceIds: [],
    gaps: [ARTIFACT_BASIS_UNAVAILABLE_GAP],
    limitations: ["No substantive content from the quarantined artifact is returned."],
    nextDecision: "Decide whether to re-run this review with current permitted evidence.",
  };
}

function isPeriodicBriefing(value: unknown): value is PeriodicBriefing {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PeriodicBriefing>;
  return item.contract === "periodic-briefing@1" && typeof item.solutionProfileId === "string"
    && ["weekly", "monthly", "quarterly"].includes(String(item.cadence))
    && Boolean(item.window && typeof item.window.start === "string" && typeof item.window.end === "string")
    && Array.isArray(item.gaps) && Array.isArray(item.evidenceIds);
}

function usableSource(row: typeof sourceConnection.$inferSelect, profile: SolutionProfile, now: Date): boolean {
  const policy = readSourceConnectionPolicy(row.configurationJson);
  const markets = profile.markets.filter((market) => policy.markets.includes(market));
  const languages = profile.languages.filter((language) => policy.languages.includes(language));
  return markets.length > 0 && languages.length > 0 && !sourcePolicyFailure({ health: row.health, rights: row.rightsJson as RightsDeclaration, policy,
    request: { operation: "briefing", filters: { markets, languages } }, dataClassification: sourceClassification(row.sourceClass as SourceClass), now: now.toISOString() });
}

async function evidenceFor(tx: Transaction | typeof db, clientId: number, sourceIds: readonly number[], now: Date) {
  if (!sourceIds.length) return [];
  const rows = await tx.select({ evidence: canonicalEvidence, sourceClass: sourceConnection.sourceClass, policy: sourceConnection.configurationJson }).from(canonicalEvidence)
    .innerJoin(sourceConnection, and(eq(sourceConnection.id, canonicalEvidence.sourceConnectionId), eq(sourceConnection.clientId, canonicalEvidence.clientId)))
    .where(and(eq(canonicalEvidence.clientId, clientId), inArray(canonicalEvidence.sourceConnectionId, [...sourceIds])));
  const evidence = rows.filter((row) => {
    const policy = readSourceConnectionPolicy(row.policy);
    const applicability = row.evidence.applicabilityJson as Applicability;
    return applicability.markets.every((market) => policy.markets.includes(market)) && applicability.languages.every((language) => policy.languages.includes(language));
  }).map(canonicalEvidenceItem);
  return resolveEvidence({ clientId: String(clientId), now: now.toISOString(), requirements: CONTEXT_EVIDENCE_REQUIREMENTS, evidence }).selected;
}

/** Bounded catch-up, with a durable checkpoint per immutable solution version and cadence. */
export async function generateDueBriefings(now = new Date(), clientId?: number): Promise<{ created: number; invalidProfiles: number }> {
  const profiles = await db.select({ id: solutionProfile.id, clientId: solutionProfile.clientId }).from(solutionProfile).where(and(eq(solutionProfile.status, "active"), clientId ? eq(solutionProfile.clientId, clientId) : undefined)).orderBy(asc(solutionProfile.id));
  const summary = { created: 0, invalidProfiles: 0 };
  for (const candidate of profiles) {
    const result = await db.transaction(async (tx) => {
      // Serializes duplicate scheduler deliveries without holding a lock across provider calls.
      await tx.execute(sql`select pg_advisory_xact_lock(73005, ${candidate.clientId})`);
      const [row] = await tx.select().from(solutionProfile).where(and(eq(solutionProfile.id, candidate.id), eq(solutionProfile.clientId, candidate.clientId), eq(solutionProfile.status, "active"))).limit(1).for("share");
      if (!row) return { created: 0, invalidProfiles: 0 };
      const profile: SolutionProfile = { ...row.profileJson as SolutionProfile, id: String(row.id), clientId: String(row.clientId), version: row.version, status: "active", createdAt: row.createdAt.toISOString() };
      if (!validateSolutionProfile(profile).valid) return { created: 0, invalidProfiles: 1 };
      if (!profile.briefingCadences?.length) return { created: 0, invalidProfiles: 0 };
      const [sensing] = await tx.select().from(sensingProfile).where(and(eq(sensingProfile.id, Number(profile.sensingProfileId)), eq(sensingProfile.clientId, row.clientId))).limit(1);
      if (!sensing) return { created: 0, invalidProfiles: 1 };
      const sensingConfiguration = sensing.profileJson as SensingProfile;
      const allSources = await tx.select().from(sourceConnection).where(eq(sourceConnection.clientId, row.clientId)).orderBy(asc(sourceConnection.id)).for("share");
      const bound = new Set(Object.values(profile.providerBindings));
      const references = new Set(sensingConfiguration.sourceConnectionIds);
      const configured = allSources.filter((source) => bound.has(source.connectorId));
      const required = configured.filter((source) => references.has(String(source.id)) || references.has(source.connectorId));
      const available = configured.filter((source) => usableSource(source, profile, now));
      const availableIds = new Set(available.map((source) => source.id));
      const unresolved = [...references].filter((reference) => !required.some((source) => String(source.id) === reference || source.connectorId === reference)).length;
      const evidence = await evidenceFor(tx, row.clientId, [...availableIds], now);
      const usableEvidenceIds = new Set(evidence.filter((item) => (!item.applicability.markets.length || item.applicability.markets.some((market) => profile.markets.includes(market))) && (!item.applicability.languages.length || item.applicability.languages.some((language) => profile.languages.includes(language)))).map((item) => Number(item.id)));
      let created = 0;
      for (const cadence of profile.briefingCadences) {
        const [checkpoint] = await tx.select({ payload: researchArtifact.payloadJson, evidenceIds: researchArtifact.evidenceIds }).from(researchArtifact).where(and(eq(researchArtifact.clientId, row.clientId), eq(researchArtifact.artifactType, "periodic_briefing"),
          sql`${researchArtifact.payloadJson}->>'solutionProfileId' = ${profile.id}`, sql`${researchArtifact.payloadJson}->>'cadence' = ${cadence}`,
        )).orderBy(desc(sql`${researchArtifact.payloadJson}->'window'->>'end'`)).limit(1);
        if (checkpoint) assertResearchArtifactBounds(checkpoint.payload, checkpoint.evidenceIds);
        const since = checkpoint ? (checkpoint.payload as PeriodicBriefing).window.end : profile.createdAt;
        for (const window of dueBriefingWindows(cadence, since, now.toISOString())) {
          const receipts = await tx.select({ receipt: sourceAcquisitionReceipt, sourceId: sourceAcquisitionJob.sourceConnectionId }).from(sourceAcquisitionReceipt)
            .innerJoin(sourceAcquisitionJob, and(eq(sourceAcquisitionJob.id, sourceAcquisitionReceipt.jobId), eq(sourceAcquisitionJob.clientId, sourceAcquisitionReceipt.clientId)))
            .where(and(eq(sourceAcquisitionReceipt.clientId, row.clientId), gte(sourceAcquisitionReceipt.completedAt, new Date(window.start)), lt(sourceAcquisitionReceipt.completedAt, new Date(window.end))));
          const runs = await tx.select().from(monitoringRun).where(and(eq(monitoringRun.clientId, row.clientId), eq(monitoringRun.sensingProfileId, sensing.id), gte(monitoringRun.finishedAt, new Date(window.start)), lt(monitoringRun.finishedAt, new Date(window.end))));
          const scheduledWithin = await tx.select({ run: monitoringRun, requestedAt: sourceAcquisitionJob.requestedAt }).from(monitoringRun)
            .innerJoin(sourceAcquisitionJob, and(eq(sourceAcquisitionJob.monitoringRunId, monitoringRun.id), eq(sourceAcquisitionJob.clientId, monitoringRun.clientId)))
            .where(and(eq(monitoringRun.clientId, row.clientId), eq(monitoringRun.sensingProfileId, sensing.id), gte(sourceAcquisitionJob.requestedAt, new Date(window.start)), lt(sourceAcquisitionJob.requestedAt, new Date(window.end))));
          const briefs = await tx.select().from(researchArtifact).where(and(eq(researchArtifact.clientId, row.clientId), eq(researchArtifact.artifactType, "decision_brief"), gte(researchArtifact.createdAt, new Date(window.start)), lt(researchArtifact.createdAt, new Date(window.end))));
          for (const artifact of briefs) assertResearchArtifactBounds(artifact.payloadJson, artifact.evidenceIds);
          const records = await tx.select().from(intelligenceRecord).where(and(eq(intelligenceRecord.clientId, row.clientId), lt(intelligenceRecord.createdAt, new Date(window.end))));
          const campaigns = cadence === "weekly" ? [] : await tx.select({ id: campaign.id, clientId: campaign.clientId, state: campaign.state }).from(campaign).where(and(eq(campaign.clientId, row.clientId), lt(campaign.createdAt, new Date(window.end))));
          const briefing = buildPeriodicBriefing({ profile, cadence, window, now: now.toISOString(), sourceIds: required.map((source) => source.id), unavailableSourceCount: unresolved + required.filter((source) => !availableIds.has(source.id)).length,
            receipts: receipts.map(({ receipt, sourceId }) => ({ clientId: String(receipt.clientId), sourceId, completedAt: receipt.completedAt.toISOString(), status: receipt.status })),
            runs: [...runs.map((run) => ({ id: run.id, clientId: String(run.clientId), finishedAt: run.finishedAt!.toISOString(), outcome: run.outcome ?? "unknown", signalIds: run.qualifiedSignalIds })),
              ...new Map(scheduledWithin.filter(({ run }) => !runs.some((included) => included.id === run.id)).map(({ run, requestedAt }) => [run.id, { id: run.id, clientId: String(run.clientId), finishedAt: requestedAt.toISOString(), outcome: run.status === "succeeded" ? run.outcome ?? "unknown" : run.status === "failed" ? "source_health_failure" : "awaiting_acquisition", signalIds: run.qualifiedSignalIds }])).values()],
            briefs: briefs.map((artifact) => { const brief = artifact.payloadJson as DecisionBrief; return { id: artifact.id, clientId: String(artifact.clientId), createdAt: artifact.createdAt.toISOString(), status: brief.contextBasis ? artifact.status : "missing_context", abilityId: artifact.abilityKey ?? "", evidenceIds: artifact.evidenceIds, markets: brief.contextBasis ? [brief.contextBasis.market] : [], languages: brief.contextBasis ? [brief.contextBasis.language] : [] }; }),
            records: records.map((record) => ({ id: record.id, clientId: String(record.clientId), kind: record.kind, reviewState: record.reviewState, lifecycle: record.lifecycle, evidenceIds: record.evidenceIds, contradictionIds: record.contradictionIds, decayAt: record.decayAt?.toISOString(), createdAt: record.createdAt.toISOString(), applicability: record.applicabilityJson as Applicability })),
            campaigns: campaigns.map((item) => ({ ...item, clientId: String(item.clientId) })), usableEvidenceIds,
          });
          await assertCurrentEvidenceUse(tx, { clientId: row.clientId, evidenceIds: briefing.evidenceIds, now });
          const [artifact] = await tx.insert(researchArtifact).values(boundedResearchArtifactValues({ clientId: row.clientId, artifactKey: briefingKey(profile.id, cadence, window), artifactType: "periodic_briefing", abilityKey: "continuous-sensing", abilityVersion: "1.0.0", status: "pending_review", version: 1, payloadJson: briefing, evidenceIds: briefing.evidenceIds, createdAt: now }))
            .onConflictDoNothing({ target: [researchArtifact.clientId, researchArtifact.artifactKey, researchArtifact.version] }).returning({ id: researchArtifact.id });
          if (artifact) {
            await tx.insert(governanceAudit).values({ clientId: row.clientId, action: "briefing_generated", entityType: "research_artifact", entityId: String(artifact.id), redactedAfterJson: { cadence, window, outcome: briefing.outcome, solutionVersion: profile.version }, createdAt: now });
            created++;
          }
        }
      }
      return { created, invalidProfiles: 0 };
    });
    summary.created += result.created;
    summary.invalidProfiles += result.invalidProfiles;
  }
  return summary;
}

type CurrentEvidence = { sources: ReadonlySet<number>; evidence: ReadonlySet<number> };

async function currentEvidence(tx: Transaction | typeof db, clientId: number, profileId: string, now: Date): Promise<CurrentEvidence> {
  const [solution] = await tx.select().from(solutionProfile).where(and(eq(solutionProfile.id, Number(profileId)), eq(solutionProfile.clientId, clientId))).limit(1);
  if (!solution) return { sources: new Set(), evidence: new Set() };
  const profile = solution.profileJson as SolutionProfile;
  const sources = await tx.select().from(sourceConnection).where(eq(sourceConnection.clientId, clientId)).orderBy(asc(sourceConnection.id));
  const allowed = new Set(Object.values(profile.providerBindings));
  const available = sources.filter((source) => allowed.has(source.connectorId) && usableSource(source, profile, now)).map((source) => source.id);
  return { sources: new Set(available), evidence: new Set((await evidenceFor(tx, clientId, available, now)).map((item) => Number(item.id))) };
}

function evidenceAvailable(row: typeof researchArtifact.$inferSelect, current: CurrentEvidence): boolean {
  const briefing = row.payloadJson as PeriodicBriefing;
  return briefing.coverage.length > 0 && briefing.coverage.every((source) => current.sources.has(source.sourceId)) && row.evidenceIds.every((id) => current.evidence.has(id));
}

export async function listPeriodicBriefings(clientId: number, now = new Date()): Promise<PeriodicBriefingRow[]> {
  const rows = await db.select().from(researchArtifact).where(and(eq(researchArtifact.clientId, clientId), eq(researchArtifact.artifactType, "periodic_briefing"))).orderBy(desc(researchArtifact.id)).limit(100);
  const projections = await projectTenantResearchArtifacts(clientId, rows, now);
  const cache = new Map<string, Promise<CurrentEvidence>>();
  return Promise.all(rows.map(async (row, index): Promise<PeriodicBriefingRow> => {
    const projection = projections[index];
    if (projection.quarantined) return { id: row.id, status: "needs_context", briefing: quarantinedPeriodicBriefing(row), currentEvidenceAvailable: false,
      basisStatus: "stale", unavailableEvidenceIds: [], quarantined: true };
    if (!isPeriodicBriefing(projection.payload)) return { id: row.id, status: "needs_context", briefing: quarantinedPeriodicBriefing(row), currentEvidenceAvailable: false,
      basisStatus: "stale", unavailableEvidenceIds: [], quarantined: true };
    const projected = projection.payload;
    const briefing: PeriodicBriefing = projection.basisStatus === "stale" ? {
      ...projected,
      outcome: "needs_context",
      summary: "This briefing is unavailable because supporting evidence is no longer usable under the current source policy.",
      gaps: [...new Set([...projected.gaps, ARTIFACT_BASIS_UNAVAILABLE_GAP])],
    } : projected;
    if (!cache.has(briefing.solutionProfileId)) cache.set(briefing.solutionProfileId, currentEvidence(db, clientId, briefing.solutionProfileId, now));
    const currentEvidenceAvailable = projection.basisStatus === "current" && evidenceAvailable(row, await cache.get(briefing.solutionProfileId)!);
    return { id: row.id, status: currentEvidenceAvailable ? row.status : "needs_context", briefing, currentEvidenceAvailable,
      basisStatus: projection.basisStatus, unavailableEvidenceIds: projection.unavailableEvidenceIds, quarantined: false };
  }));
}

export async function reviewPeriodicBriefing(input: { clientId: number; id: number; reviewerUserId: number; decision: "accepted" | "rejected"; now: Date }): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Match revocation's source-first lock order before taking the artifact lock.
    await tx.select({ id: sourceConnection.id }).from(sourceConnection).where(eq(sourceConnection.clientId, input.clientId)).orderBy(asc(sourceConnection.id)).for("share");
    const [row] = await tx.select().from(researchArtifact).where(and(eq(researchArtifact.id, input.id), eq(researchArtifact.clientId, input.clientId), eq(researchArtifact.artifactType, "periodic_briefing"), eq(researchArtifact.status, "pending_review"))).limit(1).for("update");
    if (!row) return false;
    assertResearchArtifactBounds(row.payloadJson, row.evidenceIds);
    const briefing = row.payloadJson as PeriodicBriefing;
    if (input.decision === "accepted") {
      if (briefing.outcome === "needs_context" || !evidenceAvailable(row, await currentEvidence(tx, row.clientId, briefing.solutionProfileId, input.now))) throw new Error("briefing-evidence-incomplete-or-expired");
      await assertCurrentEvidenceUse(tx, { clientId: row.clientId, evidenceIds: row.evidenceIds, now: input.now });
    }
    const review = { decision: input.decision, reviewerUserId: input.reviewerUserId, reviewedAt: input.now.toISOString() };
    const reviewedBriefing = { ...briefing, review };
    assertResearchArtifactBounds(reviewedBriefing, row.evidenceIds);
    await tx.update(researchArtifact).set({ status: input.decision, payloadJson: reviewedBriefing }).where(eq(researchArtifact.id, row.id));
    await tx.insert(governanceAudit).values({ clientId: input.clientId, actorUserId: input.reviewerUserId, action: "briefing_reviewed", entityType: "research_artifact", entityId: String(row.id), redactedBeforeJson: { status: row.status }, redactedAfterJson: review, createdAt: input.now });
    return true;
  });
}
