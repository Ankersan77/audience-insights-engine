import { NextRequest, NextResponse } from "next/server";
import { ABILITY_CATALOG } from "@/src/abilities/catalog";
import { createActiveSolutionProfile, listSolutionProfiles } from "@/src/db/queries/solution_profiles";
import { listSourceConnections } from "@/src/db/queries/sources";
import { listSensingProfiles } from "@/src/db/queries/monitoring";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import type { BriefingCadence } from "@/src/monitoring/briefings";

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : []; }

export async function GET() {
  const session = await getSession(); if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ profiles: await listSolutionProfiles(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try { assertAdmin(session); } catch (error) { if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 }); throw error; }
  const body = (await request.json()) as Record<string, unknown>;
  const enabledIds = strings(body.enabledAbilities);
  const briefingCadences = strings(body.briefingCadences);
  if (briefingCadences.some((item) => !["weekly", "monthly", "quarterly"].includes(item))) return NextResponse.json({ error: "Unsupported briefing cadence." }, { status: 400 });
  const enabledAbilities = ABILITY_CATALOG.filter((ability) => enabledIds.includes(ability.id)).map(({ id, version }) => ({ id, version }));
  const sourceIds = strings(body.sourceConnectionIds);
  const sources = await listSourceConnections(session.clientId);
  const allowedSources = new Set(sources.map((source) => source.connectorId));
  if (sourceIds.some((id) => !allowedSources.has(id))) return NextResponse.json({ error: "A provider binding is outside the client scope." }, { status: 400 });
  const evidenceDays = Number(body.evidenceDays), rawHours = Number(body.rawHours), auditDays = Number(body.auditDays);
  const sensingProfileId = typeof body.sensingProfileId === "string" && body.sensingProfileId ? body.sensingProfileId : undefined;
  if (sensingProfileId) {
    const sensingProfiles = await listSensingProfiles(session.clientId);
    if (!sensingProfiles.some((row) => row.status === "active" && row.profile.id === sensingProfileId)) {
      return NextResponse.json({ error: "The sensing profile is not an active profile for this client." }, { status: 400 });
    }
  }
  try {
    const created = await createActiveSolutionProfile({ clientId: session.clientId, createdBy: session.id, profile: {
      enabledAbilities,
      providerBindings: Object.fromEntries(sourceIds.map((id) => [id, id])),
      markets: strings(body.markets), languages: strings(body.languages),
      reviewRoles: { market_twin: ["reviewer"], measurement: ["reviewer"], brand_lift: ["reviewer"], learning: ["reviewer"] },
      retention: { evidenceDays, rawHours, auditDays },
      sensingProfileId,
      briefingCadences: briefingCadences as BriefingCadence[],
    } });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "activate", entityType: "solution_profile", entityId: String(created.databaseId), after: { version: created.profile.version, enabledAbilities: created.profile.enabledAbilities, providerBindingKeys: Object.keys(created.profile.providerBindings) } });
    return NextResponse.json({ profile: created }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Solution profile could not be created." }, { status: 400 }); }
}

