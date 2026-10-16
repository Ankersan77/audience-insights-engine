import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { requireSession } from "@/src/lib/auth";
import { listRuns } from "@/src/db/queries/research_runs";
import { RunsTable } from "./RunsTable";
import { legacyLast30DaysEnabled } from "@/src/lib/featureFlags";
import { isAdmin } from "@/src/lib/roles";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const session = await requireSession("/runs");
  const runs = await listRuns(session.clientId);

  return (
    <AppShell user={session}>
      <PageHeader
        title="Legacy runs"
        description="Historical Last30Days runs retained for migration traceability. New research uses the governed evidence workspace."
      />
      {!legacyLast30DaysEnabled() ? (
        <div className="mb-6 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          Legacy ingestion is disabled by default because it does not satisfy the canonical people-blind evidence contract.
        </div>
      ) : null}
      <RunsTable runs={runs} isAdmin={isAdmin(session)} />
    </AppShell>
  );
}
