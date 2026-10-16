import { NextRequest, NextResponse } from "next/server";
import type { Campaign } from "@/src/core/contracts";
import { transitionCampaignRecord } from "@/src/db/queries/campaign_workspace";
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
  const body = (await request.json()) as { nextState?: Campaign["state"]; learningRecordId?: number };
  const states: Campaign["state"][] = ["proposed", "approved", "active", "completed", "learning_reviewed", "archived"];
  if (!Number.isInteger(campaignId) || !body.nextState || !states.includes(body.nextState)) return NextResponse.json({ error: "A valid transition is required." }, { status: 400 });
  try {
    const updated = await transitionCampaignRecord({ clientId: session.clientId, campaignId, nextState: body.nextState, actorUserId: session.id, learningRecordId: body.learningRecordId });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "transition", entityType: "campaign", entityId: String(campaignId), after: { state: updated.state, revision: updated.currentRevision } });
    return NextResponse.json({ campaign: updated });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign transition failed." }, { status: 409 }); }
}

