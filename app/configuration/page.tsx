import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { ABILITY_CATALOG } from "@/src/abilities/catalog";
import { listSensingProfiles } from "@/src/db/queries/monitoring";
import { listSolutionProfiles } from "@/src/db/queries/solution_profiles";
import { listSourceConnections } from "@/src/db/queries/sources";
import { requireSession } from "@/src/lib/auth";
import { isAdmin } from "@/src/lib/roles";
import { ConfigurationWorkspace } from "./ConfigurationWorkspace";

export const dynamic = "force-dynamic";

export default async function ConfigurationPage() {
  const session = await requireSession("/configuration");
  const [profiles, sources, sensing] = await Promise.all([listSolutionProfiles(session.clientId), listSourceConnections(session.clientId), listSensingProfiles(session.clientId)]);
  return <AppShell user={session}><PageHeader title="Solution configuration" description="Versioned abilities, provider bindings, markets, roles, retention and sensing—portable without credentials or client evidence." /><ConfigurationWorkspace profiles={profiles} abilities={ABILITY_CATALOG} sources={sources} sensing={sensing} canAdminister={isAdmin(session)} /></AppShell>;
}

