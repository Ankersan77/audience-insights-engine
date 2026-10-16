import { NextRequest, NextResponse } from "next/server";
import { createCampaignRecord, listCampaignWorkspace } from "@/src/db/queries/campaign_workspace";
import { redactIdentifiers } from "@/src/evidence/policy";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

export const dynamic = "force-dynamic";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => redactIdentifiers(item.trim()).content).filter(Boolean) : [];
}
function ids(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : [];
}
function text(value: unknown): string { return typeof value === "string" ? redactIdentifiers(value.trim()).content : ""; }

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ campaigns: await listCampaignWorkspace(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const body = (await request.json()) as Record<string, unknown>;
  const name = text(body.name), objective = text(body.objective), audience = text(body.audience), proposition = text(body.proposition);
  if (!name || !objective || !audience || !proposition) return NextResponse.json({ error: "Name, objective, audience, and proposition are required." }, { status: 400 });
  try {
    const created = await createCampaignRecord({
      clientId: session.clientId, name, objective, audience, proposition,
      creativeRoutes: strings(body.creativeRoutes), channels: strings(body.channels), budgetAssumptions: strings(body.budgetAssumptions),
      strategicEvidenceIds: ids(body.strategicEvidenceIds), brandConstraints: strings(body.brandConstraints),
    });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "create", entityType: "campaign", entityId: String(created.id), after: { state: created.state, revision: created.currentRevision } });
    return NextResponse.json({ campaign: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign could not be created." }, { status: 400 });
  }
}

