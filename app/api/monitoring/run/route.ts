import { NextResponse } from "next/server";
import { enqueueDueMonitoringRuns, qualifyPendingMonitoringRuns, reconcileMonitoringRuns } from "@/src/db/queries/monitoring";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";
import { generateDueBriefings } from "@/src/db/queries/briefings";

export async function POST() {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) { if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 }); throw error; }
  const scheduled = await enqueueDueMonitoringRuns(new Date(), session.clientId);
  const reconciled = await reconcileMonitoringRuns(new Date(), session.clientId);
  const qualified = await qualifyPendingMonitoringRuns(new Date(), session.clientId);
  const briefings = await generateDueBriefings(new Date(), session.clientId);
  await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "schedule", entityType: "monitoring_run", entityId: "cadence-window", after: { ...scheduled, reconciled, qualified } });
  return NextResponse.json({ scheduled, reconciled, qualified, briefings });
}

