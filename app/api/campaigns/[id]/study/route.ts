import { NextRequest, NextResponse } from "next/server";
import { createStudyRecord, listCampaignWorkspace } from "@/src/db/queries/campaign_workspace";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  try { assertAdmin(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const campaignId = Number((await context.params).id);
  const campaign = (await listCampaignWorkspace(session.clientId)).find((item) => item.id === campaignId);
  if (!campaign?.measurementPlanDbId) return NextResponse.json({ error: "A measurement plan is required first." }, { status: 400 });
  const body = (await request.json()) as Record<string, unknown>;
  const requestedClaim = ["diagnostic", "directional", "brand_lift"].includes(String(body.requestedClaim)) ? body.requestedClaim as "diagnostic" | "directional" | "brand_lift" : "diagnostic";
  const assignment = ["randomized", "matched", "observational", "none"].includes(String(body.assignment)) ? body.assignment as "randomized" | "matched" | "observational" | "none" : "none";
  const contaminationRisk = ["low", "medium", "high", "unknown"].includes(String(body.contaminationRisk)) ? body.contaminationRisk as "low" | "medium" | "high" | "unknown" : "unknown";
  try {
    const created = await createStudyRecord({ clientId: session.clientId, measurementPlanId: campaign.measurementPlanDbId, design: {
      requestedClaim, hasTreatmentGroup: body.hasTreatmentGroup === true, hasControlGroup: body.hasControlGroup === true, assignment,
      baselineMeasured: body.baselineMeasured === true, outcomeInstrument: typeof body.outcomeInstrument === "string" ? body.outcomeInstrument.trim() : "",
      sampleSizeTreatment: Number(body.sampleSizeTreatment) || undefined, sampleSizeControl: Number(body.sampleSizeControl) || undefined,
      weighting: typeof body.weighting === "string" && body.weighting.trim() ? body.weighting.trim() : undefined,
      exclusions: Array.isArray(body.exclusions) ? body.exclusions.filter((item): item is string => typeof item === "string") : [],
      fieldworkWindow: typeof body.fieldworkStart === "string" && typeof body.fieldworkEnd === "string" && body.fieldworkStart && body.fieldworkEnd ? { start: body.fieldworkStart, end: body.fieldworkEnd } : undefined,
      preregistered: body.preregistered === true, contaminationRisk,
    } });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "classify", entityType: "study", entityId: String(created.id), after: { classification: created.classification, mayUseBrandLiftTerm: created.classificationResult.mayUseBrandLiftTerm } });
    return NextResponse.json({ study: created }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Study could not be classified." }, { status: 400 }); }
}

