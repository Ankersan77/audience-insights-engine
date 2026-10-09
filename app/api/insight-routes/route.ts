import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import {
  addInsightRoute,
  getInsightRouteById,
  getScopeView,
  isInsightType,
  removeInsightRoute,
} from "@/src/db/queries/insight_routes";
import { recordAudit } from "@/src/lib/audit";

export const dynamic = "force-dynamic";

function parseScope(raw: string | null): number | null {
  return raw && raw !== "global" ? Number(raw) : null;
}

/** The routing map for one scope (global, or `?brandId=`) — read-only, available to any signed-in session (viewer sees the page read-only, T17). */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("brandId");
  const brandId = parseScope(raw);
  if (brandId !== null && !Number.isInteger(brandId)) {
    return NextResponse.json({ error: "Invalid brand id." }, { status: 400 });
  }

  const view = await getScopeView(brandId);
  return NextResponse.json({ view });
}

/** Maps an Insight Type to a Channel, globally or for one Brand (T17). Admin only, same gate as every other admin API route. */
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
    brandId?: number | null;
    insightType?: string;
    channelId?: number;
  };

  if (!isInsightType(body.insightType)) {
    return NextResponse.json({ error: "Invalid insight type." }, { status: 400 });
  }
  const channelId = Number(body.channelId);
  if (!Number.isInteger(channelId)) {
    return NextResponse.json({ error: "Invalid channel id." }, { status: 400 });
  }
  const brandId =
    body.brandId === null || body.brandId === undefined ? null : Number(body.brandId);
  if (brandId !== null && !Number.isInteger(brandId)) {
    return NextResponse.json({ error: "Invalid brand id." }, { status: 400 });
  }

  const created = await addInsightRoute({ brandId, insightType: body.insightType, channelId });
  await recordAudit(session.id, "create", "insight_route", created.routeId, null, created);

  return NextResponse.json({ route: created }, { status: 201 });
}

/** Unmaps an Insight Type from a Channel (T17). Admin only. */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  try {
    assertAdmin(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    }
    throw error;
  }

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid route id." }, { status: 400 });
  }

  const before = await getInsightRouteById(id);
  if (!before) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await removeInsightRoute(id);
  await recordAudit(session.id, "delete", "insight_route", id, before, null);

  return NextResponse.json({ ok: true });
}
