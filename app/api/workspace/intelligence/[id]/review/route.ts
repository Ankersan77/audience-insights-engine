import { NextRequest, NextResponse } from "next/server";
import { reviewIntelligenceRecord } from "@/src/db/queries/workspace_intelligence";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(request: NextRequest, context: RouteContext<"/api/workspace/intelligence/[id]/review">) {
  const session = await getSession();
  try {
    assertAdmin(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const { id } = await context.params;
  const recordId = Number(id);
  const body = (await request.json()) as { decision?: string };
  if (!Number.isInteger(recordId) || !["accepted", "rejected", "revision_requested"].includes(body.decision ?? "")) {
    return NextResponse.json({ error: "A valid record and review decision are required." }, { status: 400 });
  }
  const record = await reviewIntelligenceRecord({
    clientId: session.clientId,
    id: recordId,
    reviewerUserId: session.id,
    decision: body.decision as "accepted" | "rejected" | "revision_requested",
    now: new Date(),
  });
  if (!record) return NextResponse.json({ error: "Intelligence record not found." }, { status: 404 });
  await recordGovernanceAudit({
    clientId: session.clientId, actorUserId: session.id, action: "review", entityType: "intelligence_record", entityId: record.id,
    after: { reviewState: record.reviewState, lifecycle: record.lifecycle },
  });
  return NextResponse.json({ record });
}

