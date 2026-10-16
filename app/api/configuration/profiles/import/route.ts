import { NextRequest, NextResponse } from "next/server";
import { ABILITY_CATALOG } from "@/src/abilities/catalog";
import { createActiveSolutionProfile } from "@/src/db/queries/solution_profiles";
import { listSourceConnections } from "@/src/db/queries/sources";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { importSolutionProfile } from "@/src/packaging/solution";

export async function POST(request: NextRequest) {
  const session = await getSession();
  try { assertAdmin(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  try {
    const portable = importSolutionProfile(await request.json());
    const installed = new Set(ABILITY_CATALOG.map((ability) => `${ability.id}@${ability.version}`));
    if (portable.enabledAbilities.some((ability) => !installed.has(`${ability.id}@${ability.version}`))) {
      return NextResponse.json({ error: "The package references an ability version that is not installed." }, { status: 400 });
    }
    const sources = await listSourceConnections(session.clientId);
    const configured = new Set(sources.map((source) => source.connectorId));
    const missingBindings = Object.values(portable.providerBindings).filter((connectorId) => !configured.has(connectorId));
    if (missingBindings.length > 0) {
      return NextResponse.json({ error: `Configure these connector bindings before import: ${missingBindings.join(", ")}` }, { status: 400 });
    }
    const created = await createActiveSolutionProfile({ clientId: session.clientId, createdBy: session.id, profile: portable });
    await recordGovernanceAudit({
      clientId: session.clientId,
      actorUserId: session.id,
      action: "import",
      entityType: "solution_profile",
      entityId: String(created.databaseId),
      after: { version: created.profile.version, enabledAbilities: created.profile.enabledAbilities, providerBindingKeys: Object.keys(created.profile.providerBindings) },
    });
    return NextResponse.json({ profile: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Solution package could not be imported." }, { status: 400 });
  }
}
