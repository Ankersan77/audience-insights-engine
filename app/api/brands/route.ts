import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { createBrand } from "@/src/db/queries/brands";
import { recordAudit } from "@/src/lib/audit";

export const dynamic = "force-dynamic";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Create a brand (admin only). A viewer session gets a 403 here even without the UI control ever rendering (T11). */
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
    name?: string;
    slug?: string;
    description?: string | null;
    marketIds?: number[];
  };

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const slug = body.slug?.trim() ? slugify(body.slug) : slugify(body.name);
  if (!slug) {
    return NextResponse.json({ error: "Could not derive a slug from that name." }, { status: 400 });
  }

  const created = await createBrand({
    clientId: session.clientId,
    name: body.name.trim(),
    slug,
    description: body.description?.trim() || null,
    marketIds: Array.isArray(body.marketIds) ? body.marketIds : [],
    createdBy: session.id,
  });

  await recordAudit(session.id, "create", "brand", created.id, null, created);

  return NextResponse.json({ brand: created }, { status: 201 });
}
