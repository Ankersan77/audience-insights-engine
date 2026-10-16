import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { listAcquisitionJobs, listMonitoringRuns, listSensingProfiles } from "@/src/db/queries/monitoring";
import { listSourceConnections } from "@/src/db/queries/sources";
import { listIntelligenceRecords } from "@/src/db/queries/workspace_intelligence";
import { requireSession } from "@/src/lib/auth";
import { canResearch, canReview, isAdmin } from "@/src/lib/roles";
import { MonitoringWorkspace } from "./MonitoringWorkspace";
import { BriefingWorkspace } from "./BriefingWorkspace";
import { listPeriodicBriefings } from "@/src/db/queries/briefings";
import { getActiveSolutionProfile } from "@/src/db/queries/solution_profiles";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const session = await requireSession("/monitoring");
  const [profiles, runs, sources, jobs, intelligence] = await Promise.all([listSensingProfiles(session.clientId), listMonitoringRuns(session.clientId), listSourceConnections(session.clientId), listAcquisitionJobs(session.clientId), listIntelligenceRecords(session.clientId)]);
  const signals = intelligence.filter((item) => item.kind === "signal");
  const [briefings, solution] = await Promise.all([listPeriodicBriefings(session.clientId), getActiveSolutionProfile(session.clientId)]);
  return <AppShell user={session}><PageHeader title="Market Pulse" description="Selective, source-backed changes, visible no-change outcomes, and pending-review signals that never become learning automatically." /><MonitoringWorkspace initialProfiles={profiles} initialRuns={runs} initialJobs={jobs} initialSignals={signals} sources={sources} canAdminister={isAdmin(session)} canRun={canResearch(session)} /><BriefingWorkspace initialBriefings={briefings} configuration={solution ? { id: solution.id, cadences: solution.briefingCadences ?? [] } : null} canAdminister={isAdmin(session)} canReview={canReview(session)} /></AppShell>;
}

