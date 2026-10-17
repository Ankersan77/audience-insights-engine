import { NextRequest, NextResponse } from "next/server";
import { createMeasurementPlanRecord } from "@/src/db/queries/campaign_workspace";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";
import { boundedJson } from "@/src/lib/boundedJson";
import { parseMeasurementInput } from "@/src/campaigns/measurementInput";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const campaignId = Number((await context.params).id);
  let parsed;
  try {
    if (!Number.isSafeInteger(campaignId) || campaignId < 1) throw new Error("invalid-campaign");
    parsed = parseMeasurementInput(await boundedJson(request, 131072));
  } catch { return NextResponse.json({ error: "invalid-scoped-measurement-plan" }, { status: 400 }); }
  try {
    const created = await createMeasurementPlanRecord({ ...parsed, clientId: session.clientId, campaignId, actorUserId: session.id });
    return NextResponse.json({ measurementPlan: created }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["campaign-revision-conflict", "measurement-plan-version-conflict", "measurement-plan-frozen-after-approval"].includes(code)) return NextResponse.json({ error: code }, { status: 409 });
    if (code === "campaign-not-found") return NextResponse.json({ error: code }, { status: 404 });
    if (["explicit-per-scope-measurement-required", "measurement-scope-coverage-mismatch"].includes(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: "measurement-plan-save-failed" }, { status: 503 });
  }
}

