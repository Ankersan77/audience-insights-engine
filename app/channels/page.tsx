import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { requireSession } from "@/src/lib/auth";
import { listAllChannels } from "@/src/db/queries/channels";
import { listBrands } from "@/src/db/queries/brands";
import { getScopeView } from "@/src/db/queries/insight_routes";
import { ChannelsManager } from "./ChannelsManager";

export const dynamic = "force-dynamic";

/**
 * Channel management (E5): connect Slack channels and Drive folders (T15/T16)
 * and map Insight Types to them, globally or per Brand (T17). A viewer sees
 * everything on this page but no picker, no "add channel" controls, and no
 * remove buttons (T11's pattern — never rendered, not disabled).
 */
export default async function ChannelsPage() {
  const session = await requireSession("/channels");

  const [channels, brandRows, globalView] = await Promise.all([
    listAllChannels(),
    listBrands(),
    getScopeView(null),
  ]);

  const brands = brandRows
    .filter((b) => b.status === "active")
    .map((b) => ({ id: b.id, name: b.name }));

  return (
    <AppShell user={session}>
      <PageHeader
        title="Channels"
        description="Connect Slack channels and Drive folders, and map each insight type to where it gets delivered."
      />
      <ChannelsManager
        initialChannels={channels}
        brands={brands}
        initialGlobalView={globalView}
        isAdmin={session.role === "admin"}
      />
    </AppShell>
  );
}
