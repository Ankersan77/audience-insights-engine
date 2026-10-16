import { and, desc, eq } from "drizzle-orm";
import type { EvaluationArtifactType, EvaluationCaseClass, ExternalValidationGate, ExternalValidationGateKey, QualityDimension, QualityScorecard } from "@/src/core/contracts";
import { db } from "@/src/db/client";
import { externalValidationGate, qualityEvaluation } from "@/src/db/schema";
import { assertEvaluationPair, assessQualityScores, effectiveGateStatus, QUALITY_RUBRIC_VERSION, REQUIRED_GATE_SCORECARD } from "@/src/evaluation/scorecard";

export const VALIDATION_GATE_DEFINITIONS: Readonly<Record<ExternalValidationGateKey, string>> = {
  pilot_scope: "Named pilot or approved representative dataset with a signed source inventory.",
  source_rights: "Permission, licence, purpose, quotation rights and revocation path for each source.",
  data_policy: "Approved cohort, suppression, evidence-retention and raw-retention values.",
  live_connectors: "Secret-store credentials plus provider acceptance and failure evidence.",
  research_quality: "Named qualified reviewer and scored representative/adversarial briefs.",
  brand_lift: "Named methodology reviewer and signed design/output-language review.",
  monitoring: "Shadow-mode volume, scores, noise/dismissal thresholds and retest evidence.",
  production_operations: "Deployment owner, backup, timed restore, alerts, rollback and incident exercise.",
};

export type QualityEvaluationRow = QualityScorecard & { id: number; reviewerUserId: number; meanScore: number; createdAt: Date };

export async function listQualityEvaluations(clientId: number): Promise<QualityEvaluationRow[]> {
  const rows = await db.select().from(qualityEvaluation).where(eq(qualityEvaluation.clientId, clientId)).orderBy(desc(qualityEvaluation.id));
  return rows.map((row) => ({
    id: row.id,
    clientId: String(row.clientId),
    caseClass: row.caseClass as EvaluationCaseClass,
    artifactType: row.artifactType as EvaluationArtifactType,
    artifactId: row.artifactId,
    rubricVersion: row.rubricVersion,
    scores: row.scoresJson as Partial<Record<QualityDimension, number>>,
    thresholds: row.thresholdsJson as Partial<Record<QualityDimension, number>>,
    meanThreshold: row.meanThreshold,
    meanScore: row.meanScore,
    outcome: row.outcome as QualityScorecard["outcome"],
    notes: row.notes,
    limitations: row.limitations,
    evidenceReference: row.evidenceReference,
    remediationOf: row.remediationOf ? String(row.remediationOf) : undefined,
    reviewedAt: row.createdAt.toISOString(),
    reviewerUserId: row.reviewerUserId,
    createdAt: row.createdAt,
  }));
}

export async function createQualityEvaluation(input: {
  clientId: number;
  reviewerUserId: number;
  caseClass: EvaluationCaseClass;
  artifactType: EvaluationArtifactType;
  artifactId: string;
  scores: Partial<Record<QualityDimension, number>>;
  thresholds: Partial<Record<QualityDimension, number>>;
  meanThreshold: number;
  notes: string;
  limitations: readonly string[];
  evidenceReference: string;
  remediationOf?: number;
}): Promise<QualityEvaluationRow> {
  if (input.remediationOf) {
    const [prior] = await db.select({ id: qualityEvaluation.id }).from(qualityEvaluation).where(and(eq(qualityEvaluation.id, input.remediationOf), eq(qualityEvaluation.clientId, input.clientId))).limit(1);
    if (!prior) throw new Error("remediation-scorecard-not-found");
  }
  assertEvaluationPair(input.caseClass, input.artifactType);
  const assessment = assessQualityScores(input);
  const [created] = await db.insert(qualityEvaluation).values({
    clientId: input.clientId,
    caseClass: input.caseClass,
    artifactType: input.artifactType,
    artifactId: input.artifactId,
    rubricVersion: QUALITY_RUBRIC_VERSION,
    scoresJson: input.scores,
    thresholdsJson: input.thresholds,
    meanThreshold: input.meanThreshold,
    meanScore: assessment.meanScore,
    outcome: assessment.outcome,
    notes: input.notes,
    limitations: [...input.limitations],
    evidenceReference: input.evidenceReference,
    remediationOf: input.remediationOf,
    reviewerUserId: input.reviewerUserId,
  }).returning();
  return (await listQualityEvaluations(input.clientId)).find((row) => row.id === created.id)!;
}

