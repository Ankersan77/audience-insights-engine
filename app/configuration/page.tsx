import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { ABILITY_CATALOG } from "@/src/abilities/catalog";
import { listSensingProfiles } from "@/src/db/queries/monitoring";
import { listSolutionProfiles } from "@/src/db/queries/solution_profiles";
import { listSourceConnections } from "@/src/db/queries/sources";
import { requireSession } from "@/src/lib/auth";
import { isAdmin } from "@/src/lib/roles";
import { ConfigurationWorkspace } from "./ConfigurationWorkspace";
import { SourceConnections } from "@/app/workspace/SourceConnections";
import { BudgetAdministration } from "./BudgetAdministration";
import { loadBudgetWorkspace } from "@/src/db/queries/budget_workspace";

export const dynamic = "force-dynamic";

export default async function ConfigurationPage() {
  const session = await requireSession("/configuration");
  const budgets = isAdmin(session) ? await loadBudgetWorkspace(session.clientId) : null;
  const [profiles, sources, sensing] = await Promise.all([listSolutionProfiles(session.clientId), listSourceConnections(session.clientId), listSensingProfiles(session.clientId)]);
  return <AppShell user={session}><PageHeader title="Sources & Setup" description="Governed connectors plus versioned abilities, provider bindings, markets, roles, retention and sensing—portable without credentials or client evidence." />{budgets ? <BudgetAdministration initial={budgets} /> : null}<SourceConnections initialSources={sources} isAdmin={isAdmin(session)} /><div className="mt-6"><ConfigurationWorkspace profiles={profiles} abilities={ABILITY_CATALOG} sources={sources} sensing={sensing} canAdminister={isAdmin(session)} /></div></AppShell>;
}

