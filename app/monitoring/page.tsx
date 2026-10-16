import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { listMonitoringRuns, listSensingProfiles } from "@/src/db/queries/monitoring";
import { listSourceConnections } from "@/src/db/queries/sources";
import { requireSession } from "@/src/lib/auth";
import { canResearch, isAdmin } from "@/src/lib/roles";
import { MonitoringWorkspace } from "./MonitoringWorkspace";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const session = await requireSession("/monitoring");
  const [profiles, runs, sources] = await Promise.all([listSensingProfiles(session.clientId), listMonitoringRuns(session.clientId), listSourceConnections(session.clientId)]);
  return <AppShell user={session}><PageHeader title="Monitoring" description="Selective, cadence-bound sensing with durable jobs, visible no-change outcomes, and no automatic learning." /><MonitoringWorkspace initialProfiles={profiles} initialRuns={runs} sources={sources} canAdminister={isAdmin(session)} canRun={canResearch(session)} /></AppShell>;
}

