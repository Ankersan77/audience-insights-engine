import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import {
  getInsightById,
  getInsightEvidence,
  markInsightDecision,
  updateInsightText,
} from "@/src/db/queries/insights";
import { recordAudit } from "@/src/lib/audit";

export const dynamic = "force-dynamic";

/** Evidence preview for the owned-product insight review UI. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await context.params;
  const insightId = Number(id);
  if (!Number.isInteger(insightId)) {
    return NextResponse.json({ error: "Invalid insight id." }, { status: 400 });
  }

  const insight = await getInsightById(insightId);
  if (!insight) {
    return NextResponse.json({ error: "Insight not found." }, { status: 404 });
  }

  const evidence = await getInsightEvidence(insightId);
  return NextResponse.json({
    insight,
    evidence,
    hasSensitiveEvidence: evidence.some((item) => item.sensitivityFlag === true),
  });
}

type DecisionBody = {
  action?: "accept" | "discard";
  title?: string;
  summary?: string;
  acknowledgedSensitive?: boolean;
};

/**
 * Records an in-product editorial decision. External delivery is deliberately
 * separate and may only be added through a provider-neutral DeliveryAdapter.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  try {
    assertAdmin(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    }
    throw error;
  }

  const { id } = await context.params;
  const insightId = Number(id);
  if (!Number.isInteger(insightId)) {
    return NextResponse.json({ error: "Invalid insight id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as DecisionBody;
  const before = await getInsightById(insightId);
  if (!before) {
    return NextResponse.json({ error: "Insight not found." }, { status: 404 });
  }

  if (body.action === "discard") {
    if (before.status !== "pending") {
      return NextResponse.json({ error: "Only a pending insight can be discarded." }, { status: 409 });
    }
    const updated = await markInsightDecision(insightId, { status: "discarded", reviewedBy: session.id });
    await recordAudit(session.id, "discard", "insight", insightId, before, updated);
    return NextResponse.json({ insight: updated }, { status: 200 });
  }

  if (body.action === "accept") {
    if (before.status !== "pending") {
      return NextResponse.json({ error: "Only a pending insight can be accepted." }, { status: 409 });
    }

    const evidence = await getInsightEvidence(insightId);
    if (evidence.some((item) => item.sensitivityFlag === true) && body.acknowledgedSensitive !== true) {
      return NextResponse.json(
        { error: "This insight includes sensitivity-flagged evidence — acknowledge it before accepting." },
        { status: 400 },
      );
    }

    if (typeof body.title === "string" && typeof body.summary === "string") {
      const title = body.title.trim();
      const summary = body.summary.trim();
      if (!title || !summary) {
        return NextResponse.json({ error: "Title and summary cannot be empty." }, { status: 400 });
      }
      if (title !== before.title || summary !== before.summary) {
        await updateInsightText(insightId, { title, summary });
      }
    }

    const accepted = await markInsightDecision(insightId, { status: "accepted", reviewedBy: session.id });
    await recordAudit(session.id, "accept", "insight", insightId, before, accepted);
    return NextResponse.json({ insight: accepted }, { status: 200 });
  }

  return NextResponse.json({ error: "Unrecognised action." }, { status: 400 });
}
