import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { listCanonicalEvidence } from "@/src/db/queries/canonical_evidence";
import { listCampaignWorkspace, listStudies } from "@/src/db/queries/campaign_workspace";
import { requireSession } from "@/src/lib/auth";
import { CampaignWorkspace } from "./CampaignWorkspace";
import { canResearch, canReview } from "@/src/lib/roles";
import { listIntelligenceRecords } from "@/src/db/queries/workspace_intelligence";
import { listCampaignObservationChoices } from "@/src/db/queries/campaign_results";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const session = await requireSession("/campaigns");
  const [campaigns, evidence, studies, intelligence, observations] = await Promise.all([
    listCampaignWorkspace(session.clientId),
    listCanonicalEvidence(session.clientId, 100),
    listStudies(session.clientId),
    listIntelligenceRecords(session.clientId),
    listCampaignObservationChoices(session.clientId),
  ]);
  return <AppShell user={session}>
    <PageHeader title="Campaigns & measurement" description="Versioned campaign decisions, measurement readiness, study classification, and guarded Brand Lift language." />
    <CampaignWorkspace initialCampaigns={campaigns} evidence={evidence} initialStudies={studies} intelligence={intelligence} observations={observations} canResearch={canResearch(session)} canReview={canReview(session)} />
  </AppShell>;
}

