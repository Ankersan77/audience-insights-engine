import { NextResponse } from "next/server";
import { cancelAcquisitionJob } from "@/src/db/queries/acquisition_execution";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(_request: Request, context: RouteContext<"/api/monitoring/jobs/[id]/cancel">) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "A valid job is required." }, { status: 400 });
  const cancelled = await cancelAcquisitionJob({ clientId: session.clientId, id, now: new Date() });
  if (!cancelled) return NextResponse.json({ error: "Only queued or running jobs can be cancelled." }, { status: 409 });
  await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "cancel", entityType: "source_acquisition_job", entityId: String(id), after: { status: "cancelled" } });
  return NextResponse.json({ id, status: "cancelled" });
}
