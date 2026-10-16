import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { createInstructionVersion } from "@/src/db/queries/research_instructions";
import { getBrandById } from "@/src/db/queries/brands";
import { recordAudit } from "@/src/lib/audit";

export const dynamic = "force-dynamic";

function toArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
}

/**
 * Creates a new `research_instruction` version — brand-level (`marketId:
 * null`) or scoped to one market. Never updates a row in place; versions are
 * immutable history (T14). Admin only — a viewer session gets a live 403 here
 * even without the save button ever rendering (T11's pattern).
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
  const brandId = Number(id);
  if (!Number.isInteger(brandId)) {
    return NextResponse.json({ error: "Invalid brand id." }, { status: 400 });
  }
  if (!(await getBrandById(brandId, session.clientId))) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  const body = (await request.json()) as {
    marketId?: number | null;
    subreddits?: unknown;
    dedicatedSubreddits?: unknown;
    xHandle?: string | null;
    xRelated?: unknown;
    tiktokHashtags?: unknown;
    competitors?: unknown;
    focusText?: string | null;
  };

  const marketId =
    body.marketId === null || body.marketId === undefined ? null : Number(body.marketId);
  if (marketId !== null && !Number.isInteger(marketId)) {
    return NextResponse.json({ error: "Invalid market id." }, { status: 400 });
  }

  const created = await createInstructionVersion({
    brandId,
    marketId,
    fields: {
      subreddits: toArray(body.subreddits),
      dedicatedSubreddits: toArray(body.dedicatedSubreddits),
      xHandle: body.xHandle?.trim() || null,
      xRelated: toArray(body.xRelated),
      tiktokHashtags: toArray(body.tiktokHashtags),
      competitors: toArray(body.competitors),
      focusText: body.focusText?.trim() || null,
    },
    updatedBy: session.id,
  });

  await recordAudit(session.id, "create", "research_instruction", created.id, null, created);

  return NextResponse.json({ instruction: created }, { status: 201 });
}
