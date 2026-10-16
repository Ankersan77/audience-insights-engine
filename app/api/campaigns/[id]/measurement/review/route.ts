import { NextRequest, NextResponse } from "next/server";
import { reviewMeasurementPlan } from "@/src/db/queries/campaign_workspace";
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
  const body = (await request.json()) as { decision?: string };
  if (!Number.isInteger(campaignId) || !["accepted", "rejected", "revision_requested"].includes(body.decision ?? "")) {
    return NextResponse.json({ error: "A valid review decision is required." }, { status: 400 });
  }
  const reviewed = await reviewMeasurementPlan({ clientId: session.clientId, campaignId, reviewerUserId: session.id, decision: body.decision as "accepted" | "rejected" | "revision_requested" });
  if (!reviewed) return NextResponse.json({ error: "A pending measurement plan was not found." }, { status: 409 });
  await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "review", entityType: "measurement_plan", entityId: String(reviewed.id), after: { reviewState: reviewed.reviewState } });
  return NextResponse.json({ measurementPlan: reviewed });
}

