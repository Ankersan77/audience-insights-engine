import { NextResponse } from "next/server";
import { listPeriodicBriefings } from "@/src/db/queries/briefings";
import { getSession } from "@/src/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  return NextResponse.json({ briefings: await listPeriodicBriefings(session.clientId) });
}
