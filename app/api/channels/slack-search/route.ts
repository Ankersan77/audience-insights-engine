import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { listChannels, SlackNotConfiguredError } from "@/src/lib/slack";

export const dynamic = "force-dynamic";

/**
 * Proxies the Slack channel search for the `AsyncCombobox` picker (T15).
 * `SLACK_BOT_TOKEN` is server-only, so the browser cannot call `src/lib/slack`
 * directly. Admin only — same gate as the rest of the connect-a-channel flow,
 * since a viewer never sees the picker.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  try {
    assertAdmin(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    }
    throw error;
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const channels = await listChannels(query);
    return NextResponse.json({ channels });
  } catch (error) {
    if (error instanceof SlackNotConfiguredError) {
      return NextResponse.json({ error: "not-configured", message: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "slack-error", message: "Couldn't reach Slack." }, { status: 502 });
  }
}
