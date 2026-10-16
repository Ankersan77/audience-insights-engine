import { NextRequest, NextResponse } from "next/server";
import { reviseCampaignScopes } from "@/src/db/queries/campaign_workspace";
import { getSession } from "@/src/lib/auth";
import { boundedJson } from "@/src/lib/boundedJson";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";
import { parseCampaignScopes } from "@/src/campaigns/scope";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const campaignId = Number((await context.params).id);
  let targetScopes, expectedRevision;
  try {
    const body = await boundedJson(request, 8192) as Record<string, unknown>;
    if (!Number.isSafeInteger(campaignId) || campaignId < 1 || !body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => !["targetScopes", "expectedRevision"].includes(key))
      || typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw new Error("invalid-scope-edit");
    targetScopes = parseCampaignScopes(body.targetScopes); expectedRevision = body.expectedRevision;
  } catch { return NextResponse.json({ error: "invalid-campaign-scope-edit" }, { status: 400 }); }
  try {
    return NextResponse.json(await reviseCampaignScopes({ clientId: session.clientId, campaignId, targetScopes, expectedRevision, actorUserId: session.id }));
  } catch (error) {
    const known = ["campaign-not-found", "campaign-revision-conflict", "campaign-scope-frozen-after-approval"];
    const message = error instanceof Error && known.includes(error.message) ? error.message : "campaign-scope-update-failed";
    return NextResponse.json({ error: message }, { status: message === "campaign-not-found" ? 404 : message === "campaign-scope-update-failed" ? 503 : 409 });
  }
}
