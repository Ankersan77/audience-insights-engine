import { NextRequest, NextResponse } from "next/server";
import type { Applicability, IntelligenceKind } from "@/src/core/contracts";
import { createIntelligenceCandidate, listIntelligenceRecords } from "@/src/db/queries/workspace_intelligence";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { redactIdentifiers } from "@/src/evidence/policy";

export const dynamic = "force-dynamic";

function ids(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => redactIdentifiers(item.trim()).content).filter(Boolean)
    : [];
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ records: await listIntelligenceRecords(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try {
    assertAdmin(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const body = (await request.json()) as Record<string, unknown>;
  const allowed = new Set<IntelligenceKind>(["observation", "fact", "hypothesis", "knowledge_gap"]);
  const kind = typeof body.kind === "string" ? body.kind as IntelligenceKind : "";
  const title = typeof body.title === "string" ? redactIdentifiers(body.title.trim()).content : "";
  const statement = typeof body.statement === "string" ? redactIdentifiers(body.statement.trim()).content : "";
  const confidence = Number(body.confidence);
  if (!allowed.has(kind as IntelligenceKind) || !title || !statement || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return NextResponse.json({ error: "Kind, title, statement, and confidence from 0 to 1 are required." }, { status: 400 });
  }
  const applicability: Applicability = {
    markets: strings(body.markets), languages: strings(body.languages), categories: strings(body.categories),
    audiences: strings(body.audiences), campaigns: strings(body.campaigns),
  };
  try {
    const created = await createIntelligenceCandidate({
      clientId: session.clientId,
      kind: kind as "observation" | "fact" | "hypothesis" | "knowledge_gap",
      title,
      statement,
      evidenceIds: ids(body.evidenceIds),
      contradictionIds: ids(body.contradictionIds),
      dependencyIds: ids(body.dependencyIds),
      applicability,
      confidence,
      uncertainty: strings(body.uncertainty),
      now: new Date(),
    });
    await recordGovernanceAudit({
      clientId: session.clientId, actorUserId: session.id, action: "create", entityType: "intelligence_record", entityId: created.id,
      after: { kind: created.kind, lifecycle: created.lifecycle, reviewState: created.reviewState, evidenceIds: created.evidenceIds },
    });
    return NextResponse.json({ record: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Intelligence candidate could not be created." }, { status: 400 });
  }
}

