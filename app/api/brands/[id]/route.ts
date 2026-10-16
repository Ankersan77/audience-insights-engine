import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { setBrandStatus } from "@/src/db/queries/brands";
import { recordAudit } from "@/src/lib/audit";

export const dynamic = "force-dynamic";

/** Archive/unarchive a brand (admin only) — a status change, never a delete. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
  const brandId = Number(id);
  if (!Number.isInteger(brandId)) {
    return NextResponse.json({ error: "Invalid brand id." }, { status: 400 });
  }

  const body = (await request.json()) as { status?: "active" | "archived" };
  if (body.status !== "active" && body.status !== "archived") {
    return NextResponse.json({ error: "status must be 'active' or 'archived'." }, { status: 400 });
  }

  const { before, after } = await setBrandStatus(brandId, session.clientId, body.status, session.id);
  if (!after) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  await recordAudit(
    session.id,
    body.status === "archived" ? "archive" : "unarchive",
    "brand",
    brandId,
    before,
    after,
  );

  return NextResponse.json({ brand: after }, { status: 200 });
}
