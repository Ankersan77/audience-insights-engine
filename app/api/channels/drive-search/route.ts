import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { searchFolders, DriveNotConfiguredError } from "@/src/lib/drive";

export const dynamic = "force-dynamic";

/**
 * Proxies the Drive folder search for the `AsyncCombobox` picker (T16).
 * `GOOGLE_DRIVE_CREDENTIALS_JSON` is server-only, so the browser cannot call
 * `src/lib/drive` directly. Admin only — same gate as the rest of the
 * connect-a-channel flow, since a viewer never sees the picker.
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
    const folders = await searchFolders(query);
    return NextResponse.json({ folders });
  } catch (error) {
    if (error instanceof DriveNotConfiguredError) {
      return NextResponse.json({ error: "not-configured", message: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "drive-error", message: "Couldn't reach Drive." }, { status: 502 });
  }
}
