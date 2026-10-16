import { NextRequest, NextResponse } from "next/server";
import { createActiveSensingProfile, listSensingProfiles } from "@/src/db/queries/monitoring";
import { listSourceConnections } from "@/src/db/queries/sources";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : []; }

export async function GET() {
  const session = await getSession(); if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ profiles: await listSensingProfiles(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try { assertAdmin(session); } catch (error) { if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 }); throw error; }
  const body = (await request.json()) as Record<string, unknown>;
  const sourceConnectionIds = strings(body.sourceConnectionIds);
  const sources = await listSourceConnections(session.clientId);
  const permitted = new Set(sources.map((source) => source.connectorId));
  if (sourceConnectionIds.some((id) => !permitted.has(id))) return NextResponse.json({ error: "One or more source connections are outside the client scope." }, { status: 400 });
  try {
    const created = await createActiveSensingProfile({
      clientId: String(session.clientId), themes: strings(body.themes), markets: strings(body.markets), competitors: strings(body.competitors), products: strings(body.products), sourceConnectionIds,
      cadence: typeof body.cadence === "string" ? body.cadence : "weekly", materialityThreshold: Number(body.materialityThreshold), confidenceThreshold: Number(body.confidenceThreshold), freshnessDays: Number(body.freshnessDays), minimumCorroboration: Number(body.minimumCorroboration), quietPeriods: [],
    });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "activate", entityType: "sensing_profile", entityId: String(created.databaseId), after: { version: created.profile.version, cadence: created.profile.cadence, sourceConnectionIds } });
    return NextResponse.json({ profile: created }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sensing profile could not be created." }, { status: 400 }); }
}

