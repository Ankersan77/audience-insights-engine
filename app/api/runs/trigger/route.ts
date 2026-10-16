import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { getBrandById, getMarketById } from "@/src/db/queries/brands";
import { getLatestInstructionsForBrand } from "@/src/db/queries/research_instructions";
import { createQueuedRun, DuplicateActiveRunError } from "@/src/db/queries/research_runs";
import { enqueueRunJob } from "@/src/workers/runQueue";
import { recordAudit } from "@/src/lib/audit";
import { legacyLast30DaysEnabled } from "@/src/lib/featureFlags";

export const dynamic = "force-dynamic";

/**
 * Triggers a brand+market research Run (T20). Admin only — a viewer session
 * gets a live 403 here even without a "Run now" button ever rendering (T11's
 * pattern). Never runs `last30days` synchronously: inserts a `queued`
 * `research_run` row, enqueues the pg-boss job, and returns immediately with
 * the Run's id — the worker process (`src/workers/index.ts`) does the work.
 */
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

  if (!legacyLast30DaysEnabled()) {
    return NextResponse.json(
      {
        error: "Legacy Last30Days ingestion is disabled. Configure a governed evidence source in the Research workspace.",
        code: "legacy-ingestion-disabled",
      },
      { status: 503 },
    );
  }

  const body = (await request.json()) as { brandId?: number; marketId?: number };
  const brandId = Number(body.brandId);
  const marketId = Number(body.marketId);
  if (!Number.isInteger(brandId) || !Number.isInteger(marketId)) {
    return NextResponse.json({ error: "A brand and a market are both required." }, { status: 400 });
  }

  const brand = await getBrandById(brandId, session.clientId);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 400 });
  }

  const market = await getMarketById(marketId);
  if (!market) {
    return NextResponse.json({ error: "Market not found." }, { status: 400 });
  }

  // Compliance review blocking finding (spec §16): Greece is gated off until
  // Legal signs off, by this flag — not silently processed.
  if (!market.processingEnabled) {
    return NextResponse.json(
      { error: "This market isn't enabled for processing yet." },
      { status: 403 },
    );
  }

  // Market-specific override wins over the brand-level default (T14's
  // inheritance rule), resolved once here so the Run is immune to a later
  // edit of the same brand/market's instructions.
  const latestInstructions = await getLatestInstructionsForBrand(brandId);
  const resolved = latestInstructions.get(marketId) ?? latestInstructions.get(null);
  if (!resolved) {
    return NextResponse.json(
      { error: "No research instructions are configured for this brand yet." },
      { status: 400 },
    );
  }

  try {
    const created = await createQueuedRun({
      clientId: session.clientId,
      brandId,
      marketId,
      researchInstructionVersion: resolved.version,
      triggeredBy: session.id,
    });

    await recordAudit(session.id, "trigger", "research_run", created.id, null, created);

    await enqueueRunJob({
      runId: created.id,
      clientId: session.clientId,
      brandId,
      marketId,
      researchInstructionVersion: resolved.version,
      instruction: {
        subreddits: resolved.subreddits,
        dedicatedSubreddits: resolved.dedicatedSubreddits,
        xHandle: resolved.xHandle,
        xRelated: resolved.xRelated,
        tiktokHashtags: resolved.tiktokHashtags,
        topic: resolved.focusText?.trim() || brand.name,
      },
    });

    return NextResponse.json({ run: created }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateActiveRunError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
