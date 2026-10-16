import { NextRequest, NextResponse } from "next/server";
import type { ClaimMode, ProposedAnalysis } from "@/src/abilities/engine";
import { runContextualResearch } from "@/src/abilities/synthesis";
import { getProductionSynthesisProvider } from "@/src/lib/productionSynthesis";
import { getDecisionBriefAbility } from "@/src/abilities/catalog";
import { loadEvidenceItems } from "@/src/db/queries/canonical_evidence";
import { listDecisionBriefs, saveDecisionBrief } from "@/src/db/queries/workspace_intelligence";
import { loadResearchContextSources } from "@/src/db/queries/research_context";
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

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  const projectValue = request.nextUrl.searchParams.get("projectId");
  const projectId = projectValue ? Number(projectValue) : undefined;
  if (projectId !== undefined && (!Number.isInteger(projectId) || projectId <= 0)) return NextResponse.json({ error: "valid-project-required" }, { status: 400 });
  return NextResponse.json({ briefs: await listDecisionBriefs(session.clientId, projectId) });
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
  const projectId = body.projectId === undefined ? undefined : Number(body.projectId);
  if (projectId !== undefined && (!Number.isInteger(projectId) || projectId <= 0)) return NextResponse.json({ error: "valid-project-required" }, { status: 400 });
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
  const sources = await loadResearchContextSources({ clientId: session.clientId, projectId, evidenceIds });
  if (projectId && !sources.project) return NextResponse.json({ error: "project-not-found" }, { status: 404 });
  if (projectId && sources.project?.status !== "active") return NextResponse.json({ error: "active-project-required" }, { status: 409 });
  const brief = await runContextualResearch({
    clientId: String(session.clientId), abilityId, question, analysis, sources, projectId: projectId ? String(projectId) : undefined,
    market: typeof body.market === "string" ? body.market.trim() : undefined,
    language: typeof body.language === "string" ? body.language.trim() : undefined,
    now: new Date().toISOString(),
    provider: analysis ? undefined : getProductionSynthesisProvider(session.clientId, { signal: request.signal }),
  });
  assertPeopleBlind(brief);
  let artifact;
  try {
    artifact = await saveDecisionBrief({ clientId: session.clientId, brief, createdBy: session.id, projectId });
  } catch (error) {
    if (error instanceof Error && ["research-context-changed", "active-project-scope-mismatch"].includes(error.message)) {
      return NextResponse.json({ error: "Research context changed during analysis. Refresh and run again." }, { status: 409 });
    }
    throw error;
  }
  await recordGovernanceAudit({
    clientId: session.clientId, actorUserId: session.id, action: "run_ability", entityType: "research_artifact", entityId: String(artifact.id),
    after: { artifactKey: artifact.artifactKey, abilityId, status: brief.status, evidenceIds: brief.evidenceIds },
  });
  return NextResponse.json({ artifact }, { status: 201 });
}

