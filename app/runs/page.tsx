import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { requireSession } from "@/src/lib/auth";
import { listRuns } from "@/src/db/queries/research_runs";
import { RunsTable } from "./RunsTable";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const session = await requireSession("/runs");
  const runs = await listRuns();

  return (
    <AppShell user={session}>
      <PageHeader
        title="Runs"
        description="Every research run across every brand, newest first."
      />
      <RunsTable runs={runs} isAdmin={session.role === "admin"} />
    </AppShell>
  );
}
