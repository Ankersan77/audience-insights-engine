import { NextRequest, NextResponse } from "next/server";
import { promoteCampaignLearning } from "@/src/db/queries/workspace_intelligence";
import { getSession } from "@/src/lib/auth";
import { assertReview, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(request: NextRequest, context: RouteContext<"/api/workspace/intelligence/[id]/promote">) {
  const session = await getSession();
  try { assertReview(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const sourceId = Number((await context.params).id);
  const body = (await request.json()) as { decayAt?: string };
  const decayAt = body.decayAt ? new Date(body.decayAt) : undefined;
  if (!Number.isInteger(sourceId) || (decayAt && !Number.isFinite(decayAt.getTime()))) return NextResponse.json({ error: "A valid candidate and optional decay date are required." }, { status: 400 });
  try {
    const learning = await promoteCampaignLearning({ clientId: session.clientId, sourceId, reviewerUserId: session.id, now: new Date(), decayAt });
    return NextResponse.json({ record: learning }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Learning could not be promoted." }, { status: 409 });
  }
}
