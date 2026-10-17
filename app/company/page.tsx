import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { requireSession } from "@/src/lib/auth";
import { isAdmin } from "@/src/lib/roles";
import { companyContextEnvelope, listCompanyContextHistory } from "@/src/db/queries/company_context";
import { listSourceConnections } from "@/src/db/queries/sources";
import { CompanyWorkspace } from "./CompanyWorkspace";

export const dynamic = "force-dynamic";
export default async function CompanyPage() {
  const session = await requireSession("/company");
  const [context, history, sources] = await Promise.all([companyContextEnvelope(session.clientId), listCompanyContextHistory(session.clientId), listSourceConnections(session.clientId)]);
  return <AppShell user={session}><PageHeader title="Company context" description="One maintained business profile reused across research tasks. Owner declarations stay distinct from evidence and aggregate business data." />
    <CompanyWorkspace initial={context.current} gaps={context.gaps} history={history} canEdit={isAdmin(session)} sources={sources.filter((item) => ["client_owned", "first_party_aggregate"].includes(item.sourceClass)).map((item) => ({ id: item.id, name: item.connectorId, sourceClass: item.sourceClass, health: item.health }))} />
  </AppShell>;
}
