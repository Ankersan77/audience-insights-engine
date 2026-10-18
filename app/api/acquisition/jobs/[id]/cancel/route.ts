import { NextResponse } from "next/server";
import { cancelAcquisitionJobForAdministration } from "@/src/application/acquisitionCancellation";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(_request: Request, context: RouteContext<"/api/acquisition/jobs/[id]/cancel">) {
  const session = await getSession();
  try {
    assertResearchWrite(session);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "valid-job-required" }, { status: 400 });

  const result = await cancelAcquisitionJobForAdministration({
    clientId: session.clientId,
    actorUserId: session.id,
    jobId: id,
    now: new Date(),
  });
  if (result === "unavailable") return NextResponse.json({ error: "job-not-cancellable" }, { status: 409 });
  return NextResponse.json({ id, status: "cancelled", replayed: result === "already_cancelled" });
}
