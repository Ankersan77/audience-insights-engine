import { NextRequest, NextResponse } from "next/server";
import type { Campaign } from "@/src/core/contracts";
import { transitionCampaignRecord } from "@/src/db/queries/campaign_workspace";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, assertReview, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const campaignId = Number((await context.params).id);
  const body = (await request.json()) as { nextState?: Campaign["state"]; learningRecordId?: number };
  const states: Campaign["state"][] = ["proposed", "approved", "active", "completed", "learning_reviewed", "archived"];
  if (!Number.isInteger(campaignId) || !body.nextState || !states.includes(body.nextState)) return NextResponse.json({ error: "A valid transition is required." }, { status: 400 });
  try {
    if (body.nextState === "approved" || body.nextState === "learning_reviewed") assertReview(session);
    else assertResearchWrite(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
  try {
    const updated = await transitionCampaignRecord({ clientId: session.clientId, campaignId, nextState: body.nextState, actorUserId: session.id, learningRecordId: body.learningRecordId });
    return NextResponse.json({ campaign: updated });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign transition failed." }, { status: 409 }); }
}

