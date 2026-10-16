import { NextRequest, NextResponse } from "next/server";
import type { ResearchProject } from "@/src/core/contracts";
import { setResearchProjectStatus } from "@/src/db/queries/projects";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/projects/[id]">) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const id = Number((await context.params).id);
  const body = await request.json() as Record<string, unknown>;
  const allowed = new Set<ResearchProject["status"]>(["active", "completed", "archived"]);
  const status = typeof body.status === "string" && allowed.has(body.status as ResearchProject["status"]) ? body.status as ResearchProject["status"] : null;
  if (!Number.isInteger(id) || !status) return NextResponse.json({ error: "valid-project-status-required" }, { status: 400 });
  const project = await setResearchProjectStatus({ clientId: session.clientId, id, status, now: new Date() });
  if (!project) return NextResponse.json({ error: "project-not-found" }, { status: 404 });
  await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "status_change", entityType: "research_project", entityId: project.id, after: { status } });
  return NextResponse.json({ project });
}
