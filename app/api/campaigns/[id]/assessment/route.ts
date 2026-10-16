import { NextRequest, NextResponse } from "next/server";
import { createCampaignAssessmentRecord } from "@/src/db/queries/campaign_workspace";
import { redactIdentifiers } from "@/src/evidence/policy";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => redactIdentifiers(item.trim()).content).filter(Boolean)
    : [];
}

function metrics(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key.trim() && typeof item === "number" && Number.isFinite(item)));
}

function ids(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : [];
}

export async function POST(request: NextRequest, context: RouteContext<"/api/campaigns/[id]/assessment">) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const campaignId = Number((await context.params).id);
  const body = (await request.json()) as Record<string, unknown>;
  const stage = body.stage;
  if (!Number.isInteger(campaignId) || !["preflight", "live", "post"].includes(String(stage))) {
    return NextResponse.json({ error: "A valid campaign and assessment stage are required." }, { status: 400 });
  }
  try {
    const artifact = await createCampaignAssessmentRecord({
      clientId: session.clientId,
      campaignId,
      actorUserId: session.id,
      stage: stage as "preflight" | "live" | "post",
      baseline: metrics(body.baseline),
      current: metrics(body.current),
      observedResults: metrics(body.observedResults),
      anomalies: strings(body.anomalies),
      contextualChanges: strings(body.contextualChanges),
      dataQualityIssues: strings(body.dataQualityIssues),
      alternativeExplanations: strings(body.alternativeExplanations),
      resultEvidenceIds: ids(body.resultEvidenceIds),
    });
    await recordGovernanceAudit({
      clientId: session.clientId,
      actorUserId: session.id,
      action: "assess",
      entityType: "campaign",
      entityId: String(campaignId),
      after: { stage: artifact.assessment.stage, status: artifact.assessment.status, version: artifact.version, evidenceIds: artifact.evidenceIds },
    });
    return NextResponse.json({ artifact }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign assessment could not be created." }, { status: 400 });
  }
}
