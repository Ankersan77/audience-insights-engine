import { NextRequest, NextResponse } from "next/server";
import { reviewMeasurementPlan } from "@/src/db/queries/campaign_workspace";
import { boundedJson } from "@/src/lib/boundedJson";
import { getSession } from "@/src/lib/auth";
import { assertReview, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  try { assertReview(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const campaignId = Number((await context.params).id);
  let body;
  try {
    body = await boundedJson(request, 4096) as { decision?: string; expectedPlanVersion?: number };
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["decision", "expectedPlanVersion"].includes(key))
      || !Number.isSafeInteger(campaignId) || campaignId < 1 || !["accepted", "rejected", "revision_requested"].includes(body.decision ?? "")
      || typeof body.expectedPlanVersion !== "number" || !Number.isSafeInteger(body.expectedPlanVersion) || body.expectedPlanVersion < 1) throw new Error("invalid-review");
  } catch { return NextResponse.json({ error: "A valid review decision and displayed plan version are required." }, { status: 400 }); }
  try {
    const reviewed = await reviewMeasurementPlan({ clientId: session.clientId, campaignId, reviewerUserId: session.id, decision: body.decision as "accepted" | "rejected" | "revision_requested", expectedPlanVersion: body.expectedPlanVersion });
    if (!reviewed) return NextResponse.json({ error: "A pending measurement plan was not found." }, { status: 409 });
    return NextResponse.json({ measurementPlan: reviewed });
  } catch (error) {
    if (error instanceof Error && error.message === "measurement-plan-version-conflict") return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "measurement-plan-review-failed" }, { status: 503 });
  }
}

