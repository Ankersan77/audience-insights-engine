import { NextRequest, NextResponse } from "next/server";
import { createCampaignLearningCandidate } from "@/src/db/queries/workspace_intelligence";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(request: NextRequest, context: RouteContext<"/api/campaigns/[id]/learning">) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const campaignId = Number((await context.params).id);
  const body = (await request.json()) as { assessmentId?: number };
  if (!Number.isInteger(campaignId) || !Number.isInteger(Number(body.assessmentId))) return NextResponse.json({ error: "A valid post assessment is required." }, { status: 400 });
  try {
    const record = await createCampaignLearningCandidate({ clientId: session.clientId, campaignId, assessmentId: Number(body.assessmentId), actorUserId: session.id, now: new Date() });
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Candidate learning could not be created." }, { status: 400 });
  }
}
