import { NextRequest, NextResponse } from "next/server";
import type { ExternalValidationGate, ExternalValidationGateKey } from "@/src/core/contracts";
import { upsertValidationGate, VALIDATION_GATE_DEFINITIONS } from "@/src/db/queries/evaluation";
import { redactIdentifiers } from "@/src/evidence/policy";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertReview, PermissionDeniedError } from "@/src/lib/roles";

function safeText(value: unknown): string { return typeof value === "string" ? redactIdentifiers(value.trim()).content : ""; }

export async function POST(request: NextRequest, context: RouteContext<"/api/evaluation/gates/[key]">) {
  const session = await getSession();
  try { assertReview(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const key = (await context.params).key as ExternalValidationGateKey;
  if (!(key in VALIDATION_GATE_DEFINITIONS)) return NextResponse.json({ error: "Unknown validation gate." }, { status: 404 });
  const body = (await request.json()) as Record<string, unknown>;
  const status = String(body.status) as ExternalValidationGate["status"];
  const owner = safeText(body.owner), scope = safeText(body.scope), evidenceReference = safeText(body.evidenceReference) || undefined;
  const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? new Date(body.expiresAt) : undefined;
  if (!["needs_context", "verified", "blocked"].includes(status) || !owner || !scope || (expiresAt && !Number.isFinite(expiresAt.getTime()))) {
    return NextResponse.json({ error: "Status, owner, scope and a valid optional expiry are required." }, { status: 400 });
  }
  try {
    const gate = await upsertValidationGate({ clientId: session.clientId, key, status, owner, scope, evidenceReference, verifiedBy: session.id, expiresAt });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "validate", entityType: "external_validation_gate", entityId: key, after: { status, owner, scope, evidenceReference, expiresAt: gate.expiresAt } });
    return NextResponse.json({ gate });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Validation gate could not be updated." }, { status: 400 });
  }
}
