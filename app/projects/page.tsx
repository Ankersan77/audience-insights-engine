import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { listResearchProjects } from "@/src/db/queries/projects";
import { requireSession } from "@/src/lib/auth";
import { canResearch } from "@/src/lib/roles";
import { ProjectsWorkspace } from "./ProjectsWorkspace";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await requireSession("/projects");
  return <AppShell user={session}><PageHeader title="Ask / Projects" description="Durable decision workrooms for evidence-backed questions, briefs and follow-up research." /><ProjectsWorkspace projects={await listResearchProjects(session.clientId)} canResearch={canResearch(session)} /></AppShell>;
}
