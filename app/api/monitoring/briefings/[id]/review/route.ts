import { NextRequest, NextResponse } from "next/server";
import { reviewPeriodicBriefing } from "@/src/db/queries/briefings";
import { getSession } from "@/src/lib/auth";
import { assertReview, PermissionDeniedError } from "@/src/lib/roles";

export async function POST(request: NextRequest, context: RouteContext<"/api/monitoring/briefings/[id]/review">) {
  const session = await getSession();
  try { assertReview(session); } catch (error) { if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 }); throw error; }
  const id = Number((await context.params).id);
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid-json" }, { status: 400 }); }
  const decision = body && typeof body === "object" && "decision" in body ? body.decision : undefined;
  if (!Number.isSafeInteger(id) || id < 1 || (decision !== "accepted" && decision !== "rejected")) return NextResponse.json({ error: "valid-briefing-and-decision-required" }, { status: 400 });
  try {
    const changed = await reviewPeriodicBriefing({ clientId: session.clientId, id, reviewerUserId: session.id, decision, now: new Date() });
    return changed ? NextResponse.json({ reviewed: true }) : NextResponse.json({ error: "pending-briefing-not-found" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "briefing-evidence-incomplete-or-expired") return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
