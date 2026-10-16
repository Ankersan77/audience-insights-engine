import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Applicability, MethodDeclaration, RightsDeclaration, SourceClass } from "@/src/core/contracts";
import { readSourceConnectionPolicy, sourceClassification, sourcePolicyFailure, SourcePolicyError } from "@/src/connectors/sourcePolicy";
import { listCanonicalEvidence, persistAcquisition } from "@/src/db/queries/canonical_evidence";
import { getSourceConnection } from "@/src/db/queries/sources";
import { DocumentEvidenceAdapter, PublicWebEvidenceAdapter } from "@/src/evidence/adapters";
import type { EvidencePolicy } from "@/src/evidence/policy";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

export const dynamic = "force-dynamic";

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function finiteOptional(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function configuredMinimumCohort(): number {
  const value = Number(process.env.MINIMUM_COHORT_SIZE ?? 10);
  return Number.isInteger(value) && value >= 2 ? value : 10;
}

function configuredSensitiveTerms(): string[] {
  const configured = process.env.SENSITIVE_EVIDENCE_TERMS?.split(",").map((term) => term.trim()).filter(Boolean) ?? [];
  return [...new Set(["child abuse", "medical diagnosis", "health condition", ...configured])];
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ evidence: await listCanonicalEvidence(session.clientId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try {
    assertResearchWrite(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    }
    throw error;
  }

  const body = (await request.json()) as Record<string, unknown>;
  const sourceConnectionId = Number(body.sourceConnectionId);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  if (!Number.isInteger(sourceConnectionId) || sourceConnectionId <= 0 || !title || !content) {
    return NextResponse.json({ error: "Source, title, and extracted text are required." }, { status: 400 });
  }
  if (title.length > 200 || content.length > 500_000) {
    return NextResponse.json({ error: "The title or extracted text exceeds the bounded ingestion limit." }, { status: 413 });
  }

  const source = await getSourceConnection(session.clientId, sourceConnectionId);
  if (!source) return NextResponse.json({ error: "Source connection not found." }, { status: 404 });
  if (!["client_owned", "commissioned_or_licensed", "primary_research", "official_or_public"].includes(source.sourceClass)) {
    return NextResponse.json({ error: "This source class requires its dedicated aggregate or listening adapter." }, { status: 400 });
  }
  if (source.sourceClass === "official_or_public" && !sourceUrl) {
    return NextResponse.json({ error: "A public source requires a safe source URL." }, { status: 400 });
  }

  const rights = source.rightsJson as RightsDeclaration;
  if (!rights.commercialUse) {
    return NextResponse.json({ error: "The configured rights do not permit commercial use." }, { status: 403 });
  }
  const applicability: Applicability = {
    markets: strings(body.markets),
    languages: strings(body.languages),
    categories: strings(body.categories),
    audiences: strings(body.audiences),
    campaigns: strings(body.campaigns),
  };
  const method: MethodDeclaration = {
    method: typeof body.method === "string" && body.method.trim() ? body.method.trim() : "structured manual onboarding",
    universe: typeof body.universe === "string" && body.universe.trim() ? body.universe.trim() : undefined,
    sampleSize: finiteOptional(body.sampleSize),
    weighting: typeof body.weighting === "string" && body.weighting.trim() ? body.weighting.trim() : undefined,
    fieldworkStart: typeof body.fieldworkStart === "string" && body.fieldworkStart ? body.fieldworkStart : undefined,
    fieldworkEnd: typeof body.fieldworkEnd === "string" && body.fieldworkEnd ? body.fieldworkEnd : undefined,
    limitations: strings(body.limitations),
  };
  const contentHash = createHash("sha256").update(`${sourceConnectionId}\u0000${content}`).digest("hex");
  const coreJob = {
    id: `manual:${contentHash.slice(0, 24)}`,
    clientId: String(session.clientId),
    sourceId: String(sourceConnectionId),
    adapterId: source.connectorId,
    dataClassification: sourceClassification(source.sourceClass as SourceClass),
    request: { operation: sourceUrl ? "manual-link" : "manual-document", filters: { markets: applicability.markets, languages: applicability.languages, purpose: "market-research" } },
    idempotencyKey: `${session.clientId}:${sourceConnectionId}:${contentHash}`,
    requestedAt: new Date().toISOString(),
  };
  const policyFailure = sourcePolicyFailure({ health: source.health, rights, policy: readSourceConnectionPolicy(source.configurationJson),
    request: coreJob.request, dataClassification: coreJob.dataClassification, now: coreJob.requestedAt,
  });
  if (policyFailure) return NextResponse.json({ error: policyFailure }, { status: 403 });
  const record = { id: contentHash, title, content, sourceUrl: sourceUrl || undefined, rights, method, applicability };
  const adapter = source.sourceClass === "official_or_public"
    ? new PublicWebEvidenceAdapter([{ ...record, url: sourceUrl, permitted: true }])
    : new DocumentEvidenceAdapter(
      [record],
      source.sourceClass as "client_owned" | "commissioned_or_licensed" | "primary_research",
    );
  const policy: EvidencePolicy = {
    minimumCohortSize: configuredMinimumCohort(),
    retainedEvidenceDays: source.retentionDays,
    allowVerbatim: false,
    sensitiveTerms: configuredSensitiveTerms(),
  };
  const now = new Date().toISOString();
  const result = await adapter.run(coreJob, {
    now,
    async resolveCredential() { throw new Error("manual-onboarding-does-not-resolve-credentials"); },
  }, policy);
  const collectionExpiresAt = result.evidence[0]?.expiresAt ?? new Date(Date.now() + source.retentionDays * 86_400_000).toISOString();
  // Manual extraction makes no paid provider call; do not require an adapter cost estimate.
  result.receipt.estimatedCost = 0;
  try {
    const persisted = await persistAcquisition({
      clientId: session.clientId,
      sourceConnectionId,
      operation: coreJob.request.operation,
      request: { ...coreJob.request, title: result.evidence[0]?.synthesis ?? "redacted-source", sourceUrl: result.evidence[0]?.sourceUrl },
      idempotencyKey: coreJob.idempotencyKey,
      title,
      method,
      rights,
      applicability,
      collectionExpiresAt,
      result,
    });

    await recordGovernanceAudit({
      clientId: session.clientId,
      actorUserId: session.id,
      action: persisted.replayed ? "ingestion_replayed" : "ingest",
      entityType: "evidence_collection",
      entityId: String(persisted.collectionId ?? persisted.jobId),
      after: {
        sourceConnectionId,
        title,
        evidenceIds: persisted.evidenceIds,
        lifecycle: result.evidence.map((item) => item.lifecycle),
        redactions: result.evidence.flatMap((item) => item.redactions),
      },
    });

    return NextResponse.json({ acquisition: persisted, retained: result.evidence.length }, { status: persisted.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof SourcePolicyError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}