export type ValidationGateRow = ExternalValidationGate & { definition: string; verifiedBy?: number; updatedAt?: Date };

export async function listValidationGates(clientId: number): Promise<ValidationGateRow[]> {
  const rows = await db.select().from(externalValidationGate).where(eq(externalValidationGate.clientId, clientId));
  const byKey = new Map(rows.map((row) => [row.gateKey as ExternalValidationGateKey, row]));
  return (Object.keys(VALIDATION_GATE_DEFINITIONS) as ExternalValidationGateKey[]).map((key) => {
    const row = byKey.get(key);
    const status = effectiveGateStatus({ status: row?.status as ExternalValidationGate["status"] ?? "needs_context", expiresAt: row?.expiresAt?.toISOString() }, new Date());
    return {
      clientId: String(clientId), key,
      status,
      owner: row?.owner ?? "Unassigned",
      scope: row?.scope ?? VALIDATION_GATE_DEFINITIONS[key],
      evidenceReference: row?.evidenceReference ?? undefined,
      verifiedAt: row?.verifiedAt?.toISOString(),
      expiresAt: row?.expiresAt?.toISOString(),
      definition: VALIDATION_GATE_DEFINITIONS[key],
      verifiedBy: row?.verifiedBy ?? undefined,
      updatedAt: row?.updatedAt,
    };
  });
}

export async function upsertValidationGate(input: {
  clientId: number;
  key: ExternalValidationGateKey;
  status: ExternalValidationGate["status"];
  owner: string;
  scope: string;
  evidenceReference?: string;
  verifiedBy: number;
  expiresAt?: Date;
}): Promise<ValidationGateRow> {
  if (input.status === "verified" && !input.evidenceReference) throw new Error("verified-gate-requires-evidence-reference");
  if (input.status === "verified" && input.expiresAt && input.expiresAt.getTime() <= Date.now()) throw new Error("verified-gate-expiry-must-be-in-the-future");
  const artifactType = REQUIRED_GATE_SCORECARD[input.key];
  if (input.status === "verified" && artifactType) {
    const [passing] = await db.select({ id: qualityEvaluation.id }).from(qualityEvaluation).where(and(
      eq(qualityEvaluation.clientId, input.clientId),
      eq(qualityEvaluation.artifactType, artifactType),
      eq(qualityEvaluation.outcome, "passed"),
    )).limit(1);
    if (!passing) throw new Error(`verified-${input.key}-requires-passing-${artifactType}-scorecard`);
  }
  const now = new Date();
  await db.insert(externalValidationGate).values({
    clientId: input.clientId, gateKey: input.key, status: input.status, owner: input.owner, scope: input.scope,
    evidenceReference: input.evidenceReference, verifiedBy: input.status === "verified" ? input.verifiedBy : null,
    verifiedAt: input.status === "verified" ? now : null, expiresAt: input.expiresAt, updatedAt: now,
  }).onConflictDoUpdate({
    target: [externalValidationGate.clientId, externalValidationGate.gateKey],
    set: { status: input.status, owner: input.owner, scope: input.scope, evidenceReference: input.evidenceReference, verifiedBy: input.status === "verified" ? input.verifiedBy : null, verifiedAt: input.status === "verified" ? now : null, expiresAt: input.expiresAt, updatedAt: now },
  });
  return (await listValidationGates(input.clientId)).find((gate) => gate.key === input.key)!;
}
