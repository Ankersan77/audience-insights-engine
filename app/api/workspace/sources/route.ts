import { NextRequest, NextResponse } from "next/server";
import type { RightsDeclaration, SourceClass } from "@/src/core/contracts";
import { createSourceConnection, listSourceConnections } from "@/src/db/queries/sources";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";

export const dynamic = "force-dynamic";

const SOURCE_CLASSES = new Set<SourceClass>([
  "client_owned",
  "first_party_aggregate",
  "commissioned_or_licensed",
  "official_or_public",
  "public_conversation",
  "primary_research",
]);

function positiveInteger(value: unknown, maximum: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ sources: await listSourceConnections(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try {
    assertAdmin(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    }
    throw error;
  }

  const body = (await request.json()) as Record<string, unknown>;
  const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
  const connectorVersion = typeof body.connectorVersion === "string" ? body.connectorVersion.trim() : "";
  const sourceClass = typeof body.sourceClass === "string" ? body.sourceClass : "";
  const credentialRef = typeof body.credentialRef === "string" ? body.credentialRef.trim() : "";
  const retentionDays = positiveInteger(body.retentionDays, 3650);
  const rawRetentionHours = positiveInteger(body.rawRetentionHours, 168);
  const rightsBasis = typeof body.rightsBasis === "string" ? body.rightsBasis : "";
  const validRights = new Set<RightsDeclaration["basis"]>(["client_owned", "licensed", "public_permitted", "consented"]);

  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(connectorId)) {
    return NextResponse.json({ error: "Connector id must be a lowercase, hyphenated identifier." }, { status: 400 });
  }
  if (!connectorVersion || !SOURCE_CLASSES.has(sourceClass as SourceClass)) {
    return NextResponse.json({ error: "Connector version and a valid source class are required." }, { status: 400 });
  }
  if (retentionDays === null || retentionDays === 0 || rawRetentionHours === null) {
    return NextResponse.json({ error: "Retention must be 1–3650 days and raw retention 0–168 hours." }, { status: 400 });
  }
  if (!validRights.has(rightsBasis as RightsDeclaration["basis"])) {
    return NextResponse.json({ error: "A valid rights basis is required." }, { status: 400 });
  }
  if (credentialRef && !/^[a-z0-9][a-z0-9/_:.-]{2,255}$/i.test(credentialRef)) {
    return NextResponse.json({ error: "Credential reference must be an opaque secret-store reference." }, { status: 400 });
  }

  try {
    const created = await createSourceConnection({
      clientId: session.clientId,
      connectorId,
      connectorVersion,
      sourceClass: sourceClass as SourceClass,
      credentialRef: credentialRef || undefined,
      retentionDays,
      rawRetentionHours,
      rights: {
        basis: rightsBasis as RightsDeclaration["basis"],
        commercialUse: body.commercialUse === true,
        quotationAllowed: body.quotationAllowed === true,
        restrictions: [],
      },
    });

    await recordGovernanceAudit({
      clientId: session.clientId,
      actorUserId: session.id,
      action: "create",
      entityType: "source_connection",
      entityId: String(created.id),
      after: {
        connectorId: created.connectorId,
        connectorVersion: created.connectorVersion,
        sourceClass: created.sourceClass,
        health: created.health,
        hasCredentialReference: Boolean(created.credentialRef),
        retentionDays: created.retentionDays,
        rawRetentionHours: created.rawRetentionHours,
        rights: created.rightsJson,
      },
    });

    return NextResponse.json({ source: { ...created, credentialRef: undefined } }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "That connector is already configured for this client." }, { status: 409 });
    }
    throw error;
  }
}

