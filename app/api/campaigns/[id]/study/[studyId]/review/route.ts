import { NextRequest, NextResponse } from "next/server";
import { reviewStudyRecord } from "@/src/db/queries/campaign_workspace";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertReview, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(request: NextRequest, context: RouteContext<"/api/campaigns/[id]/study/[studyId]/review">) {
  const session = await getSession();
  try { assertReview(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const { id, studyId } = await context.params;
  const campaignId = Number(id);
  const databaseId = Number(studyId);
  const body = (await request.json()) as { decision?: string };
  if (!Number.isInteger(campaignId) || !Number.isInteger(databaseId) || !["accepted", "rejected", "revision_requested"].includes(body.decision ?? "")) {
    return NextResponse.json({ error: "A valid study and review decision are required." }, { status: 400 });
  }
  const updated = await reviewStudyRecord({
    clientId: session.clientId,
    studyId: databaseId,
    reviewerUserId: session.id,
    decision: body.decision as "accepted" | "rejected" | "revision_requested",
  });
  if (!updated) return NextResponse.json({ error: "Pending study not found." }, { status: 404 });
  await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "review", entityType: "study", entityId: String(databaseId), after: { campaignId, reviewState: updated.reviewState } });
  return NextResponse.json({ study: updated });
}
