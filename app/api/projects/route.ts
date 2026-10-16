import { NextRequest, NextResponse } from "next/server";
import { createResearchProject, listResearchProjects } from "@/src/db/queries/projects";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))] : [];
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ projects: await listResearchProjects(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const body = await request.json() as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (!name || !decision || name.length > 160 || decision.length > 1000) return NextResponse.json({ error: "Name and bounded decision context are required." }, { status: 400 });
  try {
    const project = await createResearchProject({ clientId: session.clientId, createdBy: session.id, name, decision, markets: strings(body.markets), languages: strings(body.languages), now: new Date() });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "create", entityType: "research_project", entityId: project.id, after: { name: project.name, markets: project.markets, languages: project.languages } });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Project could not be created." }, { status: 400 }); }
}
