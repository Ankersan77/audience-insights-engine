import { NextRequest, NextResponse } from "next/server";
import type { ClaimMode, ProposedAnalysis } from "@/src/abilities/engine";
import { runAbility } from "@/src/abilities/engine";
import { getDecisionBriefAbility } from "@/src/abilities/catalog";
import { loadEvidenceItems } from "@/src/db/queries/canonical_evidence";
import { listDecisionBriefs, saveDecisionBrief } from "@/src/db/queries/workspace_intelligence";
import { assertPeopleBlind, redactIdentifiers } from "@/src/evidence/policy";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

export const dynamic = "force-dynamic";

function ids(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => redactIdentifiers(item.trim()).content).filter(Boolean) : [];
}

function safeText(value: unknown): string {
  return typeof value === "string" ? redactIdentifiers(value.trim()).content : "";
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ briefs: await listDecisionBriefs(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try {
    assertResearchWrite(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const body = (await request.json()) as Record<string, unknown>;
  const abilityId = typeof body.abilityId === "string" ? body.abilityId : "";
  const question = safeText(body.question);
  if (!getDecisionBriefAbility(abilityId) || !question) return NextResponse.json({ error: "A decision-brief ability and research question are required." }, { status: 400 });
  const evidenceIds = ids(body.evidenceIds);
  const evidence = await loadEvidenceItems(session.clientId, evidenceIds);
  if (evidence.length !== evidenceIds.length) return NextResponse.json({ error: "One or more evidence items are outside the client scope." }, { status: 400 });

  const pointOfView = safeText(body.pointOfView);
  const claimModes = new Set<ClaimMode>(["attitude", "behavior", "demand_proxy", "causal", "descriptive"]);
  const claimMode = typeof body.claimMode === "string" && claimModes.has(body.claimMode as ClaimMode)
    ? body.claimMode as ClaimMode
    : "descriptive";
  const analysis: ProposedAnalysis | undefined = pointOfView ? {
    pointOfView,
    clientRelevance: safeText(body.clientRelevance),
    recommendation: safeText(body.recommendation),
    nextDecision: safeText(body.nextDecision),
    claimMode,
    evidenceIds: evidence.map((item) => item.id),
    contradictions: strings(body.contradictions),
    uncertainty: strings(body.uncertainty),
  } : undefined;
  const brief = runAbility({
    clientId: String(session.clientId), abilityId, question, analysis, evidence,
    market: typeof body.market === "string" ? body.market.trim() : undefined,
    language: typeof body.language === "string" ? body.language.trim() : undefined,
    now: new Date().toISOString(),
  });
  assertPeopleBlind(brief);
  const artifact = await saveDecisionBrief({ clientId: session.clientId, brief, createdBy: session.id });
  await recordGovernanceAudit({
    clientId: session.clientId, actorUserId: session.id, action: "run_ability", entityType: "research_artifact", entityId: String(artifact.id),
    after: { artifactKey: artifact.artifactKey, abilityId, status: brief.status, evidenceIds: brief.evidenceIds },
  });
  return NextResponse.json({ artifact }, { status: 201 });
}

