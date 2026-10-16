import { NextRequest, NextResponse } from "next/server";
import { createActiveSolutionProfile, getActiveSolutionProfile } from "@/src/db/queries/solution_profiles";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { recordGovernanceAudit } from "@/src/lib/audit";
import type { BriefingCadence } from "@/src/monitoring/briefings";

export async function POST(request: NextRequest) {
  const session = await getSession();
  try { assertAdmin(session); } catch (error) { if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 }); throw error; }
  let body: { profileId?: unknown; cadences?: unknown };
  try { body = await request.json(); if (!body || typeof body !== "object") throw new Error(); } catch { return NextResponse.json({ error: "invalid-json" }, { status: 400 }); }
  if (!Array.isArray(body.cadences) || body.cadences.some((item) => !["weekly", "monthly", "quarterly"].includes(item)) || new Set(body.cadences).size !== body.cadences.length) return NextResponse.json({ error: "valid-briefing-cadences-required" }, { status: 400 });
  const active = await getActiveSolutionProfile(session.clientId);
  if (!active || String(body.profileId) !== active.id) return NextResponse.json({ error: "active-solution-changed" }, { status: 409 });
  if (body.cadences.length && !active.sensingProfileId) return NextResponse.json({ error: "Configure a bound sensing profile first." }, { status: 400 });
  try {
    const created = await createActiveSolutionProfile({ clientId: session.clientId, createdBy: session.id, expectedActiveId: Number(active.id), profile: {
      enabledAbilities: active.enabledAbilities, providerBindings: active.providerBindings, markets: active.markets, languages: active.languages,
      reviewRoles: active.reviewRoles, retention: active.retention, sensingProfileId: active.sensingProfileId, briefingCadences: body.cadences as BriefingCadence[],
    } });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "configure_briefings", entityType: "solution_profile", entityId: String(created.databaseId), after: { version: created.profile.version, cadences: created.profile.briefingCadences } });
    return NextResponse.json({ profileId: created.databaseId });
  } catch (error) {
    if (error instanceof Error && error.message === "active-solution-changed") return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
