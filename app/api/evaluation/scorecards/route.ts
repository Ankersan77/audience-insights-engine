import { NextRequest, NextResponse } from "next/server";
import type { EvaluationArtifactType, EvaluationCaseClass, QualityDimension } from "@/src/core/contracts";
import { createQualityEvaluation, listQualityEvaluations } from "@/src/db/queries/evaluation";
import { defaultQualityThresholds, QUALITY_DIMENSIONS, QUALITY_MEAN_THRESHOLD } from "@/src/evaluation/scorecard";
import { redactIdentifiers } from "@/src/evidence/policy";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertReview, PermissionDeniedError } from "@/src/lib/roles";

const CASES: readonly EvaluationCaseClass[] = ["representative", "sparse_context", "stale_data", "conflicting_evidence", "manipulated_signal", "small_sample", "regulated_category", "multi_market", "recovery"];
const ARTIFACTS: readonly EvaluationArtifactType[] = ["decision_brief", "monitoring_signal", "campaign_assessment", "study_report", "recovery_exercise"];

function safeText(value: unknown): string { return typeof value === "string" ? redactIdentifiers(value.trim()).content : ""; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(safeText).filter(Boolean) : []; }
function dimensions(value: unknown): Partial<Record<QualityDimension, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set<string>(QUALITY_DIMENSIONS);
  return Object.fromEntries(Object.entries(value).filter(([key, score]) => allowed.has(key) && Number.isFinite(Number(score))).map(([key, score]) => [key, Number(score)]));
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ scorecards: await listQualityEvaluations(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try { assertReview(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const body = (await request.json()) as Record<string, unknown>;
  const caseClass = String(body.caseClass) as EvaluationCaseClass;
  const artifactType = String(body.artifactType) as EvaluationArtifactType;
  const artifactId = safeText(body.artifactId), notes = safeText(body.notes), evidenceReference = safeText(body.evidenceReference);
  if (!CASES.includes(caseClass) || !ARTIFACTS.includes(artifactType) || !artifactId || !notes || !evidenceReference) {
    return NextResponse.json({ error: "Case, artifact, notes and durable evidence reference are required." }, { status: 400 });
  }
  try {
    const scorecard = await createQualityEvaluation({
      clientId: session.clientId, reviewerUserId: session.id, caseClass, artifactType, artifactId,
      scores: dimensions(body.scores), thresholds: defaultQualityThresholds(artifactType), meanThreshold: QUALITY_MEAN_THRESHOLD,
      notes, limitations: strings(body.limitations), evidenceReference,
      remediationOf: Number.isInteger(Number(body.remediationOf)) && Number(body.remediationOf) > 0 ? Number(body.remediationOf) : undefined,
    });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "score", entityType: "quality_evaluation", entityId: String(scorecard.id), after: { caseClass, artifactType, artifactId, outcome: scorecard.outcome, meanScore: scorecard.meanScore } });
    return NextResponse.json({ scorecard }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scorecard could not be saved." }, { status: 400 });
  }
}
