import { NextResponse } from "next/server";
import { getSolutionProfile } from "@/src/db/queries/solution_profiles";
import { listSensingProfiles } from "@/src/db/queries/monitoring";
import { getSession } from "@/src/lib/auth";
import { exportSolutionProfile } from "@/src/packaging/solution";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid-profile" }, { status: 400 });
  const row = await getSolutionProfile(session.clientId, id);
  if (!row) return NextResponse.json({ error: "profile-not-found" }, { status: 404 });
  const sensingProfiles = row.profile.sensingProfileId ? await listSensingProfiles(session.clientId) : [];
  const sensing = sensingProfiles.find((item) => item.profile.id === row.profile.sensingProfileId)?.profile;
  if (row.profile.sensingProfileId && !sensing) return NextResponse.json({ error: "bound-sensing-profile-not-found" }, { status: 409 });
  return NextResponse.json(exportSolutionProfile(row.profile, new Date().toISOString(), sensing), {
    headers: { "Content-Disposition": `attachment; filename="market-research-profile-v${row.profile.version}.json"` },
  });
}

