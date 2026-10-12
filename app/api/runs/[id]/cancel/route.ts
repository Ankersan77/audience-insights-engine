import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/src/lib/auth";
import { assertAdmin, PermissionDeniedError } from "@/src/lib/roles";
import { cancelRun, getRunById } from "@/src/db/queries/research_runs";
import { recordAudit } from "@/src/lib/audit";

export const dynamic = "force-dynamic";

/**
 * The run history screen's "Cancel" action (T21, tech/UX review advisory).
 * v1 scope only: marks the row `cancelled` in the database. It does not
 * interrupt a subprocess already running in the worker process — this API
 * route runs in the Next.js server process, which never holds that child
 * process handle. Cross-process signalling to actually kill an in-flight
 * `last30days` run was explicitly out of scope for this task.
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
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
  }

  const before = await getRunById(runId);
  const updated = await cancelRun(runId);
  if (!updated) {
    return NextResponse.json(
      { error: "Only a queued or running run can be cancelled." },
      { status: 409 },
    );
  }

  await recordAudit(session.id, "cancel", "research_run", runId, before, updated);
  return NextResponse.json({ run: updated }, { status: 200 });
}
