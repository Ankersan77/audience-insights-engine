import { notFound } from "next/navigation";
import { DECISION_BRIEF_ABILITIES } from "@/src/abilities/catalog";
import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { listCanonicalEvidence } from "@/src/db/queries/canonical_evidence";
import { getResearchProject } from "@/src/db/queries/projects";
import { listDecisionBriefs } from "@/src/db/queries/workspace_intelligence";
import { requireSession } from "@/src/lib/auth";
import { canResearch } from "@/src/lib/roles";
import { DecisionBriefs } from "@/app/workspace/DecisionBriefs";
import { ProjectControls } from "./ProjectControls";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const session = await requireSession(`/projects/${(await params).id}`);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [project, evidence, briefs] = await Promise.all([getResearchProject(session.clientId, id), listCanonicalEvidence(session.clientId), listDecisionBriefs(session.clientId, id)]);
  if (!project) notFound();
  return <AppShell user={session}><PageHeader title={project.name} description={project.decision} />
    <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"><div><p className="text-xs font-medium text-muted uppercase">{project.status} · {project.markets.join(", ")} · {project.languages.join(", ")}</p><p className="mt-1 text-sm text-muted">Every brief remains versioned, cited and bound to this client workroom.</p></div>{canResearch(session) ? <ProjectControls id={project.id} status={project.status} /> : null}</section>
    <DecisionBriefs abilities={DECISION_BRIEF_ABILITIES} evidence={evidence} initialBriefs={briefs} canResearch={canResearch(session) && project.status === "active"} projectId={id} />
  </AppShell>;
}
