import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import {
  getInsightById,
  getInsightEvidence,
  markInsightDecision,
  markInsightDelivery,
  updateInsightText,
} from "@/src/db/queries/insights";
import { getScopeView, type RouteChannel } from "@/src/db/queries/insight_routes";
import { getChannelById } from "@/src/db/queries/channels";
import { sendMessage, SlackNotConfiguredError, SlackSendError } from "@/src/lib/slack";
import { recordAudit } from "@/src/lib/audit";

export const dynamic = "force-dynamic";

const DRIVE_NOT_CONNECTED_MESSAGE =
  "Drive isn't connected for delivery yet — write access is being set up.";

type ChannelDeliveryResult = {
  channelId: number;
  channelType: "slack_channel" | "drive_folder";
  displayName: string;
  ok: boolean;
  message: string;
};

/** The Channel(s) an Insight's type routes to — its own brand's mapping, falling back to the global one (T17). */
async function resolveChannelsForInsight(brandId: number, insightType: string): Promise<RouteChannel[]> {
  const view = await getScopeView(brandId);
  const row = view.find((v) => v.type === insightType);
  if (!row) return [];
  return row.ownRoutes.length > 0 ? row.ownRoutes : row.globalRoutes;
}

async function deliverToChannel(channel: RouteChannel, text: string): Promise<ChannelDeliveryResult> {
  const base = {
    channelId: channel.channelId,
    channelType: channel.channelType,
    displayName: channel.displayName,
  };

  if (channel.channelType === "drive_folder") {
    // Known gap (spec FR9, Out of scope for this plan): Drive write delivery
    // is inert until a write-capable credential exists. Recorded, not sent.
    return { ...base, ok: false, message: DRIVE_NOT_CONNECTED_MESSAGE };
  }

  const channelRow = await getChannelById(channel.channelId);
  if (!channelRow) {
    return { ...base, ok: false, message: "That Slack channel no longer exists." };
  }

  try {
    await sendMessage(channelRow.externalRef, text);
    return { ...base, ok: true, message: "Delivered to Slack." };
  } catch (error) {
    if (error instanceof SlackNotConfiguredError) {
      return { ...base, ok: false, message: error.message };
    }
    if (error instanceof SlackSendError) {
      return { ...base, ok: false, message: error.message };
    }
    return { ...base, ok: false, message: "Slack delivery failed unexpectedly." };
  }
}

/** Resolves destination Channels and attempts delivery to each, used by both "accept" and "retry" (T23). */
async function routeAndDeliver(
  brandId: number,
  insightType: string,
  text: string,
): Promise<{ deliveryStatus: "delivered" | "failed"; results: ChannelDeliveryResult[] }> {
  const channels = await resolveChannelsForInsight(brandId, insightType);
  if (channels.length === 0) {
    return {
      deliveryStatus: "failed",
      results: [
        {
          channelId: -1,
          channelType: "slack_channel",
          displayName: "(none)",
          ok: false,
          message: "No channel is mapped for this insight type yet.",
        },
      ],
    };
  }

  const results = await Promise.all(channels.map((channel) => deliverToChannel(channel, text)));
  const deliveryStatus = results.every((r) => r.ok) ? "delivered" : "failed";
  return { deliveryStatus, results };
}

/**
 * Preview for the review UI (T23): the evidence behind an Insight (with its
 * sensitivity flags, so a flagged item is visibly surfaced before accept) and
 * the Channel(s) it would be delivered to — shown in the `ConfirmDialog`
 * before an edit-then-accept send, per UX review required finding 4.
 */
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

  const [evidence, channels] = await Promise.all([
    getInsightEvidence(insightId),
    resolveChannelsForInsight(insight.brandId, insight.insightType),
  ]);

  return NextResponse.json({
    insight,
    evidence,
    hasSensitiveEvidence: evidence.some((e) => e.sensitivityFlag === true),
    channels: channels.map((c) => ({
      channelId: c.channelId,
      channelType: c.channelType,
      displayName: c.displayName,
    })),
  });
}

type DecisionBody = {
  action?: "accept" | "discard" | "retry";
  title?: string;
  summary?: string;
  acknowledgedSensitive?: boolean;
};

/**
 * Accept / edit-then-accept / discard / retry (T23). Every mutation here is
 * admin-gated — a viewer gets a live 403, same pattern as every prior
 * mutating route (T11).
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

    // Sensitivity screening gate (compliance review required finding, T22):
    // a flagged Insight needs an explicit acknowledgement before it can be
    // accepted — enforced here, not just in the UI.
    const evidence = await getInsightEvidence(insightId);
    const hasSensitiveEvidence = evidence.some((e) => e.sensitivityFlag === true);
    if (hasSensitiveEvidence && body.acknowledgedSensitive !== true) {
      return NextResponse.json(
        { error: "This insight includes sensitivity-flagged evidence — acknowledge it before accepting." },
        { status: 400 },
      );
    }

    let title = before.title;
    let summary = before.summary;
    if (typeof body.title === "string" && typeof body.summary === "string") {
      const edited = body.title.trim();
      const editedSummary = body.summary.trim();
      if (!edited || !editedSummary) {
        return NextResponse.json({ error: "Title and summary cannot be empty." }, { status: 400 });
      }
      if (edited !== before.title || editedSummary !== before.summary) {
        await updateInsightText(insightId, { title: edited, summary: editedSummary });
      }
      title = edited;
      summary = editedSummary;
    }

    const accepted = await markInsightDecision(insightId, { status: "accepted", reviewedBy: session.id });
    const delivery = await routeAndDeliver(before.brandId, before.insightType, `*${title}*\n${summary}`);
    const final = await markInsightDelivery(insightId, delivery.deliveryStatus);

    await recordAudit(session.id, "accept", "insight", insightId, before, { ...final, delivery: delivery.results });
    return NextResponse.json({ insight: final, delivery: delivery.results }, { status: 200 });
  }

  if (body.action === "retry") {
    if (before.status !== "accepted" || before.deliveryStatus !== "failed") {
      return NextResponse.json(
        { error: "Retry is only available for an accepted insight whose delivery failed." },
        { status: 409 },
      );
    }

    const delivery = await routeAndDeliver(before.brandId, before.insightType, `*${before.title}*\n${before.summary}`);
    const final = await markInsightDelivery(insightId, delivery.deliveryStatus);

    await recordAudit(session.id, "retry", "insight", insightId, before, { ...final, delivery: delivery.results });
    return NextResponse.json({ insight: final, delivery: delivery.results }, { status: 200 });
  }

  return NextResponse.json({ error: "Unrecognised action." }, { status: 400 });
}
