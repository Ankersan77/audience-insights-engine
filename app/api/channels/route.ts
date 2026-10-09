import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { createChannel, DuplicateChannelError, type ChannelType } from "@/src/db/queries/channels";
import { recordAudit } from "@/src/lib/audit";

export const dynamic = "force-dynamic";

const CHANNEL_TYPES: ChannelType[] = ["slack_channel", "drive_folder"];

/**
 * Saves a Slack/Drive picker selection as a `channel` row (T15/T16). Admin
 * only — a viewer session gets a live 403 here even without the picker ever
 * rendering (T11's pattern).
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

  const body = (await request.json()) as {
    type?: string;
    externalRef?: string;
    displayName?: string;
  };

  if (!body.type || !CHANNEL_TYPES.includes(body.type as ChannelType)) {
    return NextResponse.json({ error: "Invalid channel type." }, { status: 400 });
  }
  if (!body.externalRef?.trim() || !body.displayName?.trim()) {
    return NextResponse.json({ error: "A channel needs both an id and a name." }, { status: 400 });
  }

  try {
    const created = await createChannel({
      type: body.type as ChannelType,
      externalRef: body.externalRef.trim(),
      displayName: body.displayName.trim(),
      createdBy: session.id,
    });
    await recordAudit(session.id, "create", "channel", created.id, null, created);
    return NextResponse.json({ channel: created }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateChannelError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
