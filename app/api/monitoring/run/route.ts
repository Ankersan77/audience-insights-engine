import { NextResponse } from "next/server";
import { enqueueDueMonitoringRuns, reconcileMonitoringRuns } from "@/src/db/queries/monitoring";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

export async function POST() {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) { if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 }); throw error; }
  const scheduled = await enqueueDueMonitoringRuns(new Date(), session.clientId);
  const reconciled = await reconcileMonitoringRuns(new Date(), session.clientId);
  await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "schedule", entityType: "monitoring_run", entityId: "cadence-window", after: { ...scheduled, reconciled } });
  return NextResponse.json({ scheduled, reconciled });
}

